// Star.js - the Sun as a filtered camera sees it, calibrated against SDO/HMI continuum
// frames: per-channel limb darkening, animated granulation (resolution-aware), a few
// sunspots with penumbrae, faculae near the limb, a thin chromosphere rim and a K-corona
// that falls off with Baumbach's radial profile.

class Star {
    constructor(config = {}) {
        this.name = config.name || "Star";
        this.radius = config.radius || 5.0;
        this.color = config.color || 0xfff4e6;
        this.luminosity = config.luminosity || 8.0;
        this.temperature = config.temperature || 5778;
        this.type = "star";

        // Stellar classification based on temperature
        this.spectralClass = this._getSpectralClass(this.temperature);
        this.actualColor = this._temperatureToColor(this.temperature);

        // Activity sets how many spot groups the disk carries (SDO frames show 0-6).
        this.activityLevel = config.activityLevel != null ? config.activityLevel : 0.6;
        this.rotationPeriod = config.rotationPeriod || 25.4; // days, sidereal at the equator

        this.createMesh();

        // Animation state
        this.time = 0;
        this.rotationSpeed = (2 * Math.PI) / (this.rotationPeriod * 24 * 3600);

        console.log(`🌟 Created SDO-QUALITY star: ${this.name} (Class ${this.spectralClass}, ${this.temperature}K, Activity: ${(this.activityLevel * 100).toFixed(0)}%)`);
    }

    _getSpectralClass(temp) {
        if (temp > 30000) return 'O';
        if (temp > 10000) return 'B';
        if (temp > 7500) return 'A';
        if (temp > 6000) return 'F';
        if (temp > 5200) return 'G';
        if (temp > 3700) return 'K';
        return 'M';
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;

        // Quality tier sets how much photosphere detail the shader computes (granulation
        // is the only costly term, and it only runs on the Sun's own pixels).
        const Q = window.RTQuality;
        this._detail = Q ? ({ high: 2, medium: 1, low: 0 })[Q.tier] : 2;
        // Low tier (and, in the Android build, the PowerVR / low Mali GPUs RTQuality flags as safeGPU) draws the
        // photosphere from a texture baked once from the same procedural fields, so a Sun
        // that fills the screen costs one texture read per pixel instead of a dozen
        // value-noise calls (that per-pixel noise held the PowerVR GE8320 for seconds a frame).
        this._lowSun = Star._wantsLowSun();

        // Photosphere: limb darkening, granulation, sunspots, faculae (one shader).
        this._createPhotosphere();

        // Chromosphere rim + K-corona: one camera-facing quad around the disk. It replaces
        // the old 1.5 R additive shell sphere (which drew a hard-edged grey disk around the
        // Sun), the two big glow sprites, and the prominence / CME / solar-wind point clouds
        // (tens of thousands of orange dots that read as dust, not as anything a camera at
        // 1 AU could see). A filtered photosphere shows none of those.
        this._createLimbAndCorona();

        // Diffraction spikes and lens ghosts come from the camera (CameraOptics.js).
        this.flareElements = [];

        // Tier changes at runtime (fps governor, WebGL context restore) swap the photosphere
        // and corona variants. A lost context takes the baked maps with it: the bake targets
        // are disposed when the context goes (GL deletes are silent no-ops while it is lost,
        // so no stale handle is touched after the restore) and again on restore, and the map
        // is baked from scratch on the restored context.
        this._onTier = () => this._applyTier();
        this._onGL = (e) => { if (e.detail) this._resetBake(); };
        window.addEventListener('rtquality', this._onTier);
        window.addEventListener('rtglcontext', this._onGL);
    }

    static _wantsLowSun() {
        const Q = window.RTQuality;
        return !!(Q && (Q.tier === 'low' || Q.safeGPU));
    }

    _applyTier() {
        const low = Star._wantsLowSun();
        if (low === this._lowSun) return;
        this._lowSun = low;
        if (this.core) this.core.material = low ? this._getBakedMat() : this._fullMat;
        if (this.corona) {
            const m = this.corona.material;
            m.defines = Object.assign({}, m.defines);
            if (low) m.defines.RT_LOW = 1; else delete m.defines.RT_LOW;
            m.needsUpdate = true;
        }
    }

    // ---- low tier photosphere: baked map + limb darkening ----
    // The mu-independent part of the procedural photosphere (unresolved mottling, the
    // supergranular network mask, sunspot umbrae/penumbrae, the plage/faculae mask) is
    // rendered ONCE into a 2048x1024 equirectangular map in the sphere's own UV layout,
    // 128 rows per frame (8 frames) so no single frame carries the whole bake. The draw
    // shader then applies the mu-dependent terms (network and faculae brightening toward
    // the limb, quadratic limb darkening, the filter ramp) exactly as the full shader does.
    // Granulation (300 cells per radius, finer than the map) comes from a second, tiling
    // 512x512 map of the same ridged value-noise cells, repeated 30x15 times over the sphere
    // (so cells stretch toward the poles) and faded by distance like the full shader does.
    // Left out on this path: the slow drift of the mottling and of the granules.
    _getBakedMat() {
        if (this._bakedMat) return this._bakedMat;
        const su = this.surfaceUniforms;
        this._bakedUniforms = {
            uMap: { value: null },
            uGranMap: { value: null },
            uGranRes: { value: 0 },   // granulation visibility (1 resolved .. 0 sub-pixel), from update()
            uReady: { value: 0 },
            uFilter: su.uFilter,      // same uniform objects: update() drives both materials
            uLDR: su.uLDR
        };
        this._bakedMat = new THREE.ShaderMaterial({
            uniforms: this._bakedUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormalV;
                varying vec3 vViewPos;
                void main() {
                    vUv = uv;
                    vNormalV = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewPos = mv.xyz;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform sampler2D uGranMap;
                uniform float uGranRes;
                uniform float uReady;
                uniform float uFilter;
                uniform float uLDR;
                varying vec2 vUv;
                varying vec3 vNormalV;
                varying vec3 vViewPos;
                void main() {
                    float mu = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
                    // r: quiet-Sun intensity incl. spots / 1.1, g: network mask, b: plage mask.
                    // Until the bake finishes: a plain limb-darkened disk.
                    vec3 m = mix(vec3(1.0 / 1.1, 0.0, 0.0), texture2D(uMap, vUv).rgb, uReady);
                    float k = pow(1.0 - mu, 1.5);
                    float I = m.r * 1.1 * (1.0 + m.g * (0.025 + 0.16 * k)) * (1.0 + 0.35 * m.b * k);
                    // granulation: the low-tier ridged cells (~300 per radius) from a tiling
                    // map, faded by the same cells-per-pixel rule, computed per frame on the CPU
                    if (uGranRes > 0.0) {
                        float g = texture2D(uGranMap, vUv * vec2(30.0, 15.0)).r;
                        I *= 1.0 + 0.12 * uGranRes * uReady * (g - 0.55);
                    }
                    float m1 = 1.0 - mu;
                    float L = I * (1.0 - 0.47 * m1 - 0.23 * (1.0 - mu * mu));
                    vec3 bare = vec3(1.0, 0.93, 0.84) * 14.0 * L * pow(vec3(max(mu, 1e-3)), vec3(0.0, 0.1, 0.25));
                    float Lc = max(L, 0.0);
                    vec3 ramp = vec3(pow(Lc, 0.45),
                                     0.78 * pow(max(Lc - 0.1, 0.0) / 0.9, 1.2),
                                     0.5 * pow(max(Lc - 0.4, 0.0) / 0.6, 1.6));
                    vec3 filt = ramp * mix(1.6, 0.98, uLDR);
                    gl_FragColor = vec4(mix(bare, filt, uFilter), 1.0);
                }
            `
        });
        return this._bakedMat;
    }

    // A restored context lost the baked maps: dispose the old targets (and their quads) and
    // bake from scratch on the next frames.
    _resetBake() {
        this._disposeBake();
        if (this._bakedUniforms) {
            this._bakedUniforms.uReady.value = 0;
            this._bakedUniforms.uMap.value = null;
            this._bakedUniforms.uGranMap.value = null;
        }
    }

    _disposeBake() {
        const b = this._bake;
        this._bake = null;
        if (!b) return;
        try { if (b.rt) b.rt.dispose(); } catch (_) {}
        try { if (b.quad) { b.quad.geometry.dispose(); b.quad.material.dispose(); } } catch (_) {}
        try { if (b.gran) b.gran.dispose(); } catch (_) {}
        try { if (b.granQuad) { b.granQuad.geometry.dispose(); b.granQuad.material.dispose(); } } catch (_) {}
    }

    _bakeStep(renderer) {
        let b = this._bake;
        if (b && b.done) return;
        if (!b) {
            const W = 2048, H = 1024;
            // generateMipmaps stays off while the strips render (three.js would rebuild the
            // whole 2048x1024 mip chain after every strip); the final strip turns it on once.
            const rt = new THREE.WebGLRenderTarget(W, H, {
                type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
                wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
                minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
                generateMipmaps: false, depthBuffer: false, stencilBuffer: false
            });
            const mat = new THREE.ShaderMaterial({
                uniforms: { uSpots: this.surfaceUniforms.uSpots },
                depthTest: false, depthWrite: false,
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
                fragmentShader: `
                    uniform vec4 uSpots[8];
                    varying vec2 vUv;
                    // fract(sin(dot(p, (127.1, 311.7, 74.7))) * 43758.5453123) is hash33(p).x of
                    // the full shader, so the baked fields are the same noise.
                    float h1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
                    float vnoise(vec3 p) {
                        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
                        float a = h1(i), b = h1(i + vec3(1,0,0)), c = h1(i + vec3(0,1,0)), d = h1(i + vec3(1,1,0));
                        float e = h1(i + vec3(0,0,1)), g = h1(i + vec3(1,0,1)), h = h1(i + vec3(0,1,1)), k = h1(i + vec3(1,1,1));
                        return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
                    }
                    void main() {
                        // three.js SphereGeometry layout: u = phi / 2pi, v = 1 - theta / pi
                        float phi = vUv.x * 6.28318530718, theta = (1.0 - vUv.y) * 3.14159265359;
                        vec3 p = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
                        float I = 1.0 + 0.025 * (vnoise(p * 9.0) - 0.5) + 0.015 * (vnoise(p * 31.0) - 0.5);
                        float nA = vnoise(p * 25.0 + 3.1), nB = vnoise(p * 57.0 - 1.7);
                        float net = smoothstep(0.55, 0.95, 1.0 - abs(2.0 * nA - 1.0)) * smoothstep(0.25, 0.75, nB);
                        float umbra = 0.0, pen = 0.0, plage = 0.0;
                        for (int i = 0; i < 8; i++) {
                            vec4 s = uSpots[i];
                            if (s.w <= 0.0) continue;
                            float a = acos(clamp(dot(p, s.xyz), -1.0, 1.0)) / s.w;
                            if (a < 6.0) {
                                float edge = 0.08 * (vnoise(p * 900.0) - 0.5);
                                pen = max(pen, 1.0 - smoothstep(0.88, 1.05, a + edge));
                                umbra = max(umbra, 1.0 - smoothstep(0.32, 0.46, a + edge * 0.5));
                                plage = max(plage, 1.0 - smoothstep(1.5, 6.0, a));
                            }
                        }
                        float fil = 0.85 + 0.3 * vnoise(p * 1400.0);
                        I *= mix(1.0, 0.72 * fil, pen);
                        I *= mix(1.0, 0.24, umbra);
                        float fac = plage * smoothstep(0.45, 0.85, vnoise(p * 140.0));
                        gl_FragColor = vec4(clamp(I / 1.1, 0.0, 1.0), net, fac, 1.0);
                    }
                `
            });
            const scene = new THREE.Scene();
            const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
            quad.frustumCulled = false;
            scene.add(quad);
            b = this._bake = { rt, scene, quad, cam: new THREE.Camera(), W, H, rows: 128, row: 0, done: false };
        }
        const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
        if (!b.granDone) {
            // frame 1: the 512x512 tiling granulation map (64 periodic cells across)
            if (!b.gran) {
                b.gran = new THREE.WebGLRenderTarget(512, 512, {
                    type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
                    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
                    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
                    generateMipmaps: true, depthBuffer: false, stencilBuffer: false
                });
                b.granQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
                    depthTest: false, depthWrite: false,
                    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
                    fragmentShader: `
                        varying vec2 vUv;
                        const float P = 64.0;
                        float h(vec2 i) { i = mod(i, P); return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453123); }
                        float vn(vec2 p) {
                            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
                        }
                        void main() {
                            float n = vn(vUv * P);
                            float g = 1.0 - abs(2.0 * n - 1.0);          // 0 on the lanes
                            gl_FragColor = vec4(vec3(smoothstep(0.15, 0.85, g)), 1.0);
                        }
                    `
                }));
                b.granQuad.frustumCulled = false;
                b.granScene = new THREE.Scene();
                b.granScene.add(b.granQuad);
            }
            renderer.autoClear = false;
            renderer.setRenderTarget(b.gran);
            renderer.render(b.granScene, b.cam);
            renderer.setRenderTarget(prevRT);
            renderer.autoClear = prevAuto;
            b.granDone = true;
            this._getBakedMat().uniforms.uGranMap.value = b.gran.texture;
            return;
        }
        b.rt.scissor.set(0, b.row, b.W, Math.min(b.rows, b.H - b.row));
        b.rt.scissorTest = true;
        const last = b.row + b.rows >= b.H;
        b.rt.texture.generateMipmaps = last;   // mip chain built once, after the final strip
        renderer.autoClear = false;
        renderer.setRenderTarget(b.rt);
        renderer.render(b.scene, b.cam);
        renderer.setRenderTarget(prevRT);
        renderer.autoClear = prevAuto;
        b.row += b.rows;
        if (last) {
            b.done = true;
            const bu = this._getBakedMat().uniforms;
            bu.uMap.value = b.rt.texture;
            bu.uReady.value = 1;
        }
    }

    // Deterministic active regions: a few spot groups in the two activity belts (5-35 deg
    // latitude), like the SDO/HMI continuum frames (a handful of small dark spots, never a
    // speckled surface). Seeded from the star's name so every run shows the same Sun.
    _makeSpots() {
        let s = 0;
        for (let i = 0; i < this.name.length; i++) s = (s * 31 + this.name.charCodeAt(i)) >>> 0;
        const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const spots = [];
        const groups = 3 + Math.round(this.activityLevel * 3);
        for (let g = 0; g < groups && spots.length < 8; g++) {
            const lat = (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 26) * Math.PI / 180;
            // spread the groups around the Sun so one is always on the visible side
            const lon = (g + 0.3 * rnd()) * Math.PI * 2 / groups;
            const n = 1 + Math.floor(rnd() * 2);
            for (let k = 0; k < n && spots.length < 8; k++) {
                // leader spot biggest; followers trail in longitude (Joy's-law tilt ignored)
                const la = lat + (rnd() - 0.5) * 0.02, lo = lon - k * (0.03 + rnd() * 0.03);
                const r = (k === 0 ? 0.014 + rnd() * 0.012 : 0.006 + rnd() * 0.007); // radians on the sphere
                spots.push(new THREE.Vector4(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo), r));
            }
        }
        while (spots.length < 8) spots.push(new THREE.Vector4(0, 1, 0, 0));
        return spots;
    }

    _createPhotosphere() {
        const geometry = new THREE.SphereGeometry(this.radius, 128, 96);
        this.surfaceUniforms = {
            time: { value: 0 },
            uDetail: { value: this._detail },
            uSpots: { value: this._makeSpots() },
            // Auto-lens solar filter (0 = bare sensor, 1 = full ND solar filter). Driven
            // per frame from update() when the camera faces the star.
            uFilter: { value: 0.0 },
            // 1 when the scene renders into 8-bit targets (no headroom above 1.0): the
            // filtered disk is scaled to fit under white instead of clipping flat.
            uLDR: { value: window.__rtHDR === false ? 1.0 : 0.0 }
        };
        const material = this._fullMat = new THREE.ShaderMaterial({
            uniforms: this.surfaceUniforms,
            extensions: { derivatives: true },
            vertexShader: `
                varying vec3 vPos;      // object space (pattern rides the rotating Sun)
                varying vec3 vNormalV;  // view space
                varying vec3 vViewPos;
                void main() {
                    vPos = position;
                    vNormalV = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewPos = mv.xyz;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float uDetail;
                uniform float uFilter;
                uniform float uLDR;
                uniform vec4 uSpots[8];
                varying vec3 vPos;
                varying vec3 vNormalV;
                varying vec3 vViewPos;

                vec3 hash33(vec3 p) {
                    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
                    return fract(sin(p) * 43758.5453123);
                }
                float vnoise(vec3 p) {
                    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
                    float a = hash33(i).x, b = hash33(i + vec3(1,0,0)).x, c = hash33(i + vec3(0,1,0)).x, d = hash33(i + vec3(1,1,0)).x;
                    float e = hash33(i + vec3(0,0,1)).x, g = hash33(i + vec3(1,0,1)).x, h = hash33(i + vec3(0,1,1)).x, k = hash33(i + vec3(1,1,1)).x;
                    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
                }
                // Worley F1/F2 with drifting feature points: convection cells that slowly
                // reshape. F2-F1 ~ 0 on the narrow dark intergranular lanes.
                vec2 worley(vec3 p, float t) {
                    vec3 i = floor(p); vec3 f = fract(p);
                    float d1 = 8.0, d2 = 8.0;
                    for (int z = -1; z <= 1; z++)
                    for (int y = -1; y <= 1; y++)
                    for (int x = -1; x <= 1; x++) {
                        vec3 g = vec3(float(x), float(y), float(z));
                        vec3 h = hash33(i + g);
                        vec3 o = 0.5 + 0.38 * sin(t + 6.2831 * h);
                        vec3 r = g + o - f;
                        float d = dot(r, r);
                        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
                    }
                    return vec2(sqrt(d1), sqrt(d2));
                }

                void main() {
                    vec3 p = normalize(vPos);
                    float mu = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);

                    // ---- granulation (white-light contrast ~10% when resolved) ----
                    float I = 1.0;
                    if (uDetail > 0.5) {
                        const float F = 300.0;               // cells per unit-sphere radius
                        vec3 q = p * F;
                        // how many cells fall in one pixel: fade detail the sensor can't resolve
                        float cellsPerPx = length(fwidth(q));
                        float res = 1.0 - smoothstep(0.35, 1.3, cellsPerPx);
                        if (res > 0.0) {
                            vec2 w = worley(q, time * 0.25);
                            float lane = smoothstep(0.0, 0.22, w.y - w.x);      // dark lanes
                            float dome = 1.0 - smoothstep(0.0, 0.75, w.x);       // bright centres
                            float g = lane * 0.65 + dome * 0.35 - 0.55;
                            if (uDetail > 1.5) {                                 // finer second scale
                                vec2 w2 = worley(q * 2.3 + 17.0, time * 0.4);
                                g += 0.25 * (smoothstep(0.0, 0.2, w2.y - w2.x) - 0.6);
                            }
                            I *= 1.0 + 0.16 * res * g;
                        }
                    } else {
                        // Low tier: the same cell scale from one value-noise octave (8 taps
                        // instead of Worley's 27). Ridged noise gives bright cells split by
                        // dark lanes; same resolution fade, a little less contrast.
                        vec3 q = p * 300.0;
                        float res = 1.0 - smoothstep(0.35, 1.3, length(fwidth(q)));
                        if (res > 0.0) {
                            float n = vnoise(q * 0.9 + vec3(0.0, time * 0.05, 0.0));
                            float g = 1.0 - abs(2.0 * n - 1.0);          // 0 on the lanes
                            I *= 1.0 + 0.12 * res * (smoothstep(0.15, 0.85, g) - 0.55);
                        }
                    }
                    // unresolved convection: very low-contrast mottling, always on
                    I *= 1.0 + 0.025 * (vnoise(p * 9.0 + time * 0.01) - 0.5) + 0.015 * (vnoise(p * 31.0 - time * 0.02) - 0.5);
                    // Supergranular network (~30 Mm cells, ~25 per solar radius): magnetic
                    // network faculae outline the cells. Faint at disk centre, brighter toward
                    // the limb (white-light faculae contrast grows as mu falls), so the disk
                    // keeps a resolved texture at distances where granules are sub-pixel.
                    {
                        float nA = vnoise(p * 25.0 + 3.1), nB = vnoise(p * 57.0 - 1.7);
                        float net = smoothstep(0.55, 0.95, 1.0 - abs(2.0 * nA - 1.0)) * smoothstep(0.25, 0.75, nB);
                        I *= 1.0 + net * (0.025 + 0.16 * pow(1.0 - mu, 1.5));
                    }

                    // ---- sunspots (umbra ~0.2, penumbra ~0.75 of the quiet Sun) + faculae ----
                    float umbra = 0.0, pen = 0.0, plage = 0.0;
                    for (int i = 0; i < 8; i++) {
                        vec4 s = uSpots[i];
                        if (s.w <= 0.0) continue;
                        float a = acos(clamp(dot(p, s.xyz), -1.0, 1.0)) / s.w;
                        if (a < 6.0) {
                            // ragged penumbra edge, radial filaments
                            float edge = 0.08 * (vnoise(p * 900.0) - 0.5);
                            pen = max(pen, 1.0 - smoothstep(0.88, 1.05, a + edge));
                            umbra = max(umbra, 1.0 - smoothstep(0.32, 0.46, a + edge * 0.5));
                            plage = max(plage, 1.0 - smoothstep(1.5, 6.0, a));
                        }
                    }
                    float fil = 0.85 + 0.3 * vnoise(p * 1400.0);
                    I *= mix(1.0, 0.72 * fil, pen);
                    I *= mix(1.0, 0.24, umbra);
                    // faculae: bright network around active regions, only visible near the limb
                    float fac = plage * smoothstep(0.45, 0.85, vnoise(p * 140.0)) * pow(1.0 - mu, 1.5);
                    I *= 1.0 + 0.35 * fac;

                    // ---- limb darkening ----
                    // Quadratic law fitted to the measured visible-band solar profile:
                    // I(mu)/I(1) = 1 - 0.47(1-mu) - 0.23(1-mu^2), so the limb sits at ~30%.
                    float m1 = 1.0 - mu;
                    float L = I * (1.0 - 0.47 * m1 - 0.23 * (1.0 - mu * mu));

                    // Bare sensor: a 5800 K disk many stops over white (blooms, flares), still
                    // a little redder toward the limb (limb darkening is stronger in the blue).
                    vec3 bare = vec3(1.0, 0.93, 0.84) * 14.0 * L * pow(vec3(max(mu, 1e-3)), vec3(0.0, 0.1, 0.25));
                    // Through the solar filter: the SDO/HMI continuum look (orange disk, pale
                    // peach centre, deep red-orange limb). Intensity maps through the same kind
                    // of black-red-orange-peach ramp the HMI frames use, so the darker limb,
                    // spots and lanes turn redder as they dim. The gain assumes the
                    // auto-exposure floor (0.6) that the meter settles on with the Sun in frame:
                    // the centre lands just over the bloom threshold, so it glows softly
                    // without clipping to white (the HMI frames never go white).
                    // The ramp keeps a real slope at the top end (L ~ 1, disk centre): the old
                    // smoothstep ramps went flat there, which erased the granulation exactly
                    // where the disk is brightest.
                    float Lc = max(L, 0.0);
                    vec3 ramp = vec3(pow(Lc, 0.45),
                                     0.78 * pow(max(Lc - 0.1, 0.0) / 0.9, 1.2),
                                     0.5 * pow(max(Lc - 0.4, 0.0) / 0.6, 1.6));
                    // Gain: with the meter at its floor (0.6) the centre's red lands at ~0.95,
                    // just over the bloom threshold, so it glows softly and never clips flat.
                    // With no headroom (8-bit targets) the disk is scaled to fit under 1.0.
                    vec3 filt = ramp * mix(1.6, 0.98, uLDR);
                    vec3 col = mix(bare, filt, uFilter);
                    gl_FragColor = vec4(col, 1.0);
                }
            `
        });
        // The full shader is only compiled if it is ever drawn (never on low tier).
        this.core = new THREE.Mesh(geometry, this._lowSun ? this._getBakedMat() : material);
        this.mesh.add(this.core);
    }

    _createLimbAndCorona() {
        this.coronaUniforms = {
            time: { value: 0 },
            uExtent: { value: this.radius * 7.0 },  // half-size of the quad, world units
            uSilR: { value: this.radius },          // silhouette radius in the quad plane
            uPxR: { value: 0.003 },                 // one screen pixel, in solar radii
            uGain: { value: 1.0 },
            uFilt: { value: 0.0 }                   // the auto-lens solar filter (0..1)
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.coronaUniforms,
            // Low tier: no spicule / streamer noise (no atan, no hashes): the quad can cover
            // the whole screen up close, so it keeps to the radial profile only.
            defines: this._lowSun ? { RT_LOW: 1 } : {},
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: `
                uniform float uExtent, uSilR;
                varying vec2 vR;   // position in units of the disk's silhouette radius
                void main() {
                    // Face the quad along the line of sight to the Sun's centre (not just the
                    // view plane): only then is the disk's silhouette an exact circle of
                    // radius uSilR in the quad, wherever the Sun sits in the frame.
                    vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    vec3 f = normalize(c);
                    vec3 rt = normalize(cross(f, abs(f.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
                    vec3 up = cross(rt, f);
                    vec2 o = position.xy * uExtent;
                    vR = o / uSilR;
                    gl_Position = projectionMatrix * vec4(c + rt * o.x + up * o.y, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time, uPxR, uGain, uExtent, uSilR, uFilt;
                varying vec2 vR;
                float h1(float n) { return fract(sin(n) * 43758.5453); }
                float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
                void main() {
                    float r = length(vR);
                    if (r < 0.997) discard;               // the photosphere covers it anyway
                    float h = max(r - 1.0, 0.0);
                #ifdef RT_LOW
                    float sp = 1.0, st = 1.0;
                #else
                    float ang = atan(vR.y, vR.x);
                #endif

                    // Chromosphere: ~2000 km (0.003 R) thick, H-alpha red; drawn at least a
                    // pixel and a half wide so it reads as a soft rim instead of aliasing.
                    // Ragged top from spicules.
                    float w = max(0.004, 1.5 * uPxR);
                #ifndef RT_LOW
                    float sp = 0.6 + 0.8 * n1(ang * 180.0 + time * 0.05) * n1(ang * 47.0 - time * 0.03);
                #endif
                    float chromo = exp(-h / (w * sp)) * smoothstep(0.997, 1.0 + 0.5 * uPxR, r);
                    vec3 col = vec3(1.0, 0.28, 0.18) * chromo * 0.9;

                    // K-corona: Baumbach's radial profile (r^-17, r^-7, r^-2.5 terms),
                    // normalised to 1 at the limb, with slow streamer structure in angle.
                    float kc = (2.565 * pow(r, -17.0) + 1.425 * pow(r, -7.0) + 0.0532 * pow(r, -2.5)) / 4.043;
                #ifndef RT_LOW
                    float st = 0.55 + 0.6 * n1(ang * 2.2 + 3.0) + 0.35 * n1(ang * 7.0 + time * 0.004);
                    st = mix(1.0, st, smoothstep(1.0, 1.4, r));
                #endif
                    col += vec3(1.0, 0.94, 0.86) * kc * st * 0.55;

                    // Through the solar filter the outer corona falls ~5 stops under the
                    // filtered disk and is lost in the sensor floor; only the bright inner
                    // K-corona stays, as a soft glow hugging the limb. Without this the
                    // r^-2.5 tail plus its bloom laid a grey veil over the whole frame when
                    // the Sun filled the screen.
                    col *= mix(1.0, exp(-h * 3.0), uFilt);
                    // fade to exactly zero before the quad edge: no visible boundary
                    float rMax = uExtent / uSilR;
                    col *= 1.0 - smoothstep(rMax * 0.55, rMax * 0.98, r);
                    gl_FragColor = vec4(col * uGain, 1.0);
                }
            `
        });
        this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        this.corona.frustumCulled = false;
        this.corona.renderOrder = 1;
        this.mesh.add(this.corona);
        this.coronaLayers = [];   // legacy name kept empty for anything that iterates it
    }
    // Improved blackbody temperature to color
    _temperatureToColor(temp) {
        temp = Math.max(1000, Math.min(40000, temp));
        let r, g, b;

        // More accurate blackbody approximation
        if (temp <= 6600) {
            r = 1.0;
            g = Math.max(0, Math.min(1, 0.39 * Math.log(temp / 100) - 0.634));
            if (temp <= 1900) {
                b = 0;
            } else {
                b = Math.max(0, Math.min(1, 0.543 * Math.log(temp / 100 - 10) - 1.196));
            }
        } else {
            r = Math.max(0, Math.min(1, 1.292 * Math.pow(temp / 100 - 60, -0.133)));
            g = Math.max(0, Math.min(1, 1.130 * Math.pow(temp / 100 - 60, -0.0755)));
            b = 1.0;
        }

        // Apply gamma correction for more natural appearance
        r = Math.pow(r, 0.8);
        g = Math.pow(g, 0.8);
        b = Math.pow(b, 0.8);

        return new THREE.Color(r, g, b);
    }

    update(deltaTime, rendererCore) {
        this.time += deltaTime;
        const cam = rendererCore && rendererCore.camera;
        if (cam && this.mesh) {
            const sp = this.mesh.getWorldPosition(this._wp || (this._wp = new THREE.Vector3()));
            const camDist = cam.position.distanceTo(sp);

            // AUTO-LENS: when the camera looks at the star, ramp in the solar filter so the
            // disk resolves (limb darkening, granulation, spots) instead of a white blowout.
            // Smoothed so it behaves like a camera adapting.
            const toStar = sp.clone().sub(cam.position).normalize();
            const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const facing = Math.max(0, camDir.dot(toStar));
            const target = facing > 0.6 ? 1 : 0;
            this._filter = (this._filter || 0) + (target - (this._filter || 0)) * Math.min(1, deltaTime * 3.5);
            if (this.surfaceUniforms) this.surfaceUniforms.uFilter.value = this._filter;
            window.__sunFilter = this._filter;   // god rays + camera optics read it
            // No headroom either when the frame is drawn directly (no composer: the black-frame
            // fallback or no post support): there is no HDR target and no auto-exposure, so the
            // 1.6x filtered disk would clip flat at white. Scale it under 1.0 as on 8-bit.
            const direct = !(typeof rendererCore !== 'undefined' && rendererCore && rendererCore.useComposer && rendererCore.composer);
            if (this.surfaceUniforms) this.surfaceUniforms.uLDR.value = (window.__rtHDR === false || direct) ? 1.0 : 0.0;

            if (this.coronaUniforms) {
                const R = this.radius;
                const d = Math.max(camDist, R * 1.001);
                // the tangent cone's silhouette radius in the plane through the centre
                this.coronaUniforms.uSilR.value = R * d / Math.sqrt(d * d - R * R);
                const fovR = THREE.MathUtils.degToRad(cam.fov || 60);
                const H = (rendererCore.renderer && rendererCore.renderer.domElement.height) || 1080;
                // world size of one pixel at the Sun's distance, in solar radii
                this.coronaUniforms.uPxR.value = (2 * d * Math.tan(fovR / 2) / H) / R;
                if (this._bakedUniforms) {
                    // granules per pixel at the nearest surface point (300 per radius), the
                    // full shader's fwidth rule evaluated once per frame
                    const cellsPerPx = 300 * (2 * Math.max(d - R, 1e-3 * R) * Math.tan(fovR / 2) / H) / R;
                    const t = Math.min(1, Math.max(0, (cellsPerPx - 0.35) / 0.95));
                    this._bakedUniforms.uGranRes.value = 1 - t * t * (3 - 2 * t);
                }
                // the corona is scattered photospheric light: the filter dims it too
                this.coronaUniforms.uGain.value = 1.0 + 5.0 * (1 - this._filter);
                this.coronaUniforms.uFilt.value = this._filter;
                this.coronaUniforms.time.value = this.time;
            }
        }

        if (this._lowSun && rendererCore && rendererCore.renderer && !rendererCore.contextLost &&
            !(this._bake && this._bake.done)) {
            let failed = false;
            try { this._bakeStep(rendererCore.renderer); }
            catch (e) { failed = true; console.warn('Sun bake skipped:', e); }
            finally {
                // a failed bake frees its targets and stays on the plain limb-darkened disk
                if (failed) { this._disposeBake(); this._bake = { done: true, failed: true }; }
            }
        }

        if (this.core) {
            this.core.rotation.y += this.rotationSpeed * deltaTime;
            if (this.surfaceUniforms) this.surfaceUniforms.time.value = this.time;
        }
    }
    dispose() {
        window.removeEventListener('rtquality', this._onTier);
        window.removeEventListener('rtglcontext', this._onGL);
        this._disposeBake();
        if (this._fullMat) this._fullMat.dispose();
        if (this._bakedMat) this._bakedMat.dispose();
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}
