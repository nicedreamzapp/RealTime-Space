// CameraOptics.js — the spacecraft camera between the scene and the screen.
//
// What a real space camera adds on top of the light that reaches it, and what this file
// actually renders:
//   1. Auto-exposure. A meter pass downsamples the rendered frame to 32x16, reads back
//      the centre-weighted average luminance (async PBO readback on WebGL2, so the GPU
//      never stalls) and drives a gain applied BEFORE bloom, like a real sensor gain /
//      shutter change: swinging toward the Sun stops the camera down, deep space opens
//      it up. Adapts in log space, faster when darkening than when brightening, clamped.
//   2. JWST-style diffraction spikes for the Sun (here) and the brightest catalog stars
//      (HYGStarfield.js, via CameraOptics.SPIKE_GLSL). Webb's primary is 18 hexagonal
//      segments: their edges diffract light into SIX spikes 60 degrees apart (one pair
//      vertical), and the vertical secondary-mirror strut adds a fainter, shorter
//      HORIZONTAL pair. Diffraction length scales with wavelength, so red reaches
//      farther than blue, and the segment gaps bead each spike with a faint periodic
//      ripple. Spikes are fixed to the sensor (screen) axes, as they are in a real camera.
//   3. Sun lens flare: internal-reflection ghosts lie on the line from the light source
//      through the optical centre. Each ghost is a soft hexagonal iris image tinted by
//      the anti-reflection coating. Occlusion is tested on the GPU by sampling the
//      rendered frame across the solar disk: a planet in front darkens the samples and
//      the spikes and ghosts fade with it.
//   4. Lateral chromatic aberration (grows with radius squared toward the frame edge)
//      and sensor grain (photon shot noise: amplitude grows with signal, and with gain).
//
// Quality tiers (high / medium / low) scale every effect; low turns off CA and grain.
// Toggles persist in localStorage('cameraFX'); window.cameraFX is this instance.

class CameraOptics {
    static TIERS = {
        high:   { meterEvery: 4,  ghosts: 6, ca: 0.0007, grain: 0.010, spikeScale: 1.0 },
        medium: { meterEvery: 8,  ghosts: 4, ca: 0.0005, grain: 0.009, spikeScale: 0.9 },
        low:    { meterEvery: 16, ghosts: 2, ca: 0.0,    grain: 0.0,   spikeScale: 0.75 }
    };

    // Shared GLSL: JWST point-spread spikes. dpx = pixel offset from the source,
    // lenPx = length of the main spikes, widthPx = spike core width.
    static SPIKE_GLSL = `
        vec3 jwstSpikes(vec2 dpx, float r0, float lenPx, float widthPx, float core) {
            vec3 acc = vec3(0.0);
            for (int k = 0; k < 4; k++) {
                // k = 0..2: the three hexagon-edge spike lines (90, 150, 210 deg → six
                // rays); k = 3: the horizontal strut pair, fainter and shorter.
                float strut = (k == 3) ? 1.0 : 0.0;
                float ang = mix(1.5707963 + float(k) * 1.0471976, 0.0, strut);
                float amp = mix(1.0, 0.32, strut);
                float lk  = mix(1.0, 0.6, strut);
                vec2 d = vec2(cos(ang), sin(ang));
                float along  = abs(dot(dpx, d));
                float across = abs(dpx.x * d.y - dpx.y * d.x);
                // diffraction length scales with wavelength: red reaches farther than blue
                // core: how fast the 1/r falloff bites, as a fraction of the length
                // r0: radius the spikes start from (0 for a point source, the limb for
                // a resolved disk)
                float s = max(along - r0, 0.0);
                vec3 L = max(lenPx * lk, 1.0) * vec3(1.12, 1.0, 0.86);
                vec3 t = clamp(vec3(s) / L, 0.0, 1.0);
                vec3 fall = (1.0 - t) * (1.0 - t) / (1.0 + s / (lenPx * core + 1.0));
                float w = exp(-across * across / (widthPx * widthPx));
                // segment-gap interference: a faint periodic beading along the spike
                float bead = 0.82 + 0.18 * cos(along * 6.2831853 / (widthPx * 6.0 + 2.0));
                acc += amp * w * bead * fall;
            }
            return acc;
        }
    `;

    constructor(rendererCore) {
        this.rc = rendererCore;
        this.renderer = rendererCore.renderer;
        this.prefs = Object.assign(
            { autoExposure: true, spikes: true, flare: true, ca: true, grain: true },
            CameraOptics._loadPrefs()
        );
        this.tierOverride = null;
        try { this.tierOverride = localStorage.getItem('cameraTier'); } catch (e) {}
        this.qualityProvider = null;   // () => 0.5..1 from UpdateLoop's adaptive quality
        this.tierName = this._detectTier();
        this.cfg = CameraOptics.TIERS[this.tierName];

        // Exposure state (log2 space)
        this.minExposure = 0.6;        // never stop down past ~-0.75 EV (Sun stays readable)
        this.maxExposure = 1.3;        // never open past ~+0.4 EV (no noisy wash in deep space)
        this.key = 0.05;               // mid-grey target for the centre-weighted mean
        this.exposure = 1.0;
        this.targetExposure = 1.0;
        this.meterLum = null;
        this.clipFrac = 0;
        this._frame = 0;
        this._pending = false;

        this.sun = null;
        this.starfield = null;
        this.refDistance = 85;         // Earth's orbital radius in game units (set from the scene)
        this._tierCheck = 0;
        this._v1 = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._v3 = new THREE.Vector3();
    }

    static _loadPrefs() {
        try { return JSON.parse(localStorage.getItem('cameraFX') || '{}') || {}; } catch (e) { return {}; }
    }

    _detectTier() {
        const o = this.tierOverride;
        if (o === 'high' || o === 'medium' || o === 'low') return o;
        let t = this.rc.isNativeApp ? 'medium' : 'high';
        // UpdateLoop drops its quality level when frames run long — follow it down.
        const q = this.qualityProvider ? this.qualityProvider() : 1;
        if (q <= 0.6) t = 'low';
        else if (q <= 0.8 && t === 'high') t = 'medium';
        return t;
    }

    // ---------- passes ----------

    createExposurePass() {
        const optics = this;
        const shader = {
            uniforms: { tDiffuse: { value: null }, uExposure: { value: 1.0 } },
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform sampler2D tDiffuse; uniform float uExposure; varying vec2 vUv;
                void main() {
                    vec4 c = texture2D(tDiffuse, vUv);
                    // Stopping down scales everything. Opening up lifts real signal but
                    // not the black level: the sensor's black clamp keeps near-black
                    // pixels black instead of amplifying them into a grey veil.
                    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
                    float g = uExposure > 1.0 ? mix(1.0, uExposure, smoothstep(0.02, 0.12, l)) : uExposure;
                    gl_FragColor = vec4(c.rgb * g, c.a);
                }`
        };
        class ExposurePass extends THREE.ShaderPass {
            render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
                optics._meter(renderer, readBuffer);
                super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
            }
        }
        const pass = new ExposurePass(shader);
        this.exposurePass = pass;

        // Meter: 32x16 target; each texel averages a 4x4 grid of the full frame.
        this.meterW = 32; this.meterH = 16;
        this.meterRT = new THREE.WebGLRenderTarget(this.meterW, this.meterH, {
            type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false
        });
        this.meterMat = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null }, uCell: { value: new THREE.Vector2(1 / 32, 1 / 16) },
                uSun: { value: new THREE.Vector2(-9, -9) }, uSunR: { value: 0.0 },
                uAspect: { value: 1.0 }, uSunBoost: { value: 1.0 }
            },
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform sampler2D tDiffuse; uniform vec2 uCell; varying vec2 vUv;
                uniform vec2 uSun; uniform float uSunR, uAspect, uSunBoost;
                void main() {
                    vec2 base = vUv - 0.5 * uCell;
                    float sum = 0.0, clip = 0.0;
                    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
                        vec2 st = base + (vec2(float(x), float(y)) + 0.5) * 0.25 * uCell;
                        vec3 c = texture2D(tDiffuse, st).rgb;
                        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
                        // The auto-lens solar filter (Star.js) only darkens the Sun so its
                        // disk stays readable. The meter counts the Sun's unobstructed disk
                        // at its true radiance, so the camera exposes for a real Sun.
                        vec2 ds = (st - uSun) * vec2(uAspect, 1.0);
                        if (dot(ds, ds) < uSunR * uSunR && l > 0.18) l *= uSunBoost;
                        // NaN/Inf texels (half-float targets) must not poison the meter
                        if (!(l >= 0.0 && l < 64.0)) l = 0.0;
                        sum += l;
                        clip += step(0.92, l);
                    }
                    // R: mean luminance / 4 (headroom for HDR targets); G: clipped fraction
                    gl_FragColor = vec4(clamp(sum / 64.0, 0.0, 1.0), clip / 16.0, 0.0, 1.0);
                }`,
            depthTest: false, depthWrite: false
        });
        this.meterMat.toneMapped = false;
        this.meterQuad = new (pass.fsQuad.constructor)(this.meterMat);
        this.meterBuf = new Uint8Array(this.meterW * this.meterH * 4);
        // centre-weighted metering pattern, like a camera's default meter
        this.meterWeights = new Float32Array(this.meterW * this.meterH);
        for (let y = 0; y < this.meterH; y++) for (let x = 0; x < this.meterW; x++) {
            const dx = (x + 0.5) / this.meterW - 0.5, dy = (y + 0.5) / this.meterH - 0.5;
            this.meterWeights[y * this.meterW + x] = 1.0 - 1.6 * (dx * dx + dy * dy);
        }
        const gl = this.renderer.getContext();
        this.gl2 = (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext;
        if (this.gl2) {
            this.pbo = gl.createBuffer();
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
            gl.bufferData(gl.PIXEL_PACK_BUFFER, this.meterBuf.byteLength, gl.STREAM_READ);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        }
        return pass;
    }

    createLensPass() {
        const shader = {
            uniforms: {
                tDiffuse: { value: null },
                uRes: { value: new THREE.Vector2(1, 1) },
                uSun: { value: new THREE.Vector2(0.5, 0.5) },
                uSunR: { value: 0.01 },
                uSunAmt: { value: 0.0 },
                uSunColor: { value: new THREE.Color(1.0, 0.94, 0.84) },
                uSpikeLen: { value: 0.2 },
                uSpikeW: { value: 2.0 },
                uSpikeAmp: { value: 0.0 },
                uGhostAmp: { value: 0.0 },
                uGhosts: { value: 4.0 },
                uCA: { value: 0.0 },
                uGrain: { value: 0.0 },
                uGain: { value: 1.0 },
                uSeed: { value: 0.0 }
            },
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 uRes, uSun;
                uniform float uSunR, uSunAmt, uSpikeLen, uSpikeW, uSpikeAmp, uGhostAmp, uGhosts;
                uniform float uCA, uGrain, uGain, uSeed;
                uniform vec3 uSunColor;
                varying vec2 vUv;

                ${CameraOptics.SPIKE_GLSL}

                float lumOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
                float hash(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.x + p3.y) * p3.z);
                }
                float tap(vec2 uv) {
                    float l = lumOf(texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb);
                    if (!(l >= 0.0 && l < 64.0)) l = 0.0;
                    return smoothstep(0.18, 0.5, l);
                }
                // How much of the solar disk is unobstructed: sample the rendered frame
                // across the disk. Planets/moons in front are dark there; the Sun is not.
                float sunVisibility() {
                    vec2 r = vec2(uSunR * 0.6 * uRes.y / uRes.x, uSunR * 0.6);
                    float v = tap(uSun) * 2.0;
                    v += tap(uSun + r * vec2( 1.0,  0.0));
                    v += tap(uSun + r * vec2(-1.0,  0.0));
                    v += tap(uSun + r * vec2( 0.0,  1.0));
                    v += tap(uSun + r * vec2( 0.0, -1.0));
                    v += tap(uSun + r * vec2( 0.7,  0.7));
                    v += tap(uSun + r * vec2(-0.7,  0.7));
                    v += tap(uSun + r * vec2( 0.7, -0.7));
                    v += tap(uSun + r * vec2(-0.7, -0.7));
                    return v / 10.0;
                }
                // ghost i: x = position along sun→centre axis (1 = optical centre,
                // 2 = mirror point), y = radius (frame heights), z = amplitude
                vec3 ghostParam(int i) {
                    if (i == 0) return vec3(2.00, 0.060, 1.00);
                    if (i == 1) return vec3(1.45, 0.022, 0.80);
                    if (i == 2) return vec3(2.45, 0.075, 0.40);
                    if (i == 3) return vec3(0.62, 0.016, 0.70);
                    if (i == 4) return vec3(1.72, 0.038, 0.55);
                    return vec3(2.90, 0.095, 0.25);
                }
                vec3 ghostTint(int i) {   // AR-coating reflection colours
                    if (i == 0) return vec3(0.55, 0.85, 0.65);
                    if (i == 1) return vec3(0.95, 0.60, 0.85);
                    if (i == 2) return vec3(0.50, 0.70, 1.00);
                    if (i == 3) return vec3(1.00, 0.80, 0.50);
                    if (i == 4) return vec3(0.65, 1.00, 0.70);
                    return vec3(0.85, 0.65, 1.00);
                }
                vec3 ghosts(vec2 uv) {
                    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
                    vec2 axis = vec2(0.5) - uSun;
                    vec3 acc = vec3(0.0);
                    for (int i = 0; i < 6; i++) {
                        if (float(i) >= uGhosts) break;
                        vec3 g = ghostParam(i);
                        vec2 c = uSun + axis * g.x;
                        vec2 q = abs((uv - c) * asp);
                        // hexagonal iris image
                        float h = max(q.x * 0.8660254 + q.y * 0.5, q.y);
                        float disc = smoothstep(g.y, g.y * 0.82, h);
                        float rim = 0.55 + 0.45 * smoothstep(g.y * 0.3, g.y, h);
                        acc += ghostTint(i) * (g.z * disc * rim);
                    }
                    return acc;
                }

                void main() {
                    vec3 col;
                    if (uCA > 0.0) {
                        // lateral CA: displacement grows with radius^2 toward the edges
                        vec2 c = vUv - 0.5;
                        vec2 ca = c * vec2(uRes.x / uRes.y, 1.0);
                        vec2 off = c * dot(ca, ca) * uCA * 4.0;
                        col = vec3(texture2D(tDiffuse, vUv - off).r,
                                   texture2D(tDiffuse, vUv).g,
                                   texture2D(tDiffuse, vUv + off).b);
                    } else {
                        col = texture2D(tDiffuse, vUv).rgb;
                    }

                    if (uSunAmt > 0.001) {
                        float a = uSunAmt * sunVisibility();
                        if (a > 0.001) {
                            vec2 dpx = (vUv - uSun) * uRes;
                            float rpx = uSunR * uRes.y;
                            float r = length(dpx);
                            if (uSpikeAmp > 0.0) {
                                // spikes run out from the limb; the disk itself stays clean
                                vec3 sp = jwstSpikes(dpx, rpx * 0.9, uSpikeLen * uRes.y, uSpikeW, 0.25);
                                sp *= smoothstep(rpx * 0.95, rpx * 1.25, r);
                                col += sp * uSunColor * (uSpikeAmp * a);
                            }
                            if (uGhostAmp > 0.0) col += ghosts(vUv) * uSunColor * (uGhostAmp * a);
                        }
                    }

                    if (uGrain > 0.0) {
                        // shot noise in a perceptual (sqrt) domain: grows with signal and gain
                        vec2 p = vUv * uRes;
                        float n = hash(p + uSeed) + hash(p * 1.37 + uSeed * 1.71) - 1.0;
                        vec3 g = sqrt(max(col, 0.0));
                        float amp = uGrain * (0.35 + 0.65 * sqrt(lumOf(g))) * uGain;
                        g = max(g + n * amp, 0.0);
                        col = g * g;
                    }
                    gl_FragColor = vec4(col, 1.0);
                }`
        };
        const pass = new THREE.ShaderPass(shader);
        const u = pass.uniforms;
        pass.setSize = (w, h) => { u.uRes.value.set(w, h); };
        const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        u.uRes.value.copy(s);
        this.lensPass = pass;
        return pass;
    }

    // ---------- metering ----------

    _meter(renderer, readBuffer) {
        if (!this.prefs.autoExposure) return;
        this._frame++;
        const gl = renderer.getContext();
        if (this._pending) this._poll(gl);
        if (this._pending || (this._frame % this.cfg.meterEvery) !== 0) return;
        const prev = renderer.getRenderTarget();
        this.meterMat.uniforms.tDiffuse.value = readBuffer.texture;
        renderer.setRenderTarget(this.meterRT);
        this.meterQuad.render(renderer);
        try {
            if (this.gl2) {
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
                gl.readPixels(0, 0, this.meterW, this.meterH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                this._fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                this._pending = true;
            } else {
                renderer.readRenderTargetPixels(this.meterRT, 0, 0, this.meterW, this.meterH, this.meterBuf);
                this._consume();
            }
        } catch (e) {
            this.prefs.autoExposure = false;   // can't meter on this device: hold exposure
            console.warn('CameraOptics: metering unavailable, exposure fixed', e);
        }
        renderer.setRenderTarget(prev);
    }

    _poll(gl) {
        const st = gl.getSyncParameter(this._fence, gl.SYNC_STATUS);
        if (st !== gl.SIGNALED) return;
        gl.deleteSync(this._fence);
        this._fence = null;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.meterBuf);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this._pending = false;
        this._consume();
    }

    _consume() {
        const b = this.meterBuf, w = this.meterWeights;
        let sum = 0, clip = 0, wsum = 0;
        for (let i = 0; i < w.length; i++) {
            sum += w[i] * b[i * 4] * (4 / 255);
            clip += w[i] * b[i * 4 + 1] / 255;
            wsum += w[i];
        }
        this.meterLum = sum / wsum;
        this.clipFrac = clip / wsum;
        // key / mean, plus highlight protection: clipped area pulls the exposure down
        // further, the way a camera's meter guards against blown highlights.
        let t = this.key / Math.max(this.meterLum, 1e-4);
        t /= (1 + 3.0 * this.clipFrac);
        this.targetExposure = Math.min(this.maxExposure, Math.max(this.minExposure, t));
    }

    // ---------- per frame ----------

    setSun(star) { this.sun = star; }
    setStarfield(hyg) { this.starfield = hyg; this._applyStarfield(); }
    setReferenceDistance(d) { if (d > 0) this.refDistance = d; }

    _applyStarfield() {
        if (this.starfield && this.starfield.setSpikes) {
            this.starfield.setSpikes(this.prefs.spikes, this.cfg.spikeScale);
        }
    }

    update(dt, camera) {
        dt = Math.min(Math.max(dt || 0.016, 0), 0.1);
        // re-evaluate the tier every ~2 s (adaptive quality may have dropped)
        this._tierCheck += dt;
        if (this._tierCheck > 2) {
            this._tierCheck = 0;
            const t = this._detectTier();
            if (t !== this.tierName) { this.tierName = t; this.cfg = CameraOptics.TIERS[t]; this._applyStarfield(); }
        }
        // the camera owns exposure in post; keep the renderer's tone-map exposure neutral
        if (this.renderer.toneMappingExposure !== 1.0) this.renderer.toneMappingExposure = 1.0;

        // exposure adaptation in log2 space: ~0.3 s stopping down, ~1.2 s opening up
        if (this.exposurePass) {
            const target = this.prefs.autoExposure ? this.targetExposure : 1.0;
            const cur = Math.log2(this.exposure), tgt = Math.log2(target);
            const tau = tgt < cur ? 0.3 : 1.2;
            this.exposure = Math.pow(2, cur + (tgt - cur) * (1 - Math.exp(-dt / tau)));
            this.exposurePass.uniforms.uExposure.value = this.exposure;
            this.exposurePass.enabled = this.prefs.autoExposure || Math.abs(this.exposure - 1) > 0.005;
        }

        const lp = this.lensPass;
        if (!lp || !camera) return;
        const u = lp.uniforms;
        const cfg = this.cfg;
        const caOn = this.prefs.ca && cfg.ca > 0;
        const grainOn = this.prefs.grain && cfg.grain > 0;
        u.uCA.value = caOn ? cfg.ca : 0;
        u.uGrain.value = grainOn ? cfg.grain : 0;
        u.uGain.value = Math.sqrt(this.exposure);
        u.uSeed.value = Math.random() * 1000;

        // Sun on the sensor
        let sunAmt = 0;
        const mu = this.meterMat ? this.meterMat.uniforms : null;
        if (mu) { mu.uSun.value.set(-9, -9); mu.uSunR.value = 0; mu.uAspect.value = camera.aspect || 1; }
        if (this.sun && this.sun.mesh && (this.prefs.spikes || this.prefs.flare)) {
            const sp = this.sun.mesh.getWorldPosition(this._v1);
            const toSun = this._v2.copy(sp).sub(camera.position);
            const d = toSun.length();
            const fwd = this._v3.set(0, 0, -1).applyQuaternion(camera.quaternion);
            const R = this.sun.radius || 15;
            if (d > R * 1.05 && fwd.dot(toSun) > 0) {
                const ndc = sp.clone().project(camera);
                const m = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
                const edge = THREE.MathUtils.clamp((1.08 - m) / 0.18, 0, 1);
                u.uSun.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
                const halfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5;
                const rUV = Math.tan(Math.asin(Math.min(1, R / d))) / Math.tan(halfFov) * 0.5;
                u.uSunR.value = rUV;
                if (mu) {
                    mu.uSun.value.copy(u.uSun.value); mu.uSunR.value = rUV;
                    // undo the solar filter's dimming (up to ~8x) for metering only
                    mu.uSunBoost.value = 1 + 7 * (this.sun._filter || 0);
                }
                // apparent brightness relative to Earth's distance (inverse square);
                // spike reach ∝ flux^0.4
                const flux = Math.pow(this.refDistance / d, 2);
                u.uSpikeLen.value = THREE.MathUtils.clamp(0.3 * Math.pow(flux, 0.4), 0.08, 0.5) * cfg.spikeScale;
                const dbs = u.uRes.value;
                u.uSpikeW.value = Math.max(1.4 * (dbs.y / 600), rUV * dbs.y * 0.06);
                // the auto-lens solar filter (Star.js) is an ND filter in front of the
                // optics: everything the Sun puts through the camera dims with it
                const filt = this.sun._filter || 0;
                const nd = 1 - 0.55 * filt;
                u.uSpikeAmp.value = this.prefs.spikes ? 3.0 * nd : 0;
                u.uGhostAmp.value = this.prefs.flare ? 0.035 * nd * Math.min(1, Math.pow(flux, 0.5)) : 0;
                u.uGhosts.value = cfg.ghosts;
                // a disk that fills the frame isn't a point source: fade the optics out
                sunAmt = edge * (1 - THREE.MathUtils.smoothstep(rUV, 0.22, 0.45));
            }
        }
        u.uSunAmt.value = sunAmt;
        lp.enabled = caOn || grainOn || sunAmt > 0.001;
    }

    // ---------- toggles ----------

    set(name, on) {
        if (!(name in this.prefs)) return false;
        this.prefs[name] = !!on;
        try { localStorage.setItem('cameraFX', JSON.stringify(this.prefs)); } catch (e) {}
        if (name === 'spikes') this._applyStarfield();
        return true;
    }
    setTier(t) {
        this.tierOverride = (t === 'high' || t === 'medium' || t === 'low') ? t : null;
        try { this.tierOverride ? localStorage.setItem('cameraTier', t) : localStorage.removeItem('cameraTier'); } catch (e) {}
        this.tierName = this._detectTier();
        this.cfg = CameraOptics.TIERS[this.tierName];
        this._applyStarfield();
    }
    debug() {
        return { tier: this.tierName, exposure: +this.exposure.toFixed(3), target: +this.targetExposure.toFixed(3),
                 meterLum: this.meterLum == null ? null : +this.meterLum.toFixed(4), clip: +this.clipFrac.toFixed(3),
                 sunAmt: this.lensPass ? +this.lensPass.uniforms.uSunAmt.value.toFixed(3) : 0,
                 lens: this.lensPass ? this.lensPass.enabled : false, prefs: this.prefs };
    }
}

if (typeof window !== 'undefined') window.CameraOptics = CameraOptics;
