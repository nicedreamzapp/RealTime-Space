// HYGStarfield.js — the REAL night sky, in REAL 3D.
//
// Renders ~8,900 real naked-eye stars from the HYG v4.1 database (window.HYG_STARS,
// each entry = [RA hours, Dec deg, mag, B–V, distance ly]) at their TRUE 3D positions —
// real sky direction AND real distance (sqrt-compressed to the shared game scale).
// From home the constellations look exactly right; fly out and they parallax, drift
// apart, and individual stars grow as you approach. Every star in the sky is a real,
// reachable object — there is no painted shell and no decorative filler.
//
// Lifecycle is owned by main.js:
//   const hyg = new HYGStarfield();  scene.add(hyg.getMesh());  // once
//
// (Previously this file was a fragile self-booting IIFE that polled for
// window.explorationTracker.camera and never actually rendered; it is now a plain managed
// class so main.js controls it and it can't silently no-op.)

class HYGStarfield {
    constructor(options = {}) {
        this.cfg = Object.assign({
            radius: 8500,       // shell radius; camera-followed → effectively at infinity
            sizeScale: 1.0,     // global multiplier on point sizes
            brightness: 1.0,    // global multiplier on star color/intensity
            magLimit: 8.1       // binocular-depth sky (catalog now ships to mag 8)
        }, options);
        this.mesh = null;
        this._build();
    }

    // B–V color index → approximate RGB (blue-hot to red-cool).
    static _STOPS = [
        [-0.35, [0.61, 0.70, 1.00]], [0.00, [0.79, 0.85, 1.00]], [0.30, [0.92, 0.94, 1.00]],
        [0.58, [1.00, 0.97, 0.92]], [0.81, [1.00, 0.91, 0.78]], [1.10, [1.00, 0.83, 0.64]],
        [1.40, [1.00, 0.76, 0.52]], [1.80, [1.00, 0.66, 0.42]]
    ];
    _bvColor(bv) {
        const S = HYGStarfield._STOPS;
        if (bv <= S[0][0]) return S[0][1];
        for (let i = 1; i < S.length; i++) {
            if (bv <= S[i][0]) {
                const [a, ca] = S[i - 1], [b, cb] = S[i];
                const t = (bv - a) / (b - a);
                return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
            }
        }
        return S[S.length - 1][1];
    }

    _build() {
        if (typeof THREE === 'undefined' || !window.HYG_STARS || !window.HYG_STARS.length) {
            console.warn('HYGStarfield: THREE or window.HYG_STARS unavailable — real sky not built');
            return;
        }
        const src = window.HYG_STARS.filter(s => s[2] <= this.cfg.magLimit);
        const n = src.length;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const siz = new Float32Array(n);
        const dst = new Float32Array(n);
        const dpr = Math.min(3, window.devicePixelRatio || 2);

        // Same light-year compression the Interstellar/constellation layers use, so
        // the whole universe shares one scale.
        const gameRadius = (ly) => Math.sqrt(ly) * 150;
        const FAR_LY = 60000;   // stars with unknown distance → deep background

        for (let i = 0; i < n; i++) {
            const [raH, decDeg, mag, bv, ly] = src[i];
            const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
            // Equatorial → scene direction (Y up), placed at the star's TRUE 3D
            // position (real distance, compressed) — these are real, reachable
            // stars, not a shell.
            const R = gameRadius(ly > 0 ? ly : FAR_LY);
            pos[i * 3]     =  Math.cos(dec) * Math.cos(ra) * R;
            pos[i * 3 + 1] =  Math.sin(dec) * R;
            pos[i * 3 + 2] = -Math.cos(dec) * Math.sin(ra) * R;
            dst[i] = R;

            // Faint stars must be FAINT: without the magnitude fade, all 33k dim
            // catalog stars rendered at the same floor size/brightness as prominent
            // ones — a wall of identical dots drowning the named stars.
            const fade = Math.max(0.18, Math.min(1, (7.6 - mag) / 3.4));
            const c = this._bvColor(bv);
            col[i * 3]     = c[0] * this.cfg.brightness * fade;
            col[i * 3 + 1] = c[1] * this.cfg.brightness * fade;
            col[i * 3 + 2] = c[2] * this.cfg.brightness * fade;

            // Brighter (lower magnitude) → bigger point. Sirius (mag -1.4) ≈ max,
            // mag-8 stars shrink to sub-pixel glints instead of full dots.
            siz[i] = Math.max(0.45, Math.min(5.0, (7.3 - mag) * 0.62)) * dpr * this.cfg.sizeScale;
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
        g.setAttribute('aDist', new THREE.BufferAttribute(dst, 1));

        const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            vertexColors: true,
            vertexShader: `
                attribute float aSize;
                attribute float aDist;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    // aSize is the star's true apparent size FROM EARTH (its magnitude).
                    // Scale by (distance-from-origin / distance-from-camera): at home it
                    // matches the real night sky; fly toward a star and it genuinely
                    // grows. Capped so a close pass reads as a sun, not a screen-filler.
                    float dcam = max(length(mv.xyz), 1.0);
                    gl_PointSize = clamp(aSize * (aDist / dcam), 1.0, 90.0);
                }`,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 c = gl_PointCoord - 0.5;
                    float d = length(c);
                    if (d > 0.5) discard;
                    float a = smoothstep(0.5, 0.05, d);
                    gl_FragColor = vec4(vColor, a);
                }`
        });

        this.mesh = new THREE.Points(g, m);
        this.mesh.renderOrder = -2;   // behind planets/UI, with the background
        this.mesh.frustumCulled = false;
        this.starCount = n;
        // Kept for index → catalog-entry lookup (StarProximity shows the star's real
        // name/distance and registers it with the scanner when you fly up to it).
        this.stars = src;

        this._buildSpikes(src, dpr);
    }

    // JWST-style diffraction spikes on the brightest stars only (camera optics — see
    // CameraOptics.js for the PSF geometry). A separate small Points layer: each sprite
    // draws only the spikes; the star's own dot above stays the core. Spike reach scales
    // with apparent flux (flux^0.4), and flux grows as 1/d² when you fly toward a star.
    _buildSpikes(src, dpr) {
        const GLSL = (typeof CameraOptics !== 'undefined') && CameraOptics.SPIKE_GLSL;
        if (!GLSL || !this.mesh) return;
        const SPIKE_MAG = 1.6;   // ~25 brightest stars (Sirius … Regulus-class)
        const SIRIUS = -1.46;
        const sel = [];
        for (let i = 0; i < src.length; i++) {
            if (src[i][2] <= SPIKE_MAG && src[i][4] > 0) sel.push(i);   // ly > 0 skips Sol
        }
        if (!sel.length) return;
        const p = this.mesh.geometry.attributes.position.array;
        const c = this.mesh.geometry.attributes.color.array;
        const dA = this.mesh.geometry.attributes.aDist.array;
        const n = sel.length;
        const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
        const flx = new Float32Array(n), dst = new Float32Array(n);
        sel.forEach((i, k) => {
            for (let j = 0; j < 3; j++) { pos[k * 3 + j] = p[i * 3 + j]; }
            // undo the magnitude fade (these are all bright) and use the true B–V colour
            const rgb = this._bvColor(src[i][3]);
            for (let j = 0; j < 3; j++) col[k * 3 + j] = rgb[j] * this.cfg.brightness;
            flx[k] = Math.pow(10, -0.4 * (src[i][2] - SIRIUS));   // Sirius = 1
            dst[k] = dA[i];
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aFlux', new THREE.BufferAttribute(flx, 1));
        g.setAttribute('aDist', new THREE.BufferAttribute(dst, 1));
        let maxPt = 256;
        try {
            const r = (typeof rendererCore !== 'undefined') ? rendererCore : null;
            const gl = r && r.renderer ? r.renderer.getContext() : null;
            if (gl) maxPt = Math.min(512, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
        } catch (e) {}
        const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            vertexColors: true,
            uniforms: {
                uScale: { value: 1.0 }, uDpr: { value: dpr },
                uMaxSize: { value: maxPt }, uIntensity: { value: 0.6 }
            },
            vertexShader: `
                uniform float uScale, uDpr, uMaxSize;
                attribute float aFlux;
                attribute float aDist;
                varying vec3 vColor;
                varying float vLen;
                varying float vAmp;
                void main() {
                    vColor = color;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    float near = aDist / max(length(mv.xyz), 1.0);
                    float flux = aFlux * near * near;            // inverse-square
                    float len = (10.0 + 34.0 * pow(flux, 0.4)) * uDpr * uScale;
                    gl_PointSize = min(2.0 * len, uMaxSize);
                    vLen = gl_PointSize * 0.5;
                    vAmp = clamp(0.3 + 0.7 * pow(flux, 0.25), 0.0, 1.5);
                }`,
            fragmentShader: `
                uniform float uDpr, uIntensity;
                varying vec3 vColor;
                varying float vLen;
                varying float vAmp;
                ${GLSL}
                void main() {
                    vec2 d = (gl_PointCoord - 0.5) * 2.0 * vLen;
                    vec3 s = jwstSpikes(d, 0.0, vLen, 0.75 * uDpr, 0.08);
                    s *= smoothstep(1.0 * uDpr, 3.5 * uDpr, length(d));  // the dot is the core
                    vec3 c = vColor * s * vAmp * uIntensity;
                    if (max(c.r, max(c.g, c.b)) < 0.002) discard;
                    gl_FragColor = vec4(c, 1.0);
                }`
        });
        this.spikes = new THREE.Points(g, m);
        this.spikes.renderOrder = -1;
        this.spikes.frustumCulled = false;
        this.mesh.add(this.spikes);
    }

    setSpikes(on, scale = 1) {
        if (!this.spikes) return;
        this.spikes.visible = !!on;
        this.spikes.material.uniforms.uScale.value = scale;
    }

    getMesh() { return this.mesh; }

    // Stars are world-fixed 3D objects now (real distances) — nothing to re-center.
    // Kept as a no-op so main.js's per-frame call stays valid.
    update() {}

    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
        }
    }
}

if (typeof module !== 'undefined') module.exports = HYGStarfield;
