// BlackHole.js - Schwarzschild black hole rendered by tracing light through curved spacetime.
//
// Nothing here is a painted-on effect. Every pixel near the hole fires a light ray backwards
// from the camera and bends it with the exact Schwarzschild photon orbit equation
//     d2u/dphi2 + u = (3/2) rs u^2          (u = 1/r)
// integrated in Cartesian form as  a = -(3/2) rs h^2 x / r^5  (h = |x cross v|, conserved).
// Whatever the bent ray hits decides the pixel:
//   * falls inside r = rs            -> black. The shadow edge lands at sqrt(27)/2 = 2.598 rs
//                                       on its own, it is not drawn.
//   * crosses the disk plane          -> thin accretion disk emission (front to back, every
//                                       crossing counts, so the far side of the disk shows up
//                                       lensed over the top and under the bottom, and the
//                                       rays that wind around the photon sphere stack up into
//                                       the thin photon ring).
//   * escapes                         -> samples the ALREADY RENDERED scene in the bent
//                                       direction, so the real stars and Milky Way behind the
//                                       hole are lensed (post-processing pass after RenderPass).
// Outside the traced sphere the remaining weak-field bend (total 2 rs / b, i.e. 4GM/(c^2 b))
// is added analytically so the star field distortion continues smoothly past it.
//
// Disk: thin Keplerian disk, inner edge at the ISCO (3 rs), flux profile of the Novikov-Thorne
// / Shakura-Sunyaev thin disk F ~ r^-3 (1 - sqrt(r_isco / r)), T ~ F^(1/4). Each crossing gets
// the full redshift factor g = sqrt(1 - rs/r) / (gamma (1 - beta cos theta)) with the
// Schwarzschild circular-orbit speed beta = sqrt(rs / (2 (r - rs))) (0.5c at the ISCO), so the
// approaching side is brighter (bolometric I ~ g^4) and bluer (T_obs = g T), the receding side
// dim and red. A real disk around Sgr A* peaks in UV/X-ray; the peak is mapped to 1900 K so
// the physical shift ratio g lands in visible colours (the same choice NASA Goddard's Schnittman
// 2019 visualization makes: its orange is a palette, the brightness asymmetry is physics).
//
// Calibrated against Schnittman 2019 (NASA SVS 13326): shadow + thin secondary ring inside the
// lensed disk, strongly beamed approaching side, sheared filamentary turbulence.
//
// Quality tiers (high/medium/low) change ray steps, step size and turbulence octaves.
// Fallback: if the composer is off (iOS black-frame guard), a proxy sphere runs the same tracer
// as an ordinary transparent mesh: shadow, disk and photon ring stay correct, only the
// background starlight is not lensed (a mesh can't read the frame it is drawing into).

class BlackHole {
    constructor(config = {}) {
        this.name = config.name || "BlackHole";
        this.radius = config.radius || 3.0;      // Schwarzschild radius rs, world units
        this.mass = config.mass || 10.0;
        this.spinRate = config.spinRate || 0.5;  // sets disk animation speed (Schwarzschild: no spin in the metric)
        this.accretionDiskEnabled = config.accretionDisk !== false;
        this.type = "blackhole";

        // Geometry in units of rs.
        this.diskInner = 3.0;   // ISCO of a Schwarzschild hole = 6GM/c^2 = 3 rs
        // Outer edge 12 rs (was 20): matched to Schnittman 2019 (NASA SVS 13326), where the
        // visible disk spans ~4.5 shadow diameters; at 20 rs the dim outer annulus dominated
        // the frame and the shadow read too small.
        this.diskOuter = 12.0;
        this.traceRadius = 22.0; // full geodesic integration inside this sphere, analytic outside
        // Inclination from the Sun's side (degrees from the disk axis). 80 deg gives the
        // Interstellar / Luminet view on arrival. Sgr A*'s true orientation is uncertain
        // (EHT 2022 prefers a more face-on view); the camera can orbit to any angle.
        // 76 deg (was 80): Schnittman's frame; the far side of the disk is lensed into a
        // tall bright arch over the shadow and the near side still crosses in front of it.
        this.viewInclination = config.inclination || 76;
        // Fly-to arrival distance (world units): 30 rs frames shadow + whole 12 rs disk.
        this.flyDistance = this.radius * 30;

        this.time = 0;
        this.tier = BlackHole.detectTier();
        this._oriented = false;
        this._onRtq = (e) => this.setQuality(e.detail.tier);
        window.addEventListener('rtquality', this._onRtq);
        this.createMesh();

        console.log(`🕳️ Created BLACK HOLE: ${this.name} (geodesic ray-traced lensing, tier ${this.tier})`);
    }

    // ---------------------------------------------------------------- quality tiers
    // Tier comes from the global RTQuality (single source of truth; ?rtq= / ?tier= override).
    static detectTier() {
        const t = window.RTQuality && window.RTQuality.tier;
        return (t === 'high' || t === 'medium' || t === 'low') ? t : 'medium';
    }

    static tierDefines(tier) {
        if (tier === 'high') return { BH_STEPS: 300, BH_K: '0.045', BH_OCT: 4, BH_FLOW2: 1 };
        if (tier === 'low') return { BH_STEPS: 90, BH_K: '0.14', BH_OCT: 2, BH_FLOW2: 0 };
        return { BH_STEPS: 160, BH_K: '0.08', BH_OCT: 3, BH_FLOW2: 1 };
    }

    setQuality(tier) {
        if (!['high', 'medium', 'low'].includes(tier) || tier === this.tier) return;
        this.tier = tier;
        const d = BlackHole.tierDefines(tier);
        [this.proxy?.material, BlackHole.lensPass?.material].forEach(m => {
            if (!m) return;
            m.defines = Object.assign({}, m.defines, d);
            m.needsUpdate = true;
        });
    }

    // ---------------------------------------------------------------- shared GLSL
    static get GLSL_COMMON() {
        return `
        uniform float uTime;
        uniform float uIn;
        uniform float uOut;
        uniform float uRb;
        uniform float uFmax;
        uniform float uTpeak;
        uniform float uGain;
        uniform float uSpin;      // +1 prograde about local +y
        uniform float uDisk;      // 1 = disk on

        float bhHash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float bhNoise(vec3 x) {
            vec3 i = floor(x); vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(bhHash(i), bhHash(i + vec3(1,0,0)), f.x),
                           mix(bhHash(i + vec3(0,1,0)), bhHash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(bhHash(i + vec3(0,0,1)), bhHash(i + vec3(1,0,1)), f.x),
                           mix(bhHash(i + vec3(0,1,1)), bhHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }

        // Turbulence co-moving with the gas: each radius turns at its own Keplerian rate
        // Omega = sqrt(GM / r^3) (= sqrt(0.5 / r^3) with rs = c = 1), so the pattern shears
        // into trailing filaments. Two phase-offset layers cross-fade so the winding never
        // tightens into aliasing stripes.
        float bhLayer(float r, float phi, float t) {
            float om = sqrt(0.5 / (r * r * r));
            float a = phi - uSpin * om * t;
            float lr = log(r);
            // Long in azimuth, thin in radius: filaments like the MHD sims Schnittman renders.
            vec3 p = vec3(cos(a) * 2.6, sin(a) * 2.6, lr * 17.0);
            float n = 0.0, amp = 0.6, tot = 0.0;
            for (int o = 0; o < BH_OCT; o++) {
                float q = bhNoise(p);
                n += amp * (1.0 - abs(2.0 * q - 1.0));   // ridged: thin bright strands
                tot += amp;
                p *= vec3(2.03, 2.03, 2.3);
                amp *= 0.6;
            }
            return n / tot;
        }
        float bhDensity(float r, float phi) {
            const float P = 48.0;
            float t1 = mod(uTime, P);
        #if BH_FLOW2 == 1
            float t2 = mod(uTime + 0.5 * P, P);
            float w = abs(t1 / P - 0.5) * 2.0;     // 1 when layer 1 resets, 0 mid-cycle
            float d = mix(bhLayer(r, phi, t1), bhLayer(r, phi, t2 + 97.0), w);
        #else
            float d = bhLayer(r, phi, t1);
        #endif
            return smoothstep(0.3, 0.85, d);
        }

        // Planck spectrum sampled at R/G/B wavelengths (micrometres), brightest channel = 1
        // (so the bolometric intensity sets the peak channel: a dim red stays a saturated red).
        vec3 bhBlackbody(float T) {
            T = clamp(T, 1000.0, 40000.0);
            vec3 lam = vec3(0.610, 0.550, 0.465);
            vec3 l5 = lam * lam * lam * lam * lam;
            vec3 p = 1.0 / (l5 * (exp(14388.0 / (lam * T)) - 1.0));
            return p / max(p.r, max(p.g, p.b));
        }

        // Emission + opacity where a ray crosses the disk plane (local y = 0).
        // order = how many times this photon has already crossed the disk plane (0 = direct
        // image, 1+ = lensed images: the arch's under-side, the photon ring).
        vec4 bhDiskSample(vec3 xc, vec3 dir, float order) {
            float r = length(xc.xz);
            if (uDisk < 0.5 || r < uIn || r > uOut) return vec4(0.0);
            float phi = atan(xc.z, xc.x);
            // Thin-disk flux, normalised to 1 at its peak (r = 49/36 r_isco).
            float F = max((1.0 - sqrt(uIn / r)) / (r * r * r) / uFmax, 0.0);
            float Temit = uTpeak * pow(F, 0.25);
            // Circular orbit speed seen by a static observer, and redshift factor g.
            float beta = min(sqrt(0.5 / (r - 1.0)), 0.99);
            float gam = 1.0 / sqrt(1.0 - beta * beta);
            vec3 vel = uSpin * normalize(vec3(-xc.z, 0.0, xc.x));
            vec3 n = -dir;                                    // photon heads to the camera
            float g = sqrt(1.0 - 1.0 / r) / (gam * (1.0 - beta * dot(vel, n)));
            // Higher-order images are squeezed ~e^(pi) per half orbit, so one pixel of the
            // photon ring covers a long stretch of disk: show the turbulence's mean there
            // (a box-filter of the noise) instead of point-sampling it into a dotted ring.
            float dens = order < 0.5 ? bhDensity(r, phi) : mix(bhDensity(r, phi), 0.42, min(order, 1.0) * 0.9);
            // Outer fade over most of the disk (not just its rim): in Schnittman's frames the
            // outer disk dims and reddens steadily, so the bright inner disk and its lensed
            // arch carry the image instead of a uniformly lit plate with a hard edge.
            float edge = smoothstep(uOut, uOut * 0.3, r) * smoothstep(uIn, uIn * 1.04, r);
            // Slab optical depth grows along grazing paths (1 / |cos|).
            float tau = (0.12 + 2.2 * dens) * edge / max(abs(dir.y), 0.03);
            float alpha = 1.0 - exp(-tau);
            float S = F * (0.35 + 1.1 * dens);
            float g2 = g * g;
            vec3 col = bhBlackbody(g * Temit) * (g2 * g2 * S * uGain * alpha);
            return vec4(col, alpha);
        }

        // Integrate one photon backwards. x, v in rs units, v unit length.
        // Returns rgb = disk light, a = accumulated opacity; esc = 1 if it escaped (dirOut set).
        vec4 bhTrace(vec3 x, vec3 v, out vec3 dirOut, out float esc) {
            vec3 col = vec3(0.0);
            float A = 0.0;
            esc = 0.0;
            dirOut = v;
            float order = 0.0;
            vec3 L = cross(x, v);
            float h2 = dot(L, L);
            for (int i = 0; i < BH_STEPS; i++) {
                float r = length(x);
                float dt = clamp(BH_K * r, 0.01, 2.5);
                vec3 xp = x;
                float r2 = r * r;
                v += x * (-1.5 * h2 / (r2 * r2 * r) * 0.5 * dt);
                x += v * dt;
                r = length(x); r2 = r * r;
                v += x * (-1.5 * h2 / (r2 * r2 * r) * 0.5 * dt);
                if (xp.y * x.y < 0.0) {
                    vec3 xc = mix(xp, x, xp.y / (xp.y - x.y));
                    vec4 e = bhDiskSample(xc, normalize(v), order);
                    col += (1.0 - A) * e.rgb;
                    A += (1.0 - A) * e.a;
                    order += 1.0;
                    if (A > 0.995) break;
                }
                if (r < 1.0) { A = 1.0; break; }                        // event horizon
                if (r > uRb && dot(x, v) > 0.0) { esc = 1.0; dirOut = normalize(v); dirOut = bhTail(x, dirOut); break; }
                if (i == BH_STEPS - 1) A = 1.0;   // still winding near the photon sphere: treat as captured
            }
            // Display curve (keeps hue): the frame is gamma-encoded later, which squashes the
            // physical g^4 beaming contrast to ~2:1 on screen; a 1.6 power below 0.8 restores
            // a visible range, and a soft roll-off above keeps bloom from flooding.
            float lum = max(col.r, max(col.g, col.b));
            if (lum > 1e-5) {
                float lo = 0.8 * pow(min(lum, 0.8) / 0.8, 1.6);
                float hi = 0.8 + 0.35 * (1.0 - exp(-max(lum - 0.8, 0.0) / 0.35));
                col *= (lum < 0.8 ? lo : hi) / lum;
            }
            return vec4(col, A);
        }
        `;
    }

    // Weak-field helpers: integral of the perpendicular acceleration along a straight line.
    static get GLSL_WEAK() {
        return `
        // f(s) for the bend accumulated along a straight path with impact parameter b:
        // bend(s1 -> s2) = (f(s2) - f(s1)) / (2 b) in units rs; f(+-inf) = +-2  (total 2 rs / b).
        float bhF(float s, float b) {
            float r2 = b * b + s * s;
            return s * (2.0 * s * s + 3.0 * b * b) / (r2 * sqrt(r2));
        }
        // Remaining bend from point p heading d out to infinity.
        vec3 bhTail(vec3 p, vec3 d) {
            float tc = -dot(p, d);
            vec3 pc = p + d * tc;
            float b = max(length(pc), 1e-4);
            float a = (2.0 - bhF(-tc, b)) / (2.0 * b);
            return normalize(d * cos(a) - pc / b * sin(a));
        }
        `;
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;

        const rin = this.diskInner;
        // Peak of (1 - sqrt(rin/r)) / r^3 sits at r = 49/36 rin.
        const rp = rin * 49 / 36;
        const fmax = (1 - Math.sqrt(rin / rp)) / (rp * rp * rp);

        this.sharedUniforms = {
            uTime: { value: 0 },
            uIn: { value: rin },
            uOut: { value: this.diskOuter },
            uRb: { value: this.traceRadius },
            uFmax: { value: fmax },
            uTpeak: { value: 1900 },
            uGain: { value: 0.7 },
            uSpin: { value: 1 },
            uDisk: { value: this.accretionDiskEnabled ? 1 : 0 }
        };

        this._createProxy();

        // Claim the screen-space lens pass (one hole drives it).
        if (BlackHole.lensPass && !BlackHole.lensPass.userData.owner) {
            BlackHole.lensPass.userData.owner = this;
            BlackHole.lensPass.material.defines = Object.assign({}, BlackHole.lensPass.material.defines, BlackHole.tierDefines(this.tier));
            BlackHole.lensPass.material.needsUpdate = true;
        }
    }

    // Direct-render fallback: the same tracer on a transparent sphere around the hole.
    _createProxy() {
        const R = this.traceRadius * this.radius;
        const geo = new THREE.SphereGeometry(R, 48, 32);
        this.proxyUniforms = Object.assign({
            uCamLocal: { value: new THREE.Vector3() },
            uWorldToLocal: { value: new THREE.Matrix3() }
        }, this.sharedUniforms);

        const mat = new THREE.ShaderMaterial({
            uniforms: this.proxyUniforms,
            defines: BlackHole.tierDefines(this.tier),
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec3 vWorld;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorld = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <logdepthbuf_pars_fragment>
                uniform vec3 uCamLocal;
                uniform mat3 uWorldToLocal;
                varying vec3 vWorld;
                ${BlackHole.GLSL_WEAK}
                ${BlackHole.GLSL_COMMON}
                void main() {
                    #include <logdepthbuf_fragment>
                    vec3 ro = uCamLocal;
                    vec3 rd = normalize(uWorldToLocal * (vWorld - cameraPosition));
                    float D = length(ro);
                    float tc = -dot(ro, rd);
                    vec3 pc = ro + rd * tc;
                    float b = max(length(pc), 1e-4);
                    vec3 x = ro, v = rd;
                    if (D > uRb) {
                        if (tc < 0.0 || b >= uRb) discard;
                        float te = tc - sqrt(uRb * uRb - b * b);
                        x = ro + rd * te;
                        float a = (bhF(te - tc, b) - bhF(-tc, b)) / (2.0 * b);
                        v = normalize(rd * cos(a) - pc / b * sin(a));
                    }
                    vec3 dOut; float esc;
                    vec4 res = bhTrace(x, v, dOut, esc);
                    if (res.a < 0.002) discard;
                    gl_FragColor = vec4(res.rgb / max(res.a, 1e-3), res.a);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false
        });
        this.proxy = new THREE.Mesh(geo, mat);
        this.proxy.frustumCulled = false;
        this.proxy.renderOrder = 5;
        this.mesh.add(this.proxy);
    }

    // Screen-space lensing pass. Created once by main.js right after the RenderPass, so it
    // bends the real rendered scene before bloom.
    static createLensPass() {
        if (!THREE.ShaderPass) return null;
        const shader = {
            uniforms: {
                tDiffuse: { value: null },
                uInvProj: { value: new THREE.Matrix4() },
                uProj: { value: new THREE.Matrix4() },
                uViewToLocal: { value: new THREE.Matrix3() },
                uLocalToView: { value: new THREE.Matrix3() },
                uCamLocal: { value: new THREE.Vector3(0, 0, 1e6) },
                uPxPerRad: { value: 800 },
                uHalo0: { value: 60 },
                uHalo1: { value: 220 },
                uTime: { value: 0 }, uIn: { value: 3 }, uOut: { value: 12 }, uRb: { value: 22 },
                uFmax: { value: 1 }, uTpeak: { value: 1900 }, uGain: { value: 0.7 },
                uSpin: { value: 1 }, uDisk: { value: 1 }
            },
            defines: BlackHole.tierDefines(BlackHole.detectTier()),
            vertexShader: `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D tDiffuse;
                uniform mat4 uInvProj;
                uniform mat4 uProj;
                uniform mat3 uViewToLocal;
                uniform mat3 uLocalToView;
                uniform vec3 uCamLocal;
                uniform float uPxPerRad;
                uniform float uHalo0;
                uniform float uHalo1;
                varying vec2 vUv;
                ${BlackHole.GLSL_WEAK}
                ${BlackHole.GLSL_COMMON}

                // Off-screen fallback for rays bent toward something the frame never drew.
                vec3 bhStars(vec3 d) {
                    vec3 p = d * 260.0;
                    vec3 i = floor(p);
                    vec3 f = fract(p) - 0.5;
                    float h = bhHash(i);
                    float s = step(0.992, h) * smoothstep(0.3, 0.0, length(f));
                    return vec3(s * (h - 0.992) * 90.0);
                }
                vec3 bhBackground(vec3 dLocal) {
                    vec3 dv = uLocalToView * dLocal;
                    vec3 col = vec3(0.0);
                    float w = 0.0;
                    if (dv.z < -1e-4) {
                        vec4 c = uProj * vec4(dv, 0.0);
                        vec2 uv = c.xy / c.w * 0.5 + 0.5;
                        vec2 e = min(uv, 1.0 - uv);
                        w = clamp(min(e.x, e.y) * 30.0, 0.0, 1.0);
                        if (w > 0.0) col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
                    }
                    if (w < 1.0) col = mix(bhStars(dLocal), col, w);
                    return col;
                }

                void main() {
                    vec4 base = texture2D(tDiffuse, vUv);
                    // Unproject on the NEAR plane: with far = 2e6 the far-plane w underflows to 0 in fp32.
                    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
                    vec3 rd = normalize(uViewToLocal * normalize(vp.xyz / vp.w));
                    vec3 ro = uCamLocal;
                    float D = length(ro);
                    float tc = -dot(ro, rd);
                    vec3 pc = ro + rd * tc;
                    float b = max(length(pc), 1e-4);
                    bool inside = D < uRb;
                    if (!inside && (tc <= 0.0 || b >= uRb)) {
                        // Weak field only: bend from the camera out to infinity.
                        float a = (2.0 - bhF(-tc, b)) / (2.0 * b);
                        // No depth here, so fade the far halo instead of bending foreground
                        // objects across the whole sky.
                        a *= 1.0 - smoothstep(uHalo0, uHalo1, b);
                        if (a * uPxPerRad < 0.15) { gl_FragColor = base; return; }
                        vec3 d = normalize(rd * cos(a) - pc / b * sin(a));
                        gl_FragColor = vec4(bhBackground(d), base.a);
                        return;
                    }
                    vec3 x = ro, v = rd;
                    if (!inside) {
                        float te = tc - sqrt(uRb * uRb - b * b);
                        x = ro + rd * te;
                        float a = (bhF(te - tc, b) - bhF(-tc, b)) / (2.0 * b);
                        v = normalize(rd * cos(a) - pc / b * sin(a));
                    }
                    vec3 dOut; float esc;
                    vec4 res = bhTrace(x, v, dOut, esc);
                    vec3 bg = esc > 0.5 ? bhBackground(dOut) : vec3(0.0);
                    gl_FragColor = vec4(res.rgb + (1.0 - res.a) * bg, base.a);
                }
            `
        };
        const pass = new THREE.ShaderPass(shader);
        pass.enabled = false;
        pass.userData = { owner: null };
        BlackHole.lensPass = pass;
        return pass;
    }

    // Tilt the disk so it is seen at `viewInclination` from the given world point.
    _orientFor(viewPoint) {
        const pos = this.mesh.getWorldPosition(new THREE.Vector3());
        const toView = viewPoint.clone().sub(pos).normalize();
        let side = new THREE.Vector3().crossVectors(toView, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        const up = new THREE.Vector3().crossVectors(side, toView).normalize();
        const inc = THREE.MathUtils.degToRad(this.viewInclination);
        const normal = toView.multiplyScalar(Math.cos(inc)).add(up.multiplyScalar(Math.sin(inc))).normalize();
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        this._oriented = true;
    }

    update(deltaTime, camera, rc) {
        this.time += deltaTime;
        // Time in units of rs/c, sped up so the ISCO orbit takes ~15 s instead of
        // Sgr A*'s real ~30 minutes.
        const t = this.time * 2.8 * (this.spinRate / 0.7);
        this.sharedUniforms.uTime.value = t;
        if (!camera) return;
        if (!this._oriented) this._orientFor(new THREE.Vector3(0, 0, 0));

        this.mesh.updateMatrixWorld();
        camera.updateMatrixWorld();
        const rs = this.radius;
        const R = (this._R ||= new THREE.Matrix3()).setFromMatrix4(this.mesh.matrixWorld);
        const RT = (this._RT ||= new THREE.Matrix3()).copy(R).transpose();
        const bhPos = (this._p ||= new THREE.Vector3()).setFromMatrixPosition(this.mesh.matrixWorld);
        const camPos = (this._c ||= new THREE.Vector3()).setFromMatrixPosition(camera.matrixWorld);
        const camLocal = (this._cl ||= new THREE.Vector3()).copy(camPos).sub(bhPos).applyMatrix3(RT).divideScalar(rs);

        // Proxy uniforms (world -> local, scaled to rs units).
        this.proxyUniforms.uCamLocal.value.copy(camLocal);
        this.proxyUniforms.uWorldToLocal.value.copy(RT).multiplyScalar(1 / rs);

        const pass = BlackHole.lensPass;
        const usePass = !!(pass && pass.userData.owner === this && rc && rc.useComposer && rc.composer);
        this.proxy.visible = !usePass;
        if (!pass || pass.userData.owner !== this) return;
        if (!usePass) { pass.enabled = false; return; }

        const u = pass.uniforms;
        for (const k in this.sharedUniforms) if (u[k]) u[k].value = this.sharedUniforms[k].value;
        const camRot = (this._cr ||= new THREE.Matrix3()).setFromMatrix4(camera.matrixWorld);
        u.uViewToLocal.value.multiplyMatrices(RT, camRot);
        u.uLocalToView.value.copy(u.uViewToLocal.value).transpose();
        u.uCamLocal.value.copy(camLocal);
        u.uProj.value.copy(camera.projectionMatrix);
        u.uInvProj.value.copy(camera.projectionMatrixInverse);
        const h = rc.renderer ? rc.renderer.getDrawingBufferSize(this._dbs ||= new THREE.Vector2()).y : window.innerHeight;
        const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
        u.uPxPerRad.value = h / (2 * Math.tan(halfFov));

        // Run the pass only when the hole or its lensing halo can be on screen.
        const D = camLocal.length();
        let on = D < this.traceRadius;
        if (!on) {
            const toBH = (this._tb ||= new THREE.Vector3()).copy(bhPos).sub(camPos).normalize();
            const fwd = (this._fw ||= new THREE.Vector3()).set(0, 0, -1).applyMatrix3(camRot).normalize();
            const off = Math.acos(THREE.MathUtils.clamp(toBH.dot(fwd), -1, 1));
            const halfDiag = Math.atan(Math.tan(halfFov) * Math.sqrt(1 + camera.aspect * camera.aspect));
            const halo = Math.asin(Math.min(1, u.uHalo1.value / D));
            on = off < halfDiag + halo;
        }
        pass.enabled = on;
    }

    dispose() {
        if (this._onRtq) window.removeEventListener('rtquality', this._onRtq);
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        if (BlackHole.lensPass && BlackHole.lensPass.userData.owner === this) {
            BlackHole.lensPass.userData.owner = null;
            BlackHole.lensPass.enabled = false;
        }
    }
}
BlackHole.lensPass = null;

if (typeof module !== 'undefined') module.exports = BlackHole;
