// RTQuality.js - one global render-quality tier for the whole scene.
//
// ============================== API (for effect builders) ==============================
//   window.RTQuality.tier          'high' | 'medium' | 'low'   (read any time, any frame)
//   window.RTQuality.settings      the numbers for the current tier, e.g.
//                                  { pixelRatioCap, bloomScale, godRaySamples, particleScale }
//   window.RTQuality.pick({high, medium, low})   -> the value for the current tier
//   window.addEventListener('rtquality', e => { e.detail.tier, e.detail.prev, e.detail.reason })
//                                  fired on window whenever the tier changes (rare: hysteresis
//                                  holds a tier for at least ~8 s, see below).
//   window.RTQuality.setTier('low', { lock: true })   force a tier (lock stops auto changes)
//   window.RTQuality.unlock()                         hand control back to the auto governor
//
// An effect should read the tier when it is built, and listen for 'rtquality' to rebuild or
// rescale itself. Low tier must stay cheap (iPhone 12 class GPU in WKWebView).
//
// How the tier is chosen:
//  1. Start tier from device hints. The iOS app injects window.__RT_DEVICE = {model, memGB}
//     (hw.machine identifier + physical memory) before any script runs. iPhone 12 family
//     (iPhone13,x) and older, or under 7 GB RAM, start at medium; A12 and older start at low.
//     In a plain browser navigator.deviceMemory / hardwareConcurrency are used instead.
//     ?rtq=low|medium|high (or ?tier=) in the URL forces and locks a tier (testing). This is
//     the ONLY tier source: Earth, black hole, camera optics, visor and 8K textures all read it.
//  2. Auto governor: frame times are averaged over 2 s windows. Drop one tier after 2
//     consecutive windows below 45 fps; climb one tier only after 5 consecutive windows at
//     >= 57 fps, never sooner than 8 s after the last change, and a tier we were forced out
//     of twice is never climbed back into this session (no flapping).
// =========================================================================================

(function () {
    const TIERS = ['low', 'medium', 'high'];

    // God rays: the shader's own sample count was 32 (main.js). Fewer samples = fewer texture
    // reads per pixel; decay/weight are rescaled per step below so the shafts keep the same
    // length and brightness (same integral, coarser steps).
    const PRESETS = {
        high:   { pixelRatioCap: 2.0,  bloomScale: 1.0,  godRaySamples: 32, particleScale: 1.0  },
        medium: { pixelRatioCap: 1.25, bloomScale: 0.75, godRaySamples: 20, particleScale: 0.6  },
        low:    { pixelRatioCap: 1.0,  bloomScale: 0.5,  godRaySamples: 12, particleScale: 0.35 }
    };

    const WINDOW_MS = 2000;
    const DOWN_FPS = 45, DOWN_WINDOWS = 2;
    const UP_FPS = 57, UP_WINDOWS = 5;
    const MIN_HOLD_MS = 8000;
    const MAX_FALLS_BEFORE_BAN = 2;

    function deviceStartTier() {
        try {
            const sp = new URLSearchParams(location.search);
            const q = sp.get('rtq') || sp.get('tier');   // debug override, the only one in the app
            if (q && PRESETS[q]) return { tier: q, lock: true, why: 'url' };
        } catch (_) {}

        const d = window.__RT_DEVICE;
        if (d && typeof d === 'object') {
            const mem = Number(d.memGB) || 0;
            const m = /^iPhone(\d+),/.exec(String(d.model || ''));
            if (m) {
                const major = parseInt(m[1], 10);
                if (major <= 11) return { tier: 'low', why: d.model + ' (A12 or older)' };
                if (major <= 13) return { tier: 'medium', why: d.model + ' (A14/A13)' };
            }
            if (mem && mem < 3) return { tier: 'low', why: mem + ' GB RAM' };
            // High tier renders the post chain at 2x (4x the pixels of the old 1x composer),
            // so only the 8 GB Pro-class phones start there; the governor promotes others
            // after sustained 57+ fps.
            if (mem && mem < 7) return { tier: 'medium', why: mem + ' GB RAM' };
            return { tier: 'high', why: (d.model || 'device') + ', ' + (mem || '?') + ' GB' };
        }

        const mem = navigator.deviceMemory;
        const cores = navigator.hardwareConcurrency;
        if (mem && mem <= 2) return { tier: 'low', why: 'deviceMemory ' + mem };
        if ((mem && mem <= 4) || (cores && cores <= 4)) return { tier: 'medium', why: 'mem ' + mem + ' / cores ' + cores };
        return { tier: 'high', why: 'browser default' };
    }

    const start = deviceStartTier();

    const RTQuality = {
        tier: start.tier,
        settings: Object.assign({}, PRESETS[start.tier]),
        locked: !!start.lock,
        startReason: start.why,
        PRESETS,

        _rc: null,
        _changedAt: 0,
        _winStart: 0, _winFrames: 0, _winTime: 0,
        _lowWins: 0, _highWins: 0,
        _falls: { low: 0, medium: 0, high: 0 },
        _godRayBase: null,
        _bloomWrapped: null,
        _appliedPR: null,

        pick(map) {
            if (!map) return undefined;
            return map[this.tier] !== undefined ? map[this.tier] : map.high;
        },

        level() { return this.tier === 'high' ? 1.0 : this.tier === 'medium' ? 0.75 : 0.5; },

        attach(rendererCore) {
            this._rc = rendererCore;
            this._changedAt = performance.now();
            this.apply('attach');
        },

        setTier(tier, opts) {
            if (!PRESETS[tier]) return;
            if (opts && opts.lock) this.locked = true;
            this._set(tier, (opts && opts.reason) || 'manual');
        },

        unlock() { this.locked = false; },

        _set(tier, reason) {
            const prev = this.tier;
            if (tier === prev) return;
            this.tier = tier;
            this.settings = Object.assign({}, PRESETS[tier]);
            this._changedAt = performance.now();
            this._lowWins = this._highWins = 0;
            this.apply(reason);
            console.log(`🎚️ RTQuality ${prev} → ${tier} (${reason})`);
            try {
                window.dispatchEvent(new CustomEvent('rtquality', { detail: { tier, prev, reason, settings: this.settings } }));
            } catch (_) {}
        },

        // Called by UpdateLoop every frame with the raw frame time in ms.
        sample(rawDeltaMs) {
            const now = performance.now();
            // A hidden tab / backgrounded app delivers one giant delta: not a perf signal.
            if (!(rawDeltaMs > 0) || rawDeltaMs > 250) { this._winStart = now; this._winFrames = 0; this._winTime = 0; return; }
            if (!this._winStart) this._winStart = now;
            this._winFrames++;
            this._winTime += rawDeltaMs;

            // Effects that appear after attach (composer passes, particles) get the tier too.
            if ((this._winFrames & 63) === 0) this._applyLazy();

            if (now - this._winStart < WINDOW_MS) return;
            const fps = 1000 * this._winFrames / this._winTime;
            this.lastWindowFPS = fps;
            this._winStart = now; this._winFrames = 0; this._winTime = 0;
            if (this.locked) return;

            if (fps < DOWN_FPS) { this._lowWins++; this._highWins = 0; }
            else if (fps >= UP_FPS) { this._highWins++; this._lowWins = 0; }
            else { this._lowWins = 0; this._highWins = 0; }

            const i = TIERS.indexOf(this.tier);
            const held = now - this._changedAt;
            if (this._lowWins >= DOWN_WINDOWS && i > 0 && held >= MIN_HOLD_MS * 0.5) {
                this._falls[this.tier]++;
                this._set(TIERS[i - 1], `avg ${fps.toFixed(0)} fps`);
            } else if (this._highWins >= UP_WINDOWS && i < TIERS.length - 1 && held >= MIN_HOLD_MS) {
                const next = TIERS[i + 1];
                if (this._falls[next] < MAX_FALLS_BEFORE_BAN) this._set(next, `avg ${fps.toFixed(0)} fps`);
                else this._highWins = 0;
            }
        },

        // ---- appliers -------------------------------------------------------------------
        apply(reason) {
            const rc = this._rc;
            if (!rc || !rc.renderer) return;
            this._applyPixelRatio();
            this._applyBloom(true);
            this._applyGodRays(true);
            this._applyParticles();
        },

        _applyLazy() {
            this._applyBloom(false);
            this._applyGodRays(false);
            this._applyParticles();
        },

        _applyPixelRatio() {
            const rc = this._rc;
            // rc.pixelRatio is RendererCore's chosen base (already capped at 2x).
            const base = rc.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
            const pr = Math.min(base, this.settings.pixelRatioCap);
            if (pr === this._appliedPR) return;
            this._appliedPR = pr;
            rc.renderer.setPixelRatio(pr);
            rc.renderer.setSize(window.innerWidth, window.innerHeight);
            if (rc.composer) {
                if (rc.composer.setPixelRatio) rc.composer.setPixelRatio(pr);
                else rc.composer.setSize(window.innerWidth, window.innerHeight);
            }
            // setPixelRatio on the composer already re-sized every pass, including bloom.
            this._bloomSizedFor = this.settings.bloomScale;
        },

        // UnrealBloomPass sizes its blur chain from the size the composer hands it. Wrap that
        // one instance's setSize so the chain runs at bloomScale of the frame buffer.
        _applyBloom(force) {
            const rc = this._rc, bp = rc && rc.bloomPass;
            if (!bp || typeof bp.setSize !== 'function') return;
            if (this._bloomWrapped !== bp) {
                const orig = bp.setSize.bind(bp);
                const self = this;
                bp.setSize = function (w, h) {
                    // Composer hands over buffer pixels (CSS px x pixel ratio). Bloom is sized
                    // in CSS px x bloomScale so its halo keeps the width Matt tuned by eye on
                    // high tier no matter the pixel ratio, and gets cheaper on lower tiers.
                    const pr = self._appliedPR || 1;
                    const s = (self.settings.bloomScale || 1) / pr;
                    orig(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
                };
                this._bloomWrapped = bp;
                force = true;
            }
            if (!force && this._bloomSizedFor === this.settings.bloomScale) return;
            this._bloomSizedFor = this.settings.bloomScale;
            const pr = rc.renderer.getPixelRatio();
            bp.setSize(window.innerWidth * pr, window.innerHeight * pr);
        },

        // The god-ray pass (main.js) hard-codes 32 steps. Rewrite the loop bound into a
        // define once, then each tier just changes the define (one shader recompile per
        // tier change, which hysteresis keeps rare).
        _applyGodRays(force) {
            const rc = this._rc, pass = rc && rc.godRaysPass;
            const mat = pass && pass.material;
            if (!mat || !mat.uniforms || !mat.uniforms.uDecay) return;
            if (!this._godRayBase || this._godRayBase.pass !== pass) {
                const src = mat.fragmentShader;
                if (src.indexOf('i < 32;') < 0 || src.indexOf('/ 32.0') < 0) return; // shader changed upstream: leave it alone
                mat.fragmentShader = src
                    .replace('/ 32.0', '/ float(RT_GR_SAMPLES)')
                    .replace('i < 32;', 'i < RT_GR_SAMPLES;');
                this._godRayBase = {
                    pass,
                    decay: mat.uniforms.uDecay.value,
                    weight: mat.uniforms.uWeight.value,
                    n: 32
                };
                force = true;
            }
            const n = this.settings.godRaySamples;
            if (!force && mat.defines && mat.defines.RT_GR_SAMPLES === n) return;
            const b = this._godRayBase;
            const stepScale = b.n / n;                 // each step now covers this many old steps
            mat.defines = Object.assign({}, mat.defines, { RT_GR_SAMPLES: n });
            // Same falloff per unit of screen distance, same summed brightness.
            mat.uniforms.uDecay.value = Math.pow(b.decay, stepScale);
            const oldSum = (1 - Math.pow(b.decay, b.n)) / (1 - b.decay);
            const newSum = (1 - Math.pow(mat.uniforms.uDecay.value, n)) / (1 - mat.uniforms.uDecay.value);
            mat.uniforms.uWeight.value = b.weight * oldSum / newSum;
            mat.needsUpdate = true;
        },

        _applyParticles() {
            const s = this.settings.particleScale;
            try {
                // eslint-disable-next-line no-undef
                if (typeof ambientParticles !== 'undefined' && ambientParticles && ambientParticles.setQualityScale) {
                    ambientParticles.setQualityScale(s); // eslint-disable-line no-undef
                }
            } catch (_) {}
            try {
                // eslint-disable-next-line no-undef
                const belt = (typeof asteroidBelt !== 'undefined') ? asteroidBelt : null;
                if (belt && belt._rtqScale !== s && belt.asteroids && belt.mesh) {
                    belt._rtqScale = s;
                    const n = belt.asteroids.length;
                    // Golden-ratio stride keeps the survivors spread evenly round the belt.
                    for (let i = 0; i < n; i++) {
                        const m = belt.asteroids[i].mesh;
                        if (m) m.visible = ((i * 0.6180339887) % 1) < s;
                    }
                    const dust = belt.mesh.children.find(c => c.isPoints);
                    if (dust && dust.geometry) {
                        const total = dust.geometry.getAttribute('position').count;
                        // Dust is generated in random order, so a prefix is an even subsample.
                        dust.geometry.setDrawRange(0, Math.max(1, Math.round(total * Math.max(s, 0.5))));
                    }
                }
            } catch (_) {}
        }
    };

    window.RTQuality = RTQuality;
    console.log(`🎚️ RTQuality start tier: ${RTQuality.tier} (${start.why})${RTQuality.locked ? ' [locked]' : ''}`);
})();

// RTMotion - the system Reduce Motion setting, for every effect that moves the picture on
// its own (camera shake, warp streaks, lens-flare ghosts, sensor grain).
//   window.RTMotion.reduced      true when the player asked the system for less motion
//   window.addEventListener('rtmotion', e => e.detail.reduced)   fired when it changes
// Sources: the CSS media query (WKWebView and Android WebView both follow the system
// setting), plus a native hint: iOS injects __RT_DEVICE.reduceMotion (UIAccessibility) and
// calls RTMotion.set() when it changes; Android does the same from the animator scale.
(function () {
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let nativeHint = !!(window.__RT_DEVICE && window.__RT_DEVICE.reduceMotion);
    const RTMotion = {
        reduced: false,
        set(on) { nativeHint = !!on; update(); }
    };
    function update() {
        const next = nativeHint || !!(mq && mq.matches);
        if (next === RTMotion.reduced) return;
        RTMotion.reduced = next;
        try { window.dispatchEvent(new CustomEvent('rtmotion', { detail: { reduced: next } })); } catch (_) {}
    }
    update();
    if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', update);
        else if (mq.addListener) mq.addListener(update);
    }
    window.RTMotion = RTMotion;
    if (RTMotion.reduced) console.log('🎚️ Reduce Motion on: shake, warp, flare and grain toned down');
})();
