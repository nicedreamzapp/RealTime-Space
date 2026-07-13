// ExoSystems.js — a planetary system for EVERY real star (the "explore forever" layer).
//
// NASA's Kepler mission established that planets outnumber stars in our galaxy:
// most stars host at least one. This layer gives each of the ~8,920 real catalog
// stars a DETERMINISTIC system generated from those occurrence statistics —
// seeded by the star's identity, so Vega always has the same worlds, for every
// player, forever. Planets use the bundled exo surface textures, orbit their sun,
// and are named by real convention (star name + b, c, d…). Scannable; the Field
// Guide entry says plainly that these are statistically predicted worlds, not
// directly observed ones — honesty first.
//
// Systems only exist while you're AT their star (spawned/despawned around
// StarProximity's active star) — cost stays constant no matter how many stars.

(function () {
  'use strict';

  const TYPES = [
    // [texture, class label, weight closer→farther bias handled below]
    ['exo_lava.jpg',       'Lava world'],
    ['exo_rocky.jpg',      'Rocky world'],
    ['exo_desert.jpg',     'Desert world'],
    ['exo_ocean.jpg',      'Ocean world'],
    ['exo_jungle.jpg',     'Jungle world'],
    ['exo_ice.jpg',        'Ice world'],
    ['exo_gas_blue.jpg',   'Gas giant'],
    ['exo_gas_violet.jpg', 'Gas giant']
  ];
  const LETTERS = ['b', 'c', 'd', 'e', 'f', 'g'];

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  class ExoSystems {
    constructor(THREE, rc, sp) {
      this.THREE = THREE; this.rc = rc; this.sp = sp;
      this.group = null;
      this.forStar = -1;
      this.planets = [];
      this.uniEntries = [];
      this.texCache = {};
      this._accum = 0;
      const tick = (t) => { this._update(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }

    _tex(file) {
      if (!this.texCache[file]) {
        const t = new this.THREE.TextureLoader().load('codex/cosmos/' + file);
        if (this.THREE.SRGBColorSpace !== undefined) t.colorSpace = this.THREE.SRGBColorSpace;
        this.texCache[file] = t;
      }
      return this.texCache[file];
    }

    _despawn() {
      if (!this.group) return;
      this.rc.scene.remove(this.group);
      this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.map) o.material.dispose(); });
      // pull our entries back out of the scan registry
      if (window.__universe && this.uniEntries.length) {
        window.__universe = window.__universe.filter(e => !this.uniEntries.includes(e));
      }
      this.group = null; this.planets = []; this.uniEntries = [];
    }

    _spawn(starIdx) {
      const entry = this.sp.stars[starIdx];
      if (!entry) return;
      const starName = entry[5] || ('Star ' + starIdx);
      const ly = entry[4];
      const rand = mulberry32(hash(starName));

      // Kepler-informed occurrence: ~72% of stars get planets, 1–5 of them
      if (rand() > 0.72) { this.forStar = starIdx; return; }
      const count = 1 + Math.floor(rand() * rand() * 5);

      const THREE = this.THREE;
      const center = this.sp.mesh.position.clone();
      const starR = this.sp.mesh.scale.x || 3;
      this.group = new THREE.Group();
      this.group.position.copy(center);
      // random but deterministic system tilt
      this.group.rotation.set((rand() - 0.5) * 0.9, rand() * 6.283, (rand() - 0.5) * 0.4);

      for (let i = 0; i < count; i++) {
        const orbit = starR * (3.2 + i * (2.2 + rand() * 1.6));
        // type by distance: hot inner worlds → temperate → ice/gas outer
        const zone = i / Math.max(1, count - 1);
        let ti;
        if (zone < 0.25) ti = rand() < 0.6 ? 0 : 1;
        else if (zone < 0.55) ti = 1 + Math.floor(rand() * 4);
        else ti = 4 + Math.floor(rand() * 4);
        const [tex, klass] = TYPES[Math.min(ti, TYPES.length - 1)];
        const isGas = klass === 'Gas giant';
        const radius = (isGas ? 0.9 + rand() * 1.1 : 0.35 + rand() * 0.55) * Math.max(1, starR * 0.28);

        const m = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 28, 28),
          new THREE.MeshBasicMaterial({ map: this._tex(tex) })
        );
        const ang = rand() * 6.283;
        m.position.set(Math.cos(ang) * orbit, 0, Math.sin(ang) * orbit);
        m.userData = { orbit, ang, speed: 0.05 / Math.sqrt(orbit / starR), spin: 0.1 + rand() * 0.3 };
        this.group.add(m);

        // faint orbit ring so the system reads at a glance
        const ringPts = [];
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * 6.283;
          ringPts.push(new THREE.Vector3(Math.cos(a) * orbit, 0, Math.sin(a) * orbit));
        }
        const ring = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(ringPts),
          new THREE.LineBasicMaterial({ color: 0x3a5a7a, transparent: true, opacity: 0.25 })
        );
        this.group.add(ring);
        this.planets.push(m);

        // identity + scan registration (honest provenance in the fact text)
        const pname = starName + ' ' + (LETTERS[i] || ('p' + (i + 1)));
        try {
          if (window.SpaceData && !window.SpaceData.has(pname)) {
            window.SpaceData.register(pname, {
              class: klass, distanceLabel: ly > 0 ? ly + ' light-years (system)' : 'deep sky system',
              composition: isGas
                ? [{ label: 'Hydrogen', pct: 84 }, { label: 'Helium', pct: 14 }, { label: 'Ices/metals', pct: 2 }]
                : [{ label: 'Silicate rock', pct: 62 }, { label: 'Iron core', pct: 30 }, { label: 'Volatiles', pct: 8 }],
              fact: pname + ' is a statistically predicted world of ' + starName +
                ' — no planet has been directly observed here yet, but NASA\'s Kepler ' +
                'mission showed most stars host planets. Same star, same worlds, every visit.',
              discovered: 'Predicted (Kepler statistics)', color: '#8fd8ff', moons: 0, icon: '🪐',
              radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
            });
          }
          const ue = { name: pname, mesh: m, radius: Math.max(30, radius * 18) };
          window.__universe = window.__universe || [];
          window.__universe.push(ue);
          this.uniEntries.push(ue);
        } catch (e) {}
      }

      this.rc.scene.add(this.group);
      this.forStar = starIdx;
      console.log('🪐 system spawned at', starName + ':', count, 'worlds');
    }

    _update() {
      // follow StarProximity's active star
      const idx = this.sp.activeIndex;
      if (idx !== this.forStar) {
        this._despawn();
        if (idx >= 0) this._spawn(idx); else this.forStar = -1;
      }
      // orbit + spin
      if (this.group) {
        for (const p of this.planets) {
          p.userData.ang += p.userData.speed * 0.016;
          p.position.set(Math.cos(p.userData.ang) * p.userData.orbit, 0, Math.sin(p.userData.ang) * p.userData.orbit);
          p.rotation.y += p.userData.spin * 0.016;
        }
      }
    }
  }

  const boot = setInterval(() => {
    let rc = null;
    try { rc = (typeof rendererCore !== 'undefined') ? rendererCore : null; } catch (e) {}
    const sp = window.starProximity;
    if (!rc || !rc.scene || !sp || !window.THREE) return;
    clearInterval(boot);
    try {
      window.exoSystems = new ExoSystems(window.THREE, rc, sp);
      console.log('🪐 ExoSystems ready — every real star can host predicted worlds');
    } catch (e) {
      console.warn('ExoSystems init failed:', e);
    }
  }, 700);
})();
