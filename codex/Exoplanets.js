// Exoplanets.js — real, confirmed exoplanets placed at their host stars' true sky
// directions & distances, skinned with the AI-generated surface library. Additive and
// self-contained (no catalog/Space-Map changes). Unlit materials so the worlds are
// visible far from the Sun's light.
//
// [name, RA h, Dec deg, dist ly, surface key, fact]

(function () {
  'use strict';

  const PLANETS = [
    ['Proxima b', 14.495, -62.68, 4.24, 'exo_rocky', 'The nearest exoplanet to Earth — a rocky world in Proxima Centauri’s habitable zone, just 4.24 light-years away.'],
    ['Proxima d', 14.495, -62.68, 4.24, 'exo_lava', 'A scorching sub-Earth whipping around Proxima Centauri every 5 days.'],
    ['Tau Ceti e', 1.734, -15.94, 11.90, 'exo_ocean', 'A super-Earth at the inner edge of Tau Ceti’s habitable zone — a candidate ocean world.'],
    ['Epsilon Eridani b', 3.548, -9.46, 10.50, 'exo_gas_blue', 'A Jupiter-mass giant orbiting one of the closest sun-like stars, ringed by a debris disk.'],
    ['Pollux b', 7.755, 28.03, 33.78, 'exo_gas_violet', 'A gas giant twice Jupiter’s mass orbiting the orange giant star Pollux.'],
    ['Fomalhaut b', 22.961, -29.62, 25.13, 'exo_ice', 'A world embedded in Fomalhaut’s vast, sharply-edged ring of icy debris.'],
    ['TRAPPIST-1 e', 23.103, -5.04, 39.50, 'exo_desert', 'One of SEVEN Earth-sized planets around a single red dwarf — three of them in the habitable zone.'],
    ['TRAPPIST-1 g', 23.103, -4.98, 39.50, 'exo_ice', 'An outer TRAPPIST world likely cloaked in ice — part of the most famous planetary system found.'],
    ['51 Pegasi b', 22.960, 20.77, 50.45, 'exo_lava', 'The first planet ever found around a sun-like star (1995) — a roasting "hot Jupiter".'],
    ['Kepler-442b', 19.050, 39.28, 1206.0, 'exo_ocean', 'One of the most Earth-like worlds known: a super-Earth in its star’s habitable zone.'],
    ['HD 189733 b', 20.005, 22.71, 64.50, 'exo_gas_blue', 'A deep-blue hot Jupiter where the weather may include sideways rain of molten glass.'],
    ['55 Cancri e', 8.973, 28.33, 41.00, 'exo_lava', 'A super-Earth so hot one side is an ocean of lava; once thought to be a "diamond planet".']
  ];

  const TYPES = {
    exo_rocky:  ['Rocky exoplanet', [{ label: 'Rock', pct: 70 }, { label: 'Iron core', pct: 30 }], '#c89a78'],
    exo_ocean:  ['Ocean world', [{ label: 'Water', pct: 60 }, { label: 'Rock', pct: 40 }], '#4a90e2'],
    exo_lava:   ['Lava world', [{ label: 'Molten rock', pct: 80 }, { label: 'Iron', pct: 20 }], '#e2563a'],
    exo_ice:    ['Ice world', [{ label: 'Water ice', pct: 70 }, { label: 'Rock', pct: 30 }], '#bfe0ff'],
    exo_desert: ['Desert world', [{ label: 'Silicate rock', pct: 85 }, { label: 'Iron', pct: 15 }], '#d8b070'],
    exo_jungle: ['Verdant world', [{ label: 'Rock', pct: 55 }, { label: 'Water', pct: 35 }, { label: 'Atmosphere', pct: 10 }], '#5cc46a'],
    exo_gas_blue:   ['Gas giant exoplanet', [{ label: 'Hydrogen', pct: 90 }, { label: 'Helium', pct: 10 }], '#5aa0e0'],
    exo_gas_violet: ['Gas giant exoplanet', [{ label: 'Hydrogen', pct: 88 }, { label: 'Helium', pct: 12 }], '#b070d0']
  };

  function gameRadius(ly) { return Math.sqrt(ly) * 150; } // matches the star/constellation depth scale
  function dir(raH, decDeg) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
  }

  class Exoplanets {
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
      this.group = new THREE.Group();
      const loader = new THREE.TextureLoader();
      let offset = 0;
      PLANETS.forEach(p => this._add(THREE, loader, p, offset++));
      scene.add(this.group);
      console.log('🪐 Exoplanets layer:', PLANETS.length, 'worlds placed');
    }
    _add(THREE, loader, [name, raH, decDeg, ly, surf, fact], i) {
      const [dx, dy, dz] = dir(raH, decDeg);
      const r = gameRadius(ly);
      // nudge off the host star so star + planet don't overlap
      const jitter = new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 3.1)).multiplyScalar(12);
      const pos = new THREE.Vector3(dx * r, dy * r, dz * r).add(jitter);

      const geo = new THREE.SphereGeometry(6, 32, 24);
      const mat = new THREE.MeshBasicMaterial({ color: 0x888888 }); // fallback until texture loads
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      this.group.add(mesh);
      loader.load('codex/cosmos/' + surf + '.jpg', (tex) => {
        if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      }, undefined, () => {});

      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._label(THREE, name, ly + ' ly'), transparent: true, depthWrite: false, sizeAttenuation: false
      }));
      label.scale.set(0.13, 0.033, 1); label.center.set(0.5, -0.8); label.position.copy(pos);
      this.group.add(label);

      // gentle spin
      mesh.userData.spin = 0.1 + Math.random() * 0.2;
      if (!this._spinning) { this._spinning = []; this._loop(); }
      this._spinning.push(mesh);

      // register for discovery cards (Field Guide) + scan + fly-to
      const t = TYPES[surf] || ['Exoplanet', [{ label: 'Rock', pct: 100 }], '#88aaff'];
      if (window.SpaceData) window.SpaceData.register(name, {
        class: t[0] + ' · exoplanet', distanceLabel: ly + ' light-years',
        composition: t[1], fact: fact, discovered: 'Confirmed exoplanet', color: t[2], moons: null, icon: '🪐',
        radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
      });
      window.__universe = window.__universe || [];
      window.__universe.push({ name, mesh, radius: 28 });
    }
    _label(THREE, name, sub) {
      const c = document.createElement('canvas'); c.width = 300; c.height = 76;
      const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 24px -apple-system, sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(name, 151, 25); g.fillStyle = '#dfeaff'; g.fillText(name, 150, 24);
      g.font = '400 17px -apple-system'; g.fillStyle = 'rgba(150,200,255,0.85)'; g.fillText(sub, 150, 52);
      return new THREE.CanvasTexture(c);
    }
    _loop() {
      let last = null;
      const step = (ts) => {
        const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
        if (this._spinning) this._spinning.forEach(m => { m.rotation.y += m.userData.spin * dt; });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  function boot() { if (!window.exoplanets) { try { window.exoplanets = new Exoplanets(); } catch (e) { console.error('Exoplanets boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1800);
  else window.addEventListener('load', () => setTimeout(boot, 1800));
})();
