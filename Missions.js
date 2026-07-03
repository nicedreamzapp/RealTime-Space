// Missions.js - Exploration challenges with toast notifications.
// Self-contained: checks camera position against mission conditions each frame,
// persists completion in localStorage, and pops a small HUD toast on completion.

class Missions {
    constructor() {
        this.completed = this._load();
        this.toastQueue = [];
        this.toastActive = false;
        this._visited = new Set(this.completed['grand-tour-progress'] || []);
        this._defs = this._buildDefinitions();
        this._injectStyles();
        console.log(`🎯 Missions ready: ${this._completedCount()}/${this._defs.length} complete`);
    }

    _buildDefinitions() {
        return [
            {
                id: 'sungrazer',
                title: 'Sungrazer',
                desc: 'Fly within 40 units of the Sun',
                check: (ctx) => ctx.sunDistance < 40
            },
            {
                id: 'ring-runner',
                title: 'Ring Runner',
                desc: "Skim through Saturn's rings",
                check: (ctx) => {
                    if (!ctx.saturn) return false;
                    const d = ctx.camPos.distanceTo(ctx.saturn.mesh.position);
                    return d > ctx.saturn.radius * 1.2 && d < ctx.saturn.radius * 2.4;
                }
            },
            {
                id: 'moonwalker',
                title: 'Moonwalker',
                desc: 'Visit one of the great moons up close',
                check: (ctx) => ctx.moons.some(m => {
                    m.mesh.getWorldPosition(Missions._tmpVec);
                    return ctx.camPos.distanceTo(Missions._tmpVec) < m.radius + 4;
                })
            },
            {
                id: 'event-horizon',
                title: 'Edge of the Abyss',
                desc: 'Approach within 60 units of the black hole',
                check: (ctx) => ctx.blackHoleDistance < 60
            },
            {
                id: 'comet-chaser',
                title: 'Comet Chaser',
                desc: 'Catch up to a comet',
                check: (ctx) => ctx.comets.some(c =>
                    c.mesh && ctx.camPos.distanceTo(c.mesh.position) < 25)
            },
            {
                id: 'interstellar',
                title: 'Interstellar',
                desc: 'Travel 2,000 units from the Sun',
                check: (ctx) => ctx.sunDistance > 2000
            },
            {
                id: 'grand-tour',
                title: 'The Grand Tour',
                desc: 'Visit all 8 planets',
                check: (ctx) => {
                    ctx.planets.forEach(p => {
                        if (this._visited.has(p.name)) return;
                        if (ctx.camPos.distanceTo(p.mesh.position) < Math.max(20, p.radius * 4)) {
                            this._visited.add(p.name);
                            this.completed['grand-tour-progress'] = [...this._visited];
                            this._save();
                            if (this._visited.size < ctx.planets.length) {
                                this._toast(`✦ ${p.name} visited — ${this._visited.size}/${ctx.planets.length} planets`, false);
                            }
                        }
                    });
                    return ctx.planets.length > 0 && this._visited.size >= ctx.planets.length;
                }
            }
        ];
    }

    // ctx: { camPos, sunDistance, blackHoleDistance, planets, moons, comets, saturn }
    update(ctx) {
        for (const def of this._defs) {
            if (this.completed[def.id]) continue;
            let hit = false;
            try { hit = def.check(ctx); } catch (e) { /* mission check never crashes the loop */ }
            if (hit) {
                this.completed[def.id] = Date.now();
                this._save();
                this._toast(`🏆 MISSION COMPLETE — ${def.title}`, true, def.desc);
                console.log(`🏆 Mission complete: ${def.title} (${this._completedCount()}/${this._defs.length})`);
            }
        }
    }

    getMissions() {
        return this._defs.map(d => ({
            id: d.id,
            title: d.title,
            desc: d.desc,
            complete: !!this.completed[d.id]
        }));
    }

    _completedCount() {
        return this._defs.filter(d => this.completed[d.id]).length;
    }

    // ---------- Toasts ----------

    _toast(text, big, sub) {
        this.toastQueue.push({ text, big, sub });
        this._drainToasts();
    }

    _drainToasts() {
        if (this.toastActive || this.toastQueue.length === 0) return;
        this.toastActive = true;
        const { text, big, sub } = this.toastQueue.shift();

        const el = document.createElement('div');
        el.className = 'mission-toast' + (big ? ' mission-toast-big' : '');
        el.innerHTML = `<div>${text}</div>` + (sub ? `<div class="mission-toast-sub">${sub}</div>` : '');
        document.body.appendChild(el);

        requestAnimationFrame(() => el.classList.add('mission-toast-show'));
        setTimeout(() => {
            el.classList.remove('mission-toast-show');
            setTimeout(() => {
                el.remove();
                this.toastActive = false;
                this._drainToasts();
            }, 450);
        }, big ? 3600 : 2200);

        // Haptic on the iOS side if available
        if (big && window.webkit?.messageHandlers?.iosHandler) {
            try {
                window.webkit.messageHandlers.iosHandler.postMessage({ type: 'HAPTIC', style: 'success' });
            } catch (e) {}
        }
    }

    _injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .mission-toast {
                position: absolute;
                top: 120px;
                left: 50%;
                transform: translateX(-50%) translateY(-12px);
                padding: 10px 22px;
                border-radius: 12px;
                background: rgba(10, 14, 24, 0.78);
                border: 1px solid rgba(255, 255, 255, 0.14);
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                color: rgba(255, 255, 255, 0.92);
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                font-weight: 600;
                letter-spacing: 0.06em;
                text-align: center;
                z-index: 300;
                opacity: 0;
                transition: opacity 0.45s ease, transform 0.45s ease;
                pointer-events: none;
            }
            .mission-toast-show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .mission-toast-big {
                font-size: 15px;
                padding: 14px 28px;
                border-color: rgba(255, 215, 100, 0.45);
                box-shadow: 0 0 30px rgba(255, 200, 80, 0.18);
            }
            .mission-toast-sub {
                margin-top: 4px;
                font-size: 11px;
                font-weight: 400;
                color: rgba(255, 255, 255, 0.55);
                letter-spacing: 0.03em;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- Persistence ----------

    _load() {
        try {
            return JSON.parse(localStorage.getItem('missions_v1') || '{}');
        } catch (e) {
            return {};
        }
    }

    _save() {
        try {
            localStorage.setItem('missions_v1', JSON.stringify(this.completed));
        } catch (e) {}
    }
}

Missions._tmpVec = new THREE.Vector3();
