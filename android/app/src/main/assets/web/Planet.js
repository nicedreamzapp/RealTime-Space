// Close-up texture budget for THIS device (Android fork, added 2026-11-04 after two PowerVR GPU stalls on a
// 3 GB Cricket phone right when Jupiter's 4096x2048 close-up map swapped in). Native reports memory through
// AndroidBridge.deviceInfo(); low-end or <=4 GB devices keep the bundled 2048 maps (no close-up swap) and no
// anisotropic filtering. Bigger devices still swap, capped by GL_MAX_TEXTURE_SIZE, decoded off the main thread.
function rtsTexBudget() {
    if (window.__rtsTexBudget) return window.__rtsTexBudget;
    let dev = null;
    try { dev = JSON.parse(window.AndroidBridge && window.AndroidBridge.deviceInfo ? window.AndroidBridge.deviceInfo() : 'null'); } catch (e) {}
    const r = (typeof rendererCore !== 'undefined' && rendererCore && rendererCore.renderer) || null;
    const caps = r && r.capabilities;
    const maxTex = caps && caps.maxTextureSize ? caps.maxTextureSize : 2048;
    const maxAniso = caps && caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 8;
    const low = !dev || dev.lowRam || dev.totalMB <= 4096 || dev.memClassMB < 256;
    const b = { maxSize: low ? 2048 : Math.min(maxTex, 8192), aniso: low ? 1 : Math.min(maxAniso, 8), low, dev, maxTex };
    if (dev && caps) { window.__rtsTexBudget = b; console.log('🧮 texture budget ' + JSON.stringify(b)); }
    return b;
}
window.rtsTexBudget = rtsTexBudget;
function rtsAniso(want) { return Math.max(1, Math.min(want, rtsTexBudget().aniso)); }
window.rtsAniso = rtsAniso;
// Decode a big texture with createImageBitmap (off the main thread), push it to the GPU on its own frame
// with initTexture, then hand it back. Falls back to TextureLoader where ImageBitmap is missing.
function rtsLoadStaged(path, onTex, onErr) {
    const r = (typeof rendererCore !== 'undefined' && rendererCore && rendererCore.renderer) || null;
    if (typeof createImageBitmap === 'function' && THREE.ImageBitmapLoader) {
        const l = new THREE.ImageBitmapLoader(); l.setOptions({ imageOrientation: 'flipY' });
        l.load(path, (bmp) => {
            const tex = new THREE.Texture(bmp); tex.flipY = false; tex.needsUpdate = true;
            setTimeout(() => { try { if (r && r.initTexture) r.initTexture(tex); } catch (e) {}
                requestAnimationFrame(() => onTex(tex)); }, 0);
        }, undefined, onErr);
    } else {
        new THREE.TextureLoader().load(path, onTex, undefined, onErr);
    }
}

// Planet.js - planet rendering.
// Real NASA/ESA texture maps for the solar-system bodies, procedural noise textures for
// generated worlds. Earth gets a physically based scattering atmosphere
// (Rayleigh + Mie + ozone), cloud shadows, airglow and a volumetric aurora; every other
// atmosphere is a simple view-angle limb glow (not a scattering model).

// Shared GLSL: soft eclipse shadows cast by spherical occluders (moons/planets) and
// ring-plane shadows (Saturn's rings on the planet). The penumbra is approximated by
// comparing the angular radii of the sun and occluder discs as seen from the fragment.
const ECLIPSE_SHADOW_GLSL = `
    uniform vec3 uSunPos;
    uniform float uSunRadius;
    uniform vec4 uOccluders[4];
    uniform int uOccluderCount;

    float occluderShadow(vec3 P, vec4 occ) {
        vec3 toSun = uSunPos - P;
        float dSun = length(toSun);
        vec3 L = toSun / dSun;
        vec3 toOcc = occ.xyz - P;
        float dOcc = length(toOcc);
        if (dOcc > dSun) return 1.0;        // occluder is farther than the sun
        if (dOcc < occ.w * 1.05) return 1.0; // fragment is on/in the occluder itself
        float aSun = asin(clamp(uSunRadius / dSun, 0.0, 1.0));
        float aOcc = asin(clamp(occ.w / dOcc, 0.0, 1.0));
        float sep  = acos(clamp(dot(L, toOcc / dOcc), -1.0, 1.0));
        float f = clamp((aOcc + aSun - sep) / max(2.0 * aSun, 1e-4), 0.0, 1.0);
        f = f * f * (3.0 - 2.0 * f);
        return 1.0 - f;
    }

    float eclipseShadow(vec3 P) {
        float s = 1.0;
        for (int i = 0; i < 4; i++) {
            if (i >= uOccluderCount) break;
            s *= occluderShadow(P, uOccluders[i]);
        }
        return s;
    }
`;

const RING_SHADOW_GLSL = `
    uniform sampler2D uRingMap;
    uniform vec3 uRingCenter;
    uniform vec3 uRingNormal;
    uniform vec2 uRingRadii; // x: inner, y: outer (world units)

    float ringShadow(vec3 P) {
        vec3 L = normalize(uSunPos - P);
        float denom = dot(L, uRingNormal);
        if (abs(denom) < 1e-4) return 1.0;
        float t = dot(uRingCenter - P, uRingNormal) / denom;
        if (t <= 0.0) return 1.0; // sun ray doesn't cross the ring plane
        vec3 hit = P + L * t;
        float r = length(hit - uRingCenter);
        if (r < uRingRadii.x || r > uRingRadii.y) return 1.0;
        float u = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
        float a = texture2D(uRingMap, vec2(u, 0.5)).a;
        return 1.0 - a * 0.88;
    }
`;

// ---------------------------------------------------------------------------
// Earth atmosphere: Rayleigh + Mie scattering + ozone absorption (single scattering
// ray-marched, multiple scattering approximated).
//
// Everything is evaluated in KILOMETRES around the planet centre (world units are
// rescaled by uKmPerUnit), with the measured Earth coefficients used by
// Bruneton 2017 / Hillaire 2020 (sea-level values, per km):
//   Rayleigh scattering   (5.802, 13.558, 33.1) e-3, scale height 8 km
//   Mie scattering         3.996 e-3, absorption 4.40 e-3, scale height 1.2 km, g = 0.8
//   Ozone absorption      (0.650, 1.881, 0.085) e-3, tent profile centred at 25 km
// The atmosphere is cut off at 100 km. The view ray is ray-marched (step count set
// by the quality tier); sunlight reaching each sample is attenuated with Schuler's
// analytic Chapman-function approximation (GPU Pro 3) instead of a second march,
// so the cost is O(steps), not O(steps^2). Higher scattering orders are only
// approximated (an isotropic term proportional to the single-scattered source).
// Night-side limb: the thin green OI 557.7 nm airglow layer (~95 km, seen as a
// faint band in every ISS night pass) is added as a Gaussian emission layer.
// ---------------------------------------------------------------------------
const EARTH_ATMO_GLSL = `
    #define ATMO_RG 6371.0
    #define ATMO_RT 6471.0
    #define ATMO_HR 8.0
    #define ATMO_HM 1.2
    const vec3  ATMO_BR   = vec3(5.802e-3, 13.558e-3, 33.1e-3);
    const float ATMO_BM_S = 3.996e-3;
    const float ATMO_BM_E = 3.996e-3 + 4.40e-3;
    const vec3  ATMO_BO   = vec3(0.650e-3, 1.881e-3, 0.085e-3);
    const float ATMO_G    = 0.8;
    const vec3  AIRGLOW_RGB = vec3(0.35, 1.0, 0.30); // OI 557.7 nm green line

    // Ray / sphere (centred at origin): returns (tNear, tFar); tNear > tFar = miss.
    vec2 atmoRaySphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float d = b * b - c;
        if (d < 0.0) return vec2(1e9, -1e9);
        d = sqrt(d);
        return vec2(-b - d, -b + d);
    }

    // Schuler's Chapman approximation. X and h are in units of the 50% height
    // (H*ln2); returns Ch(x, chi) * 2^-h, i.e. slant column / (H * rho0).
    float atmoChapman(float X, float h, float coschi) {
        float c = sqrt(X + h);
        if (coschi >= 0.0) {
            return c / (c * coschi + 1.0) * exp2(-h);
        }
        float x0 = sqrt(max(1.0 - coschi * coschi, 0.0)) * (X + h);
        float c0 = sqrt(x0);
        // sun below the geometric horizon: through-the-planet path -> huge depth
        return 2.0 * c0 * exp2(min(X - x0, 80.0)) - c / (1.0 - c * coschi) * exp2(-h);
    }

    // Fraction of the ozone column (tent 10-40 km) that lies above altitude h.
    float atmoOzoneAbove(float h) {
        float x = clamp((h - 10.0) / 30.0, 0.0, 1.0);
        return x < 0.5 ? 1.0 - 2.0 * x * x : 2.0 * (1.0 - x) * (1.0 - x);
    }

    // Transmittance of sunlight from the top of the atmosphere down to altitude h
    // (km), sun at zenith cosine coschi.
    vec3 atmoSunTransmittance(float h, float coschi) {
        const float LN2 = 0.693147;
        float hr50 = ATMO_HR * LN2, hm50 = ATMO_HM * LN2;
        float chR = atmoChapman(ATMO_RG / hr50, h / hr50, coschi);
        float chM = atmoChapman(ATMO_RG / hm50, h / hm50, coschi);
        // ozone: 15 km-equivalent vertical column treated as a thin shell at 25 km
        // (thin-layer air mass 1/cos of the zenith angle where the ray crosses it)
        float rr = (ATMO_RG + h) / (ATMO_RG + 25.0);
        float sin2 = (1.0 - coschi * coschi) * rr * rr;
        float airmassO3 = 1.0 / sqrt(max(1.0 - min(sin2, 1.0), 4e-3));
        vec3 tau = ATMO_BR * ATMO_HR * chR
                 + ATMO_BM_E * ATMO_HM * chM
                 + ATMO_BO * 15.0 * atmoOzoneAbove(h) * airmassO3;
        return exp(-tau);
    }

    // Single-scattered radiance along ro + rd*[0, tMax] (km) plus the view-path
    // transmittance. sunE is the solar irradiance in the shader's radiance units.
    vec3 atmoInscatter(vec3 ro, vec3 rd, float tMax, vec3 L, float sunE,
                       float airglow, float jitter, out vec3 transmittance) {
        transmittance = vec3(1.0);
        vec2 ta = atmoRaySphere(ro, rd, ATMO_RT);
        float t0 = max(ta.x, 0.0);
        float t1 = min(ta.y, tMax);
        if (t1 <= t0) return vec3(0.0);
        float ds = (t1 - t0) / float(ATMO_STEPS);
        float mu = dot(rd, L);
        float phaseR = 0.0596831 * (1.0 + mu * mu);                    // 3/(16pi)
        float g2 = ATMO_G * ATMO_G;
        float phaseM = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu)        // Cornette-Shanks
                     / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * ATMO_G * mu, 1e-4), 1.5));
        vec3 tau = vec3(0.0);
        vec3 sumR = vec3(0.0), sumM = vec3(0.0);
        float glow = 0.0;
        for (int i = 0; i < ATMO_STEPS; i++) {
            float t = t0 + (float(i) + jitter) * ds;
            vec3 p = ro + rd * t;
            float r = length(p);
            float h = max(r - ATMO_RG, 0.0);
            float dR = exp(-h / ATMO_HR);
            float dM = exp(-h / ATMO_HM);
            float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
            vec3 stepTau = (ATMO_BR * dR + ATMO_BM_E * dM + ATMO_BO * dO) * ds;
            vec3 Tv = exp(-(tau + 0.5 * stepTau));
            tau += stepTau;
            vec3 Ts = atmoSunTransmittance(h, dot(p, L) / r);
            sumR += Tv * Ts * (dR * ds);
            sumM += Tv * Ts * (dM * ds);
            // airglow is ~1e-4 of the daylit sky, so it only counts in darkness
            float ag = (h - 95.0) / 6.0;
            float dark = 1.0 - smoothstep(-0.25, -0.05, dot(p, L) / r);
            glow += Tv.g * exp(-ag * ag) * dark * ds;
        }
        transmittance = exp(-tau);
        // Approximate multiple scattering: higher scattering orders treated as an
        // isotropic source proportional to the single-scattering source (the idea of
        // Hillaire 2020, with a constant transfer factor instead of his LUT; bluer
        // light scatters more often, so it gains more).
        const vec3 ATMO_MS = vec3(0.45, 0.55, 0.75) * 0.0795775;   // x 1/(4pi)
        return sunE * (ATMO_BR * (phaseR * sumR + ATMO_MS * sumR)
                     + ATMO_BM_S * (phaseM * sumM + ATMO_MS * sumM))
             + AIRGLOW_RGB * (glow * airglow);
    }

    // Interleaved gradient noise (Jimenez 2014) for per-pixel step jitter.
    float atmoIGN(vec2 px) {
        return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
    }
`;

// Rendering quality tier for the expensive Earth effects: the global RTQuality tier
// (RTQuality.js is the single source of truth, ?rtq= / ?tier= overrides it for testing).
function planetQualityTier() {
    const t = window.RTQuality && window.RTQuality.tier;
    return (t === 'high' || t === 'medium' || t === 'low') ? t : 'medium';
}
const EARTH_QUALITY = {
    //          sky steps, surface aerial-perspective steps, aurora steps
    high:   { sky: 16, ap: 8, aurora: 32 },
    medium: { sky: 10, ap: 5, aurora: 20 },
    low:    { sky: 6,  ap: 3, aurora: 12 }
};

// Geomagnetic north pole (IGRF-14, 2025): 80.8 N, 72.8 W. Earth-fixed unit vector in
// the sphere's object space (u = 0.5 is the prime meridian on the Blue Marble map).
function earthFixedDir(latDeg, lonDeg) {
    const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
    return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

// Mark a colour texture as sRGB-encoded for whichever three.js API is present
// (r150 reads .encoding, r152+ reads .colorSpace).
function markSRGB(tex) {
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
}

const _planetTmpVec = new THREE.Vector3();
const _planetTmpQuat = new THREE.Quaternion();
const _planetTmpMat4 = new THREE.Matrix4();
const _planetSunOrigin = new THREE.Vector3(0, 0, 0);

class Planet {
    constructor(config = {}) {
        this.name = config.name || "Planet";
        this.radius = config.radius || 1.0;
        this.color = config.color || 0x4a90e2;
        this.position = config.position || { x: 0, y: 0, z: 0 };
        this.hasAtmosphere = config.hasAtmosphere !== false;
        this.atmosphereColor = config.atmosphereColor || 0x88ccff;
        this.atmosphereDensity = config.atmosphereDensity || 1.0;
        this.orbitalData = config.orbitalData || null;
        this.rotationPeriod = config.rotationPeriod || 24;
        this.type = "planet";
        this.planetType = config.planetType || "rocky";
        this.hasRings = config.hasRings || false;
        this.hasClouds = config.hasClouds || (this.planetType === "rocky" && this.hasAtmosphere);
        this.seed = config.seed || Math.random() * 10000;

        // New advanced features
        // Aurora is only modelled for Earth (volumetric auroral ovals around the real
        // geomagnetic poles). Other bodies ignore the flag.
        this.hasAurora = config.hasAurora !== undefined ? !!config.hasAurora : (config.texturePack === "earth");
        // Flags kept for API compatibility; nothing renders volcanoes or ice caps yet.
        this.hasVolcanicActivity = config.hasVolcanicActivity || (this.planetType === "rocky" && Math.random() > 0.7);
        this.hasIceCaps = config.hasIceCaps || (this.planetType === "rocky" && Math.random() > 0.4);
        this.hasCities = config.hasCities || false; // Night-side city lights
        this.oceanLevel = config.oceanLevel || 0.4;
        // Real planets pass their true tilt; procedural worlds keep a random one.
        // (This random fallback + no data from planetData was why Saturn's ring
        // angle changed every launch.)
        this.axialTilt = config.axialTilt !== undefined ? config.axialTilt : Math.random() * 0.5; // Radians
        // True pole direction for bodies placed by the real ephemeris (Earth): the north pole
        // leans toward ecliptic longitude 90 deg (J2000 NCP = lon 90, lat 66.56).
        this.poleTowardEclipticLon90 = !!config.poleTowardEclipticLon90;
        this.magneticFieldStrength = config.magneticFieldStrength || (this.hasAurora ? 0.5 + Math.random() * 0.5 : 0);
        this.texturePack = config.texturePack || null;

        // Terrain features
        this.terrainConfig = {
            mountainHeight: 0.15 + Math.random() * 0.2,
            craterDensity: this.planetType === "rocky" ? 0.1 + Math.random() * 0.3 : 0,
            continentalDrift: Math.random(),
            vegetationLevel: this.hasAtmosphere ? 0.3 + Math.random() * 0.5 : 0,
            desertLevel: 0.1 + Math.random() * 0.3
        };

        this.time = 0;
        this.uniforms = {};

        // Eclipse-shadow state: occluders are other bodies ({mesh, radius}) that can
        // pass between this planet and the sun. Uniforms are shared by reference with
        // every shader this planet owns (surface, Earth shader, rings).
        this._occluders = [];
        this._shadowUniforms = {
            uSunPos: { value: new THREE.Vector3(0, 0, 0) },
            uSunRadius: { value: 15.0 },
            uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
            uOccluderCount: { value: 0 }
        };

        this.createMesh();

        console.log(`🌍 Created HUBBLE-QUALITY planet: ${this.name} (${this.planetType})`);
    }

    // Bodies that can cast shadows onto this planet (e.g. its moons, or its parent).
    setOccluders(list) {
        this._occluders = (list || []).slice(0, 4);
    }

    // Wires soft eclipse shadows (and optionally ring shadows) into a built-in
    // material (MeshStandardMaterial etc.) via onBeforeCompile injection.
    _injectShadows(material, opts = {}) {
        const shadowUniforms = this._shadowUniforms;
        const ringUniforms = opts.ringUniforms || null;

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, shadowUniforms);
            let head = ECLIPSE_SHADOW_GLSL;
            let apply = 'float planetShadow = eclipseShadow(vEclipseWorldPos);\n';
            if (ringUniforms) {
                Object.assign(shader.uniforms, ringUniforms);
                head += RING_SHADOW_GLSL;
                apply += 'planetShadow *= ringShadow(vEclipseWorldPos);\n';
            }
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEclipseWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;\n' + head)
                .replace('#include <output_fragment>', apply + 'outgoingLight *= mix(0.04, 1.0, planetShadow);\n#include <output_fragment>');
        };
        material.customProgramCacheKey = () => 'planet-shadow' + (ringUniforms ? '-ring' : '');
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        const segments = this.texturePack ? 256 : (this.radius > 2 ? 128 : 64);

        if (this.texturePack === "earth") {
            this._createPhotorealEarth(segments);
        } else if (this.texturePack) {
            // Generic photoreal path: real color map, optional bump, MeshStandardMaterial.
            // Gas/ice giants get matching texture pack (Jupiter bands, Saturn, etc).
            this._createTexturedPlanet(segments);
        } else if (this.planetType === "gas") {
            this._createGasGiant(segments);
        } else if (this.planetType === "ice") {
            this._createIcePlanet(segments);
        } else {
            this._createRockyPlanet(segments);
        }

        if (this.hasAtmosphere) {
            this._createRealisticAtmosphere();
        }

        if (this.hasClouds && this.planetType === "rocky") {
            this._createCloudLayer();
        }

        if (this.hasRings) {
            this._createRings();
        }

        // Aurora effects for magnetic planets
        if (this.hasAurora && this.hasAtmosphere) {
            this._createAurora();
        }

        // Night-side city lights (for advanced civilizations)
        if (this.hasCities) {
            this._createCityLights();
        }

        // Follow the global quality tier live (RTQuality 'rtquality' event).
        if (this.texturePack === "earth" && typeof window !== 'undefined' && !this._onRtq) {
            this._onRtq = () => this._applyEarthQuality();
            window.addEventListener('rtquality', this._onRtq);
        }
    }

    // Re-set the ray-march step counts for the current tier (one recompile per change).
    _applyEarthQuality() {
        const q = EARTH_QUALITY[planetQualityTier()];
        const U = this.uniforms || {};
        this.mesh.traverse(o => {
            const m = o.material;
            if (!m || !m.defines) return;
            let n = null, k = null;
            if ('AURORA_STEPS' in m.defines) { k = 'AURORA_STEPS'; n = q.aurora; }
            else if ('ATMO_STEPS' in m.defines) {
                k = 'ATMO_STEPS';
                n = (m.uniforms === U.atmosphere) ? q.sky : (m.uniforms === U.earth ? q.ap : null);
            }
            if (k && n != null && m.defines[k] !== n) { m.defines[k] = n; m.needsUpdate = true; }
        });
    }

    // AURORA (Earth only) - volumetric emission ray-marched through a 90-400 km shell.
    //  * Ovals sit around the GEOMAGNETIC poles (80.8 N, 72.8 W and its antipode),
    //    which are fixed to the crust and rotate with the planet, while the oval's
    //    shape is fixed relative to the Sun: it reaches ~66 deg magnetic latitude on
    //    the night side and ~72 deg at noon (Feldstein oval, moderate activity).
    //  * Inside the oval: several thin, folding east-west arcs (curtains). Brightness
    //    is modulated along the arc at ~5-10 km scale and held constant with altitude,
    //    which gives the vertical "rays" that follow the near-vertical field lines.
    //  * Vertical profile per ray: sharp lower edge at ~100-115 km with the green
    //    OI 557.7 nm line peaking just above it and decaying upward; the red OI
    //    630.0 nm line is a broad diffuse layer at ~200-350 km; a faint N2 pink fringe
    //    sits at the very bottom edge of bright curtains.
    //  * Only shown where the ground below is in darkness (it is swamped by daylight).
    //  Emission only (additive); the aurora lies above the 100 km atmosphere top.
    _createAurora() {
        if (this.texturePack !== 'earth') return; // only Earth's aurora is modelled
        const q = EARTH_QUALITY[planetQualityTier()];
        const kmPerUnit = 6371 / this.radius;
        const shellRadius = this.radius * (1 + 420 / 6371);
        this.uniforms.aurora = {
            uTime: { value: 0 },
            uIntensity: { value: 1.0 },
            uKmPerUnit: { value: kmPerUnit },
            uCenter: { value: new THREE.Vector3() },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uToFixed: { value: new THREE.Matrix3() },
            uMagAxis: { value: earthFixedDir(80.8, -72.8) },
            uNoise: { value: Planet._auroraNoiseTexture() }
        };
        const geo = new THREE.SphereGeometry(shellRadius * 1.004, 96, 48);
        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms.aurora,
            defines: { AURORA_STEPS: q.aurora },   // re-set on tier change (_applyEarthQuality)
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec3 vWorldPosition;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform float uTime;
                uniform float uIntensity;
                uniform float uKmPerUnit;
                uniform vec3 uCenter;
                uniform vec3 uSunDir;
                uniform mat3 uToFixed;
                uniform vec3 uMagAxis;
                varying vec3 vWorldPosition;

                #define RG 6371.0
                #define R_BOT 6461.0
                #define R_TOP 6791.0

                uniform sampler2D uNoise;
                vec4 NZ(vec2 p) { return texture2D(uNoise, p * (1.0 / 256.0)); }
                float gFine = 0.0;   // fine-ray weight, set per pixel from camera altitude
                vec2 raySphere(vec3 ro, vec3 rd, float r) {
                    float b = dot(ro, rd);
                    float c = dot(ro, ro) - r * r;
                    float d = b * b - c;
                    if (d < 0.0) return vec2(1e9, -1e9);
                    d = sqrt(d);
                    return vec2(-b - d, -b + d);
                }

                // Volume emission (linear RGB per km) at Earth-fixed point pf (km).
                vec3 auroraEmission(vec3 pf, vec3 Lf, float nightFade) {
                    float r = length(pf);
                    vec3 n = pf / r;
                    float h = r - RG;
                    float cm = dot(n, uMagAxis);
                    float hemi = cm >= 0.0 ? 1.0 : -1.0;
                    vec3 ax = uMagAxis * hemi;
                    float colat = acos(clamp(abs(cm), 0.0, 1.0));      // magnetic colatitude
                    if (colat > 0.62 || colat < 0.12) return vec3(0.0);
                    // magnetic local time angle: 0 at magnetic midnight
                    vec3 mid = -Lf - ax * dot(-Lf, ax);
                    float ml = length(mid);
                    mid = ml > 1e-4 ? mid / ml : normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
                    vec3 dusk = cross(ax, mid);
                    vec3 np = n - ax * dot(n, ax);
                    vec2 cs = normalize(vec2(dot(np, mid), dot(np, dusk)) + 1e-6);
                    float cphi = cs.x;                                  // cos(MLT angle)
                    // periodic coordinates around the oval (seam-free)
                    float seed = hemi * 17.0;
                    float t = uTime;
                    // oval centre colatitude: 23 deg at midnight, 17 deg at noon
                    float centre = radians(20.0 + 3.0 * cphi);
                    // Noise comes from a 256x256 RGBA value-noise texture (4 independent
                    // channels per fetch) - far cheaper on phone GPUs than hashing.
                    // large-scale folds and slow drift of the arc system
                    vec4 nA = NZ(cs * 3.5 + vec2(seed + t * 0.020, 0.0));
                    vec4 nB = NZ(cs * 10.0 + vec2(seed + 40.0, t * 0.050));
                    vec4 nC = NZ(cs * 26.0 + vec2(t * 0.11, seed + 80.0));
                    float fold = (nA.r - 0.5) * radians(4.0) + (nB.r - 0.5) * radians(2.0)
                               + (nC.r - 0.5) * radians(0.6);
                    float s = colat - centre - fold;
                    if (abs(s) > radians(5.5)) return vec3(0.0);
                    // arcs appear, fade and break up along the oval: each arc's strength
                    // is its own slow noise around the oval
                    float k1 = smoothstep(0.25, 0.75, nA.g);
                    float k2 = smoothstep(0.35, 0.85, nA.b);
                    float k3 = smoothstep(0.40, 0.90, nB.g);
                    float a1 = s / radians(0.30);
                    float a2 = (s + radians(1.6)) / radians(0.45);
                    float a3 = (s - radians(1.4)) / radians(0.7);
                    float arcs = k1 * exp(-a1 * a1) + 0.6 * k2 * exp(-a2 * a2) + 0.4 * k3 * exp(-a3 * a3);
                    // diffuse aurora band underneath the arcs, itself patchy
                    float band = (s + radians(0.8)) / radians(2.8);
                    float diffuse = 0.03 * exp(-band * band) * (0.3 + nB.b);
                    // brightness around the oval: strongest in the midnight sector,
                    // weak on the dayside (cusp), patchy everywhere
                    float sector = smoothstep(-0.85, 0.7, cphi);
                    // ISS passes show the oval as bright knots and folds with near-dark gaps
                    // between them, not a uniform ring: square the patchiness.
                    float pch = smoothstep(0.2, 0.85, nA.a) * (0.5 + 0.8 * nB.a);
                    float along = sector * sector * (0.08 + 1.4 * pch * pch);
                    // vertical rays: fine structure along the arc, constant with height
                    vec4 nR = NZ(cs * 140.0 + vec2(seed, t * 0.6));
                    float rayN = nR.r;
                    float rays = 0.25 + 1.1 * rayN * rayN
                               * (0.6 + 0.4 * NZ(cs * 420.0 + vec2(t * 1.3, seed)).g);
                #if AURORA_STEPS > 12
                    // Finer rays (ISS 4K aurora frames: individual rays a few km wide, many
                    // per 100 km of arc, flickering in < 1 s). Only when the camera is low
                    // enough to resolve them; at a distance they would just shimmer.
                    if (gFine > 0.0) {
                        float f = NZ(cs * 1100.0 + vec2(seed + 7.0, t * 2.2)).a;
                        rays *= mix(1.0, 0.45 + 1.6 * f * f * f, gFine);
                    }
                #endif
                    // lower edge altitude varies per ray (precipitating electron energy)
                    float hb = 103.0 + 14.0 * mix(nR.b, nC.g, 0.5);
                    float dh = h - hb;
                    float green = smoothstep(-4.0, 3.0, dh) * exp(-max(dh, 0.0) / 38.0);
                    float rz = (h - 250.0) / 75.0;
                    float red = exp(-rz * rz);
                    float pz = (dh + 1.5) / 3.0;
                    float pink = exp(-pz * pz);
                    float curtain = arcs * rays * along;
                    vec3 e = vec3(0.12, 1.0, 0.32) * (green * (curtain + diffuse))
                           + vec3(1.0, 0.08, 0.12) * (red * (0.02 * curtain + diffuse * 0.2 + 0.004 * arcs * along))
                           + vec3(0.9, 0.25, 0.65) * (pink * curtain * 0.35);
                    return e * nightFade;
                }

                void main() {
                    #include <logdepthbuf_fragment>
                    vec3 ro = (cameraPosition - uCenter) * uKmPerUnit;
                    vec3 rd = normalize(vWorldPosition - cameraPosition);
                    vec2 tt = raySphere(ro, rd, R_TOP);
                    float t0 = max(tt.x, 0.0), t1 = tt.y;
                    vec2 tg = raySphere(ro, rd, RG);
                    if (tg.x < tg.y && tg.x > 0.0) t1 = min(t1, tg.x);
                    if (t1 <= t0) discard;
                    // quick reject: whole segment far from both magnetic poles
                    vec3 L = normalize(uSunDir);
                    vec3 pa = normalize(uToFixed * (ro + rd * t0));
                    vec3 pb = normalize(uToFixed * (ro + rd * t1));
                    vec3 pm = normalize(uToFixed * (ro + rd * (0.5 * (t0 + t1))));
                    float near = max(max(abs(dot(pa, uMagAxis)), abs(dot(pb, uMagAxis))), abs(dot(pm, uMagAxis)));
                    if (near < 0.55) discard;
                    vec3 Lf = uToFixed * L;
                    gFine = 1.0 - smoothstep(1500.0, 6000.0, length(ro) - RG);
                    float ds = (t1 - t0) / float(AURORA_STEPS);
                    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                    vec3 sum = vec3(0.0);
                    for (int i = 0; i < AURORA_STEPS; i++) {
                        float t = t0 + (float(i) + jitter) * ds;
                        vec3 p = ro + rd * t;
                        float r = length(p);
                        if (r < R_BOT) continue;
                        // ground beneath this sample must be in darkness
                        float sunAlt = dot(p / r, L);
                        float nightFade = smoothstep(0.08, -0.12, sunAlt);
                        if (nightFade <= 0.0) continue;
                        sum += auroraEmission(uToFixed * p, Lf, nightFade) * ds;
                    }
                    // Scaled to the ISS night footage (Gerst 2017, ISS 4K aurora): seen edge-on the
                    // oval is a thin bright ribbon at the limb, the same order of brightness
                    // as the city lights below it, not a band that floods the frame.
                    vec3 col = sum * 0.006 * uIntensity;
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.FrontSide
        });
        const aurora = new THREE.Mesh(geo, mat);
        aurora.renderOrder = 2;
        aurora.frustumCulled = false;
        const shellOuter = shellRadius * 1.004;
        const u = this.uniforms.aurora;
        // Outside the shell: front faces, depth-tested (the Moon can occlude it).
        // Inside the shell (camera below ~420 km): back faces, no depth test, the
        // shader clips against the planet itself.
        aurora.onBeforeRender = (renderer, scene, camera) => {
            aurora.getWorldPosition(u.uCenter.value);
            const inside = camera.position.distanceTo(u.uCenter.value) < shellOuter * 1.02;
            const side = inside ? THREE.BackSide : THREE.FrontSide;
            if (mat.side !== side) { mat.side = side; mat.depthTest = !inside; }
            if (this.surface) {
                _planetTmpMat4.extractRotation(this.surface.matrixWorld);
                u.uToFixed.value.setFromMatrix4(_planetTmpMat4).transpose();
            }
        };
        this.auroraMesh = aurora;
        this.mesh.add(aurora);
    }

    // 256x256 RGBA of independent random bytes; with linear filtering and repeat
    // wrapping each channel is a tileable 2D value noise.
    static _auroraNoiseTexture() {
        if (Planet._auroraNoise) return Planet._auroraNoise;
        const n = 256, data = new Uint8Array(n * n * 4);
        let x = 0x9e3779b9;
        for (let i = 0; i < data.length; i++) {
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;   // xorshift32, deterministic
            data[i] = (x >>> 0) & 255;
        }
        const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        Planet._auroraNoise = tex;
        return tex;
    }

    _createCityLights() {
        // Procedural city lights visible on night side
        const cityGeo = new THREE.SphereGeometry(this.radius * 1.002, 128, 64);

        // Generate city light texture
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Dark background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 2048, 1024);

        // Generate city clusters on landmasses
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * 2048;
            const y = Math.random() * 1024;

            // Avoid oceans (rough approximation using noise)
            const u = x / 2048;
            const v = y / 1024;
            const isLand = this._noise2D(u * 10 + this.seed, v * 10) > -0.2;

            if (isLand) {
                // City cluster
                const clusterSize = 5 + Math.random() * 20;
                const brightness = 150 + Math.random() * 105;

                ctx.fillStyle = `rgba(255, ${brightness + 50}, ${brightness - 30}, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, clusterSize, 0, Math.PI * 2);
                ctx.fill();

                // Smaller surrounding lights
                for (let j = 0; j < 10; j++) {
                    const ox = x + (Math.random() - 0.5) * clusterSize * 4;
                    const oy = y + (Math.random() - 0.5) * clusterSize * 4;
                    ctx.fillStyle = `rgba(255, ${brightness}, ${brightness - 50}, ${0.3 + Math.random() * 0.7})`;
                    ctx.beginPath();
                    ctx.arc(ox, oy, 1 + Math.random() * 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        const cityTexture = new THREE.CanvasTexture(canvas);
        cityTexture.wrapS = THREE.RepeatWrapping;

        const cityMat = new THREE.ShaderMaterial({
            uniforms: {
                cityMap: { value: cityTexture },
                sunDirection: { value: new THREE.Vector3(1, 0, 0) }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;

                void main() {
                    vUv = uv;
                    vNormal = normal;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D cityMap;
                uniform vec3 sunDirection;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;

                void main() {
                    vec4 cityLight = texture2D(cityMap, vUv);

                    // Only visible on night side
                    float daylight = dot(vWorldNormal, sunDirection);
                    float nightFactor = smoothstep(-0.2, -0.4, daylight);

                    // Twinkle effect
                    float twinkle = 0.8 + sin(vUv.x * 1000.0) * 0.2;

                    vec3 finalColor = cityLight.rgb * nightFactor * twinkle * 2.0;
                    float alpha = cityLight.r * nightFactor * 0.8;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.cityLights = new THREE.Mesh(cityGeo, cityMat);
        this.mesh.add(this.cityLights);
    }

    // Generate procedural terrain texture
    _generateTerrainTexture(size = 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');

        // Base color from planet config
        const baseColor = new THREE.Color(this.color);
        const r = Math.floor(baseColor.r * 255);
        const g = Math.floor(baseColor.g * 255);
        const b = Math.floor(baseColor.b * 255);

        // Generate terrain using multiple noise octaves
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;

                // Spherical coordinates for seamless wrapping
                const u = x / size;
                const v = y / (size / 2);
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                // 3D position on sphere for noise
                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Multi-octave noise for terrain
                let elevation = 0;
                let amplitude = 1;
                let frequency = 2;
                let maxValue = 0;

                for (let oct = 0; oct < 8; oct++) {
                    elevation += this._noise3D(
                        nx * frequency + this.seed,
                        ny * frequency + this.seed * 0.7,
                        nz * frequency + this.seed * 0.3
                    ) * amplitude;
                    maxValue += amplitude;
                    amplitude *= 0.5;
                    frequency *= 2.1;
                }
                elevation /= maxValue;
                elevation = (elevation + 1) / 2; // Normalize to 0-1

                // Color variation based on elevation
                let cr, cg, cb;

                if (this.planetType === "rocky") {
                    // Earth-like coloring - vibrant, lifelike palette
                    if (elevation < 0.35) {
                        // Deep ocean - rich deep blue
                        cr = r * 0.1; cg = g * 0.2; cb = b * 0.85;
                    } else if (elevation < 0.4) {
                        // Shallow water - turquoise tint
                        cr = r * 0.25; cg = g * 0.55; cb = b * 1.0;
                    } else if (elevation < 0.45) {
                        // Beach/coast - warm sand
                        cr = 230; cg = 210; cb = 155;
                    } else if (elevation < 0.6) {
                        // Lowlands/grass - lush green
                        cr = r * 0.5; cg = g * 1.3; cb = b * 0.35;
                    } else if (elevation < 0.75) {
                        // Hills/forest - deep green
                        cr = r * 0.3; cg = g * 0.8; cb = b * 0.25;
                    } else if (elevation < 0.85) {
                        // Mountains - warm grey-brown
                        cr = 130; cg = 115; cb = 95;
                    } else {
                        // Snow caps - bright white
                        cr = 255; cg = 255; cb = 255;
                    }
                } else {
                    // Mars-like / barren
                    const variation = elevation * 0.4 + 0.6;
                    cr = r * variation;
                    cg = g * variation * 0.9;
                    cb = b * variation * 0.8;
                }

                // Add detail noise for surface texture
                const detail = this._noise3D(
                    nx * 50 + this.seed * 2,
                    ny * 50,
                    nz * 50
                ) * 15;

                data[i] = Math.max(0, Math.min(255, cr + detail));
                data[i + 1] = Math.max(0, Math.min(255, cg + detail));
                data[i + 2] = Math.max(0, Math.min(255, cb + detail));
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = rtsAniso(16);
        return texture;
    }

    // Generate normal map from terrain
    _generateNormalMap(size = 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        const strength = 2.0;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;

                const u = x / size;
                const v = y / (size / 2);
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Sample heights for normal calculation
                const delta = 0.01;
                const h = this._getHeight(nx, ny, nz);
                const hx = this._getHeight(nx + delta, ny, nz);
                const hy = this._getHeight(nx, ny + delta, nz);

                // Calculate normal from height differences
                const dx = (hx - h) * strength;
                const dy = (hy - h) * strength;

                // Encode normal in RGB
                data[i] = Math.floor((dx + 1) * 0.5 * 255);
                data[i + 1] = Math.floor((dy + 1) * 0.5 * 255);
                data[i + 2] = 255; // Z always up
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    _getHeight(x, y, z) {
        let h = 0;
        let amp = 1;
        let freq = 2;
        for (let i = 0; i < 6; i++) {
            h += this._noise3D(x * freq + this.seed, y * freq, z * freq) * amp;
            amp *= 0.5;
            freq *= 2;
        }
        return h;
    }

    // Generate roughness map
    _generateRoughnessMap(size = 512) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const u = x / size;
                const v = y / (size / 2);

                // Variation in roughness
                const noise = this._noise2D(u * 20 + this.seed, v * 20) * 0.3 + 0.7;
                const value = Math.floor(noise * 255);

                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        return texture;
    }

    // Real-texture registry. Paths are relative to index.html in the app bundle.
    static get TEXTURE_REGISTRY() {
        return {
            mercury: { color: 'textures/mercury/mercury_color.jpg',  bump: 'textures/mercury/mercury_bump.jpg',  bumpScale: 0.05, roughness: 0.95, metalness: 0.0 },
            venus:   { color: 'textures/venus/venus_color.jpg',      bump: 'textures/venus/venus_bump.jpg',      bumpScale: 0.04, roughness: 0.85, metalness: 0.0 },
            mars:    { color: 'textures/mars/mars_color_1k.jpg',     bump: 'textures/mars/mars_bump_1k.jpg',     bumpScale: 0.06, roughness: 0.92, metalness: 0.0 },
            jupiter: { color: 'textures/jupiter/jupiter_4k.jpg',     bump: null,                                  bumpScale: 0,    roughness: 0.6,  metalness: 0.0 },
            saturn:  { color: 'textures/saturn/saturn_4k.jpg',       bump: null,                                  bumpScale: 0,    roughness: 0.6,  metalness: 0.0,
                       ringColor: 'textures/saturn/saturn_ring_alpha.png', ringPattern: null,
                       ringInner: 1.24, ringOuter: 2.27, ringShadow: true },
            uranus:  { color: 'textures/uranus/uranus_2k.jpg',       bump: null,                                  bumpScale: 0,    roughness: 0.5,  metalness: 0.0,
                       ringColor: 'textures/uranus/uranus_ring_color.jpg', ringPattern: 'textures/uranus/uranus_ring_trans.gif',
                       ringInner: 1.6, ringOuter: 2.0 },
            neptune: { color: 'textures/neptune/neptune_2k.jpg',     bump: null,                                  bumpScale: 0,    roughness: 0.5,  metalness: 0.0 },
            moon:    { color: 'textures/moon/moon_color_1k.jpg',     bump: 'textures/moon/moon_bump_1k.jpg',     bumpScale: 0.06, roughness: 0.95, metalness: 0.0 },
            pluto:   { color: 'textures/pluto/pluto_color_1k.jpg',   bump: 'textures/pluto/pluto_bump_1k.jpg',   bumpScale: 0.04, roughness: 0.9,  metalness: 0.0 }
        };
    }

    _createTexturedPlanet(segments) {
        const reg = Planet.TEXTURE_REGISTRY[this.texturePack];
        if (!reg) {
            console.warn(`Unknown texturePack '${this.texturePack}', falling back to procedural`);
            this._createRockyPlanet(segments);
            return;
        }

        const geometry = new THREE.SphereGeometry(this.radius, segments, Math.max(64, segments / 2));
        const loader = new THREE.TextureLoader();

        const colorMap = loader.load(reg.color,
            () => console.log(`🪐 ${this.name} color loaded`),
            undefined,
            (err) => console.warn(`${this.name} color load failed:`, err));
        markSRGB(colorMap);
        colorMap.anisotropy = rtsAniso(16);

        const matOptions = {
            map: colorMap,
            roughness: reg.roughness,
            metalness: reg.metalness,
            envMapIntensity: 0.5
        };

        if (reg.bump) {
            const bumpMap = loader.load(reg.bump);
            bumpMap.anisotropy = rtsAniso(16);
            matOptions.bumpMap = bumpMap;
            matOptions.bumpScale = reg.bumpScale;
        }

        const material = new THREE.MeshStandardMaterial(matOptions);

        // Eclipse shadows from moons/parents; Saturn additionally gets its rings'
        // shadow band projected onto the cloud tops.
        let ringShadowUniforms = null;
        if (reg.ringShadow && reg.ringColor) {
            const ringTex = new THREE.TextureLoader().load(reg.ringColor);
            ringTex.anisotropy = rtsAniso(16);
            ringShadowUniforms = {
                uRingMap: { value: ringTex },
                uRingCenter: { value: new THREE.Vector3() },
                uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
                uRingRadii: { value: new THREE.Vector2(this.radius * (reg.ringInner || 1.4), this.radius * (reg.ringOuter || 2.5)) }
            };
            this._ringShadowUniforms = ringShadowUniforms;
        }
        this._injectShadows(material, { ringUniforms: ringShadowUniforms });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);

        // Progressive detail (Jupiter/Saturn): swap the color map to a real 4K photo when
        // close, dispose it when far — same anti-jetsam approach as Earth.
        this._texMaterial = material;
        this._texLowColor = colorMap;
        this._texHiColor = null;
        this._texDetail = 'low';
        this._texHiLoading = false;

        // Override hasRings flag with the texture-based ring renderer
        if (reg.ringColor) {
            this._createTexturedRings(reg);
            this.hasRings = false; // Suppress procedural rings later in createMesh
        }
    }

    // Physically-lit ring system: sunlit face, translucent backlighting, and the
    // planet's own shadow sweeping across the ring plane. Replaces the old unlit
    // MeshBasicMaterial rings that looked pasted-on.
    _createTexturedRings(reg) {
        const innerRadius = this.radius * (reg.ringInner || 1.4);
        const outerRadius = this.radius * (reg.ringOuter || 2.5);
        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 256, 8);

        // Remap UVs so the ring texture is sampled radially (1D gradient across the ring's width)
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            const r = Math.sqrt(x * x + y * y);
            const t = (r - innerRadius) / (outerRadius - innerRadius);
            uv.setXY(i, t, 0.5);
        }
        uv.needsUpdate = true;

        const loader = new THREE.TextureLoader();
        const ringColor = loader.load(reg.ringColor);
        markSRGB(ringColor);
        ringColor.anisotropy = rtsAniso(16);

        const ringUniforms = {
            uMap: { value: ringColor },
            uAlphaMap: { value: null },
            uUseAlphaMap: { value: 0.0 },
            uSunPos: this._shadowUniforms.uSunPos,
            uSunRadius: this._shadowUniforms.uSunRadius,
            uPlanetCenter: { value: new THREE.Vector3() },
            uPlanetRadius: { value: this.radius },
            uOpacity: { value: 1.0 }
        };

        // Optional separate alpha pattern (Uranus uses a transparency gif; the new
        // Saturn ring PNG carries its own alpha channel)
        if (reg.ringPattern) {
            const ringPattern = loader.load(reg.ringPattern);
            ringUniforms.uAlphaMap.value = ringPattern;
            ringUniforms.uUseAlphaMap.value = 1.0;
        }

        const ringMat = new THREE.ShaderMaterial({
            uniforms: ringUniforms,
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vPlanetCenterW;
                void main() {
                    vUv = uv;
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vPlanetCenterW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                // Log-depth chunks are REQUIRED: the renderer uses a logarithmic
                // depth buffer, and a custom shader without them writes depth on a
                // different scale than every built-in material. Result: the ring
                // always LOST the depth test against the planet, so the near side
                // of the ring never rendered in front of the disc — rings looked
                // pasted BEHIND the planet from every angle.
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform sampler2D uMap;
                uniform sampler2D uAlphaMap;
                uniform float uUseAlphaMap;
                uniform vec3 uSunPos;
                uniform float uSunRadius;
                uniform vec3 uPlanetCenter;
                uniform float uPlanetRadius;
                uniform float uOpacity;
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vPlanetCenterW;

                // Soft shadow of the planet's disc on the ring plane
                float planetShadow(vec3 P) {
                    vec3 toSun = uSunPos - P;
                    float dSun = length(toSun);
                    vec3 L = toSun / dSun;
                    vec3 toOcc = uPlanetCenter - P;
                    float dOcc = length(toOcc);
                    if (dOcc > dSun) return 1.0;
                    float aSun = asin(clamp(uSunRadius / dSun, 0.0, 1.0));
                    float aOcc = asin(clamp(uPlanetRadius / dOcc, 0.0, 1.0));
                    float sep  = acos(clamp(dot(L, toOcc / dOcc), -1.0, 1.0));
                    float f = clamp((aOcc + aSun - sep) / max(2.0 * aSun, 1e-4), 0.0, 1.0);
                    f = f * f * (3.0 - 2.0 * f);
                    return 1.0 - f * 0.97;
                }

                void main() {
                    #include <logdepthbuf_fragment>
                    // MANUAL planet occlusion. The depth buffer proved unreliable
                    // between this custom shader and the planet (log-depth scale
                    // mismatch hid the ring's near side behind the disc from every
                    // angle). So the ring decides for itself: ray from camera to
                    // this fragment — if it enters the planet sphere first, the
                    // fragment is behind the planet. depthTest is OFF for this
                    // material; this test is the only occlusion, and it is exact.
                    {
                        vec3 rd = vWorldPos - cameraPosition;
                        float tFrag = length(rd);
                        rd /= tFrag;
                        vec3 oc = cameraPosition - vPlanetCenterW;
                        float b = dot(oc, rd);
                        float cc = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
                        float disc = b * b - cc;
                        if (disc > 0.0) {
                            float tHit = -b - sqrt(disc);
                            if (tHit > 0.0 && tHit < tFrag) discard;
                        }
                    }
                    vec4 c = texture2D(uMap, vUv);
                    float alpha = c.a;
                    if (uUseAlphaMap > 0.5) {
                        alpha = texture2D(uAlphaMap, vUv).g;
                    }
                    if (alpha < 0.003) discard;

                    vec3 N = normalize(vWorldNormal);
                    vec3 toSun = uSunPos - vWorldPos;
                    vec3 L = normalize(toSun);
                    vec3 V = normalize(cameraPosition - vWorldPos);

                    float ndl = dot(N, L);
                    float lit = clamp(ndl, 0.0, 1.0) + clamp(-ndl, 0.0, 1.0); // |ndl|
                    bool viewingLitFace = (dot(N, V) * ndl) > 0.0;

                    // Lit face: full diffuse. Unlit face: dimmer, mostly light
                    // filtering through the ring particles (translucency).
                    float light = viewingLitFace ? (0.05 + lit * 1.05)
                                                 : (0.05 + lit * 0.45);

                    float sh = planetShadow(vWorldPos);
                    vec3 color = c.rgb * light * sh;

                    gl_FragColor = vec4(color, alpha * uOpacity);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false   // occlusion handled in-shader (see fragment)
        });

        this.rings = new THREE.Mesh(ringGeo, ringMat);
        // Flat in the EQUATORIAL plane — the planet mesh carries the real axial
        // tilt now. The old '+ 0.4' fake-tilt hack left the rings skewed ~23°
        // off the planet's equator once true tilts landed.
        this.rings.rotation.x = Math.PI / 2;
        this._ringLightUniforms = ringUniforms;
        this.mesh.add(this.rings);
    }

    // PHOTOREAL EARTH - NASA Blue Marble day map + Black Marble city lights (2048x1024
    // bundled, 8192x4096 swapped in up close), NASA elevation relief, MODIS cloud
    // composite. One shader does the whole column so every layer shares the same
    // physics:
    //   ground -> lit by sunlight attenuated through the atmosphere (Chapman
    //             transmittance), so the terminator turns orange/red by itself
    //   clouds -> composited on top, lit the same way at 6 km altitude, black on the
    //             night side, dimming and diffusing the city lights under them
    //   cloud shadows -> the cloud map re-sampled where the sun ray through the
    //             ground point crosses the cloud layer (offset grows toward the
    //             terminator as the sun gets low)
    //   aerial perspective -> the scattering march from the camera to the
    //             surface (EARTH_ATMO_GLSL) adds in-scattered skylight and extinction
    _createPhotorealEarth(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, Math.max(64, segments / 2));
        const loader = new THREE.TextureLoader();
        const q = EARTH_QUALITY[planetQualityTier()];

        const dayMap = loader.load(
            'textures/earth/earth_daymap_8k.jpg',
            () => console.log('🌍 Earth daymap loaded (NASA Blue Marble, 2048x1024)'),
            undefined,
            (err) => console.warn('Earth daymap load failed:', err)
        );
        const nightMap = loader.load(
            'textures/earth/earth_nightmap_8k.jpg',
            () => console.log('🌃 Earth nightmap loaded (NASA Black Marble, 2048x1024)'),
            undefined,
            (err) => console.warn('Earth nightmap load failed:', err)
        );

        // Relief is computed from neighbouring texels, so the step must be ONE TEXEL of
        // this map (it was hard-coded to 1/8192 while the bundled map is 2048 wide, which
        // sampled 1/4 texel apart and flattened every mountain range).
        const elevMap = loader.load(
            'textures/earth/earth_elevation_8k.png',
            (tex) => {
                const img = tex.image;
                if (img && img.width && img.height && this.uniforms.earth) {
                    this.uniforms.earth.elevTexel.value.set(1 / img.width, 1 / img.height);
                }
                console.log(`⛰️ Earth elevation loaded (${img ? img.width + 'x' + img.height : '?'}) - terrain relief active`);
            },
            undefined,
            (err) => console.warn('Earth elevation load failed:', err)
        );

        // MODIS cloud composite: grayscale, black = clear sky, brightness ~ optical
        // thickness. Used as both colour and coverage. (The old separate
        // earth_clouds_alpha.jpg belongs to a different cloud dataset and is inverted,
        // so it is no longer used.)
        const cloudMap = loader.load(
            'textures/earth/earth_clouds_2k.jpg',
            () => console.log('☁️  Earth cloud composite loaded (NASA MODIS 2K)'),
            undefined,
            (err) => console.warn('Earth cloud load failed:', err)
        );
        cloudMap.wrapS = THREE.RepeatWrapping;

        // Decode the colour maps to linear light on the GPU. The bundled three.js is
        // r150, which only honours .encoding (.colorSpace arrived in r152), so setting
        // colorSpace alone left these maps undecoded: sRGB values were lit as if they
        // were linear and then gamma-encoded again by the final pass (washed out).
        // The atmosphere maths below needs real linear albedo.
        [dayMap, nightMap, cloudMap].forEach(markSRGB);
        dayMap.anisotropy = rtsAniso(16);
        nightMap.anisotropy = rtsAniso(16);
        elevMap.anisotropy = rtsAniso(16);
        cloudMap.anisotropy = rtsAniso(16);

        this.uniforms.earth = {
            dayMap: { value: dayMap },
            nightMap: { value: nightMap },
            elevMap: { value: elevMap },
            cloudMap: { value: cloudMap },
            elevTexel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) }, // replaced by the real size on load
            // 8-bit elevation map: 0..1 spans roughly 0..9 km (Everest is ~0.95).
            // One texel is ~20 km, which averages real mountain slopes down to a few
            // degrees, so relief is drawn with a 15x vertical exaggeration (shaded-relief
            // map practice) to bring back the slope contrast seen in orbital photos.
            elevRangeKm: { value: 9.3 },
            reliefExaggeration: { value: 15.0 },
            cloudShift: { value: 0 },          // cloud drift relative to the ground (u)
            cloudAltKm: { value: 6.0 },
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
            uCenter: { value: new THREE.Vector3() },
            uKmPerUnit: { value: 6371 / this.radius },
            // Solar irradiance in the shader's radiance units: the ground is drawn as
            // albedo * cos(sun) (= albedo * E / pi), so E = pi keeps sky and ground on
            // the same physical scale.
            uSunE: { value: Math.PI },
            // shared eclipse-shadow uniforms (moon transits → solar eclipse spot)
            uSunPos: this._shadowUniforms.uSunPos,
            uSunRadius: this._shadowUniforms.uSunRadius,
            uOccluders: this._shadowUniforms.uOccluders,
            uOccluderCount: this._shadowUniforms.uOccluderCount
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms.earth,
            defines: { ATMO_STEPS: q.ap },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec2 vUv;
                varying vec3 vNormalWorld;
                varying vec3 vTangentWorld;
                varying vec3 vBitangentWorld;
                varying vec3 vWorldPosition;
                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vNormalWorld = normalize(mat3(modelMatrix) * normal);
                    // Sphere tangent frame: tangent points east (+lon, +u), bitangent north (+v).
                    // SphereGeometry puts a vertex at (-cos(2*pi*u), ., sin(2*pi*u)) * sin(theta),
                    // so d(position)/du is along (z, 0, -x): lon 0 (+x) -> east is -z (lon 90E,
                    // see earthFixedDir). cross(up, east) = north.
                    vec3 objTangent = normalize(vec3(position.z, 0.0, -position.x) + vec3(1e-6, 0.0, 0.0));
                    vTangentWorld = normalize(mat3(modelMatrix) * objTangent);
                    vBitangentWorld = normalize(cross(vNormalWorld, vTangentWorld));
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform sampler2D dayMap;
                uniform sampler2D nightMap;
                uniform sampler2D elevMap;
                uniform sampler2D cloudMap;
                uniform vec2 elevTexel;
                uniform float elevRangeKm;
                uniform float reliefExaggeration;
                uniform float cloudShift;
                uniform float cloudAltKm;
                uniform vec3 sunDirection;
                uniform vec3 uCenter;
                uniform float uKmPerUnit;
                uniform float uSunE;
                varying vec2 vUv;
                varying vec3 vNormalWorld;
                varying vec3 vTangentWorld;
                varying vec3 vBitangentWorld;
                varying vec3 vWorldPosition;

                ${ECLIPSE_SHADOW_GLSL}
                ${EARTH_ATMO_GLSL}

                float cloudCover(vec2 uv) {
                    float c = texture2D(cloudMap, vec2(uv.x - cloudShift, uv.y)).r;
                    return smoothstep(0.06, 0.75, c);
                }

                void main() {
                    #include <logdepthbuf_fragment>
                    vec3 dayColor   = texture2D(dayMap, vUv).rgb;
                    vec3 nightColor = texture2D(nightMap, vUv).rgb;
                    vec3 Ng = normalize(vNormalWorld);
                    vec3 E  = normalize(vTangentWorld);
                    vec3 Nn = normalize(vBitangentWorld);
                    vec3 L = normalize(sunDirection);
                    float mu = dot(Ng, L);                       // cos(solar zenith)
                    float coslat = max(cos((vUv.y - 0.5) * 3.14159265), 0.02);

                    // --- Relief: slope from one-texel finite differences (km / km)
                    float texelKmX = elevTexel.x * 2.0 * 3.14159265 * ATMO_RG * coslat;
                    float texelKmY = elevTexel.y * 3.14159265 * ATMO_RG;
                    float h  = texture2D(elevMap, vUv).r;
                    float hU = texture2D(elevMap, vUv + vec2(elevTexel.x, 0.0)).r;
                    float hV = texture2D(elevMap, vUv + vec2(0.0, elevTexel.y)).r;
                    float k = elevRangeKm * reliefExaggeration;
                    vec3 N = normalize(Ng - E * ((hU - h) * k / texelKmX) - Nn * ((hV - h) * k / texelKmY));
                    float NdotL = dot(N, L);

                    // Moon shadow (solar eclipse spot crawling across the surface)
                    float eclipse = eclipseShadow(vWorldPosition);

                    // --- Sunlight reaching the ground and the cloud tops
                    vec3 sunGround = atmoSunTransmittance(h * elevRangeKm, mu) * eclipse;
                    vec3 sunCloud  = atmoSunTransmittance(cloudAltKm, mu) * eclipse;
                    // approximate skylight (diffuse light from the blue sky), fades
                    // through twilight; ~8-15% of direct sun on a clear day
                    vec3 skyLight = vec3(0.045, 0.075, 0.13) * smoothstep(-0.12, 0.35, mu) * eclipse;

                    // --- Clouds and their shadows
                    float cov = cloudCover(vUv);
                    // where the sun ray through this ground point crosses the cloud
                    // layer: horizontal offset = h_c * tan(zenith), toward the sun
                    float muS = max(mu, 0.06);
                    float offKm = cloudAltKm * sqrt(1.0 - muS * muS) / muS;
                    vec3 sunT = L - Ng * mu;
                    float sl = length(sunT);
                    vec2 dirEN = sl > 1e-5 ? vec2(dot(sunT, E), dot(sunT, Nn)) / sl : vec2(0.0);
                    vec2 shadowUv = vUv + dirEN * offKm / vec2(2.0 * 3.14159265 * ATMO_RG * coslat, 3.14159265 * ATMO_RG);
                    float shadow = 1.0 - 0.75 * cloudCover(shadowUv);

                    // --- Ground
                    vec3 ground = dayColor * (sunGround * max(NdotL, 0.0) * 0.95 * shadow + skyLight);
                    // ocean sun glint (water mask from the day map's blue lead)
                    float blueLead = dayColor.b - max(dayColor.r, dayColor.g) * 0.75;
                    float waterMask = smoothstep(0.0, 0.18, blueLead);
                    vec3 V = normalize(cameraPosition - vWorldPosition);
                    vec3 H = normalize(L + V);
                    float spec = pow(max(dot(Ng, H), 0.0), 90.0) * waterMask * max(mu, 0.0);
                    ground += sunGround * shadow * spec * 1.4;

                    // --- Cloud tops: white, Lambert-ish, still lit a little after
                    // ground sunset (6 km up sees the sun ~2.5 deg longer)
                    float cloudBright = texture2D(cloudMap, vec2(vUv.x - cloudShift, vUv.y)).r;
                    float cloudDiffuse = clamp((mu + 0.045) / 1.045, 0.0, 1.0);
                    vec3 cloudCol = vec3(0.6 + 0.4 * cloudBright) * (sunCloud * cloudDiffuse * 0.95 + skyLight * 1.6);
                    vec3 surface = mix(ground, cloudCol, cov);

                    // --- Night: city lights switch on after sunset; clouds block them and
                    // glow faintly where they scatter the light (blurred mip of the map)
                    float lightsOn = 1.0 - smoothstep(-0.10, 0.06, mu);
                    vec3 cityBlur = texture2D(nightMap, vUv, 3.5).rgb;
                    // The bundled Black Marble map carries a blue "moonlight" base layer;
                    // the unlit night side seen from orbit is black, so keep only the
                    // artificial light, keyed on the red channel (city light is warm,
                    // the base layer has almost no red).
                    nightColor *= smoothstep(0.003, 0.03, nightColor.r);
                    cityBlur *= smoothstep(0.003, 0.03, cityBlur.r);
                    vec3 night = (nightColor * (1.0 - 0.85 * cov) + cityBlur * cov * 0.25) * 1.6 * lightsOn;
                    surface += night;
                    // Night-side ground and cloud tops lit by airglow, starlight and (when up)
                    // the Moon: ~1e-6 of daylight, but the ISS night timelapses are long
                    // high-ISO exposures where clouds and coastlines still read faintly
                    // under the city lights. This is that exposure's floor, not a light.
                    vec3 nightFloor = mix(dayColor * 0.6, vec3(0.85), cov) * vec3(0.008, 0.010, 0.014);
                    surface += nightFloor * lightsOn;

                    // --- Aerial perspective: camera -> surface through the atmosphere
                    vec3 ro = (cameraPosition - uCenter) * uKmPerUnit;
                    vec3 pk = (vWorldPosition - uCenter) * uKmPerUnit;
                    vec3 seg = pk - ro;
                    float segLen = length(seg);
                    vec3 Tview;
                    // fixed mid-step sampling here: the camera-to-ground path is short and
                    // smooth, and per-pixel jitter would show as grain on the surface
                    vec3 inscatter = atmoInscatter(ro, seg / segLen, segLen, L, uSunE * eclipse,
                                                   0.0, 0.5, Tview);
                    gl_FragColor = vec4(surface * Tview + inscatter, 1.0);
                }
            `
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = false;
        const earthU = this.uniforms.earth;
        this.surface.onBeforeRender = () => {
            this.surface.getWorldPosition(earthU.uCenter.value);
        };
        this.mesh.add(this.surface);

        // Progressive detail: keep the bundled 2048x1024 maps as the safe default and
        // only swap in the 8192x4096 NASA maps when the camera is close, disposing
        // them again when you leave — so the heavy texture is never resident at distance
        // (this is what prevents the 8K-memory jetsam the project hit before).
        this._earthLowDay = dayMap;
        this._earthLowNight = nightMap;
        this._earthHiDay = null;
        this._earthHiNight = null;
        this._earthDetail = 'low';
        this._earthHiLoading = false;
    }

    // Swap Earth's day + night maps between bundled low-res and true 8K (NASA Blue Marble +
    // Black Marble city lights). Safe to call every frame; only acts on transitions and never
    // holds the heavy textures while far away — both are disposed when you leave.
    setEarthDetail(high) {
        if (!this.uniforms || !this.uniforms.earth) return;
        this._earthWantsHigh = high;
        const dayU = this.uniforms.earth.dayMap;
        const nightU = this.uniforms.earth.nightMap;
        const setSRGB = (tex) => {
            markSRGB(tex);
            tex.anisotropy = rtsAniso(16);
        };
        if (high) {
            if (this._earthDetail === 'high' || this._earthHiLoading) return;
            if (rtsTexBudget().maxSize < 8192) return;   // this device keeps the bundled 2048 maps
            this._earthHiLoading = true;
            let pending = 2, bailed = false;
            const done = () => { if (--pending === 0) { this._earthHiLoading = false;
                if (!bailed) { this._earthDetail = 'high'; console.log('🌍 Earth → 8K day + night city lights (up close)'); } } };
            const loadInto = (path, uniform, store) => rtsLoadStaged(path, (tex) => {
                // camera may have already left while loading — bail and dispose
                if (!this._earthWantsHigh) { tex.dispose(); bailed = true; done(); return; }
                setSRGB(tex); this[store] = tex; uniform.value = tex; done();
            }, () => { bailed = true; done(); });
            loadInto('textures/earth/earth_daymap_hi.jpg', dayU, '_earthHiDay');
            loadInto('textures/earth/earth_nightmap_hi.jpg', nightU, '_earthHiNight');
        } else {
            if (this._earthDetail === 'low') return;
            dayU.value = this._earthLowDay;
            nightU.value = this._earthLowNight;
            this._earthDetail = 'low';
            if (this._earthHiDay) { this._earthHiDay.dispose(); this._earthHiDay = null; }
            if (this._earthHiNight) { this._earthHiNight.dispose(); this._earthHiNight = null; }
            console.log('🌍 Earth → low-res (far away, 8K freed)');
        }
    }

    // Swap a textured planet's (Jupiter/Saturn) color map between bundled low-res and the
    // real 4K photo. Same safe transition pattern as Earth — only acts on change, frees hi when far.
    setTexturedDetail(high) {
        if (!this._texMaterial) return;
        const HI = {
            jupiter: 'textures/jupiter/jupiter_hi.jpg',
            saturn:  'textures/saturn/saturn_hi.jpg'
        };
        // 8192x4096 Mars (Solar System Scope, CC BY 4.0): ~180 MB of GPU memory with
        // mips, so only on the HIGH render tier (RTQuality).
        // Android: also needs GL_MAX_TEXTURE_SIZE >= 8192 and a big-RAM device (rtsTexBudget).
        if (planetQualityTier() === 'high' && rtsTexBudget().maxSize >= 8192) HI.mars = 'textures/mars/mars_8k.jpg';
        const hiPath = HI[this.texturePack];
        // No hi map for this tier (e.g. Mars after RTQuality drops below HIGH): treat as far,
        // so a resident 8K gets freed on the next LOD tick instead of staying in GPU memory.
        if (!hiPath && high) high = false;
        if (!hiPath && this._texDetail !== 'high') return; // nothing loaded to free
        this._texWantsHigh = high;
        if (high) {
            if (this._texDetail === 'high' || this._texHiLoading) return;
            if (rtsTexBudget().maxSize < 4096) return;   // this device keeps the bundled 2048 map
            this._texHiLoading = true;
            rtsLoadStaged(hiPath, (tex) => {
                if (!this._texWantsHigh) { tex.dispose(); this._texHiLoading = false; return; }
                markSRGB(tex);
                tex.anisotropy = rtsAniso(16);
                this._texHiColor = tex;
                this._texMaterial.map = tex;
                this._texMaterial.needsUpdate = true;
                this._texDetail = 'high';
                this._texHiLoading = false;
                console.log(`🪐 ${this.name} → hi-res real texture (up close)`);
            }, () => { this._texHiLoading = false; });
        } else {
            if (this._texDetail === 'low') return;
            this._texMaterial.map = this._texLowColor;
            this._texMaterial.needsUpdate = true;
            this._texDetail = 'low';
            if (this._texHiColor) { this._texHiColor.dispose(); this._texHiColor = null; }
            console.log(`🪐 ${this.name} → low-res (far away, freed)`);
        }
    }

    _createRockyPlanet(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Generate procedural textures
        const diffuseMap = this._generateTerrainTexture(1024);
        const normalMap = this._generateNormalMap(1024);
        const roughnessMap = this._generateRoughnessMap(512);

        const material = new THREE.MeshStandardMaterial({
            map: diffuseMap,
            normalMap: normalMap,
            normalScale: new THREE.Vector2(1.5, 1.5),
            roughnessMap: roughnessMap,
            roughness: 0.8,
            metalness: 0.1,
            envMapIntensity: 0.4
        });
        this._injectShadows(material);

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createGasGiant(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Custom shader for gas giant bands
        this.uniforms.gasGiant = {
            time: { value: 0 },
            baseColor: { value: new THREE.Color(this.color) },
            bandCount: { value: 12 + Math.random() * 8 },
            stormIntensity: { value: 0.3 + Math.random() * 0.4 },
            seed: { value: this.seed }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms.gasGiant,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 baseColor;
                uniform float bandCount;
                uniform float stormIntensity;
                uniform float seed;

                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;

                // Simplex noise functions
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);

                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);

                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;

                    i = mod289(i);
                    vec4 p = permute(permute(permute(
                        i.z + vec4(0.0, i1.z, i2.z, 1.0))
                        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;

                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);

                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);

                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);

                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));

                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);

                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                    p0 *= norm.x;
                    p1 *= norm.y;
                    p2 *= norm.z;
                    p3 *= norm.w;

                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                void main() {
                    vec3 pos = normalize(vPosition);
                    float lat = asin(pos.y) / 3.14159 + 0.5;
                    float lon = atan(pos.z, pos.x) / 6.28318 + 0.5;

                    // Atmospheric bands
                    float bandBase = sin(lat * bandCount * 3.14159) * 0.5 + 0.5;

                    // Add turbulence to bands
                    float turbulence = snoise(vec3(lon * 8.0 + time * 0.02, lat * 4.0, seed)) * 0.15;
                    turbulence += snoise(vec3(lon * 16.0 + time * 0.04, lat * 8.0, seed * 1.3)) * 0.08;

                    float bands = bandBase + turbulence;

                    // Storm systems (Great Red Spot style)
                    float stormX = lon * 6.28318 - time * 0.01;
                    float stormY = (lat - 0.35) * 12.0;
                    float storm = exp(-(stormX * stormX + stormY * stormY) * 2.0) * stormIntensity;

                    // Color palette for gas giant - rich, vibrant bands
                    vec3 lightBand = baseColor * 1.5;
                    vec3 darkBand = baseColor * 0.5;
                    vec3 stormColor = vec3(0.9, 0.45, 0.2);

                    vec3 bandColor = mix(darkBand, lightBand, bands);
                    vec3 finalColor = mix(bandColor, stormColor, storm);

                    // Limb darkening
                    float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 1.5);
                    finalColor *= 1.0 - fresnel * 0.4;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createIcePlanet(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Ice planet with frozen surface
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(1024, 512);
        const data = imageData.data;

        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 1024; x++) {
                const i = (y * 1024 + x) * 4;
                const u = x / 1024;
                const v = y / 512;

                // Ice cracks and surface variation
                const noise1 = this._noise2D(u * 30 + this.seed, v * 30) * 0.5 + 0.5;
                const noise2 = this._noise2D(u * 100 + this.seed * 2, v * 100) * 0.5 + 0.5;
                const cracks = Math.abs(this._noise2D(u * 50, v * 50)) < 0.1 ? 0.3 : 1.0;

                const brightness = noise1 * 0.3 + noise2 * 0.2 + 0.5;
                const iceColor = brightness * cracks;

                // Pale blue-white ice color
                data[i] = Math.floor(180 + iceColor * 60);
                data[i + 1] = Math.floor(200 + iceColor * 50);
                data[i + 2] = Math.floor(220 + iceColor * 35);
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.2,
            metalness: 0.1,
            envMapIntensity: 1.2
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createRealisticAtmosphere() {
        if (this.texturePack === 'earth') {
            this._createEarthAtmosphere();
            return;
        }
        // Non-Earth atmospheres: a simple view-angle limb glow tinted by
        // atmosphereColor. This is NOT a scattering model, just an artistic rim.
        this.uniforms.atmosphere = {
            atmosphereColor: { value: new THREE.Color(this.atmosphereColor) }
        };

        const atmosphereGeometry = new THREE.SphereGeometry(this.radius * 1.22, 64, 64);
        const atmosphereMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms.atmosphere,
            // REWRITTEN 2026-07-30: an older Rayleigh/Mie attempt measured "altitude" as
            // distance from the WORLD ORIGIN (the Sun) and produced NaN fragments
            // (the "black donut" ring). This limb glow keeps every term clamped so
            // NaN is impossible.
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec3 vCenter;

                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform vec3 atmosphereColor;

                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec3 vCenter;

                void main() {
                    #include <logdepthbuf_fragment>
                    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                    vec3 n = normalize(vNormal);

                    // Limb rim: strongest at the silhouette, fades inward. abs() covers
                    // the BackSide-flipped normals; clamp guards float error (pow of a
                    // negative is NaN = the old black-ring bug).
                    float rim = clamp(1.0 - abs(dot(viewDir, n)), 0.0, 1.0);
                    float fresnel = pow(rim, 6.0);   // tight limb hug — 2.3 read as a fat halo

                    // The Sun sits at the world origin: light the day-side limb more,
                    // keep a faint night-side rim so the planet still reads in shadow.
                    vec3 sunDir = normalize(-vCenter);
                    vec3 up = normalize(vWorldPosition - vCenter);
                    float dayside = 0.3 + 0.7 * clamp(dot(up, sunDir) * 0.5 + 0.5, 0.0, 1.0);

                    float alpha = clamp(fresnel * dayside * 0.35, 0.0, 0.6);
                    gl_FragColor = vec4(atmosphereColor * dayside, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.mesh.add(this.atmosphere);

        // Add subtle inner glow
        const innerGlowGeo = new THREE.SphereGeometry(this.radius * 1.02, 48, 48);
        const innerGlowMat = new THREE.MeshBasicMaterial({
            color: this.atmosphereColor,
            transparent: true,
            opacity: 0.05 * this.atmosphereDensity,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMat);
        this.mesh.add(this.innerGlow);
    }

    // EARTH SKY / LIMB - the part of the atmosphere seen against space (rays that miss
    // the planet). Rays that hit the planet get the same scattering inside the surface
    // shader (aerial perspective), so the two meet seamlessly at the horizon.
    // Real proportions: the atmosphere ends 100 km up (1.6% of the radius), which is
    // why the limb is the thin blue band seen from the ISS rather than a halo.
    // Composited as premultiplied radiance over the background: dst * T + L, so
    // stars and the Moon dim when seen through the limb.
    _createEarthAtmosphere() {
        const q = EARTH_QUALITY[planetQualityTier()];
        this.uniforms.atmosphere = {
            uCenter: { value: new THREE.Vector3() },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uKmPerUnit: { value: 6371 / this.radius },
            uSunE: { value: Math.PI },
            // OI 557.7 nm airglow volume emission (relative units per km). Set for a
            // night-adapted exposure so the night limb shows the faint green line seen
            // in ISS night footage (physically ~1e-4 of the day sky, so it is only
            // added where the air is in darkness).
            uAirglow: { value: 1.5e-5 }
        };
        // Mesh slightly larger than the 100 km top so tessellation never clips it;
        // the shader intersects the true sphere analytically.
        const geo = new THREE.SphereGeometry(this.radius * (1 + 100 / 6371) * 1.006, 160, 80);
        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms.atmosphere,
            defines: { ATMO_STEPS: q.sky },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec3 vWorldPosition;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform vec3 uCenter;
                uniform vec3 uSunDir;
                uniform float uKmPerUnit;
                uniform float uSunE;
                uniform float uAirglow;
                varying vec3 vWorldPosition;
                ${EARTH_ATMO_GLSL}
                void main() {
                    #include <logdepthbuf_fragment>
                    vec3 ro = (cameraPosition - uCenter) * uKmPerUnit;
                    vec3 rd = normalize(vWorldPosition - cameraPosition);
                    // rays that hit the ground are drawn by the surface shader
                    vec2 tg = atmoRaySphere(ro, rd, ATMO_RG);
                    if (tg.x < tg.y && tg.y > 0.0) discard;
                    vec3 T;
                    vec3 L = atmoInscatter(ro, rd, 1e9, normalize(uSunDir), uSunE,
                                           uAirglow, atmoIGN(gl_FragCoord.xy), T);
                    float a = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0);
                    gl_FragColor = vec4(L, a);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor
        });
        this.atmosphere = new THREE.Mesh(geo, mat);
        this.atmosphere.renderOrder = 1;
        const u = this.uniforms.atmosphere;
        this.atmosphere.onBeforeRender = () => {
            this.atmosphere.getWorldPosition(u.uCenter.value);
        };
        this.mesh.add(this.atmosphere);
    }

    _createCloudLayer() {
        // Earth's clouds are drawn inside the surface shader (shared lighting, cloud
        // shadows, night side); no separate shell.
        if (this.texturePack === 'earth') return;
        const cloudGeo = new THREE.SphereGeometry(this.radius * 1.015, 128, 64);

        // Procedural cloud texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(1024, 512);
        const data = imageData.data;

        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 1024; x++) {
                const i = (y * 1024 + x) * 4;
                const u = x / 1024;
                const v = y / 512;
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Multi-octave cloud noise
                let cloud = 0;
                let amp = 1;
                let freq = 3;
                for (let oct = 0; oct < 6; oct++) {
                    cloud += this._noise3D(nx * freq + this.seed * 3, ny * freq, nz * freq) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                cloud = (cloud + 1) / 2;
                cloud = Math.pow(cloud, 1.5); // Sharpen clouds

                // More clouds at equator, less at poles
                const latFactor = 1.0 - Math.abs(v - 0.5) * 1.5;
                cloud *= Math.max(0.3, latFactor);

                const alpha = cloud > 0.4 ? (cloud - 0.4) * 2.5 : 0;

                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = Math.floor(alpha * 200);
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const cloudTexture = new THREE.CanvasTexture(canvas);
        cloudTexture.wrapS = THREE.RepeatWrapping;

        this.cloudUniforms = {
            cloudMap: { value: cloudTexture },
            time: { value: 0 }
        };

        const cloudMat = new THREE.MeshBasicMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
        this.mesh.add(this.clouds);
    }

    _createRings() {
        const innerRadius = this.radius * 1.4;
        const outerRadius = this.radius * 2.5;

        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 8);

        // Generate ring texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Ring bands with gaps
        for (let x = 0; x < 1024; x++) {
            const t = x / 1024;
            const noise = this._noise2D(t * 50 + this.seed, 0) * 0.5 + 0.5;
            const gap = Math.sin(t * 80) > 0.8 ? 0.2 : 1.0;
            const density = noise * gap;

            const baseColor = new THREE.Color(this.color);
            const r = Math.floor(baseColor.r * 255 * density * 0.8);
            const g = Math.floor(baseColor.g * 255 * density * 0.75);
            const b = Math.floor(baseColor.b * 255 * density * 0.7);

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${density * 0.8})`;
            ctx.fillRect(x, 0, 1, 64);
        }

        const ringTexture = new THREE.CanvasTexture(canvas);
        ringTexture.wrapS = THREE.ClampToEdgeWrapping;

        const ringMat = new THREE.MeshBasicMaterial({
            map: ringTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.rings = new THREE.Mesh(ringGeo, ringMat);
        this.rings.rotation.x = Math.PI / 2; // equatorial — mesh carries the real tilt
        this.mesh.add(this.rings);
    }

    // Improved 3D noise
    _noise3D(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);

        const u = this._fade(x);
        const v = this._fade(y);
        const w = this._fade(z);

        const A = this._p[X] + Y;
        const AA = this._p[A] + Z;
        const AB = this._p[A + 1] + Z;
        const B = this._p[X + 1] + Y;
        const BA = this._p[B] + Z;
        const BB = this._p[B + 1] + Z;

        return this._lerp(w,
            this._lerp(v,
                this._lerp(u, this._grad(this._p[AA], x, y, z), this._grad(this._p[BA], x - 1, y, z)),
                this._lerp(u, this._grad(this._p[AB], x, y - 1, z), this._grad(this._p[BB], x - 1, y - 1, z))),
            this._lerp(v,
                this._lerp(u, this._grad(this._p[AA + 1], x, y, z - 1), this._grad(this._p[BA + 1], x - 1, y, z - 1)),
                this._lerp(u, this._grad(this._p[AB + 1], x, y - 1, z - 1), this._grad(this._p[BB + 1], x - 1, y - 1, z - 1))));
    }

    _noise2D(x, y) {
        return this._noise3D(x, y, 0);
    }

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    _lerp(t, a, b) { return a + t * (b - a); }
    _grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    // Permutation table for noise
    get _p() {
        if (!this._perm) {
            const p = [];
            for (let i = 0; i < 256; i++) p[i] = Math.floor(Math.random() * 256);
            this._perm = new Array(512);
            for (let i = 0; i < 512; i++) this._perm[i] = p[i & 255];
        }
        return this._perm;
    }

    update(deltaTime, sunPosition) {
        this.time += deltaTime;

        // Rotate surface (not Earth: OrbitalMechanics sets Earth's whole-body angle from
        // Greenwich sidereal time, and a second spin here would knock it off the real one)
        if (this.surface && !this.poleTowardEclipticLon90) {
            const rotationSpeed = (Math.PI * 2) / (this.rotationPeriod * 3600);
            this.surface.rotation.y += rotationSpeed * deltaTime * 1000;
        }

        // Rotate clouds slightly faster
        if (this.clouds) {
            const cloudSpeed = (Math.PI * 2) / (this.rotationPeriod * 3600) * 1.1;
            this.clouds.rotation.y += cloudSpeed * deltaTime * 1000;
        }

        // Update gas giant shader
        if (this.uniforms.gasGiant) {
            this.uniforms.gasGiant.time.value = this.time;
        }

        // Update sun position for all shaders. The update loop passes rendererCore
        // as the second arg (not a position), so validate before using — the sun
        // lives at the origin in this scene.
        let sunPos = sunPosition;
        if (!sunPos || typeof sunPos.x !== 'number' || !isFinite(sunPos.x)) {
            sunPos = _planetSunOrigin;
        }


        // Refresh shared eclipse/ring shadow uniforms
        if (this._shadowUniforms) {
            this._shadowUniforms.uSunPos.value.set(sunPos.x, sunPos.y, sunPos.z);
            let n = 0;
            for (let i = 0; i < this._occluders.length && n < 4; i++) {
                const occ = this._occluders[i];
                const m = occ.mesh || occ;
                if (!m || !m.getWorldPosition) continue;
                m.getWorldPosition(_planetTmpVec);
                this._shadowUniforms.uOccluders.value[n].set(
                    _planetTmpVec.x, _planetTmpVec.y, _planetTmpVec.z, occ.radius || 1
                );
                n++;
            }
            this._shadowUniforms.uOccluderCount.value = n;
        }
        if (this._ringShadowUniforms && this.rings) {
            this.mesh.getWorldPosition(this._ringShadowUniforms.uRingCenter.value);
            this.rings.getWorldQuaternion(_planetTmpQuat);
            this._ringShadowUniforms.uRingNormal.value.set(0, 0, 1).applyQuaternion(_planetTmpQuat);
        }
        if (this._ringLightUniforms) {
            this.mesh.getWorldPosition(this._ringLightUniforms.uPlanetCenter.value);
        }

        // Update photoreal Earth sun direction (world-space direction from planet to sun).
        // sunPos may be a plain {x,y,z} object, not a Vector3 — read components directly.
        if (this.uniforms.earth) {
            const dir = this.uniforms.earth.sunDirection.value;
            dir.set(
                sunPos.x - this.mesh.position.x,
                sunPos.y - this.mesh.position.y,
                sunPos.z - this.mesh.position.z
            ).normalize();
            // Clouds drift 10% faster than the ground turns (same rate the old
            // separate cloud shell used), expressed as a u offset on the cloud map.
            const spin = (Math.PI * 2) / (this.rotationPeriod * 3600) * deltaTime * 1000;
            const cs = this.uniforms.earth.cloudShift;
            cs.value = (cs.value + 0.1 * spin / (Math.PI * 2)) % 1;
            if (this.uniforms.atmosphere && this.uniforms.atmosphere.uSunDir) {
                this.uniforms.atmosphere.uSunDir.value.copy(dir);
            }
            if (this.uniforms.aurora) {
                this.uniforms.aurora.uSunDir.value.copy(dir);
                this.uniforms.aurora.uTime.value = this.time;
            }
        }

        // Update city lights sun direction
        if (this.cityLights && this.cityLights.material.uniforms) {
            const sunDir = sunPos.clone().sub(this.mesh.position).normalize();
            this.cityLights.material.uniforms.sunDirection.value.copy(sunDir);
        }

        // Rotate rings slowly
        if (this.rings) {
            this.rings.rotation.z += deltaTime * 0.001;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    if (child.material.normalMap) child.material.normalMap.dispose();
                    if (child.material.roughnessMap) child.material.roughnessMap.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}
