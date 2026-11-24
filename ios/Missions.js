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
        this.panelOpen = false;
        this._panel = null;
        // Rank-up toast when a newly explored place crosses a rank line.
        this._rank = Missions.rankFor(Missions.exploredCount()).name;
        window.addEventListener('rtsexplored', (e) => {
            const r = Missions.rankFor(e.detail ? e.detail.count : Missions.exploredCount());
            if (r.name !== this._rank) {
                this._rank = r.name;
                this._toast(`🎖️ PROMOTED — ${r.name.toUpperCase()}`, true, `${r.min} places explored`);
            }
            if (this.panelOpen) this._renderPanel();
        });
        console.log(`🎯 Missions ready: ${this._completedCount()}/${this._defs.length} complete`);
    }

    _buildDefinitions() {
        return [
            {
                id: 'sungrazer',
                icon: '☀️',
                title: 'Sungrazer',
                desc: 'Fly within 40 units of the Sun',
                check: (ctx) => ctx.sunDistance < 40
            },
            {
                id: 'ring-runner',
                icon: '🪐',
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
                icon: '🌙',
                title: 'Moonwalker',
                desc: 'Visit one of the great moons up close',
                check: (ctx) => ctx.moons.some(m => {
                    m.mesh.getWorldPosition(Missions._tmpVec);
                    return ctx.camPos.distanceTo(Missions._tmpVec) < m.radius + 4;
                })
            },
            {
                id: 'event-horizon',
                icon: '🕳️',
                title: 'Edge of the Abyss',
                desc: 'Approach within 60 units of the black hole',
                check: (ctx) => ctx.blackHoleDistance < 60
            },
            {
                id: 'comet-chaser',
                icon: '☄️',
                title: 'Comet Chaser',
                desc: 'Catch up to a comet',
                check: (ctx) => ctx.comets.some(c =>
                    c.mesh && ctx.camPos.distanceTo(c.mesh.position) < 25)
            },
            {
                id: 'interstellar',
                icon: '✨',
                title: 'Interstellar',
                desc: 'Travel 2,000 units from the Sun',
                check: (ctx) => ctx.sunDistance > 2000
            },
            {
                id: 'grand-tour',
                icon: '🌍',
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
            icon: d.icon,
            complete: !!this.completed[d.id]
        }));
    }

    // ---------- Missions & Badges screen ----------

    openPanel() {
        if (this.panelOpen) return;
        this.panelOpen = true;
        const el = document.createElement('div');
        el.className = 'mb-scrim';
        el.addEventListener('click', (e) => { if (e.target === el) this.closePanel(); });
        document.body.appendChild(el);
        this._panel = el;
        this._renderPanel();
        this._chrome(true);
        requestAnimationFrame(() => el.classList.add('mb-show'));
    }

    closePanel() {
        if (!this.panelOpen) return;
        this.panelOpen = false;
        const el = this._panel;
        this._panel = null;
        this._chrome(false);
        if (!el) return;
        el.classList.remove('mb-show');
        setTimeout(() => el.remove(), 250);
    }

    togglePanel() { this.panelOpen ? this.closePanel() : this.openPanel(); }

    _chrome(hidden) {
        try {
            window.webkit?.messageHandlers?.iosHandler?.postMessage({ type: 'CHROME', hidden: !!hidden });
        } catch (e) {}
        // Same body class the Codex cards use: hides the web icon cluster under the card.
        document.body.classList.toggle('cx-modal-open', !!hidden);
    }

    _renderPanel() {
        const el = this._panel;
        if (!el) return;
        const explored = Missions.exploredCount();
        const rank = Missions.rankFor(explored);
        const next = Missions.RANKS[Missions.RANKS.indexOf(rank) + 1] || null;
        const pct = next ? Math.round(100 * (explored - rank.min) / (next.min - rank.min)) : 100;
        const done = this._completedCount();
        const visited = this._visited.size;
        const rows = this._defs.map(d => {
            const ok = !!this.completed[d.id];
            const extra = (!ok && d.id === 'grand-tour') ? ` <span class="mb-prog">${visited}/8</span>` : '';
            return `<div class="mb-row ${ok ? 'mb-done' : 'mb-locked'}">
                <div class="mb-badge">${ok ? d.icon : '🔒'}</div>
                <div class="mb-text"><div class="mb-name">${d.title}${extra}</div><div class="mb-desc">${d.desc}</div></div>
                <div class="mb-state">${ok ? '✓' : ''}</div>
            </div>`;
        }).join('');
        el.innerHTML = `
            <div class="mb-card" role="dialog" aria-label="Missions and badges">
                <button class="mb-close" aria-label="Close">✕</button>
                <div class="mb-title">MISSIONS &amp; BADGES</div>
                <div class="mb-rank">
                    <div class="mb-rank-icon">${rank.icon}</div>
                    <div class="mb-rank-text">
                        <div class="mb-rank-name">${rank.name}</div>
                        <div class="mb-rank-sub">${explored} place${explored === 1 ? '' : 's'} explored${next ? ` · ${next.min - explored} more to ${next.name}` : ' · highest rank'}</div>
                        <div class="mb-bar"><div class="mb-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
                    </div>
                </div>
                <div class="mb-count">${done} of ${this._defs.length} badges earned</div>
                <div class="mb-list">${rows}</div>
            </div>`;
        el.querySelector('.mb-close').addEventListener('click', () => this.closePanel());
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
            @media (prefers-reduced-motion: reduce) {
                .mission-toast, .mission-toast-show { transform: translateX(-50%); }
            }
            .mb-scrim {
                position: fixed; inset: 0; z-index: 400;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0, 0, 0, 0.45);
                opacity: 0; transition: opacity 0.22s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .mb-scrim.mb-show { opacity: 1; }
            .mb-card {
                position: relative;
                width: min(380px, calc(100vw - 32px));
                max-height: calc(100vh - 48px);
                overflow-y: auto; -webkit-overflow-scrolling: touch;
                padding: 18px 16px 14px;
                border-radius: 16px;
                background: linear-gradient(135deg, rgba(13, 21, 36, 0.985), rgba(6, 11, 20, 0.995));
                border: 1px solid rgba(120, 200, 255, 0.28);
                box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.92);
            }
            .mb-close {
                position: absolute; top: 8px; right: 8px; width: 36px; height: 36px;
                border: 0; border-radius: 18px; background: rgba(255, 255, 255, 0.06);
                color: rgba(160, 220, 255, 0.9); font-size: 16px;
            }
            .mb-title {
                font: 700 11px ui-monospace, Menlo, monospace; letter-spacing: 0.18em;
                color: rgba(120, 220, 255, 0.9); margin-bottom: 12px;
            }
            .mb-rank { display: flex; gap: 12px; align-items: center; padding: 10px 12px;
                border-radius: 12px; background: rgba(255, 215, 100, 0.07);
                border: 1px solid rgba(255, 215, 100, 0.3); }
            .mb-rank-icon { font-size: 30px; line-height: 1; }
            .mb-rank-text { flex: 1; min-width: 0; }
            .mb-rank-name { font-size: 18px; font-weight: 700; color: #ffd86b; letter-spacing: 0.03em; }
            .mb-rank-sub { font-size: 11px; color: rgba(255, 255, 255, 0.6); margin: 2px 0 6px; }
            .mb-bar { height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
            .mb-fill { height: 100%; background: linear-gradient(90deg, #4fd2ff, #ffd86b); }
            .mb-count { font: 600 10px ui-monospace, Menlo, monospace; letter-spacing: 0.12em;
                color: rgba(120, 220, 255, 0.75); margin: 14px 2px 6px; text-transform: uppercase; }
            .mb-row { display: flex; align-items: center; gap: 12px; padding: 9px 6px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
            .mb-row:last-child { border-bottom: 0; }
            .mb-badge { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 19px;
                display: flex; align-items: center; justify-content: center; font-size: 19px;
                background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); }
            .mb-done .mb-badge { background: rgba(255, 200, 80, 0.14); border-color: rgba(255, 215, 100, 0.55);
                box-shadow: 0 0 14px rgba(255, 200, 80, 0.18); }
            .mb-locked .mb-badge { opacity: 0.55; font-size: 15px; }
            .mb-text { flex: 1; min-width: 0; }
            .mb-name { font-size: 14px; font-weight: 600; }
            .mb-locked .mb-name { color: rgba(255, 255, 255, 0.6); }
            .mb-desc { font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: 1px; }
            .mb-prog { font-size: 11px; font-weight: 500; color: rgba(120, 220, 255, 0.8); margin-left: 4px; }
            .mb-state { width: 18px; color: #ffd86b; font-weight: 700; text-align: right; }
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

// Ranks by places explored (the persisted count in CelestialCatalog), Cadet to Captain.
Missions.RANKS = [
    { name: 'Cadet',      min: 0,  icon: '🧑‍🚀' },
    { name: 'Ensign',     min: 3,  icon: '🎗️' },
    { name: 'Lieutenant', min: 8,  icon: '🎖️' },
    { name: 'Commander',  min: 15, icon: '⭐' },
    { name: 'Captain',    min: 25, icon: '🚀' }
];
Missions.rankFor = function (count) {
    let r = Missions.RANKS[0];
    for (const x of Missions.RANKS) if (count >= x.min) r = x;
    return r;
};
Missions.exploredCount = function () {
    try {
        if (typeof CelestialCatalog !== 'undefined' && CelestialCatalog.exploredNames) {
            return CelestialCatalog.exploredNames().size;
        }
    } catch (e) {}
    return 0;
};
