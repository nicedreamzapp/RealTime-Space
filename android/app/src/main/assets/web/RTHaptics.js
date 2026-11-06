// RTHaptics.js - flight haptics (Android fork: FlightHaptics.kt plays them with VibrationEffect;
// the iOS app uses Core Haptics).
//
// What you feel:
//  - rumble: a continuous low buzz whose strength follows ship speed. Speed is measured
//    against the cruise top speed; warp (up to 100x) adds on a log scale so it keeps
//    building without slamming to max. Thrusting adds a small push on top.
//  - swell: the tidal pull of the nearest star or black hole, felt only close to it. A ship
//    in free fall feels no steady gravity, only the tide (the difference in pull across the
//    hull), which goes as M/r^3. Relative to the surface (the Sun's photosphere, a close-up
//    star's sphere, a black hole's photon sphere at 1.5 Schwarzschild radii) that is
//    (R/d)^3: 1 at the surface, 1/8 at two radii, and zero from about three radii out (a
//    smooth fade over 2.5..4 radii plus a small floor). The buzz follows its square root, a
//    perceptual curve. Cruising or parked anywhere in the solar system, the swell is zero.
//  - transients: one sharp tick on warp entry and one on warp exit.
//
// JS only computes two numbers in 0..1 and sends them ~12 times a second (only when they
// change) as { type: 'HAPTIC_FLIGHT', rumble, swell } over the existing iosHandler bridge;
// WebBridge.kt hands them to FlightHaptics.kt, a very subtle repeating vibration that stops
// if updates stop (and in Battery Saver). The user toggle (⋯ panel > SOUND > Haptics) gates both sides.
//
// API: window.RTHaptics.setEnabled(bool), .enabled, .last (last values sent, for tests).

(function () {
    const SEND_HZ = 12;
    const EPS = 0.02;
    const KEEPALIVE_S = 0.5;   // native stops the rumble if it hears nothing for ~1.5 s

    const handler = () => window.webkit?.messageHandlers?.iosHandler;

    const RTHaptics = {
        enabled: !(window.__RT_DEVICE && window.__RT_DEVICE.haptics === false),
        rumble: 0,
        swell: 0,
        last: { rumble: 0, swell: 0 },
        _acc: 0,
        _sinceSend: 0,
        _warp: false,
        _sink: null,           // tests can set a function to capture messages

        _post(msg) {
            if (this._sink) { try { this._sink(msg); } catch (_) {} }
            try { handler()?.postMessage(msg); } catch (_) {}
        },

        setEnabled(on) {
            on = !!on;
            if (on === this.enabled) return;
            this.enabled = on;
            if (!on) this._sendFlight(0, 0, true);
        },

        _sendFlight(r, s, force) {
            if (!force && Math.abs(r - this.last.rumble) < EPS && Math.abs(s - this.last.swell) < EPS &&
                !(this._sinceSend >= KEEPALIVE_S && (r > EPS || s > EPS))) return;
            this.last = { rumble: r, swell: s };
            this._sinceSend = 0;
            this._post({ type: 'HAPTIC_FLIGHT', rumble: +r.toFixed(3), swell: +s.toFixed(3) });
        },

        _speedLevel(nav) {
            const top = nav.maxSpeed || 120;
            const s = nav.getSpeed() / top;
            const cruise = Math.min(1, Math.max(0, s));
            // Warp: 1x..100x top speed -> 0..1 on a log scale.
            const warp = Math.min(1, Math.max(0, Math.log10(Math.max(1, s)) / 2));
            const push = nav.isThrusting ? 0.15 : 0;
            return Math.min(1, 0.55 * cruise + 0.30 * warp + push);
        },

        _wellDepth(cam) {
            const NEAR = 2.5, FAR = 4;    // tide fades out between 2.5 and 4 body radii
            let best = 0;
            const consider = (pos, rRef) => {
                if (!pos || !(rRef > 0)) return;
                const d = Math.max(rRef, cam.distanceTo(pos));
                const x = d / rRef;                   // distance in body radii (>= 1)
                if (x >= FAR) return;
                const tide = 1 / (x * x * x);         // tidal acceleration relative to the surface
                const t = Math.min(1, Math.max(0, (x - NEAR) / (FAR - NEAR)));
                const v = tide * (1 - t * t * (3 - 2 * t));
                if (v > best) best = v;
            };
            try {
                /* global objects, blackHoles */
                if (typeof objects !== 'undefined' && objects) {
                    for (const o of objects) if (o && o.type === 'star' && o.mesh) consider(o.mesh.position, o.radius);
                }
                if (typeof blackHoles !== 'undefined' && blackHoles) {
                    for (const bh of blackHoles) if (bh && bh.mesh) consider(bh.mesh.position, (bh.radius || 3) * 1.5);
                }
                const sp = window.starProximity;
                if (sp && sp.mesh && sp.mesh.visible) consider(sp.mesh.position, sp.mesh.scale.x);
            } catch (_) {}
            // (R/d)^3 is already steep; a square root keeps the last radius or two before the
            // surface from being all the same. The faint edge fades in: zero at 0.03, the full
            // square-root curve from 0.09 on, smoothstep between (it used to jump 0 -> 0.17).
            if (best <= 0.03) return 0;
            const f = Math.min(1, (best - 0.03) / 0.06);
            return Math.min(1, Math.sqrt(best)) * f * f * (3 - 2 * f);
        },

        update(dt) {
            if (!(dt > 0)) return;
            /* global navPhysics, rendererCore */
            const nav = (typeof navPhysics !== 'undefined') ? navPhysics : null;
            const cam = (typeof rendererCore !== 'undefined' && rendererCore) ? rendererCore.camera : null;
            if (!nav || !cam || typeof nav.getSpeed !== 'function') return;
            if (!handler() && !this._sink) return;   // not inside the app: nothing to drive

            // Warp transitions: setWarpDrive() parks the old boost multiplier in _preWarpMult
            // while warp is held, so that is the warp-on flag.
            const warp = nav._preWarpMult != null;
            if (warp !== this._warp) {
                this._warp = warp;
                if (this.enabled) this._post({ type: 'HAPTIC', style: warp ? 'warpIn' : 'warpOut' });
            }

            // Smooth toward targets (~0.25 s time constant) so the buzz never steps.
            const k = 1 - Math.exp(-dt / 0.25);
            this.rumble += (this._speedLevel(nav) - this.rumble) * k;
            this.swell += (this._wellDepth(cam.position) - this.swell) * k;

            this._acc += dt;
            this._sinceSend += dt;
            if (this._acc < 1 / SEND_HZ) return;
            this._acc = 0;
            if (!this.enabled || document.hidden) { if (this.last.rumble || this.last.swell) this._sendFlight(0, 0, true); return; }
            const r = this.rumble < EPS ? 0 : this.rumble;
            const s = this.swell < EPS ? 0 : this.swell;
            this._sendFlight(r, s, false);
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && (RTHaptics.last.rumble || RTHaptics.last.swell)) RTHaptics._sendFlight(0, 0, true);
    });

    window.RTHaptics = RTHaptics;
})();
