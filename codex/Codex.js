// Codex.js — Discovery gameplay layer for RealTime Fidget.
// Turns "fly past pretty objects" into "explore and discover them":
//   • SCAN button arms when a catalogued body is in range; scanning reveals a
//     real-data card (true NASA numbers, size-vs-Earth bar, composition, a fact)
//     and logs the body into your Field Guide.
//   • Field Guide — a solar-system "Pokédex" you fill in; shows progress and lets
//     you re-open any discovered card. Persists in localStorage.
//   • A real top-down orbital chart ("you are here") drawn from real AU distances
//     and live ephemeris angles — the same J2000 math main.js uses.
//
// Pure HTML/CSS overlay inside the WKWebView. No native Swift changes required.
// Everything is wrapped so a failure here can NEVER black out the 3D engine.

(function () {
  'use strict';

  // Real ephemeris (J2000 mean longitude L0 + deg/day rate) — mirrors main.js so the
  // orbital chart shows planets where they ACTUALLY are today.
  const EPHEMERIS = {
    mercury: [252.25084, 4.09233445, 0.39],
    venus:   [181.97973, 1.60213034, 0.72],
    earth:   [100.46435, 0.98560910, 1.00],
    mars:    [355.45332, 0.52402068, 1.52],
    jupiter: [ 34.40438, 0.08308529, 5.20],
    saturn:  [ 49.94432, 0.03344414, 9.58],
    uranus:  [313.23218, 0.01172834, 19.2],
    neptune: [304.88003, 0.00598103, 30.1]
  };

  function meanLongitude(key) {
    const e = EPHEMERIS[key];
    if (!e) return 0;
    const daysSinceJ2000 = Date.now() / 86400000 - 10957.5;
    let deg = (e[0] + e[1] * daysSinceJ2000) % 360;
    if (deg < 0) deg += 360;
    return deg * Math.PI / 180;
  }

  const STORE_KEY = 'rtf_fieldguide_v1';

  class Codex {
    constructor() {
      this.scanned = this._load();      // Set of lowercased names already discovered
      this.armedTarget = null;          // catalog entry currently in scan range
      this.scanning = false;
      this.lastCardBody = null;
      this._pollAccum = 0;
      // Sound defaults to OFF — the ambient drone was too intense on launch. The user
      // turns it on deliberately via any of the sound buttons; the choice persists.
      const stored = localStorage.getItem('rtf_muted');
      this.muted = (stored === null) ? true : (stored === '1');
      this._injectStyles();
      this._buildDOM();
      this._applyMute(0);
      console.log('🔭 Codex ready —', this.scanned.size, 'discovered, sound', this.muted ? 'OFF' : 'ON');
    }

    // ---- sound (persisted; reachable from every screen) ----------------------
    toggleMute() {
      this.muted = !this.muted;
      try { localStorage.setItem('rtf_muted', this.muted ? '1' : '0'); } catch (e) {}
      this._applyMute(0);
      this._refreshMuteButtons();
      this._haptic('light');
    }
    _applyMute(retries) {
      try {
        const ge = window.galaxyExplorer;
        if (ge && typeof ge.setAudioEnabled === 'function') {
          ge.setAudioEnabled(!this.muted);
        } else if (retries < 30) {
          setTimeout(() => this._applyMute(retries + 1), 400); // engine not ready yet
        }
      } catch (e) {}
    }
    _refreshMuteButtons() {
      document.querySelectorAll('.cx-mute').forEach(b => { b.textContent = this.muted ? '🔇' : '🔊'; });
    }

    // ---- persistence ---------------------------------------------------------
    _load() {
      try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); }
      catch (e) { return new Set(); }
    }
    _save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify([...this.scanned])); }
      catch (e) {}
    }

    // ---- references (resolved lazily; engine boots before us sometimes) -------
    _catalog() {
      return (window.explorationTracker && window.explorationTracker.catalog)
          || window.celestialCatalog || null;
    }
    _camera() {
      const rc = window.galaxyExplorer && window.galaxyExplorer._rendererCore;
      return (window.explorationTracker && window.explorationTracker.camera)
          || (rc && rc.camera) || null;
    }

    // ===========================================================================
    //  PER-FRAME: find nearest catalogued body, arm the scan button in range
    // ===========================================================================
    update(dt) {
      try {
        this._pollAccum += dt || 0.016;
        if (this._pollAccum < 0.2) return;   // ~5 Hz is plenty for UI
        this._pollAccum = 0;

        const cat = this._catalog();
        const cam = this._camera();
        if (!cat || !cam) return;

        const camPos = cam.position;
        let nearest = null, nearestDist = Infinity;
        for (const obj of cat.objects) {
          const pos = obj.mesh && obj.mesh.position;
          if (!pos) continue;
          // honour the real body name for data lookup; skip unnamed clutter
          if (!window.SpaceData || !window.SpaceData.has(obj.name)) continue;
          const d = pos.distanceTo(camPos);
          if (d < nearestDist) { nearestDist = d; nearest = obj; }
        }

        // Also scan the interstellar / exoplanet / galaxy layer (registered separately so
        // it never affects the solar-system catalog or Space Map).
        const uni = window.__universe || [];
        for (const obj of uni) {
          const pos = obj.mesh && obj.mesh.position;
          if (!pos) continue;
          const d = pos.distanceTo(camPos);
          if (d < nearestDist) { nearestDist = d; nearest = obj; }
        }

        // Scan range scales with body size so you can scan a giant from farther out.
        const armed = nearest &&
          nearestDist < Math.max(80, (nearest.radius || 1) * 14) ? nearest : null;
        this.armedTarget = armed;
        this._refreshScanButton(armed, nearestDist);
      } catch (e) { /* never break the render loop */ }
    }

    _refreshScanButton(armed, dist) {
      if (!this.scanBtn) return;
      if (this.scanning) return;
      if (armed) {
        const known = this.scanned.has(armed.name.toLowerCase());
        this.scanBtn.classList.add('armed');
        this.scanBtn.classList.toggle('known', known);
        this.scanLabel.textContent = known ? 'RE-SCAN ' + armed.name.toUpperCase()
                                            : 'SCAN ' + armed.name.toUpperCase();
      } else {
        this.scanBtn.classList.remove('armed', 'known');
        this.scanLabel.textContent = 'NO TARGET IN RANGE';
      }
    }

    // ===========================================================================
    //  SCAN sequence
    // ===========================================================================
    triggerScan() {
      try {
        if (this.scanning) return;
        const target = this.armedTarget;
        if (!target) { this._flashButton(); return; }
        this.scanning = true;
        this.scanBtn.classList.add('scanning');
        this.scanLabel.textContent = 'SCANNING…';
        this._haptic('light');

        // animate the progress sweep, then reveal
        this.scanFill.style.transition = 'none';
        this.scanFill.style.width = '0%';
        // force reflow so the transition restarts
        void this.scanFill.offsetWidth;
        this.scanFill.style.transition = 'width 1.15s ease-in-out';
        this.scanFill.style.width = '100%';

        setTimeout(() => {
          this.scanning = false;
          this.scanBtn.classList.remove('scanning');
          this.scanFill.style.transition = 'opacity 0.4s';
          this.scanFill.style.opacity = '0';
          setTimeout(() => { this.scanFill.style.width = '0%'; this.scanFill.style.opacity = '1'; }, 400);

          const key = target.name.toLowerCase();
          const isNew = !this.scanned.has(key);
          this.scanned.add(key);
          this._save();
          const cat = this._catalog();
          if (cat && cat.exploreObject) {
            try { cat.exploreObject(target.name); } catch (e) {}
          }
          this._haptic('success');
          this.showCard(target, isNew);
          this._updateGuideBadge();
        }, 1200);
      } catch (e) { this.scanning = false; }
    }

    // ===========================================================================
    //  DISCOVERY CARD
    // ===========================================================================
    showCard(body, isNew) {
      const data = window.SpaceData && window.SpaceData.getData(body.name);
      if (!data) return;
      const F = window.SpaceData.fmt;
      const cat = this._catalog();
      const catInfo = cat ? cat.getCategoryInfo(cat.getByName(body.name) ? cat.getByName(body.name).type : '') : { icon: '🛰️' };
      const info = { icon: data.icon || catInfo.icon };
      this.lastCardBody = body;
      // The size-vs-Earth bar and the solar-system orbital chart only make sense for bodies
      // IN the solar system. Interstellar/galaxy entries (which carry a distanceLabel) skip them.
      const solar = !data.distanceLabel;

      const stat = (label, value) =>
        `<div class="cx-stat"><div class="cx-stat-k">${label}</div><div class="cx-stat-v">${value}</div></div>`;

      const sizeRatio = data.radiusKm ? Math.min(1, Math.log10(data.radiusKm / 600 + 1) / Math.log10(120)) : 0;
      const compBars = (data.composition || []).map(c =>
        `<div class="cx-comp-row">
           <span class="cx-comp-label">${c.label}</span>
           <span class="cx-comp-track"><span class="cx-comp-fill" style="width:${c.pct}%;"></span></span>
           <span class="cx-comp-pct">${c.pct}%</span>
         </div>`).join('');

      this.card.innerHTML = `
        <div class="cx-card-inner glasscx" style="--accent:${data.color}">
          ${isNew ? '<div class="cx-newbadge">NEW DISCOVERY</div>' : '<div class="cx-newbadge re">LOG ENTRY</div>'}
          <div class="cx-card-head">
            <div class="cx-card-icon">${info.icon || '🛰️'}</div>
            <div>
              <div class="cx-card-name">${body.name}</div>
              <div class="cx-card-class">${data.class}</div>
            </div>
            <div class="cx-head-btns">
              <button class="cx-mute cx-icon-btn" title="Sound on/off">${this.muted ? '🔇' : '🔊'}</button>
              <button class="cx-close" aria-label="close">✕</button>
            </div>
          </div>

          <div class="cx-statgrid">
            ${stat('Diameter', data.radiusKm ? F.km(data.radiusKm * 2) : '—')}
            ${stat('Gravity', F.gravity(data.gravity))}
            ${stat('Day', F.duration(data.dayHours))}
            ${stat('Year', F.duration(data.yearDays ? data.yearDays * 24 : null))}
            ${stat('Mean temp', F.temp(data.tempC))}
            ${stat(data.distanceLabel ? 'Distance' : 'From Sun', data.distanceLabel || F.distance(data.distanceAU))}
            ${stat('Moons', F.moons(data.moons))}
            ${stat('Mass', F.mass(data.massKg))}
          </div>

          ${solar ? `<div class="cx-sizebar">
            <div class="cx-sizebar-row">
              <span>Size vs Earth</span><span class="cx-size-val">${F.sizeVsEarth(data.radiusKm)}</span>
            </div>
            <div class="cx-sizebar-track">
              <div class="cx-earth-dot" title="Earth"></div>
              <div class="cx-size-fill" style="width:${(sizeRatio * 100).toFixed(0)}%;"></div>
            </div>
          </div>` : ''}

          <div class="cx-section-title">Composition</div>
          <div class="cx-comp">${compBars}</div>

          ${solar ? '<canvas class="cx-orbit" width="520" height="200"></canvas>' : ''}

          <div class="cx-fact"><span class="cx-fact-i">✦</span> ${data.fact}</div>
          <div class="cx-discovered">Discovered: ${data.discovered}</div>
        </div>`;

      this.card.classList.add('show');
      this._chrome(true);
      const close = this.card.querySelector('.cx-close');
      if (close) close.onclick = () => this.hideCard();
      // tap the dim backdrop to dismiss
      this.card.onclick = (e) => { if (e.target === this.card) this.hideCard(); };

      const canvas = this.card.querySelector('.cx-orbit');
      if (canvas) this._drawOrbitChart(canvas, body.name);
    }

    hideCard() {
      if (this.card) this.card.classList.remove('show');
      if (!this.guide || !this.guide.classList.contains('show')) this._chrome(false);
    }

    // ===========================================================================
    //  REAL ORBITAL CHART — top-down, real AU + live ephemeris angles
    // ===========================================================================
    _drawOrbitChart(canvas, highlightName) {
      try {
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2;
        const maxAU = 30.1;
        // log scale so inner + outer planets all fit legibly
        const R = (au) => {
          if (au <= 0) return 0;
          return (Math.log10(au + 1) / Math.log10(maxAU + 1)) * (Math.min(W, H) / 2 - 16);
        };
        const hi = (highlightName || '').toLowerCase();

        // Sun
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc33'; ctx.shadowColor = '#ffcc33'; ctx.shadowBlur = 12; ctx.fill();
        ctx.shadowBlur = 0;

        const ORDER = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
        for (const key of ORDER) {
          const au = EPHEMERIS[key][2];
          const rr = R(au);
          // orbit ring
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(120,200,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
          // planet at real current angle
          const ang = meanLongitude(key);
          const px = cx + Math.cos(ang) * rr;
          const py = cy + Math.sin(ang) * rr;
          const isHi = (key === hi) || (hi === 'moon' && key === 'earth') ||
                       (['io', 'europa', 'ganymede', 'callisto'].includes(hi) && key === 'jupiter') ||
                       (['titan', 'enceladus'].includes(hi) && key === 'saturn');
          ctx.beginPath(); ctx.arc(px, py, isHi ? 5 : 3, 0, Math.PI * 2);
          const col = (window.SpaceData.getData(key) || {}).color || '#9cf';
          ctx.fillStyle = isHi ? '#ffffff' : col;
          if (isHi) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
          ctx.fill(); ctx.shadowBlur = 0;
          if (isHi) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = '11px -apple-system, monospace';
            ctx.fillText('◀ ' + (window.SpaceData.getData(key) ? key.replace(/^\w/, c => c.toUpperCase()) : key),
                         px + 8, py + 4);
          }
        }

        // "you are here" — project the camera's heading onto the chart
        const cam = this._camera();
        if (cam) {
          const ang = Math.atan2(cam.position.z, cam.position.x);
          const rr = Math.min(W, H) / 2 - 10;
          const yx = cx + Math.cos(ang) * rr, yy = cy + Math.sin(ang) * rr;
          ctx.beginPath(); ctx.arc(yx, yy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#33ff99'; ctx.shadowColor = '#33ff99'; ctx.shadowBlur = 8; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(51,255,153,0.9)'; ctx.font = '10px -apple-system, monospace';
          ctx.fillText('YOU', yx + 6, yy + 3);
        }
      } catch (e) {}
    }

    // ===========================================================================
    //  FIELD GUIDE
    // ===========================================================================
    openGuide() {
      const all = window.SpaceData ? window.SpaceData.all() : {};
      const keys = Object.keys(all);
      const found = keys.filter(k => this.scanned.has(k)).length;
      const cat = this._catalog();

      const cells = keys.map(k => {
        const d = all[k];
        const got = this.scanned.has(k);
        const entry = cat ? cat.getByName(k) : null;
        const icon = (cat && entry) ? cat.getCategoryInfo(entry.type).icon : '•';
        const name = k.replace(/(^|[\s-])\w/g, c => c.toUpperCase());
        return `<button class="cx-cell ${got ? 'got' : 'locked'}" data-key="${k}" style="--accent:${d.color}">
            <div class="cx-cell-icon">${got ? icon : '?'}</div>
            <div class="cx-cell-name">${got ? name : '— — —'}</div>
          </button>`;
      }).join('');

      this.guide.innerHTML = `
        <div class="cx-guide-inner glasscx">
          <div class="cx-guide-head">
            <div>
              <div class="cx-guide-title">FIELD GUIDE</div>
              <div class="cx-guide-sub">${found} / ${keys.length} bodies discovered</div>
            </div>
            <div class="cx-head-btns">
              <button class="cx-mute cx-icon-btn" title="Sound on/off">${this.muted ? '🔇' : '🔊'}</button>
              <button class="cx-close" aria-label="close">✕</button>
            </div>
          </div>
          <div class="cx-guide-bar"><div class="cx-guide-bar-fill" style="width:${(found / keys.length * 100).toFixed(0)}%;"></div></div>
          <div class="cx-guide-grid">${cells}</div>
        </div>`;
      this.guide.classList.add('show');
      this._chrome(true);
      const closeGuide = () => { this.guide.classList.remove('show'); this._chrome(false); };
      this.guide.querySelector('.cx-close').onclick = closeGuide;
      this.guide.onclick = (e) => { if (e.target === this.guide) closeGuide(); };
      this.guide.querySelectorAll('.cx-cell.got').forEach(btn => {
        btn.onclick = () => {
          const key = btn.getAttribute('data-key');
          const entry = cat ? cat.getByName(key) : null;
          const body = entry || { name: key.replace(/(^|[\s-])\w/g, c => c.toUpperCase()) };
          this.guide.classList.remove('show');
          this.showCard(body, false);
        };
      });
    }

    _updateGuideBadge() {
      if (!this.guideBadge) return;
      this.guideBadge.textContent = this.scanned.size;
      this.guideBadge.classList.add('pulse');
      setTimeout(() => this.guideBadge.classList.remove('pulse'), 600);
    }

    // ===========================================================================
    //  SPACE MAP — full-screen top-down chart of the whole explorable space.
    //  Planets drawn at their ACTUAL in-engine positions (a true projection, so it
    //  matches today's real ephemeris); deep-space objects shown as rim markers with
    //  bearings. Tap any body to fly there. Discovered bodies are lit; the rest are "?".
    // ===========================================================================
    openMap() {
      this.mapEl.innerHTML = `
        <div class="cx-map-inner glasscx">
          <div class="cx-guide-head">
            <div>
              <div class="cx-guide-title">SPACE MAP</div>
              <div class="cx-guide-sub">tap a world to fly there · you are the green marker</div>
            </div>
            <div class="cx-head-btns">
              <button class="cx-mute cx-icon-btn" title="Sound on/off">${this.muted ? '🔇' : '🔊'}</button>
              <button class="cx-close" aria-label="close">✕</button>
            </div>
          </div>
          <div class="cx-map-stage">
            <canvas class="cx-map-canvas" width="900" height="900"></canvas>
            <div class="cx-map-tip" id="cxMapTip"></div>
          </div>
        </div>`;
      this.mapEl.classList.add('show');
      this._chrome(true);
      const closeMap = () => { this.mapEl.classList.remove('show'); this._stopMapLoop(); this._chrome(false); };
      this.mapEl.querySelector('.cx-close').onclick = closeMap;
      this.mapEl.onclick = (e) => { if (e.target === this.mapEl) closeMap(); };

      const canvas = this.mapEl.querySelector('.cx-map-canvas');
      this._mapTip = this.mapEl.querySelector('#cxMapTip');
      this._mapHits = [];
      canvas.onclick = (e) => this._onMapClick(e, canvas);
      // Live-redraw a few times a second so YOU and the planets track the moving scene.
      const loop = () => { this._drawSpaceMap(canvas); this._mapRAF = setTimeout(loop, 250); };
      loop();
    }
    _stopMapLoop() { if (this._mapRAF) { clearTimeout(this._mapRAF); this._mapRAF = null; } }

    _drawSpaceMap(canvas) {
      try {
        const cat = this._catalog(), cam = this._camera();
        if (!cat) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
        const chartR = Math.min(W, H) / 2 - 70;
        ctx.clearRect(0, 0, W, H);
        this._mapHits = [];

        // Classify catalogued bodies that we have real data for.
        const SOLAR = new Set(['STAR', 'PLANET', 'DWARF_PLANET', 'ASTEROID_BELT']);
        const DEEP = new Set(['NEBULA', 'COMET', 'BLACK_HOLE', 'GALAXY', 'PULSAR', 'QUASAR']);
        const solar = [], deep = [];
        for (const o of cat.objects) {
          if (!window.SpaceData || !window.SpaceData.has(o.name)) continue;
          const p = o.mesh && o.mesh.position; if (!p) continue;
          if (SOLAR.has(o.type)) solar.push(o);
          else if (DEEP.has(o.type)) deep.push(o);
        }
        // Calibrate to the outermost solar body, then map distance through a log scale so
        // the inner planets (which sit at <5% of Neptune's distance) don't pile up at center.
        let maxD = 1;
        for (const o of solar) {
          const p = o.mesh.position; const d = Math.hypot(p.x, p.z);
          if (o.type !== 'STAR' && d > maxD) maxD = d;
        }
        const denom = Math.log10(maxD + 1) || 1;
        const lg = (d) => d <= 0 ? 0 : Math.min(chartR, chartR * (Math.log10(d + 1) / denom));
        const proj = (p) => { const a = Math.atan2(p.z, p.x), r = lg(Math.hypot(p.x, p.z)); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };

        // faint orbit rings
        for (const o of solar) {
          if (o.type !== 'PLANET') continue;
          const p = o.mesh.position; const r = lg(Math.hypot(p.x, p.z));
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(120,200,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();
        }

        // deep-space rim markers (direction only — they're far beyond the planets)
        for (const o of deep) {
          const p = o.mesh.position; const ang = Math.atan2(p.z, p.x);
          const rx = cx + Math.cos(ang) * (chartR + 34), ry = cy + Math.sin(ang) * (chartR + 34);
          const data = window.SpaceData.getData(o.name) || {};
          const got = this.scanned.has(o.name.toLowerCase());
          const icon = cat.getCategoryInfo(o.type).icon;
          ctx.fillStyle = got ? (data.color || '#c9f') : 'rgba(160,180,210,0.45)';
          ctx.font = '30px -apple-system'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(got ? icon : '?', rx, ry);
          ctx.fillStyle = got ? 'rgba(220,235,255,0.9)' : 'rgba(160,180,210,0.5)';
          ctx.font = '600 17px -apple-system';
          const short = got ? o.name : '???';
          ctx.fillText(short, rx, ry + 26);
          this._mapHits.push({ name: o.name, x: rx, y: ry, r: 30, got });
        }

        // Sun + planets at their true projected angles (log-scaled radius)
        for (const o of solar) {
          const p = o.mesh.position;
          const [sx, sy] = proj(p);
          const data = window.SpaceData.getData(o.name) || {};
          const isSun = o.type === 'STAR';
          const got = this.scanned.has(o.name.toLowerCase());
          const rad = isSun ? 13 : (o.type === 'ASTEROID_BELT' ? 4 : 8);
          if (o.type === 'ASTEROID_BELT') {
            // draw as a faint dotted ring instead of a dot
            const rr = lg(Math.hypot(p.x, p.z));
            ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(155,139,110,0.35)'; ctx.lineWidth = 6; ctx.setLineDash([3, 9]); ctx.stroke(); ctx.setLineDash([]);
            this._mapHits.push({ name: o.name, x: cx + rr, y: cy, r: 26, got });
            continue;
          }
          ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          ctx.fillStyle = isSun ? '#ffcc33' : (got ? (data.color || '#9cf') : 'rgba(150,170,200,0.5)');
          if (isSun || got) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = isSun ? 22 : 10; }
          ctx.fill(); ctx.shadowBlur = 0;
          // label
          ctx.fillStyle = got || isSun ? 'rgba(225,240,255,0.92)' : 'rgba(150,170,200,0.55)';
          ctx.font = '600 16px -apple-system'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(isSun ? 'Sun' : (got ? o.name : '?'), sx, sy - rad - 12);
          this._mapHits.push({ name: o.name, x: sx, y: sy, r: Math.max(22, rad + 12), got: got || isSun });
        }

        // YOU — actual camera position (same log projection), clamped to rim if off-chart
        if (cam) {
          let [yx, yy] = proj(cam.position);
          const dist = Math.hypot(yx - cx, yy - cy);
          let clamped = false;
          if (dist > chartR + 30) { const a = Math.atan2(yy - cy, yx - cx); yx = cx + Math.cos(a) * (chartR + 30); yy = cy + Math.sin(a) * (chartR + 30); clamped = true; }
          ctx.beginPath(); ctx.arc(yx, yy, 7, 0, Math.PI * 2);
          ctx.fillStyle = '#33ff99'; ctx.shadowColor = '#33ff99'; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(51,255,153,0.95)'; ctx.font = '700 15px -apple-system'; ctx.textAlign = 'center';
          ctx.fillText(clamped ? 'YOU ▸' : 'YOU', yx, yy - 16);
        }
      } catch (e) {}
    }

    _onMapClick(e, canvas) {
      try {
        const rect = canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        let best = null, bestD = Infinity;
        for (const h of this._mapHits) {
          const d = Math.hypot(h.x - sx, h.y - sy);
          if (d < h.r && d < bestD) { bestD = d; best = h; }
        }
        if (!best) return;
        this._haptic('light');
        if (this._mapTip) {
          this._mapTip.textContent = best.got ? ('Flying to ' + best.name + '…') : 'Undiscovered — fly there and scan it';
          this._mapTip.classList.add('show');
          setTimeout(() => this._mapTip && this._mapTip.classList.remove('show'), 1800);
        }
        this._flyTo(best.name);
        // close the map shortly after so the flight is visible
        setTimeout(() => { this.mapEl.classList.remove('show'); this._stopMapLoop(); this._chrome(false); }, 650);
      } catch (e) {}
    }

    _flyTo(name) {
      try {
        const ge = window.galaxyExplorer; if (!ge) return;
        if (/^sun$/i.test(name) && ge.centerOnSun) { ge.centerOnSun(); return; }
        if (ge.flyToByName) { ge.flyToByName(name); return; }
        if (ge.flyToNearestPlanet) ge.flyToNearestPlanet();
      } catch (e) {}
    }

    // ===========================================================================
    //  DESTINATIONS — a full "fly to anywhere" menu: planets, moons, ISS, comets,
    //  the nebulae, and a warp to the Sagittarius A* black hole. Tap to fly.
    // ===========================================================================
    openDestinations() {
      const GROUPS = [
        { title: 'The Star', items: [{ n: 'Sun', i: '☀️' }] },
        { title: 'Planets', items: [
          { n: 'Mercury', i: '🌑' }, { n: 'Venus', i: '🟡' }, { n: 'Earth', i: '🌍' }, { n: 'Mars', i: '🔴' },
          { n: 'Jupiter', i: '🟠' }, { n: 'Saturn', i: '🪐' }, { n: 'Uranus', i: '🔵' }, { n: 'Neptune', i: '🔵' } ] },
        { title: 'Moons', items: [
          { n: 'Moon', i: '🌕', label: 'The Moon' }, { n: 'Io', i: '🌋' }, { n: 'Europa', i: '🧊' },
          { n: 'Ganymede', i: '🌑' }, { n: 'Callisto', i: '⚪' }, { n: 'Titan', i: '🟠' }, { n: 'Enceladus', i: '❄️' } ] },
        { title: 'Stations', items: [{ n: 'Earth', i: '🛰️', label: 'ISS · orbiting Earth' }] },
        { title: 'Comets', items: [
          { n: 'Halley', i: '☄️' }, { n: 'Swift-Tuttle', i: '☄️' }, { n: 'Hale-Bopp', i: '☄️' } ] },
        { title: 'Deep Space', items: [
          { n: 'Orion Nebula', i: '☁️' }, { n: 'Carina Nebula', i: '☁️' }, { n: 'Horsehead Nebula', i: '🐴' },
          { n: 'Sagittarius A*', i: '🕳️', label: 'Sagittarius A* · black hole' } ] },
        { title: 'The Belt', items: [{ n: 'Main Asteroid Belt', i: '🪨' }] }
      ];

      const groupsHtml = GROUPS.map(g => `
        <div class="cx-dest-group-title">${g.title}</div>
        <div class="cx-dest-grid">
          ${g.items.map(it => `
            <button class="cx-dest-cell" data-fly="${it.n}">
              <span class="cx-dest-ico">${it.i}</span>
              <span class="cx-dest-name">${it.label || it.n}</span>
            </button>`).join('')}
        </div>`).join('');

      this.destEl.innerHTML = `
        <div class="cx-dest-inner glasscx">
          <div class="cx-guide-head">
            <div>
              <div class="cx-guide-title">FLY TO</div>
              <div class="cx-guide-sub">tap a destination — autopilot takes you there</div>
            </div>
            <div class="cx-head-btns">
              <button class="cx-mute cx-icon-btn" title="Sound on/off">${this.muted ? '🔇' : '🔊'}</button>
              <button class="cx-close" aria-label="close">✕</button>
            </div>
          </div>
          <div class="cx-dest-scroll">${groupsHtml}</div>
        </div>`;
      this.destEl.classList.add('show');
      this._chrome(true);
      const closeDest = () => { this.destEl.classList.remove('show'); this._chrome(false); };
      this.destEl.querySelector('.cx-close').onclick = closeDest;
      this.destEl.onclick = (e) => { if (e.target === this.destEl) closeDest(); };
      this.destEl.querySelectorAll('.cx-dest-cell').forEach(btn => {
        btn.onclick = () => {
          this._haptic('light');
          this._flyTo(btn.getAttribute('data-fly'));
          closeDest();
        };
      });
    }

    // ===========================================================================
    //  DOM + STYLES
    // ===========================================================================
    _buildDOM() {
      // control cluster (top-left, clear of Swift's joystick/thrust which sit lower)
      const wrap = document.createElement('div');
      wrap.className = 'cx-controls';
      wrap.innerHTML = `
        <button class="cx-scan" id="cxScan">
          <span class="cx-scan-fill" id="cxScanFill"></span>
          <span class="cx-scan-label" id="cxScanLabel">NO TARGET IN RANGE</span>
        </button>
        <div class="cx-btnrow">
          <button class="cx-map-btn cx-icon-btn" id="cxMapBtn" title="Space Map">🗺️</button>
          <button class="cx-live-btn cx-icon-btn" id="cxLiveBtn" title="Live — right now">🛰️</button>
          <button class="cx-guide-btn" id="cxGuideBtn">
            📖 <span class="cx-guide-badge" id="cxGuideBadge">${this.scanned.size}</span>
          </button>
          <button class="cx-mute cx-icon-btn" title="Sound on/off">${this.muted ? '🔇' : '🔊'}</button>
        </div>`;
      document.body.appendChild(wrap);

      const card = document.createElement('div'); card.className = 'cx-card'; document.body.appendChild(card);
      const guide = document.createElement('div'); guide.className = 'cx-guide'; document.body.appendChild(guide);
      const map = document.createElement('div'); map.className = 'cx-map'; document.body.appendChild(map);
      const dest = document.createElement('div'); dest.className = 'cx-dest'; document.body.appendChild(dest);
      this.destEl = dest;

      this.scanBtn = wrap.querySelector('#cxScan');
      this.scanFill = wrap.querySelector('#cxScanFill');
      this.scanLabel = wrap.querySelector('#cxScanLabel');
      this.guideBtn = wrap.querySelector('#cxGuideBtn');
      this.guideBadge = wrap.querySelector('#cxGuideBadge');
      this.mapBtn = wrap.querySelector('#cxMapBtn');
      this.mapEl = map;
      this.card = card;
      this.guide = guide;

      this.scanBtn.addEventListener('click', () => this.triggerScan());
      this.guideBtn.addEventListener('click', () => this.openGuide());
      this.mapBtn.addEventListener('click', () => this.openMap());
      const liveBtn = wrap.querySelector('#cxLiveBtn');
      if (liveBtn) liveBtn.addEventListener('click', () => { if (window.liveData) window.liveData.open(); });
      // Delegated: any sound button anywhere (cluster, card header, guide header) toggles mute.
      document.addEventListener('click', (e) => {
        const m = e.target.closest && e.target.closest('.cx-mute');
        if (m) { e.stopPropagation(); this.toggleMute(); }
      });
    }

    _flashButton() {
      if (!this.scanBtn) return;
      this.scanBtn.classList.add('deny');
      setTimeout(() => this.scanBtn.classList.remove('deny'), 350);
    }
    _haptic(style) {
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iosHandler) {
          window.webkit.messageHandlers.iosHandler.postMessage({ type: 'HAPTIC', style });
        }
      } catch (e) {}
    }
    // Tell the native shell to hide its flight controls while a modal is open (and our own
    // scan/guide cluster too, via the body class), so nothing floats over the card.
    _chrome(hidden) {
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iosHandler) {
          window.webkit.messageHandlers.iosHandler.postMessage({ type: 'CHROME', hidden: !!hidden });
        }
      } catch (e) {}
      document.body.classList.toggle('cx-modal-open', !!hidden);
    }

    _injectStyles() {
      if (document.getElementById('cx-styles')) return;
      const s = document.createElement('style');
      s.id = 'cx-styles';
      s.textContent = `
      .glasscx{
        background:linear-gradient(135deg,rgba(13,21,36,0.985),rgba(6,11,20,0.995));
        backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);
        border:1px solid rgba(120,200,255,0.28);
        box-shadow:0 12px 48px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,255,255,0.06);
      }
      /* ---- control cluster ---- */
      .cx-controls{position:absolute;top:200px;right:12px;z-index:400;display:flex;flex-direction:column;align-items:flex-end;gap:10px;
        font-family:-apple-system,'SF Pro Display',sans-serif;-webkit-user-select:none;transition:opacity .2s;}
      /* When a card or the Field Guide is open, get the scan/guide buttons out of the way. */
      body.cx-modal-open .cx-controls{opacity:0;pointer-events:none;}
      .cx-scan{position:relative;overflow:hidden;min-width:188px;height:42px;border-radius:21px;cursor:pointer;
        border:1px solid rgba(120,200,255,0.25);color:rgba(160,210,255,0.55);
        background:linear-gradient(135deg,rgba(10,22,40,0.7),rgba(6,12,24,0.85));
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
        font-size:12px;font-weight:600;letter-spacing:1.5px;transition:all .25s;padding:0 16px;}
      .cx-scan.armed{color:#9fe6ff;border-color:rgba(80,220,255,0.7);
        box-shadow:0 0 18px rgba(60,200,255,0.35);animation:cxPulse 1.6s ease-in-out infinite;}
      .cx-scan.armed.known{color:#ffd98a;border-color:rgba(255,200,100,0.6);box-shadow:0 0 16px rgba(255,190,90,0.3);}
      .cx-scan.scanning{color:#fff;border-color:#5fd0ff;animation:none;}
      .cx-scan.deny{animation:cxDeny .35s;}
      .cx-scan-label{position:relative;z-index:2;white-space:nowrap;}
      .cx-scan-fill{position:absolute;left:0;top:0;bottom:0;width:0;z-index:1;
        background:linear-gradient(90deg,rgba(60,200,255,0.35),rgba(120,255,220,0.5));}
      @keyframes cxPulse{0%,100%{box-shadow:0 0 14px rgba(60,200,255,0.25);}50%{box-shadow:0 0 26px rgba(60,200,255,0.55);}}
      @keyframes cxDeny{0%,100%{transform:translateX(0);}25%{transform:translateX(-5px);}75%{transform:translateX(5px);}}
      .cx-btnrow{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:220px;}
      .cx-guide-btn{position:relative;width:46px;height:42px;border-radius:14px;cursor:pointer;font-size:19px;
        border:1px solid rgba(120,200,255,0.22);background:linear-gradient(135deg,rgba(10,22,40,0.7),rgba(6,12,24,0.85));
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
      .cx-icon-btn{width:46px;height:42px;border-radius:14px;cursor:pointer;font-size:18px;line-height:1;
        border:1px solid rgba(120,200,255,0.22);color:#cfe6ff;background:linear-gradient(135deg,rgba(10,22,40,0.7),rgba(6,12,24,0.85));
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
      .cx-head-btns{display:flex;gap:8px;margin-left:auto;align-items:center;}
      .cx-head-btns .cx-icon-btn{width:34px;height:34px;border-radius:17px;font-size:15px;flex:0 0 auto;}
      .cx-guide-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9px;
        background:#33ff99;color:#012;font-size:10px;font-weight:700;line-height:18px;text-align:center;padding:0 4px;
        box-shadow:0 0 8px rgba(51,255,153,0.6);}
      .cx-guide-badge.pulse{animation:cxBadge .6s;}
      @keyframes cxBadge{0%{transform:scale(1);}40%{transform:scale(1.5);}100%{transform:scale(1);}}

      /* ---- discovery card ---- */
      .cx-card,.cx-guide,.cx-map,.cx-dest{position:absolute;inset:0;z-index:600;display:none;align-items:center;justify-content:center;
        background:rgba(0,1,6,0.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
        font-family:-apple-system,'SF Pro Display',sans-serif;-webkit-user-select:none;}
      .cx-card.show,.cx-guide.show,.cx-map.show,.cx-dest.show{display:flex;animation:cxFade .3s;}
      @keyframes cxFade{from{opacity:0;}to{opacity:1;}}
      .cx-card-inner{width:min(560px,92vw);max-height:88vh;overflow-y:auto;border-radius:22px;padding:22px 22px 26px;
        color:#dff1ff;position:relative;animation:cxRise .35s cubic-bezier(.2,.9,.3,1.1);}
      @keyframes cxRise{from{transform:translateY(26px) scale(.97);opacity:0;}to{transform:none;opacity:1;}}
      .cx-newbadge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:2px;padding:4px 10px;border-radius:20px;
        background:var(--accent);color:#04101c;margin-bottom:12px;box-shadow:0 0 14px var(--accent);}
      .cx-newbadge.re{background:rgba(120,200,255,0.2);color:#9fe6ff;box-shadow:none;}
      .cx-card-head{display:flex;align-items:flex-start;gap:14px;margin-bottom:18px;}
      .cx-card-icon{font-size:40px;line-height:1;filter:drop-shadow(0 0 10px var(--accent));}
      .cx-card-name{font-size:26px;font-weight:700;letter-spacing:.5px;}
      .cx-card-class{font-size:12px;color:rgba(160,210,255,0.7);margin-top:3px;}
      .cx-close{margin-left:auto;width:32px;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,0.15);
        background:rgba(255,255,255,0.06);color:#cfe6ff;font-size:14px;cursor:pointer;flex:0 0 auto;}
      .cx-statgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:18px;}
      .cx-stat{background:rgba(120,200,255,0.06);border:1px solid rgba(120,200,255,0.1);border-radius:12px;padding:9px 12px;}
      .cx-stat-k{font-size:10px;letter-spacing:1px;color:rgba(160,210,255,0.6);text-transform:uppercase;}
      .cx-stat-v{font-size:15px;font-weight:600;margin-top:2px;color:#eaf6ff;}
      .cx-sizebar{margin-bottom:16px;}
      .cx-sizebar-row{display:flex;justify-content:space-between;font-size:11px;color:rgba(160,210,255,0.75);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase;}
      .cx-size-val{color:var(--accent);font-weight:700;}
      .cx-sizebar-track{position:relative;height:14px;border-radius:7px;background:rgba(120,200,255,0.08);}
      .cx-size-fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background:linear-gradient(90deg,var(--accent),rgba(255,255,255,0.5));opacity:.85;}
      .cx-earth-dot{position:absolute;left:calc(${(Math.log10(6371 / 600 + 1) / Math.log10(120) * 100).toFixed(1)}% - 4px);top:-3px;width:8px;height:20px;border-left:2px dashed rgba(120,220,120,0.9);}
      .cx-section-title{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(160,210,255,0.6);margin:6px 0 10px;}
      .cx-comp-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px;}
      .cx-comp-label{flex:0 0 38%;color:#cfe6ff;}
      .cx-comp-track{flex:1;height:8px;border-radius:4px;background:rgba(120,200,255,0.1);overflow:hidden;}
      .cx-comp-fill{display:block;height:100%;background:linear-gradient(90deg,var(--accent),rgba(255,255,255,0.4));}
      .cx-comp-pct{flex:0 0 38px;text-align:right;color:rgba(200,225,255,0.8);}
      .cx-orbit{width:100%;height:auto;margin:14px 0 6px;border-radius:12px;background:radial-gradient(circle at 50% 50%,rgba(20,40,70,0.4),rgba(2,6,14,0.5));border:1px solid rgba(120,200,255,0.1);}
      .cx-fact{font-size:13px;line-height:1.5;color:#eaf6ff;background:rgba(120,200,255,0.06);border-left:2px solid var(--accent);border-radius:8px;padding:11px 13px;margin-top:8px;}
      .cx-fact-i{color:var(--accent);margin-right:5px;}
      .cx-discovered{font-size:11px;color:rgba(160,210,255,0.55);margin-top:10px;text-align:right;letter-spacing:.5px;}

      /* ---- field guide ---- */
      .cx-guide-inner{width:min(620px,94vw);max-height:88vh;overflow-y:auto;border-radius:22px;padding:22px;color:#dff1ff;animation:cxRise .35s cubic-bezier(.2,.9,.3,1.1);}
      .cx-guide-head{display:flex;align-items:center;margin-bottom:14px;}
      .cx-guide-title{font-size:22px;font-weight:700;letter-spacing:2px;}
      .cx-guide-sub{font-size:12px;color:rgba(160,210,255,0.7);margin-top:2px;}
      .cx-guide-bar{height:8px;border-radius:4px;background:rgba(120,200,255,0.1);overflow:hidden;margin-bottom:18px;}
      .cx-guide-bar-fill{height:100%;background:linear-gradient(90deg,#33ff99,#5fd0ff);box-shadow:0 0 10px rgba(51,255,153,0.5);}
      .cx-guide-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;}
      .cx-cell{aspect-ratio:1;border-radius:14px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
        border:1px solid rgba(120,200,255,0.14);background:rgba(120,200,255,0.05);color:#dff1ff;padding:6px;transition:transform .15s;}
      .cx-cell.got{border-color:color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:0 0 14px color-mix(in srgb,var(--accent) 25%,transparent);}
      .cx-cell.got:active{transform:scale(.94);}
      .cx-cell.locked{opacity:.4;cursor:default;}
      .cx-cell-icon{font-size:26px;}
      .cx-cell-name{font-size:10px;text-align:center;line-height:1.1;color:rgba(220,238,255,0.85);}

      /* ---- space map ---- */
      .cx-map-inner{width:min(640px,95vw);max-height:92vh;border-radius:22px;padding:20px;color:#dff1ff;
        display:flex;flex-direction:column;animation:cxRise .35s cubic-bezier(.2,.9,.3,1.1);}
      .cx-map-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;}
      .cx-map-canvas{width:100%;height:auto;max-height:78vh;aspect-ratio:1;border-radius:16px;cursor:pointer;
        background:radial-gradient(circle at 50% 50%,rgba(18,34,60,0.55),rgba(2,5,12,0.6));border:1px solid rgba(120,200,255,0.12);}
      .cx-map-tip{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);opacity:0;transition:opacity .2s;
        background:rgba(8,16,28,0.92);border:1px solid rgba(120,200,255,0.3);color:#9fe6ff;font-size:13px;font-weight:600;
        padding:8px 14px;border-radius:20px;white-space:nowrap;pointer-events:none;}
      .cx-map-tip.show{opacity:1;}

      /* ---- destinations (fly to) ---- */
      .cx-dest-inner{width:min(600px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:22px;padding:20px;color:#dff1ff;animation:cxRise .35s cubic-bezier(.2,.9,.3,1.1);}
      .cx-dest-scroll{overflow-y:auto;flex:1;}
      .cx-dest-group-title{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(160,210,255,0.55);margin:14px 0 8px;}
      .cx-dest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;}
      .cx-dest-cell{display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:12px;cursor:pointer;text-align:left;
        border:1px solid rgba(120,200,255,0.14);background:rgba(120,200,255,0.06);color:#eaf6ff;transition:transform .12s,background .15s;}
      .cx-dest-cell:active{transform:scale(.96);background:rgba(120,200,255,0.16);}
      .cx-dest-ico{font-size:20px;flex:0 0 auto;}
      .cx-dest-name{font-size:13px;font-weight:500;line-height:1.15;}
      `;
      document.head.appendChild(s);
    }
  }

  // Boot once the engine globals are live.
  function boot() {
    try {
      if (window.codex) return;
      window.codex = new Codex();
    } catch (e) { console.error('Codex boot failed:', e); }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('load', () => setTimeout(boot, 1200));
  }

  window.Codex = Codex;
})();
