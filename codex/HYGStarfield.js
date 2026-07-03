// HYGStarfield.js — the REAL night sky.
//
// Renders the ~8,700 real naked-eye stars from the HYG database (window.HYG_STARS,
// each entry = [RA hours, Dec deg, apparent magnitude, B–V color index]) at their TRUE
// sky directions, sized by real magnitude and tinted by real B–V color, in a single GPU
// draw call. Because these are actual positions, you see actual constellations — Orion's
// Belt, the Big Dipper, Cassiopeia — sitting where they really are in the sky.
//
// Lifecycle is owned by main.js, exactly like Starfield.js:
//   const hyg = new HYGStarfield();  scene.add(hyg.getMesh());  // once
//   hyg.update(camera.position);                                // every frame
// The mesh re-centers on the camera each frame, so the shell is effectively infinite and
// the stars never move relative to the camera as it flies — they behave like real stars.
// Additive blending layers it over the procedural Starfield dust without occluding it.
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
            magLimit: 7.0       // faintest magnitude to include (naked eye ≈ 6.5)
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
        const R = this.cfg.radius;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const siz = new Float32Array(n);
        const dpr = Math.min(3, window.devicePixelRatio || 2);

        for (let i = 0; i < n; i++) {
            const [raH, decDeg, mag, bv] = src[i];
            const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
            // Equatorial → scene direction (Y up), placed on the shell.
            pos[i * 3]     =  Math.cos(dec) * Math.cos(ra) * R;
            pos[i * 3 + 1] =  Math.sin(dec) * R;
            pos[i * 3 + 2] = -Math.cos(dec) * Math.sin(ra) * R;

            const c = this._bvColor(bv);
            col[i * 3]     = c[0] * this.cfg.brightness;
            col[i * 3 + 1] = c[1] * this.cfg.brightness;
            col[i * 3 + 2] = c[2] * this.cfg.brightness;

            // Brighter (lower magnitude) → bigger point. Sirius (mag -1.4) ≈ max.
            siz[i] = Math.max(1.0, Math.min(5.0, (6.9 - mag) * 0.62)) * dpr * this.cfg.sizeScale;
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

        const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            vertexColors: true,
            vertexShader: `
                attribute float aSize;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize;
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
    }

    getMesh() { return this.mesh; }

    // Re-center the shell on the camera each frame so the stars sit at infinity.
    update(camPos) {
        if (this.mesh && camPos) this.mesh.position.copy(camPos);
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
        }
    }
}

if (typeof module !== 'undefined') module.exports = HYGStarfield;
