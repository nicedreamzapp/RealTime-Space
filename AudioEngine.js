// AudioEngine.js - Procedural WebAudio soundscape. No audio files needed.
// Layers:
//   ambient  — two slow detuned low oscillators + filtered noise (deep space hum)
//   thrust   — band-passed noise rumble that follows the throttle
//   shimmer  — high harmonic cluster that swells as you near the sun
//   abyss    — sub-bass drone that grows near the black hole
// iOS/WKWebView suspends AudioContext until a user gesture; we resume on first touch.

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.started = false;
        this.enabled = true;
        this._nodes = {};

        // Lazily create on first user interaction (autoplay policies)
        const resume = () => {
            this._ensureContext();
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        };
        window.addEventListener('touchstart', resume, { passive: true });
        window.addEventListener('pointerdown', resume, { passive: true });
        window.addEventListener('keydown', resume);
    }

    _ensureContext() {
        if (this.started) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.started = true;
        this._build();
        console.log("🔊 AudioEngine started (procedural WebAudio)");
    }

    _noiseBuffer(seconds = 2) {
        const rate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
        const data = buffer.getChannelData(0);
        // Brown-ish noise: integrate white noise for a soft, deep texture
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        return buffer;
    }

    _build() {
        const ctx = this.ctx;

        this.master = ctx.createGain();
        this.master.gain.value = 0.32; // quieter, less intrusive background bed
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.ratio.value = 12;
        this.master.connect(limiter);
        limiter.connect(ctx.destination);

        // ---- Ambient drone ----
        const ambGain = ctx.createGain();
        ambGain.gain.value = 0.05;
        ambGain.connect(this.master);

        [55, 55.7, 110.3].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = i === 2 ? 'sine' : 'triangle';
            osc.frequency.value = freq;

            // Slow pitch SWAY so the drone never holds one constant frequency. Each voice
            // sways at a different slow rate, so together they drift in and out of tune —
            // an organic, breathing space hum instead of a flat (weird) tone. Exaggerated
            // on purpose so the movement is clearly audible.
            const sway = ctx.createOscillator();
            sway.type = 'sine';
            sway.frequency.value = 0.018 + i * 0.013;          // very slow, different per voice
            const swayDepth = ctx.createGain();
            swayDepth.gain.value = (0.5 + i * 0.4);             // ± Hz of drift — subtle now
                                                                // (was 3–9 Hz: caused a
                                                                // seasick, wobbly beating tone)
            sway.connect(swayDepth);
            swayDepth.connect(osc.frequency);
            sway.start();

            // Gentle volume swell on each voice (also offset) so it ebbs and flows.
            const g = ctx.createGain();
            g.gain.value = i === 2 ? 0.15 : 0.4;
            const swell = ctx.createOscillator();
            swell.frequency.value = 0.03 + i * 0.017;
            const swellDepth = ctx.createGain();
            swellDepth.gain.value = (i === 2 ? 0.05 : 0.12);
            swell.connect(swellDepth);
            swellDepth.connect(g.gain);
            swell.start();

            osc.connect(g);
            g.connect(ambGain);
            osc.start();
        });

        const ambNoise = ctx.createBufferSource();
        ambNoise.buffer = this._noiseBuffer(4);
        ambNoise.loop = true;
        const ambFilter = ctx.createBiquadFilter();
        ambFilter.type = 'lowpass';
        ambFilter.frequency.value = 180;
        const ambNoiseGain = ctx.createGain();
        ambNoiseGain.gain.value = 0.14;   // less hissy noise bed
        ambNoise.connect(ambFilter);
        ambFilter.connect(ambNoiseGain);
        ambNoiseGain.connect(ambGain);
        ambNoise.start();

        // Slow LFO breathing on the ambient filter
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 60;
        lfo.connect(lfoGain);
        lfoGain.connect(ambFilter.frequency);
        lfo.start();

        // ---- Thrust rumble ----
        const thrustNoise = ctx.createBufferSource();
        thrustNoise.buffer = this._noiseBuffer(2);
        thrustNoise.loop = true;
        this._nodes.thrustFilter = ctx.createBiquadFilter();
        this._nodes.thrustFilter.type = 'bandpass';
        this._nodes.thrustFilter.frequency.value = 160;
        this._nodes.thrustFilter.Q.value = 0.7;
        this._nodes.thrustGain = ctx.createGain();
        this._nodes.thrustGain.gain.value = 0;
        thrustNoise.connect(this._nodes.thrustFilter);
        this._nodes.thrustFilter.connect(this._nodes.thrustGain);
        this._nodes.thrustGain.connect(this.master);
        thrustNoise.start();

        // ---- Sun shimmer ----
        this._nodes.shimmerGain = ctx.createGain();
        this._nodes.shimmerGain.gain.value = 0;
        this._nodes.shimmerGain.connect(this.master);
        [1244, 1567, 2092].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const g = ctx.createGain();
            g.gain.value = 0.06 / (i + 1);
            const trem = ctx.createOscillator();
            trem.frequency.value = 0.13 + i * 0.07;
            const tremGain = ctx.createGain();
            tremGain.gain.value = 0.03;
            trem.connect(tremGain);
            tremGain.connect(g.gain);
            osc.connect(g);
            g.connect(this._nodes.shimmerGain);
            osc.start();
            trem.start();
        });

        // ---- Black hole abyss ----
        this._nodes.abyssGain = ctx.createGain();
        this._nodes.abyssGain.gain.value = 0;
        this._nodes.abyssGain.connect(this.master);
        const abyss = ctx.createOscillator();
        abyss.type = 'sine';
        abyss.frequency.value = 31;
        const abyss2 = ctx.createOscillator();
        abyss2.type = 'sine';
        abyss2.frequency.value = 38.7;
        const abyssMix = ctx.createGain();
        abyssMix.gain.value = 0.5;
        abyss.connect(abyssMix);
        abyss2.connect(abyssMix);
        abyssMix.connect(this._nodes.abyssGain);
        abyss.start();
        abyss2.start();
    }

    // Called every frame with flight/scene state.
    update(dt, state) {
        if (!this.started || !this.enabled || !this.ctx || this.ctx.state !== 'running') return;
        const t = this.ctx.currentTime;
        const ease = 0.12;

        // Thrust: gain and pitch follow throttle; boost opens the filter up
        const thrustTarget = state.thrusting ? (state.boosting ? 0.30 : 0.16) : Math.min(0.06, state.speed * 0.0006);
        this._nodes.thrustGain.gain.setTargetAtTime(thrustTarget, t, ease);
        this._nodes.thrustFilter.frequency.setTargetAtTime(
            state.boosting ? 420 : 160 + Math.min(160, state.speed * 1.2), t, 0.25);

        // Sun shimmer: audible inside ~220 units, swells as you close in
        const sunAmount = Math.max(0, 1 - (state.sunDistance || 9999) / 220);
        this._nodes.shimmerGain.gain.setTargetAtTime(sunAmount * sunAmount * 0.5, t, 0.4);

        // Black hole: sub-bass dread inside ~500 units
        const bhAmount = Math.max(0, 1 - (state.blackHoleDistance || 9999) / 500);
        this._nodes.abyssGain.gain.setTargetAtTime(bhAmount * bhAmount * 0.6, t, 0.4);
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (this.master) {
            this.master.gain.value = on ? 0.45 : 0.0;
        }
    }
}
