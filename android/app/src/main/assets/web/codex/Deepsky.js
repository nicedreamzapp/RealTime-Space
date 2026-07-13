// Deepsky.js — famous nebulae and globular star clusters at their true sky positions.
// Nebulae are AI-skinned glowing billboards; clusters are dense procedural star-balls.
// All scannable (register into SpaceData + the __universe fly registry). Additive & safe.

(function () {
  'use strict';

  // Nebulae: [name, RA h, Dec deg, dist ly, AI texture key, fact]
  const NEBULAE = [
    ['Eagle Nebula', 18.313, -13.79, 7000, 'neb_eagle', 'Home of the "Pillars of Creation" — towering columns of gas and dust where new stars are being born.'],
    ['Crab Nebula', 5.575, 22.01, 6500, 'neb_crab', 'The wreckage of a supernova that Chinese astronomers recorded in 1054 AD — still expanding at 1,500 km/s.'],
    ['Ring Nebula', 18.893, 33.03, 2300, 'neb_ring', 'A dying sun-like star that puffed its outer layers into a glowing ring — a preview of our Sun\'s fate.'],
    ['Helix Nebula', 22.494, -20.84, 650, 'neb_helix', 'The "Eye of God": one of the closest planetary nebulae, a dying star\'s glowing shroud.'],
    ['Lagoon Nebula', 18.061, -24.38, 4100, 'neb_lagoon', 'A giant stellar nursery of glowing pink hydrogen, faintly visible to the naked eye in Sagittarius.'],
    ['Trifid Nebula', 18.045, -23.03, 5200, 'neb_lagoon', 'A striking mix of red emission and blue reflection nebula, split into three by dark dust lanes.']
  ];
  // Globular clusters: [name, RA h, Dec deg, dist ly, fact]
  const CLUSTERS = [
    ['Hercules Cluster (M13)', 16.695, 36.46, 22200, 'A swarm of several hundred thousand stars ~11.6 billion years old — among the oldest objects in the galaxy.'],
    ['Omega Centauri', 13.446, -47.48, 17000, 'The largest globular cluster in the Milky Way — about 10 million stars, perhaps the core of a swallowed dwarf galaxy.'],
    ['47 Tucanae', 0.401, -72.08, 13000, 'The second-brightest globular cluster, a dazzling ball of millions of ancient stars.']
  ];

  function gameRadius(ly) { return Math.sqrt(ly) * 150; } // matches the star depth scale
  function gaussB() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.7; }
  function dir(raH, decDeg) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
  }

  class Deepsky {
    constructor() { this._tries = 0; this._attach(); }
    _attach() {
      const THREE = window.THREE;
      const cat = window.celestialCatalog || (window.explorationTracker && window.explorationTracker.catalog);
      const earth = cat && cat.getByName('Earth');
      if (!THREE || !earth || !earth.mesh) {
        if (this._tries++ < 45) return void setTimeout(() => this._attach(), 500);
        return;
      }
      let scene = earth.mesh; while (scene.parent) scene = scene.parent;
      this.group = new THREE.Group();
      this._glow = this._glowTex(THREE);
      NEBULAE.forEach(o => this._addNebula(THREE, o));
      CLUSTERS.forEach(o => this._addCluster(THREE, o));
      scene.add(this.group);
      window.__universe = window.__universe || [];
      console.log('☁️ Deep-sky layer:', NEBULAE.length, 'nebulae +', CLUSTERS.length, 'clusters');
    }

    _addNebula(THREE, [name, raH, decDeg, ly, surf, fact]) {
      const [dx, dy, dz] = dir(raH, decDeg);
      const r = gameRadius(ly);
      const c = new THREE.Vector3(dx * r, dy * r, dz * r);
      // Two-tone glowing gas, by nebula. Built as a 3D cloud of points — fly through it.
      const PAL = {
        neb_eagle: [[1.0, 0.55, 0.75], [0.95, 0.8, 0.4]], neb_crab: [[1.0, 0.6, 0.35], [0.4, 0.7, 1.0]],
        neb_ring: [[0.4, 0.95, 0.85], [1.0, 0.45, 0.8]], neb_helix: [[0.35, 0.85, 0.95], [1.0, 0.45, 0.45]],
        neb_lagoon: [[1.0, 0.5, 0.7], [0.6, 0.4, 0.9]]
      };
      const pal = PAL[surf] || [[1.0, 0.5, 0.72], [0.5, 0.6, 1.0]];
      const R = 95, N = 2400;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      // a few blobby lobes so it isn't a uniform ball
      const lobes = [];
      for (let k = 0; k < 4; k++) lobes.push([gaussB() * R * 0.6, gaussB() * R * 0.6, gaussB() * R * 0.6]);
      for (let i = 0; i < N; i++) {
        const L = lobes[Math.floor(Math.random() * lobes.length)];
        pos[i * 3] = L[0] + gaussB() * R * 0.5;       // relative — mesh carries the center
        pos[i * 3 + 1] = L[1] + gaussB() * R * 0.5;
        pos[i * 3 + 2] = L[2] + gaussB() * R * 0.5;
        const mix = Math.random(), base = mix < 0.65 ? pal[0] : pal[1];
        const b = 0.55 + Math.random() * 0.45;
        col[i * 3] = base[0] * b; col[i * 3 + 1] = base[1] * b; col[i * 3 + 2] = base[2] * b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: 13, sizeAttenuation: true, vertexColors: true, map: this._glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
      const pts = new THREE.Points(g, m);
      pts.position.copy(c); // mesh at nebula center → correct fly-to & scan
      this.group.add(pts);
      this._label(THREE, name, ly + ' ly', c, 0xff9ec4);
      this._register(name, 'Nebula', ly + ' light-years',
        [{ label: 'Hydrogen gas', pct: 90 }, { label: 'Helium', pct: 9 }, { label: 'Dust', pct: 1 }], fact, '#ff7eb0', '☁️');
      window.__universe = window.__universe || []; window.__universe.push({ name, mesh: pts, radius: R });
    }

    _addCluster(THREE, [name, raH, decDeg, ly, fact]) {
      const [dx, dy, dz] = dir(raH, decDeg);
      const r = gameRadius(ly);
      const center = new THREE.Vector3(dx * r, dy * r, dz * r);
      // procedural ball of stars
      const N = 400, p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const u = Math.random(), v = Math.random(), rr = 55 * Math.cbrt(Math.random());
        const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
        p[i * 3] = rr * Math.sin(ph) * Math.cos(th);       // relative — mesh carries the center
        p[i * 3 + 1] = rr * Math.sin(ph) * Math.sin(th);
        p[i * 3 + 2] = rr * Math.cos(ph);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.PointsMaterial({ color: 0xfff0d8, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, map: this._glow });
      const pts = new THREE.Points(g, m);
      pts.position.copy(center); // mesh at cluster center → correct fly-to & scan
      this.group.add(pts);
      this._label(THREE, name, ly + ' ly', center, 0xffd98a);
      this._register(name, 'Globular star cluster', ly + ' light-years',
        [{ label: 'Ancient stars', pct: 100 }], fact, '#ffe0a0', '✨');
      window.__universe = window.__universe || []; window.__universe.push({ name, mesh: pts, radius: 90 });
    }

    _register(name, cls, distLabel, comp, fact, color, icon) {
      if (window.SpaceData) window.SpaceData.register(name, {
        class: cls, distanceLabel: distLabel, composition: comp, fact: fact,
        discovered: 'Catalogued', color: color, icon: icon, moons: null,
        radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
      });
    }

    _glowTex(THREE) {
      const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
    }
    _label(THREE, name, sub, pos, color) {
      const c = document.createElement('canvas'); c.width = 340; c.height = 76; const g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 25px -apple-system, sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(name, 171, 25);
      g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillText(name, 170, 24);
      g.font = '400 17px -apple-system'; g.fillStyle = 'rgba(220,220,255,0.8)'; g.fillText(sub, 170, 54);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, sizeAttenuation: false }));
      lab.scale.set(0.19, 0.043, 1); lab.center.set(0.5, -1.0); lab.position.copy(pos);
      this.group.add(lab);
    }
  }

  function boot() { if (!window.deepsky) { try { window.deepsky = new Deepsky(); } catch (e) { console.error('Deepsky boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 2000);
  else window.addEventListener('load', () => setTimeout(boot, 2000));
})();
