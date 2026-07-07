// Constellations.js — TRUE 3D constellations. Every star sits at its REAL distance from
// Earth, and the figure lines run through actual 3D space. So a constellation only "reads"
// as its familiar shape from near Earth (the origin) — fly out among the stars and it
// visibly distorts and falls apart, because the stars are really light-years apart in depth.
// Fixed in the world (NOT pasted to the camera). Bright stars are labelled & scannable.
//
// Star: [name, RA hours, Dec deg, magnitude, distance light-years].

(function () {
  'use strict';

  const FIGURES = [
    { name: 'Orion', stars: [
        ['Betelgeuse', 5.919, 7.41, 0.4, 548], ['Bellatrix', 5.418, 6.35, 1.6, 250],
        ['Mintaka', 5.533, -0.30, 2.2, 1200], ['Alnilam', 5.604, -1.20, 1.7, 2000], ['Alnitak', 5.679, -1.94, 1.7, 1260],
        ['Saiph', 5.796, -9.67, 2.1, 650], ['Rigel', 5.242, -8.20, 0.1, 863] ],
      lines: [[0,1],[1,2],[0,4],[2,3],[3,4],[4,5],[6,2],[6,5],[1,6]] },
    { name: 'Ursa Major', stars: [
        ['Dubhe', 11.062, 61.75, 1.8, 124], ['Merak', 11.031, 56.38, 2.4, 79], ['Phecda', 11.897, 53.69, 2.4, 84],
        ['Megrez', 12.257, 57.03, 3.3, 58], ['Alioth', 12.900, 55.96, 1.8, 81], ['Mizar', 13.399, 54.93, 2.2, 83],
        ['Alkaid', 13.792, 49.31, 1.9, 104] ],
      lines: [[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6]] },
    { name: 'Cassiopeia', stars: [
        ['Caph', 0.153, 59.15, 2.3, 54], ['Schedar', 0.675, 56.54, 2.2, 228], ['Gamma Cas', 0.945, 60.72, 2.5, 550],
        ['Ruchbah', 1.430, 60.24, 2.7, 99], ['Segin', 1.906, 63.67, 3.4, 410] ],
      lines: [[0,1],[1,2],[2,3],[3,4]] },
    { name: 'Cygnus', stars: [
        ['Deneb', 20.690, 45.28, 1.3, 1425], ['Sadr', 20.370, 40.26, 2.2, 1500], ['Gienah', 20.770, 33.97, 2.5, 72],
        ['Delta Cyg', 19.749, 45.13, 2.9, 165], ['Albireo', 19.512, 27.96, 3.1, 430] ],
      lines: [[0,1],[1,4],[3,1],[1,2]] },
    { name: 'Scorpius', stars: [
        ['Antares', 16.490, -26.43, 1.1, 550], ['Dschubba', 16.005, -22.62, 2.3, 400], ['Pi Sco', 15.980, -26.11, 2.9, 590],
        ['Shaula', 17.560, -37.10, 1.6, 570], ['Sargas', 17.622, -42.99, 1.9, 270], ['Epsilon Sco', 16.864, -38.05, 2.3, 65] ],
      lines: [[1,0],[2,0],[0,5],[5,4],[4,3]] },
    { name: 'Leo', stars: [
        ['Regulus', 10.139, 11.97, 1.4, 79], ['Algieba', 10.333, 19.84, 2.0, 130], ['Zosma', 11.235, 20.52, 2.6, 58],
        ['Denebola', 11.818, 14.57, 2.1, 36], ['Eta Leo', 10.122, 16.76, 3.5, 1270] ],
      lines: [[0,1],[1,2],[2,3],[3,0],[1,4],[4,0]] },
    { name: 'Crux', stars: [
        ['Acrux', 12.443, -63.10, 0.8, 320], ['Mimosa', 12.795, -59.69, 1.3, 280], ['Gacrux', 12.519, -57.11, 1.6, 88],
        ['Delta Cru', 12.253, -58.75, 2.8, 345] ],
      lines: [[0,2],[1,3]] },
    { name: 'Gemini', stars: [ ['Castor', 7.577, 31.89, 1.6, 51], ['Pollux', 7.755, 28.03, 1.2, 34] ], lines: [[0,1]] },
    { name: 'Taurus', stars: [ ['Aldebaran', 4.599, 16.51, 0.9, 65], ['Elnath', 5.438, 28.61, 1.7, 134] ], lines: [[0,1]] }
  ];

  // Bright solo stars (real anchors, no figure) — the famous naked-eye stars, each a real
  // reachable destination at its true (compressed) distance.
  const SOLO = [
    ['Sirius', 6.752, -16.72, -1.5, 8.6], ['Vega', 18.616, 38.78, 0.0, 25], ['Arcturus', 14.261, 19.18, 0.0, 37],
    ['Capella', 5.278, 45.99, 0.1, 43], ['Procyon', 7.655, 5.22, 0.4, 11.5], ['Spica', 13.420, -11.16, 1.0, 250],
    ['Altair', 19.846, 8.87, 0.8, 16.7], ['Fomalhaut', 22.961, -29.62, 1.2, 25], ['Polaris', 2.530, 89.26, 2.0, 433],
    ['Antares', 16.490, -26.43, 1.1, 550], ['Pollux', 7.755, 28.03, 1.1, 34], ['Deneb', 20.690, 45.28, 1.25, 2615],
    ['Regulus', 10.140, 11.97, 1.35, 79], ['Canopus', 6.399, -52.70, -0.6, 310], ['Achernar', 1.629, -57.24, 0.5, 139],
    ['Castor', 7.577, 31.89, 1.6, 51], ['Adhara', 6.977, -28.97, 1.5, 430]
  ];

  // Real distance → game units (sqrt keeps the huge range playable while preserving the
  // RELATIVE depths that make the figure distort).
  const D = (ly) => Math.sqrt(ly) * 150;
  function pos3(THREE, raH, decDeg, ly) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180, r = D(ly);
    return new THREE.Vector3(Math.cos(dec) * Math.cos(ra) * r, Math.sin(dec) * r, -Math.cos(dec) * Math.sin(ra) * r);
  }

  class Constellations {
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
      this.group = new THREE.Group();      // FIXED in the world — real 3D, no camera follow
      this._glow = this._glowTex(THREE);
      this._dot = (THREE.SRGBColorSpace !== undefined);

      const all = [];
      FIGURES.forEach(f => { f._pos = f.stars.map(s => { const p = pos3(THREE, s[1], s[2], s[4]); this._star(THREE, s, p); all.push([s, p]); return p; }); });
      SOLO.forEach(s => { const p = pos3(THREE, s[1], s[2], s[4]); this._star(THREE, s, p); all.push([s, p]); });
      this._lines(THREE);
      scene.add(this.group);
      window.__universe = window.__universe || [];
      console.log('✨ True-3D constellations placed — they distort as you fly');
    }

    _star(THREE, s, p) {
      const [name, ra, dec, mag, ly] = s;
      // Small faint marker only — the star ITSELF is the true-color HYG point at
      // this same position (same distance scale), so a big white ball here was a
      // fake-looking duplicate sitting on top of the real star.
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glow, color: 0xeaf2ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false }));
      glow.scale.setScalar(Math.max(0.008, 0.016 - mag * 0.002));
      glow.position.copy(p);
      this.group.add(glow);
      // label for the brightest
      if (mag < 1.6) {
        const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._labelTex(THREE, name), transparent: true, depthWrite: false, sizeAttenuation: false }));
        lab.scale.set(0.11, 0.028, 1); lab.center.set(0.5, -0.7); lab.position.copy(p);
        this.group.add(lab);
      }
      // register for scan + fly-to + Field Guide
      if (window.SpaceData && window.SpaceData.register) window.SpaceData.register(name, {
        class: 'Star · ' + (ly < 50 ? 'nearby' : ly < 500 ? 'bright giant' : 'distant supergiant'),
        distanceLabel: ly + ' light-years',
        composition: [{ label: 'Hydrogen', pct: 73 }, { label: 'Helium', pct: 25 }, { label: 'Heavier elements', pct: 2 }],
        fact: name + ' shines from ' + ly + ' light-years away. From Earth it traces part of a familiar constellation — but fly out and the pattern falls apart, because its stars lie at wildly different real distances.',
        discovered: 'Catalogued', color: '#cfe0ff', icon: '⭐', moons: 0,
        radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
      });
      window.__universe = window.__universe || [];
      window.__universe.push({ name, mesh: glow, radius: 35 });
    }

    _lines(THREE) {
      const verts = [];
      FIGURES.forEach(f => f.lines.forEach(([a, b]) => {
        const pa = f._pos[a], pb = f._pos[b];
        verts.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      }));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const m = new THREE.LineBasicMaterial({ color: 0x4a86c8, transparent: true, opacity: 0.28, depthWrite: false });
      this.group.add(new THREE.LineSegments(g, m));
    }

    _glowTex(THREE) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(220,235,255,0.7)'); grd.addColorStop(1, 'rgba(180,210,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    }
    _labelTex(THREE, name) {
      // 3x canvas for CRISP text (sprite scale unchanged)
      const c = document.createElement('canvas'); c.width = 768; c.height = 192; const g = c.getContext('2d');
      g.font = '600 84px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(name, 387, 99); g.fillStyle = '#dfeaff'; g.fillText(name, 384, 96);
      const t = new THREE.CanvasTexture(c);
      t.anisotropy = 4;
      return t;
    }
  }

  function boot() { if (!window.constellations) { try { window.constellations = new Constellations(); } catch (e) { console.error('Constellations boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1750);
  else window.addEventListener('load', () => setTimeout(boot, 1750));
})();
