// Interstellar.js — the first step beyond the solar system. Renders the real nearest &
// most famous stars in their TRUE sky directions (J2000 RA/Dec) at their TRUE relative
// distances (compressed to a playable scale), as colored glowing markers you can warp
// out to and find. Purely additive: it adds its own objects to the scene and does NOT
// touch the catalog, Space Map, or any v1.0 system — so the shippable build is untouched.
//
// Star: [name, RA hours, Dec deg, distance light-years, spectral class, color hex].

(function () {
  'use strict';

  // Just our nearest stellar NEIGHBORS — the famous bright stars now live in the (true-3D)
  // constellation layer, so there are no duplicates.
  const STARS = [
    ['Proxima Centauri', 14.495, -62.68, 4.24, 'Red dwarf', 0xff7755],
    ['Alpha Centauri', 14.660, -60.83, 4.37, 'Sun-like (G2)', 0xfff0c0],
    ["Barnard's Star", 17.963, 4.69, 5.96, 'Red dwarf', 0xff8866],
    ['Wolf 359', 10.940, 7.01, 7.86, 'Red dwarf', 0xff7a55],
    ['Luyten 726-8', 1.639, -17.95, 8.73, 'Red dwarf', 0xff7a55],
    ['Ross 154', 18.832, -23.84, 9.69, 'Red dwarf', 0xff8866],
    ['Epsilon Eridani', 3.548, -9.46, 10.50, 'Orange (K2)', 0xffcc88],
    ['61 Cygni', 21.068, 38.75, 11.40, 'Orange (K5)', 0xffc070],
    ['Tau Ceti', 1.734, -15.94, 11.90, 'Sun-like (G8)', 0xfff0c0]
  ];

  const STAR_COMP = [{ label: 'Hydrogen', pct: 73 }, { label: 'Helium', pct: 25 }, { label: 'Heavier elements', pct: 2 }];
  const FAMOUS = {
    'Proxima Centauri': 'The closest star to the Sun, 4.24 light-years away — a tiny red dwarf with at least two planets, one in its habitable zone.',
    'Alpha Centauri': 'The closest sun-like star system to Earth. To the naked eye it looks like one bright star, but it\'s actually three.',
    'Sirius': 'The brightest star in Earth\'s night sky — twice the Sun\'s mass, with a white-dwarf companion called the "Pup".',
    'Betelgeuse': 'A red supergiant ~700× the Sun\'s width. It\'s near the end of its life and will one day explode as a supernova bright enough to see by day.',
    'Rigel': 'A blue supergiant pouring out 120,000 times the Sun\'s light from Orion\'s foot.',
    'Vega': 'Once the northern pole star and a standard for measuring stellar brightness — surrounded by a disk of dust.',
    'Polaris': 'The current North Star — a yellow supergiant that sits almost exactly above Earth\'s north pole.',
    'Antares': 'The red heart of Scorpius, a supergiant so vast it would swallow Mars\' orbit if placed at the Sun.',
    'Arcturus': 'An ancient orange giant racing through the galaxy, the brightest star in the northern celestial hemisphere.',
    'Procyon': 'One of our nearest neighbors and, with Sirius and Betelgeuse, a corner of the Winter Triangle.'
  };

  // Compress real light-years to a reachable game radius. Solar system ends ~550 units;
  // start interstellar space at ~1500 and spread by sqrt(distance), capped so nothing
  // sits past a safe render distance.
  function gameRadius(ly) { return Math.sqrt(ly) * 150; } // true relative depth (matches constellations)

  function dir(raH, decDeg) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
  }

  class Interstellar {
    constructor() { this._tries = 0; this._attach(); }

    _attach() {
      const THREE = window.THREE;
      const cat = window.celestialCatalog || (window.explorationTracker && window.explorationTracker.catalog);
      const earth = cat && cat.getByName('Earth');
      if (!THREE || !earth || !earth.mesh) {
        if (this._tries++ < 40) return void setTimeout(() => this._attach(), 500);
        return;
      }
      let scene = earth.mesh; while (scene.parent) scene = scene.parent;
      this.scene = scene;
      this.group = new THREE.Group();
      this._glow = this._glowTexture(THREE);
      STARS.forEach(s => this._addStar(THREE, s));
      scene.add(this.group);
      console.log('🌌 Interstellar layer:', STARS.length, 'real stars placed');
    }

    _addStar(THREE, [name, raH, decDeg, ly, cls, color]) {
      const [dx, dy, dz] = dir(raH, decDeg);
      const r = gameRadius(ly);
      const pos = new THREE.Vector3(dx * r, dy * r, dz * r);

      // glowing star sprite (constant screen size so it reads at any range)
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glow, color: color, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false
      }));
      glow.scale.setScalar(0.06);
      glow.position.copy(pos);
      this.group.add(glow);

      // bright core
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glow, color: 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false
      }));
      core.scale.setScalar(0.018);
      core.position.copy(pos);
      this.group.add(core);

      // label (real name + distance)
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._labelTexture(THREE, name, ly + ' ly · ' + cls),
        transparent: true, depthWrite: false, depthTest: true, sizeAttenuation: false
      }));
      label.scale.set(0.16, 0.04, 1);
      label.center.set(0.5, -0.6);
      label.position.copy(pos);
      this.group.add(label);

      // register for discovery cards (Field Guide) + scan + fly-to
      const hex = '#' + color.toString(16).padStart(6, '0');
      if (window.SpaceData) window.SpaceData.register(name, {
        class: cls + ' · star', distanceLabel: ly + ' light-years',
        composition: STAR_COMP, fact: FAMOUS[name] || (name + ' is a ' + cls.toLowerCase() + ' about ' + ly + ' light-years from Earth — one of our stellar neighbors.'),
        discovered: 'Catalogued', color: hex, moons: 0, icon: '⭐',
        radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
      });
      window.__universe = window.__universe || [];
      window.__universe.push({ name, mesh: glow, radius: 45 });
    }

    _glowTexture(THREE) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    _labelTexture(THREE, name, sub) {
      const c = document.createElement('canvas'); c.width = 320; c.height = 80;
      const g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 26px -apple-system, sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(name, 161, 27);
      g.fillStyle = '#eaf2ff'; g.fillText(name, 160, 26);
      g.font = '400 18px -apple-system, sans-serif';
      g.fillStyle = 'rgba(150,200,255,0.85)'; g.fillText(sub, 160, 56);
      return new THREE.CanvasTexture(c);
    }
  }

  function boot() { if (!window.interstellar) { try { window.interstellar = new Interstellar(); } catch (e) { console.error('Interstellar boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1700);
  else window.addEventListener('load', () => setTimeout(boot, 1700));
})();
