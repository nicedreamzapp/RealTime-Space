// ScenicTour.js - GRAND TOUR autopilot
// A curated cinematic route through the most scenic places in the system:
// long eased flights between stops, then a slow drifting orbit at each one
// with a title card. Tap anywhere to take back the controls; NEXT ▸ skips.
//
// Self-contained: builds its own DOM/styles, driven by a per-frame update()
// registered as a system in main.js. main.js owns start/stop wiring via
// window.galaxyExplorer.startScenicTour() / stopScenicTour().

class ScenicTour {
    constructor(opts = {}) {
        this.camera = opts.camera || null;
        // (name) => { mesh, radius, name } — resolver injected by main.js so the
        // tour can follow live positions (comets move mid-dwell).
        this.findByName = opts.findByName || (() => null);
        this.onStart = opts.onStart || null;   // main.js: kill activeFly, zero nav velocity
        this.onStop = opts.onStop || null;

        // The route. Order is the show: leave home, sunward turn, then outward
        // planet by planet, and finish falling toward the black hole.
        // mult = camera distance in target radii (min absolute distance enforced).
        this.STOPS = [
            { name: "Earth",          mult: 4.0, title: "Earth",           sub: "Home. Everyone you've ever known lived here." },
            { name: "Moon",           mult: 4.5, title: "The Moon",        sub: "Our first step into the dark." },
            { name: "Sun",            mult: 5.5, title: "The Sun",         sub: "99.8% of everything in this system." },
            { name: "Mars",           mult: 4.0, title: "Mars",            sub: "The next world we'll walk on." },
            { name: "Jupiter",        mult: 3.2, title: "Jupiter",         sub: "A storm bigger than Earth has raged here for centuries." },
            { name: "Io",             mult: 5.0, title: "Io",              sub: "The most volcanic world in the solar system." },
            { name: "Saturn",         mult: 3.0, title: "Saturn",          sub: "The rings are almost a mile thin." },
            { name: "Uranus",         mult: 3.5, title: "Uranus",          sub: "An ice giant rolling on its side." },
            { name: "Neptune",        mult: 3.5, title: "Neptune",         sub: "Winds here break 1,200 miles per hour." },
            { name: "Pluto",          mult: 5.0, title: "Pluto",           sub: "Demoted on paper. Look for the heart." },
            { name: "Halley",         mult: 8.0, title: "Halley's Comet",  sub: "It will return. It always returns." },
            { name: "Orion Nebula",   mult: 1.6, title: "The Orion Nebula", sub: "A stellar nursery — stars are being born in there." },
            { name: "Sagittarius A*", mult: 9.0, title: "Sagittarius A*",  sub: "The black hole at the heart of the galaxy. End of the line." }
        ];

        this.active = false;
        this.stopIndex = -1;
        this.phase = null;          // 'fly' | 'dwell'
        this.phaseStart = 0;
        this.flyDuration = 4000;    // recomputed per leg
        this.dwellDuration = 9000;
        this._startPos = new THREE.Vector3();
        this._startQuat = new THREE.Quaternion();
        this._arriveOffset = new THREE.Vector3(); // camera offset from target at arrival
        this._orbitAngle = 0;
        this._tmpTarget = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
        this._tmpMat = new THREE.Matrix4();
        this._current = null;       // resolved { mesh, radius } for current stop

        this._buildDOM();
        // Any touch on the sky = pilot takes the controls back. The tour's own
        // buttons stop propagation so NEXT/END don't count as "the sky".
        this._cancelHandler = () => { if (this.active) this.stop('user'); };
    }

    // ---------------------------------------------------------------- control
    start() {
        if (this.active) return;
        this.active = true;
        this.stopIndex = -1;
        if (this.onStart) { try { this.onStart(); } catch (e) {} }
        // Clean full-window view — chase/cockpit cameras would fight the tour.
        try { window.galaxyExplorer?.setViewMode?.('visor'); } catch (e) {}
        this._prevCinematic = !!(window.galaxyExplorer?.getCinematicMode?.());
        try { window.galaxyExplorer?.setCinematicMode?.(true); } catch (e) {}

        const canvas = document.getElementById('galaxyCanvas');
        if (canvas) canvas.addEventListener('pointerdown', this._cancelHandler, { capture: true });

        this.chip.classList.add('show');
        this._advance();
        console.log("🎬 Grand Tour: departure");
    }

    stop(reason = 'end') {
        if (!this.active) return;
        this.active = false;
        this.phase = null;
        this._current = null;
        const canvas = document.getElementById('galaxyCanvas');
        if (canvas) canvas.removeEventListener('pointerdown', this._cancelHandler, { capture: true });
        this.chip.classList.remove('show');
        this._hideCard();
        try { window.galaxyExplorer?.setCinematicMode?.(this._prevCinematic); } catch (e) {}
        if (this.onStop) { try { this.onStop(reason); } catch (e) {} }
        console.log(`🎬 Grand Tour: ended (${reason})`);
    }

    skip() {
        if (!this.active) return;
        this._advance();
    }

    _advance() {
        this.stopIndex++;
        if (this.stopIndex >= this.STOPS.length) {
            this._showCard('Tour complete', 'The ship is yours, captain.', '');
            this._haptic('success');
            const self = this;
            setTimeout(() => { self.stop('complete'); }, 2600);
            this.phase = null;
            return;
        }

        const stop = this.STOPS[this.stopIndex];
        const obj = this.findByName(stop.name);
        if (!obj || !obj.mesh) {
            console.warn(`🎬 Grand Tour: "${stop.name}" not found — skipping`);
            this._advance();
            return;
        }

        this._current = { obj, stop };
        obj.mesh.getWorldPosition(this._tmpTarget);

        // Camera slot: hold current direction from target, at the stop's distance,
        // lifted a touch above the ecliptic so rings and cloud bands read well.
        const dist = Math.max((obj.radius || 10) * stop.mult, 6);
        const dir = this.camera.position.clone().sub(this._tmpTarget);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();
        dir.y = Math.max(dir.y, 0.18); // gentle high-angle
        dir.normalize();
        this._arriveOffset.copy(dir).multiplyScalar(dist);

        this._startPos.copy(this.camera.position);
        this._startQuat.copy(this.camera.quaternion);
        this.phase = 'fly';
        this.phaseStart = performance.now();
        // Long legs get longer flights, capped so the outer system never drags.
        const legLength = this._startPos.distanceTo(this._tmpTarget);
        this.flyDuration = Math.min(9000, 2400 + legLength * 6);
        this._orbitAngle = 0;
        this._hideCard();
        this._setChipProgress();
    }

    // ---------------------------------------------------------------- per-frame
    update(dt) {
        if (!this.active || !this.phase || !this.camera || !this._current) return;

        const { obj, stop } = this._current;
        if (!obj.mesh) { this._advance(); return; }
        obj.mesh.getWorldPosition(this._tmpTarget);
        const now = performance.now();

        if (this.phase === 'fly') {
            const t = Math.min((now - this.phaseStart) / this.flyDuration, 1);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // End point tracks the live target so moving bodies are met, not missed.
            const endPos = this._tmpTarget.clone().add(this._arriveOffset);
            this.camera.position.lerpVectors(this._startPos, endPos, ease);

            this._tmpMat.lookAt(this.camera.position, this._tmpTarget, this.camera.up);
            this._tmpQuat.setFromRotationMatrix(this._tmpMat);
            this.camera.quaternion.slerpQuaternions(this._startQuat, this._tmpQuat, ease);

            if (t >= 1) {
                this.phase = 'dwell';
                this.phaseStart = now;
                this._orbitAngle = 0;
                this._showCard(stop.title, stop.sub, `${this.stopIndex + 1} / ${this.STOPS.length}`);
                this._haptic('light');
            }
            return;
        }

        // dwell: slow drifting orbit around the live target
        this._orbitAngle += dt * 0.07;
        const off = this._arriveOffset;
        const cosA = Math.cos(this._orbitAngle), sinA = Math.sin(this._orbitAngle);
        const ox = off.x * cosA - off.z * sinA;
        const oz = off.x * sinA + off.z * cosA;
        const breathe = 1 + 0.04 * Math.sin(this._orbitAngle * 2.3);
        this.camera.position.set(
            this._tmpTarget.x + ox * breathe,
            this._tmpTarget.y + off.y * breathe,
            this._tmpTarget.z + oz * breathe
        );
        this.camera.lookAt(this._tmpTarget);

        if (now - this.phaseStart >= this.dwellDuration) this._advance();
    }

    // ---------------------------------------------------------------- UI
    _buildDOM() {
        const style = document.createElement('style');
        style.textContent = `
            .st-chip {
                position: fixed; top: calc(env(safe-area-inset-top, 12px) + 8px);
                left: 50%; transform: translateX(-50%) translateY(-70px);
                display: flex; align-items: center; gap: 10px;
                padding: 7px 10px 7px 14px; border-radius: 20px;
                background: rgba(8, 14, 26, 0.72);
                border: 1px solid rgba(120, 180, 255, 0.35);
                backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
                font-family: -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif;
                color: #cfe4ff; font-size: 12px; letter-spacing: 0.08em;
                z-index: 10040; transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.25, 1);
                pointer-events: auto; white-space: nowrap;
            }
            .st-chip.show { transform: translateX(-50%) translateY(0); }
            .st-chip .st-label { font-weight: 600; }
            .st-chip button {
                appearance: none; border: 1px solid rgba(120, 180, 255, 0.4);
                background: rgba(40, 70, 120, 0.5); color: #dceaff;
                font: inherit; border-radius: 13px; padding: 4px 11px;
            }
            .st-chip button:active { background: rgba(90, 140, 210, 0.6); }
            .st-card {
                position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom, 16px) + 84px);
                transform: translateX(-50%) translateY(14px);
                text-align: center; z-index: 10035; pointer-events: none;
                font-family: -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif;
                color: #fff; opacity: 0;
                transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.9, 0.25, 1);
                text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85);
            }
            .st-card.show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .st-card .st-count { font-size: 11px; letter-spacing: 0.35em; color: #9fc4ef; margin-bottom: 5px; }
            .st-card .st-title { font-size: 30px; font-weight: 700; letter-spacing: 0.04em; }
            .st-card .st-sub { font-size: 14px; color: #cfe0f5; margin-top: 6px; font-weight: 400; }
        `;
        document.head.appendChild(style);

        this.chip = document.createElement('div');
        this.chip.className = 'st-chip';
        this.chip.innerHTML = `
            <span class="st-label">🎬 GRAND TOUR</span>
            <span class="st-prog"></span>
            <button class="st-next">NEXT ▸</button>
            <button class="st-end">✕</button>`;
        document.body.appendChild(this.chip);
        this._prog = this.chip.querySelector('.st-prog');

        const eat = (e) => { e.stopPropagation(); };
        this.chip.addEventListener('pointerdown', eat, { capture: true });
        this.chip.querySelector('.st-next').addEventListener('click', (e) => { e.stopPropagation(); this._haptic('light'); this.skip(); });
        this.chip.querySelector('.st-end').addEventListener('click', (e) => { e.stopPropagation(); this.stop('user'); });

        this.card = document.createElement('div');
        this.card.className = 'st-card';
        document.body.appendChild(this.card);
    }

    _setChipProgress() {
        if (this._prog) this._prog.textContent = `${this.stopIndex + 1}/${this.STOPS.length}`;
    }

    _showCard(title, sub, count) {
        this.card.innerHTML = `
            ${count ? `<div class="st-count">${count}</div>` : ''}
            <div class="st-title">${title}</div>
            <div class="st-sub">${sub}</div>`;
        this.card.classList.add('show');
    }

    _hideCard() {
        this.card.classList.remove('show');
    }

    _haptic(styleName) {
        try {
            window.webkit?.messageHandlers?.iosHandler?.postMessage({ type: 'HAPTIC', style: styleName });
        } catch (e) {}
        try {
            window.AndroidBridge?.haptic?.(styleName);
        } catch (e) {}
    }
}
