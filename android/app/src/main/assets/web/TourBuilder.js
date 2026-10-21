// TourBuilder.js - "Make Your Tour"
// The kid taps the places they want to see (planets, moons, stars, constellations,
// deep-sky wonders). Each pick lights up in its own color and becomes a stop. Start
// flies the real solar system to each one with the ScenicTour autopilot; at every stop
// a card drops from the top with real facts, and a tap moves the tour on.
//
// Cards are text only; the app does not talk.
//
// Constellations are handled honestly: a constellation is a pattern seen from Earth, so
// its stop is two views - from beside Earth (the familiar shape) and then from the side,
// where the shape falls apart because its stars sit at very different real distances.

(function () {
  'use strict';

  // One bright color per pick, in the order they are tapped.
  const COLORS = ['#4fd8ff', '#ff6fb1', '#ffd23f', '#7dff8a', '#b78cff', '#ff9b4a', '#5ef2d6', '#ff5e5e'];

  // id = key into TourText.js, name = the engine's object name.
  const GROUPS = [
    { id: 'planets', items: [
      { id: 'sun', name: 'Sun', icon: '☀️' }, { id: 'mercury', name: 'Mercury', icon: '🪨' }, { id: 'venus', name: 'Venus', icon: '🟡' },
      { id: 'earth', name: 'Earth', icon: '🌍' }, { id: 'mars', name: 'Mars', icon: '🔴' }, { id: 'jupiter', name: 'Jupiter', icon: '🟠' },
      { id: 'saturn', name: 'Saturn', icon: '🪐' }, { id: 'uranus', name: 'Uranus', icon: '🔵' }, { id: 'neptune', name: 'Neptune', icon: '🔵' },
      { id: 'pluto', name: 'Pluto', icon: '🤍' } ] },
    { id: 'moons', items: [
      { id: 'moon', name: 'Moon', icon: '🌙' }, { id: 'io', name: 'Io', icon: '🌋' }, { id: 'europa', name: 'Europa', icon: '🧊' },
      { id: 'ganymede', name: 'Ganymede', icon: '⚪' }, { id: 'titan', name: 'Titan', icon: '🟤' }, { id: 'enceladus', name: 'Enceladus', icon: '❄️' } ] },
    { id: 'stars', items: [
      { id: 'sirius', name: 'Sirius', ly: 8.6 }, { id: 'proxima', name: 'Proxima Centauri', ly: 4.24 },
      { id: 'alphacen', name: 'Alpha Centauri', ly: 4.37 }, { id: 'betelgeuse', name: 'Betelgeuse', ly: 548 },
      { id: 'rigel', name: 'Rigel', ly: 863 }, { id: 'vega', name: 'Vega', ly: 25 }, { id: 'polaris', name: 'Polaris', ly: 433 },
      { id: 'arcturus', name: 'Arcturus', ly: 37 }, { id: 'antares', name: 'Antares', ly: 550 },
      { id: 'canopus', name: 'Canopus', ly: 310 }, { id: 'aldebaran', name: 'Aldebaran', ly: 65 } ] },
    { id: 'constellations', items: [
      { id: 'orion', name: 'Orion' }, { id: 'bigdipper', name: 'Ursa Major' }, { id: 'cassiopeia', name: 'Cassiopeia' },
      { id: 'scorpius', name: 'Scorpius' }, { id: 'cygnus', name: 'Cygnus' }, { id: 'leo', name: 'Leo' }, { id: 'crux', name: 'Crux' } ] },
    { id: 'wonders', items: [
      { id: 'iss', name: 'ISS', icon: '🛰️' }, { id: 'belt', name: 'Main Asteroid Belt', icon: '🪨' },
      { id: 'halley', name: 'Halley', icon: '☄️' }, { id: 'orionneb', name: 'Orion Nebula', icon: '🌌', ly: 1344 },
      { id: 'horsehead', name: 'Horsehead Nebula', icon: '🌌', ly: 1500 }, { id: 'ring', name: 'Ring Nebula', icon: '🌌', ly: 2300 },
      { id: 'trappist', name: 'TRAPPIST-1 e', icon: '🌎', ly: 40 }, { id: 'andromeda', name: 'Andromeda (M31)', icon: '🌀', ly: 2500000 },
      { id: 'sgra', name: 'Sagittarius A*', icon: '⚫', ly: 26000 } ] }
  ];
  GROUPS.forEach(g => g.items.forEach(it => {
    if (g.id === 'constellations') { it.kind = 'constellation'; it.icon = '✨'; }
    if (g.id === 'stars') it.icon = '⭐';
    // Planets and moons get size / temperature / day-length pills from SpaceData.
    it.stats = g.id === 'planets' || g.id === 'moons';
  }));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  function post(msg) {
    try { window.webkit?.messageHandlers?.iosHandler?.postMessage(msg); } catch (e) {}
  }
  function haptic(style) { post({ type: 'HAPTIC', style }); }

  // -------------------------------------------------------------- language
  const ALL = () => window.TOUR_TEXT || {};
  function pickLang() {
    const saved = store.get('tourLang', '');
    if (saved && ALL()[saved]) return saved;
    const nav = (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase());
    return nav.find(l => ALL()[l]) || 'en';
  }
  let LANG = pickLang();
  const L = () => ALL()[LANG] || ALL().en;
  const fill = (str, vars) => String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  const ui = (k, vars = {}) => fill((L().ui || {})[k] ?? ALL().en.ui[k], vars);
  const num = (v, digits) => {
    try { return new Intl.NumberFormat(LANG, { maximumFractionDigits: digits }).format(v); } catch (e) { return String(v); }
  };
  const lyText = (ly) => ui('ly', { v: num(ly, ly >= 100 ? 0 : 2) });
  function words(item) {
    const k = item.kind === 'constellation' ? 'constellations' : 'items';
    return (L()[k] || {})[item.id] || ALL().en[k][item.id] || [item.name, '', ''];
  }
  const nameOf = (item) => words(item)[0];
  function durationText(hours) {
    if (hours < 48) return num(hours, 1) + ' ' + ui('hours');
    const days = hours / 24;
    if (days < 700) return num(days, 1) + ' ' + ui('days');
    return num(days / 365.25, 1) + ' ' + ui('years');
  }
  function tempText(c) {
    return num(Math.round(c), 0) + '°C / ' + num(Math.round(c * 9 / 5 + 32), 0) + '°F';
  }

  // -------------------------------------------------------------- helpers
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function findFlyable(name) {
    try { return window.galaxyExplorer?.findFlyableByName?.(name) || null; } catch (e) { return null; }
  }
  function available(item) {
    if (item.kind === 'constellation') return !!window.constellations?.figure?.(item.name);
    return !!findFlyable(item.name);
  }

  // Everything a card shows (and says) for one stop.
  function cardFor(item, view) {
    const [name, a, b] = words(item);
    if (item.kind === 'constellation') {
      const f = window.constellations.figure(item.name);
      if (view === 'earth') {
        return { id: item.id + '-earth', title: name, kicker: ui('fromEarth'), pills: [[ui('stars'), num(f.stars.length, 0)]], fact: a };
      }
      const lys = f.stars.map(s => s.ly).sort((x, y) => x - y);
      const near = lyText(lys[0]), far = lyText(lys[lys.length - 1]);
      return {
        id: item.id + '-side', title: ui('side', { x: name }), kicker: ui('newAngle'),
        pills: [[ui('closest'), near], [ui('farthest'), far]],
        fact: ui('sideFact', { near, far, shape: b })
      };
    }
    const pills = [];
    const d = (item.stats && window.SpaceData && window.SpaceData.getData(item.name)) || {};
    if (d.radiusKm) pills.push([ui('size'), ui('xEarth', { v: num(d.radiusKm / 6371, d.radiusKm >= 6371 ? 1 : 2) })]);
    if (d.tempC != null) pills.push([item.id === 'sun' ? ui('surface') : ui('temp'), tempText(d.tempC)]);
    if (d.dayHours) pills.push([ui('day'), durationText(d.dayHours)]);
    if (item.ly) pills.push([ui('distance'), lyText(item.ly)]);
    return { id: item.id, title: name, kicker: a, pills: pills.slice(0, 3), fact: b };
  }

  // -------------------------------------------------------------- the builder
  class TourBuilder {
    constructor() {
      this.picks = [];          // [{ item, color }]
      this.running = false;
      this._injectStyles();
      this._buildPicker();
      this._buildTourUI();
    }

    // ---------------- picker
    open() {
      if (this.running) return;
      if (window.galaxyExplorer?.isScenicTourActive?.()) window.galaxyExplorer.stopScenicTour();
      this._renderPicker();
      this.picker.classList.add('show');
      this._chrome(true);
      haptic('light');
    }

    close() {
      this.picker.classList.remove('show');
      if (!this.running) this._chrome(false);
    }

    _toggle(item) {
      const i = this.picks.findIndex(p => p.item === item);
      if (i >= 0) this.picks.splice(i, 1);
      else this.picks.push({ item });
      // Colors follow tap order so stop 1 is always cyan, stop 2 pink...
      this.picks.forEach((p, n) => { p.color = COLORS[n % COLORS.length]; });
      haptic('light');
      this._renderPicker();
    }

    _renderPicker() {
      const body = this.picker.querySelector('.tb-list');
      body.innerHTML = '';
      GROUPS.forEach(g => {
        const items = g.items.filter(available);
        if (!items.length) return;
        const h = document.createElement('div');
        h.className = 'tb-group';
        h.textContent = (L().groups || {})[g.id] || ALL().en.groups[g.id];
        body.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'tb-chips';
        items.forEach(item => {
          const n = this.picks.findIndex(p => p.item === item);
          const b = document.createElement('button');
          b.className = 'tb-chip' + (n >= 0 ? ' on' : '');
          if (n >= 0) b.style.setProperty('--c', this.picks[n].color);
          b.innerHTML = (n >= 0 ? `<span class="tb-num">${n + 1}</span>` : `<span class="tb-ic">${item.icon || ''}</span>`) +
            `<span>${esc(nameOf(item))}</span>`;
          b.addEventListener('click', () => this._toggle(item));
          wrap.appendChild(b);
        });
        body.appendChild(wrap);
      });
      const n = this.picks.length;
      const go = this.picker.querySelector('.tb-go');
      go.disabled = n === 0;
      go.textContent = n === 0 ? ui('empty') : '▶  ' + (n === 1 ? ui('start1') : ui('startN', { n: num(n, 0) }));
      this.picker.querySelector('.tb-clear').style.display = n ? '' : 'none';
      this._applyLang();
    }

    // Static words + reading direction for the current language.
    _applyLang() {
      const set = (root, sel, txt) => { const el = root.querySelector(sel); if (el) el.textContent = txt; };
      set(this.picker, '.tb-h1', ui('title'));
      set(this.picker, '.tb-h2', ui('hint'));
      set(this.picker, '.tb-clear', ui('clear'));
      set(this.picker, '.tb-classic', ui('classic'));
      set(this.tour, '.tb-end span', ui('end'));
      set(this.tour, '.tb-done .tb-title', ui('done'));
      set(this.tour, '.tb-again', ui('again'));
      set(this.tour, '.tb-free', ui('free'));
      const dir = L().rtl ? 'rtl' : 'ltr';
      this.picker.setAttribute('dir', dir);
      this.card.setAttribute('dir', dir);
      this.done.setAttribute('dir', dir);
      this.flyLabel.setAttribute('dir', dir);
      const sel = this.picker.querySelector('.tb-lang');
      if (sel && !sel.options.length) {
        Object.entries(ALL()).forEach(([code, t]) => sel.add(new Option(t.label, code)));
      }
      if (sel) sel.value = LANG;
    }

    setLanguage(code) {
      if (!ALL()[code]) return;
      LANG = code;
      store.set('tourLang', code);
      this._renderPicker();
    }

    // ---------------- running a tour
    _stopsFor(pick, pickIndex) {
      const { item, color } = pick;
      const base = { pickIndex, color, item };
      if (item.kind !== 'constellation') {
        // Camera distance in body radii: ringed giants need room for the rings.
        const MULT = { Sun: 5.5, Saturn: 7, Jupiter: 4.5, Uranus: 5, Neptune: 4.5, ISS: 5 };
        const mult = /Belt|Nebula|Andromeda/.test(item.name) ? 2.2 : (MULT[item.name] || 3.6);
        if (item.id === 'belt') {
          // Look along the ring from just outside and above it, so the band of rocks curves
          // away across the screen (from straight on, it is nearly empty space).
          const THREE = window.THREE;
          const spotAt = () => findFlyable(item.name).mesh.getWorldPosition(new THREE.Vector3());
          const cameraAt = () => {
            const p = spotAt(), out = p.clone().setY(0).normalize();
            const tangent = new THREE.Vector3(-out.z, 0, out.x);
            return p.clone().add(out.multiplyScalar(48)).add(new THREE.Vector3(0, 20, 0)).add(tangent.multiplyScalar(-38));
          };
          return [Object.assign({ name: item.name, cameraAt, still: true }, base)];
        }
        return [Object.assign({ name: item.name, mult, sunSide: item.stats || item.id === 'iss' }, base)];
      }
      const THREE = window.THREE;
      const f = window.constellations.figure(item.name);
      const c = new THREE.Vector3();
      f.stars.forEach(s => c.add(s.pos));
      c.multiplyScalar(1 / f.stars.length);
      // Earth view: stand just off Earth and aim at the middle of the pattern AS SEEN FROM
      // EARTH (average direction, not the 3D centroid, which a far star drags sideways). If the
      // whole figure can't fit below the card, widen the view for this stop only (stop.fov).
      const pivot = new THREE.Object3D();
      const resolve = () => ({ name: item.name, mesh: pivot, radius: 1 });
      let earthCam = null, earthFov = null;
      const fromEarth = () => {
        if (earthCam) return earthCam;
        const e = findFlyable('Earth');
        const ep = e ? e.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
        const dir = new THREE.Vector3();
        f.stars.forEach(s => dir.add(s.pos.clone().sub(ep).normalize()));
        dir.normalize();
        const R = 1000;
        const real = window.galaxyExplorer.getCamera();
        const cam = real ? real.clone() : new THREE.PerspectiveCamera(68, 0.45, 0.01, 2e6);
        if (real) cam.aspect = real.aspect;
        cam.position.copy(ep).add(dir.clone().multiplyScalar(8));
        const v = new THREE.Vector3();
        for (let fov = cam.fov; fov <= 110; fov += 4) {
          cam.fov = fov; cam.updateProjectionMatrix();
          // lift the aim so the figure sits in the lower, uncovered part of the screen
          const up = new THREE.Vector3(0, 1, 0).projectOnPlane(dir).normalize();
          pivot.position.copy(cam.position).add(dir.clone().multiplyScalar(R))
            .add(up.multiplyScalar(R * Math.tan(fov * Math.PI / 360) * 0.25));
          cam.lookAt(pivot.position); cam.updateMatrixWorld(true);
          const fits = f.stars.every(s => { v.copy(s.pos).project(cam); return Math.abs(v.x) < 0.85 && v.y < 0.2 && v.y > -0.85; });
          earthFov = fov;
          if (fits) break;
        }
        earthCam = cam.position.clone();
        return earthCam;
      };
      // Side view: look across the line of sight from far enough out that the nearest and
      // farthest star both fit on screen, aimed at the middle of that depth range.
      const u = c.clone().normalize();
      const depths = f.stars.map(s => s.pos.dot(u));
      const dMin = Math.min(...depths), dMax = Math.max(...depths);
      const mid = c.clone().add(u.clone().multiplyScalar((dMin + dMax) / 2 - c.dot(u)));
      const sidePivot = new THREE.Object3D();
      sidePivot.position.copy(mid);
      let perp = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0));
      if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
      perp.normalize();
      // Back away until every star sits inside the lower, uncovered part of the screen
      // (the card covers the top), checked by projecting through a copy of the real camera.
      let sideCam = null;
      const fromSide = () => {
        if (sideCam) return sideCam;
        const real = window.galaxyExplorer.getCamera();
        const cam = real ? real.clone() : new THREE.PerspectiveCamera(68, 0.45, 0.01, 2e6);
        if (real) { cam.aspect = real.aspect; cam.updateProjectionMatrix(); }
        const v = new THREE.Vector3();
        let k = (dMax - dMin) * 0.6;
        for (let i = 0; i < 40; i++) {
          const lift = k * Math.tan(cam.fov * Math.PI / 360) * 0.25;   // aim above the figure so it sits low
          sidePivot.position.copy(mid).add(new THREE.Vector3(0, lift, 0));
          cam.position.copy(mid).add(perp.clone().multiplyScalar(k));
          cam.lookAt(sidePivot.position);
          cam.updateMatrixWorld(true);
          const fits = f.stars.every(s => { v.copy(s.pos).project(cam); return Math.abs(v.x) < 0.78 && v.y < 0.1 && v.y > -0.8; });
          if (fits) break;
          k *= 1.15;
        }
        sideCam = cam.position.clone();
        return sideCam;
      };
      return [
        Object.assign({ resolve, cameraAt: fromEarth, still: true, view: 'earth', fov: () => earthFov }, base),
        Object.assign({ resolve: () => ({ name: item.name, mesh: sidePivot, radius: 1 }), cameraAt: fromSide, still: true, view: 'side', flyMs: 7000 }, base)
      ];
    }

    start() {
      if (!this.picks.length) return;
      const stops = [];
      this.picks.forEach((p, i) => stops.push(...this._stopsFor(p, i)));
      this.running = true;
      this.picker.classList.remove('show');
      this._chrome(true);
      this.tour.classList.add('show');
      document.body.classList.add('tb-touring');
      this._renderDots(-1);
      this._flying(stops[0]);
      haptic('success');
      window.galaxyExplorer.startCustomTour({
        stops,
        onArrive: (stop) => this._arrive(stop),
        onLeave: (stop) => this._leave(stop),
        onEnd: (reason) => this._ended(reason),
        onFly: (stop) => this._flying(stop)
      });
      this._stops = stops;
      this._at = -1;
    }

    _flying(stop) {
      this._hideCard();
      this._waiting = false;
      if (!stop) return;
      this._renderDots(stop.pickIndex);
      const label = `<b style="color:${stop.color}">${esc(nameOf(stop.item))}</b>`;
      this.flyLabel.innerHTML = esc(ui(stop.view === 'side' ? 'sliding' : 'flying', { x: '\u0001' })).replace('\u0001', label);
      this.flyLabel.classList.add('show');
    }

    _arrive(stop) {
      this.flyLabel.classList.remove('show');
      this._at = this._stops.indexOf(stop);
      const total = this.picks.length;
      const last = this._at === this._stops.length - 1;
      if (stop.fov && stop.fov()) {
        const cam = window.galaxyExplorer.getCamera();
        if (cam && this._fov0 == null) this._fov0 = cam.fov;
        if (cam) { cam.fov = stop.fov(); cam.updateProjectionMatrix(); }
      }
      if (stop.view) {
        window.constellations.highlight(stop.item.name, stop.color);
        this._showStarLabels(window.constellations.figure(stop.item.name), stop.color);
      }
      const card = cardFor(stop.item, stop.view);
      this._showCard(card, stop, ui('stop', { i: num(stop.pickIndex + 1, 0), n: num(total, 0) }), last);
      this._waiting = true;
    }

    _restoreFov() {
      const cam = window.galaxyExplorer.getCamera();
      if (cam && this._fov0 != null) { cam.fov = this._fov0; cam.updateProjectionMatrix(); }
      this._fov0 = null;
    }

    _leave(stop) {
      this._restoreFov();
      this._hideCard();
      // The Earth view hands straight to the side view, so keep the lines lit between them.
      if (stop && stop.view === 'side') { window.constellations?.clearHighlight?.(); this._hideStarLabels(); }
    }

    // Name + real distance beside every star of the highlighted figure, as crisp page text
    // that follows the stars on screen (including during the slide out to the side).
    _showStarLabels(f, color) {
      this._hideStarLabels();
      const layer = this.labels;
      const els = f.stars.map(s => {
        const el = document.createElement('div');
        el.className = 'tb-star';
        el.innerHTML = `${esc(s.name)}<b style="color:${color}">${esc(lyText(s.ly))}</b>`;
        layer.appendChild(el);
        return { el, pos: s.pos };
      });
      const v = new window.THREE.Vector3();
      const tick = () => {
        const cam = window.galaxyExplorer.getCamera();
        if (cam) {
          const w = window.innerWidth, h = window.innerHeight;
          els.forEach(({ el, pos }) => {
            v.copy(pos).project(cam);
            const on = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
            el.style.display = on ? '' : 'none';
            if (on) el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, 10px)`;
          });
        }
        this._labelRaf = requestAnimationFrame(tick);
      };
      tick();
    }

    _hideStarLabels() {
      if (this._labelRaf) cancelAnimationFrame(this._labelRaf);
      this._labelRaf = 0;
      if (this.labels) this.labels.innerHTML = '';
    }

    _continue() {
      if (!this._waiting) return;
      this._waiting = false;
      haptic('light');
      const next = this._stops[this._at + 1];
      window.galaxyExplorer.skipScenicTour();
      if (next) this._flying(next);
    }

    end() {
      window.galaxyExplorer.stopScenicTour();
    }

    _ended(reason) {
      this._restoreFov();
      window.constellations?.clearHighlight?.();
      this._hideStarLabels();
      this._hideCard();
      this.flyLabel.classList.remove('show');
      this._waiting = false;
      if (reason === 'complete') {
        this.tour.classList.add('fin');
        this.done.classList.add('show');
        haptic('success');
        return;
      }
      this._finish();
    }

    _finish() {
      this.running = false;
      this.done.classList.remove('show');
      this.tour.classList.remove('show', 'fin');
      document.body.classList.remove('tb-touring');
      this._chrome(false);
    }

    // ---------------- tour UI
    _renderDots(active) {
      this.dots.innerHTML = this.picks.map((p, i) =>
        `<span class="tb-dot${i === active ? ' now' : ''}${i < active ? ' past' : ''}" style="--c:${p.color}"></span>`).join('');
    }

    _showCard(card, stop, count, last) {
      this.card.style.setProperty('--c', stop.color);
      this.card.innerHTML = `
        <div class="tb-count">${esc(count)}</div>
        <div class="tb-title">${esc(card.title)}</div>
        ${card.kicker ? `<div class="tb-kicker">${esc(card.kicker)}</div>` : ''}
        ${card.pills.length ? `<div class="tb-pills">${card.pills.map(([k, v]) => `<span><i>${esc(k)}</i>${esc(v)}</span>`).join('')}</div>` : ''}
        ${card.fact ? `<div class="tb-fact">${esc(card.fact)}</div>` : ''}
        <div class="tb-tap">${esc(last ? ui('finish') : ui('next'))}</div>`;
      this.card.classList.add('show');
    }

    _hideCard() { this.card.classList.remove('show'); }

    // Hide the native flight controls (and the scan/guide buttons) while the builder owns the screen.
    _chrome(hidden) {
      post({ type: 'CHROME', hidden: !!hidden });
      document.body.classList.toggle('cx-modal-open', !!hidden);
    }

    // ---------------- DOM
    _buildPicker() {
      const p = document.createElement('div');
      p.className = 'tb-picker';
      p.innerHTML = `
        <div class="tb-sheet">
          <div class="tb-head">
            <div><div class="tb-h1"></div><div class="tb-h2"></div></div>
            <label class="tb-langwrap">🌐<select class="tb-lang" aria-label="Language"></select></label>
            <button class="tb-x" aria-label="Close">✕</button>
          </div>
          <div class="tb-list"></div>
          <div class="tb-foot">
            <button class="tb-clear">Clear</button>
            <button class="tb-go"></button>
          </div>
          <button class="tb-classic">or watch the Grand Tour</button>
        </div>`;
      document.body.appendChild(p);
      p.querySelector('.tb-x').addEventListener('click', () => this.close());
      p.querySelector('.tb-lang').addEventListener('change', (e) => { this.setLanguage(e.target.value); haptic('light'); });
      p.querySelector('.tb-clear').addEventListener('click', () => { this.picks = []; this._renderPicker(); });
      p.querySelector('.tb-go').addEventListener('click', () => this.start());
      p.querySelector('.tb-classic').addEventListener('click', () => {
        this.close();
        window.galaxyExplorer?.startScenicTour?.();
      });
      // Tapping the dark area around the sheet closes it.
      p.addEventListener('click', (e) => { if (e.target === p) this.close(); });
      this.picker = p;
    }

    _buildTourUI() {
      const t = document.createElement('div');
      t.className = 'tb-tour';
      t.innerHTML = `
        <div class="tb-catch"></div>
        <div class="tb-labels"></div>
        <div class="tb-fly"></div>
        <div class="tb-card" role="button"></div>
        <div class="tb-bar">
          <div class="tb-dots"></div>
          <button class="tb-end">✕<span>End</span></button>
        </div>
        <div class="tb-done">
          <div class="tb-title">That was your tour!</div>
          <button class="tb-again">Make another tour</button>
          <button class="tb-free">Fly on my own</button>
        </div>`;
      document.body.appendChild(t);
      this.tour = t;
      this.card = t.querySelector('.tb-card');
      this.labels = t.querySelector('.tb-labels');
      this.flyLabel = t.querySelector('.tb-fly');
      this.dots = t.querySelector('.tb-dots');
      this.done = t.querySelector('.tb-done');
      // Tap the card, or anywhere on the sky, to move on.
      this.card.addEventListener('click', () => this._continue());
      t.querySelector('.tb-catch').addEventListener('click', () => this._continue());
      t.querySelector('.tb-end').addEventListener('click', () => { haptic('light'); this.end(); });
      t.querySelector('.tb-again').addEventListener('click', () => { this._finish(); this.picks = []; this.open(); });
      t.querySelector('.tb-free').addEventListener('click', () => this._finish());
      // Keep every tour touch away from the flight canvas underneath.
      t.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    _injectStyles() {
      const s = document.createElement('style');
      s.textContent = `
        .tb-picker, .tb-tour { font-family: -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        .tb-picker button, .tb-tour button { font: inherit; cursor: pointer; -webkit-user-select: none; user-select: none; }
        .tb-picker { position: fixed; inset: 0; z-index: 10060; background: rgba(0, 4, 12, 0.55);
          display: none; align-items: center; justify-content: center; }
        .tb-picker.show { display: flex; }
        .tb-sheet { width: min(640px, calc(100vw - 20px)); max-height: calc(100vh - 20px - var(--sai-top, 0px) - var(--sai-bottom, 0px));
          display: flex; flex-direction: column; border-radius: 20px; overflow: hidden;
          background: rgba(10, 18, 34, 0.94); border: 1px solid rgba(120, 180, 255, 0.3);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: #e8f2ff; }
        .tb-head { display: flex; gap: 12px; align-items: flex-start; padding: 16px 16px 8px; }
        .tb-head > div { flex: 1; }
        .tb-h1 { font-size: 22px; font-weight: 700; }
        .tb-h2 { font-size: 14px; color: #a9c3e6; margin-top: 3px; }
        .tb-langwrap { display: inline-flex; align-items: center; gap: 4px; height: 44px; padding: 0 6px 0 10px; border-radius: 22px;
          border: 1px solid rgba(120,180,255,.35); background: rgba(40,70,120,.4); font-size: 16px; flex: none; }
        .tb-lang { appearance: none; -webkit-appearance: none; background: transparent; border: none; color: #dceaff; font: inherit;
          font-size: 15px; font-weight: 600; max-width: 96px; padding: 0 4px; outline: none; }
        .tb-lang option { color: #04101f; }
        .tb-x { width: 44px; height: 44px; border-radius: 22px; border: 1px solid rgba(120,180,255,.35); background: rgba(40,70,120,.4); color: #dceaff; font-size: 18px; flex: none; }
        .tb-list { overflow-y: auto; padding: 0 16px 8px; -webkit-overflow-scrolling: touch;
          flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; }  /* min-height:0 or iOS Safari won't scroll a flex child */
        .tb-group { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #8fb3de; margin: 12px 0 8px; font-weight: 700; }
        .tb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .tb-chip { min-height: 44px; padding: 0 14px 0 10px; border-radius: 22px; display: inline-flex; align-items: center; gap: 8px;
          border: 1.5px solid rgba(140, 190, 255, .35); background: rgba(30, 50, 85, .55); color: #e8f2ff; font-size: 16px; }
        .tb-chip.on { background: var(--c); border-color: var(--c); color: #04101f; font-weight: 700; box-shadow: 0 0 14px var(--c); }
        .tb-ic { font-size: 17px; width: 24px; text-align: center; }
        .tb-num { width: 24px; height: 24px; border-radius: 12px; background: #04101f; color: var(--c); font-size: 14px; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center; }
        .tb-foot { display: flex; gap: 10px; padding: 12px 16px 4px; border-top: 1px solid rgba(120,180,255,.15); }
        .tb-go { flex: 1; min-height: 52px; border-radius: 26px; border: none; background: #4fd8ff; color: #04101f; font-size: 18px; font-weight: 800; }
        .tb-go:disabled { background: rgba(80, 110, 150, .35); color: #9bb4d4; font-weight: 600; font-size: 16px; }
        .tb-clear { min-height: 52px; padding: 0 18px; border-radius: 26px; border: 1px solid rgba(120,180,255,.35); background: transparent; color: #cfe0f5; font-size: 16px; }
        .tb-classic { background: none; border: none; color: #8fb3de; font-size: 14px; padding: 8px 0 14px; text-decoration: underline; }

        .tb-tour { position: fixed; inset: 0; z-index: 10050; display: none; }
        /* Steering hints make no sense while the autopilot flies. */
        body.tb-touring #nav-indicator, body.tb-touring .direction-prompt, body.tb-touring .target-bracket { display: none !important; }
        .tb-tour.show { display: block; }
        .tb-catch { position: absolute; inset: 0; }
        .tb-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .tb-star { position: absolute; left: 0; top: 0; white-space: nowrap; font-size: 12px; font-weight: 600; color: #e8f2ff;
          text-align: center; line-height: 1.2; text-shadow: 0 1px 4px #000, 0 0 2px #000; }
        .tb-star b { display: block; font-weight: 800; font-size: 11px; }
        .tb-fly { position: absolute; left: 50%; top: calc(var(--sai-top, 0px) + 14px); transform: translateX(-50%);
          padding: 10px 18px; border-radius: 22px; background: rgba(8, 14, 26, .7); color: #dceaff; font-size: 16px;
          white-space: nowrap; opacity: 0; transition: opacity .4s; pointer-events: none; }
        .tb-fly.show { opacity: 1; }
        .tb-card { position: absolute; left: 50%; top: calc(var(--sai-top, 0px) + 10px);
          width: min(560px, calc(100vw - 20px)); box-sizing: border-box; transform: translate(-50%, -130%);
          transition: transform .45s cubic-bezier(.2,.9,.25,1); padding: 14px 16px 12px; border-radius: 18px;
          background: rgba(8, 14, 28, .88); border: 1.5px solid var(--c); border-left-width: 6px;
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: #fff; max-height: 60vh; overflow-y: auto; }
        .tb-card.show { transform: translate(-50%, 0); }
        .tb-count { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--c); font-weight: 700; }
        .tb-title { font-size: 24px; font-weight: 800; margin-top: 2px; }
        .tb-kicker { font-size: 15px; color: #b9d0ee; margin-top: 2px; }
        .tb-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .tb-pills span { background: rgba(255,255,255,.08); border-radius: 10px; padding: 5px 9px; font-size: 14px; font-weight: 600; }
        .tb-pills i { font-style: normal; color: #9fbde2; font-weight: 500; margin-right: 6px; }
        .tb-fact { font-size: 16px; line-height: 1.4; margin-top: 10px; color: #e6efff; }
        .tb-tap { margin-top: 10px; font-size: 14px; font-weight: 700; color: var(--c); text-align: right; }
        .tb-bar { position: absolute; left: 50%; bottom: calc(var(--sai-bottom, 0px) + 14px); transform: translateX(-50%);
          display: flex; align-items: center; gap: 12px; padding: 6px; border-radius: 30px; background: rgba(8, 14, 26, .72);
          border: 1px solid rgba(120,180,255,.3); }
        .tb-bar button { min-height: 48px; padding: 0 16px; border-radius: 24px; border: 1px solid rgba(120,180,255,.4);
          background: rgba(40,70,120,.5); color: #e8f2ff; font-size: 20px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
        .tb-bar button span { font-size: 15px; font-weight: 700; }
        .tb-dots { display: flex; gap: 6px; }
        .tb-dot { width: 10px; height: 10px; border-radius: 5px; background: var(--c); opacity: .35; }
        .tb-dot.past { opacity: .7; }
        .tb-dot.now { opacity: 1; box-shadow: 0 0 8px var(--c); transform: scale(1.3); }
        .tb-done { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; flex-direction: column; gap: 12px;
          width: min(360px, calc(100vw - 40px)); padding: 22px; border-radius: 20px; text-align: center; color: #fff;
          background: rgba(8, 14, 28, .92); border: 1px solid rgba(120,180,255,.35); }
        .tb-done.show { display: flex; }
        .tb-tour.fin .tb-bar { display: none; }
        .tb-done button { min-height: 52px; border-radius: 26px; border: none; font-size: 17px; font-weight: 800; background: #4fd8ff; color: #04101f; }
        .tb-done .tb-free { background: transparent; color: #dceaff; border: 1px solid rgba(120,180,255,.4); }
      `;
      document.head.appendChild(s);
    }
  }

  function boot() {
    if (window.tourBuilder) return;
    try { window.tourBuilder = new TourBuilder(); } catch (e) { console.error('TourBuilder boot failed', e); }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
