// StarProximity.js — close-up star surfaces for the real HYG sky.
//
// The ~8,900 real stars render as GPU points (HYGStarfield). Real stars have no
// photo textures — they're points even to Hubble — but their COLOR CLASS is real,
// so when the camera gets close to any star this layer parks a single reusable
// glowing sun mesh at that star's position: surface texture picked by the star's
// true B–V color class (blue giant / yellow / orange K / red dwarf), tinted with
// the star's actual catalog color, sized by its brightness. Fly away and it hides.
// One mesh serves all 8,900 stars — you can only be at one star at a time.

(function () {
  'use strict';

  const NEAR = 140;        // units: show the surface when closer than this
  const CHECK_EVERY = 0.3; // seconds between nearest-star scans

  // The ~25 stars astronomers have ACTUALLY resolved or characterized in detail —
  // each gets its real observed traits. r = size multiplier, oblate = polar squash
  // (fast rotators), comp = [offset, size, colorHex] companion, ring = debris disk,
  // pulse = variable star breathing, tex override picks the surface class.
  const SPECIALS = {
    'Sirius':     { tex: 'blue',   r: 1.6, comp: [3.2, 0.28, 0xf3f6ff] },   // + Sirius B white dwarf ("the Pup")
    'Procyon':    { tex: 'yellow', r: 1.4, comp: [2.8, 0.24, 0xf0f2ff] },   // + Procyon B white dwarf
    'Betelgeuse': { tex: 'red',    r: 3.4, flicker: true },                  // convecting red supergiant
    'Antares':    { tex: 'red',    r: 3.2, flicker: true },
    'Mira':       { tex: 'red',    r: 2.4, pulse: true },                    // the famous pulsator
    'Achernar':   { tex: 'blue',   r: 1.8, oblate: 0.65 },                   // flattest star known
    'Altair':     { tex: 'yellow', r: 1.4, oblate: 0.78 },                   // 9-hour day
    'Regulus':    { tex: 'blue',   r: 1.5, oblate: 0.86 },
    'Vega':       { tex: 'blue',   r: 1.5, ring: true },                     // debris disk
    'Fomalhaut':  { tex: 'blue',   r: 1.4, ring: true },                     // Hubble-photographed ring
    'Albireo':    { tex: 'orange', r: 1.4, comp: [3.0, 0.55, 0x86b8ff] },    // gold + sapphire double
    'Algol':      { tex: 'blue',   r: 1.4, comp: [2.2, 0.7, 0xffc890], pulse: true }, // eclipsing binary
    'Castor':     { tex: 'blue',   r: 1.3, comp: [2.4, 0.8, 0xdfe8ff] },
    'Mizar':      { tex: 'blue',   r: 1.3, comp: [2.6, 0.7, 0xe8eeff] },
    'Capella':    { tex: 'yellow', r: 1.8, comp: [2.0, 0.85, 0xffe9b0] },    // twin yellow giants
    'Polaris':    { tex: 'yellow', r: 1.7, pulse: true, comp: [3.0, 0.3, 0xf0f4ff] }, // Cepheid + companion
    'Rigel':      { tex: 'blue',   r: 2.4, comp: [3.4, 0.4, 0xcfe0ff] },     // blue supergiant
    'Deneb':      { tex: 'blue',   r: 2.6 },
    'Aldebaran':  { tex: 'orange', r: 2.2 },
    'Arcturus':   { tex: 'orange', r: 2.3 },
    'Pollux':     { tex: 'orange', r: 1.9 },
    'Spica':      { tex: 'blue',   r: 1.5, oblate: 0.88, comp: [1.8, 0.75, 0xcfe0ff] },
    'Canopus':    { tex: 'yellow', r: 2.2 },
    'Mirach':     { tex: 'red',    r: 2.0 },
    'Dubhe':      { tex: 'orange', r: 1.9 }
  };

  class StarProximity {
    constructor(THREE, rc, hyg) {
      this.THREE = THREE;
      this.rc = rc;
      const hygMesh = hyg.mesh;
      this.stars = hyg.stars || [];   // [ra, dec, mag, bv, ly, name] per star
      this.pos = hygMesh.geometry.getAttribute('position');
      this.col = hygMesh.geometry.getAttribute('color');
      this.siz = hygMesh.geometry.getAttribute('aSize');
      this.count = this.pos.count;
      this.activeIndex = -1;
      this._registered = new Set();
      this._accum = 0;

      // Class surfaces (already bundled for the discovery cards).
      const load = (f) => {
        const t = new THREE.TextureLoader().load('codex/cosmos/' + f);
        if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      // Real solar-observatory photography (Matt's SDO/EIT references) PLUS the
      // original art — multiple variants per class, picked deterministically per
      // star so neighboring suns don't all look identical.
      this.tex = {
        blue:   [load('star_blue_surface.jpg'), load('star_white_surface.jpg'), load('star_blue_giant.jpg')],
        yellow: [load('sun_gold.jpg'), load('sun_amber.jpg'), load('star_white_surface.jpg')],
        orange: [load('sun_ember.jpg'), load('star_orange_surface.jpg'), load('star_orange_k.jpg')],
        red:    [load('sun_red_euv.jpg'), load('star_redgiant_surface.jpg'), load('star_red_dwarf.jpg')]
      };

      this.mat = new THREE.MeshBasicMaterial({ map: this.tex.yellow });
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 40), this.mat);
      this.mesh.visible = false;
      rc.scene.add(this.mesh);

      // soft corona sprite around the surface
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.25)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      this.glow.visible = false;
      rc.scene.add(this.glow);

      // companion star (Sirius B, Albireo's sapphire, ...) — hidden unless the
      // active star is a known binary
      this.compMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.comp = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), this.compMat);
      this.comp.visible = false;
      rc.scene.add(this.comp);

      // debris ring (Vega, Fomalhaut) — a thin torus of dusty points
      const ringN = 2200, rp = new Float32Array(ringN * 3);
      for (let i = 0; i < ringN; i++) {
        const th = Math.random() * 6.283, rr = 1 + (Math.random() - 0.5) * 0.12;
        rp[i * 3] = Math.cos(th) * rr;
        rp[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
        rp[i * 3 + 2] = Math.sin(th) * rr;
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
      this.ring = new THREE.Points(rg, new THREE.PointsMaterial({
        color: 0xcfe2ff, size: 1.6, sizeAttenuation: false, transparent: true,
        opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      this.ring.visible = false;
      rc.scene.add(this.ring);

      this._special = null;
      this._phase = 0;

      // name/distance label — every star is identifiable on approach
      this.labelCanvas = document.createElement('canvas');
      this.labelCanvas.width = 512; this.labelCanvas.height = 128;
      this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.labelTex, transparent: true, depthWrite: false, sizeAttenuation: false
      }));
      this.label.scale.set(0.34, 0.085, 1);
      this.label.center.set(0.5, -1.4);
      this.label.visible = false;
      rc.scene.add(this.label);
    }

    _classWord(r, g, b) {
      if (b > r * 1.04) return 'Blue-white star';
      if (r > b * 1.35) return 'Red star';
      if (r > b * 1.12) return 'Orange star';
      return 'Yellow-white star';
    }

    _drawLabel(name, sub) {
      const g = this.labelCanvas.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      g.textAlign = 'center';
      g.font = '600 44px -apple-system, SF Pro Display, sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 10;
      g.fillText(name, 256, 52);
      g.font = '500 28px -apple-system, SF Pro Display, sans-serif';
      g.fillStyle = 'rgba(160,215,255,0.9)';
      g.fillText(sub, 256, 96);
      this.labelTex.needsUpdate = true;
    }

    // Catalog color → class texture (blue/red balance tells the temperature class).
    // idx picks a per-star variant deterministically so each sun keeps its face.
    _texFor(r, g, b, idx) {
      let set;
      if (b > r * 1.04) set = this.tex.blue;
      else if (r > b * 1.35) set = this.tex.red;
      else if (r > b * 1.12) set = this.tex.orange;
      else set = this.tex.yellow;
      return set[idx % set.length];
    }

    update(dt) {
      const step = dt || 0.016;
      if (this.mesh.visible) {
        this.mesh.rotation.y += step * (this._special && this._special.flicker ? 0.12 : 0.05);
        // Real observed behaviors: Mira-type breathing, supergiant convective flicker.
        if (this._special) {
          this._phase += step;
          const s = this._special;
          const base = this._baseRadius || 1;
          if (s.pulse) {
            const k = 1 + Math.sin(this._phase * 0.8) * 0.12;
            this.mesh.scale.set(base * k, base * k * (s.oblate || 1), base * k);
          }
          if (s.flicker) {
            const f = 0.92 + 0.08 * Math.sin(this._phase * 2.3) * Math.sin(this._phase * 1.1);
            this.mat.color.setScalar(f).multiply(this._baseTint || new this.THREE.Color(1, 1, 1));
          }
          if (this.comp.visible) {
            // slow orbit for companions
            const cs = s.comp, R = base * cs[0];
            this.comp.position.set(
              this.mesh.position.x + Math.cos(this._phase * 0.25) * R,
              this.mesh.position.y + Math.sin(this._phase * 0.25) * R * 0.2,
              this.mesh.position.z + Math.sin(this._phase * 0.25) * R
            );
          }
        }
      }
      this._accum += step;
      if (this._accum < CHECK_EVERY) return;
      this._accum = 0;

      const cam = this.rc.camera.position;
      let best = -1, bestD2 = NEAR * NEAR;
      const a = this.pos.array;
      for (let i = 0; i < this.count; i++) {
        const dx = a[i * 3] - cam.x, dy = a[i * 3 + 1] - cam.y, dz = a[i * 3 + 2] - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }

      if (best < 0) {
        this.mesh.visible = this.glow.visible = this.label.visible = false;
        this.comp.visible = this.ring.visible = false;
        this.activeIndex = -1;
        this._special = null;
        return;
      }
      if (best !== this.activeIndex) {
        this.activeIndex = best;
        const r = this.col.getX(best), g = this.col.getY(best), b = this.col.getZ(best);
        const entryPeek = this.stars[best];
        const special = (entryPeek && SPECIALS[entryPeek[5]]) || null;
        this._special = special;
        this._phase = 0;
        // brightness (point size) → physical presence: brilliant star ≈ 6u, faint ≈ 2u
        const radius = (2 + (this.siz.getX(best) / 15) * 4) * (special && special.r ? special.r : 1);
        this._baseRadius = radius;
        this.mesh.position.set(a[best * 3], a[best * 3 + 1], a[best * 3 + 2]);
        this.mesh.scale.set(radius, radius * (special && special.oblate ? special.oblate : 1), radius);
        this.mat.map = special && special.tex ? this.tex[special.tex][0] : this._texFor(r, g, b, best);
        this.mat.color.setRGB(0.55 + r * 0.45, 0.55 + g * 0.45, 0.55 + b * 0.45);
        this._baseTint = this.mat.color.clone();
        this.mat.needsUpdate = true;
        this.glow.position.copy(this.mesh.position);
        this.glow.scale.setScalar(radius * 5);
        this.glow.material.color.setRGB(r, g, b);

        // observed companions & debris rings
        if (special && special.comp) {
          this.comp.visible = true;
          this.comp.scale.setScalar(radius * special.comp[1]);
          this.compMat.color.setHex(special.comp[2]);
          this.comp.position.set(this.mesh.position.x + radius * special.comp[0], this.mesh.position.y, this.mesh.position.z);
        } else {
          this.comp.visible = false;
        }
        if (special && special.ring) {
          this.ring.visible = true;
          this.ring.position.copy(this.mesh.position);
          this.ring.scale.setScalar(radius * 4.5);
        } else {
          this.ring.visible = false;
        }

        // Identify: real name + real distance, and register with the scanner so the
        // SCAN button arms on it and it can join the Field Guide.
        const entry = this.stars[best];
        if (entry) {
          const name = entry[5] || 'Unknown star';
          const ly = entry[4];
          const cls = this._classWord(r, g, b);
          this._drawLabel(name, (ly > 0 ? ly + ' ly · ' : '') + cls);
          this.label.position.copy(this.mesh.position);
          if (!this._registered.has(name)) {
            this._registered.add(name);
            try {
              if (window.SpaceData) window.SpaceData.register(name, {
                class: cls, distanceLabel: ly > 0 ? ly + ' light-years' : 'distance unknown',
                composition: [{ label: 'Hydrogen', pct: 73 }, { label: 'Helium', pct: 25 }, { label: 'Heavier elements', pct: 2 }],
                fact: name + ' is a real catalogued star ' + (ly > 0 ? 'about ' + ly + ' light-years from Earth.' : 'in Earth\'s night sky.'),
                discovered: 'Catalogued', color: '#9fd8ff', moons: 0, icon: '⭐',
                radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
              });
              // Fixed anchor at the star's own position — the close-up mesh is SHARED
              // and moves from star to star, so registering it directly would make
              // every previously visited star appear to sit wherever you are now.
              const anchor = new this.THREE.Object3D();
              anchor.position.copy(this.mesh.position);
              this.rc.scene.add(anchor);
              window.__universe = window.__universe || [];
              window.__universe.push({ name, mesh: anchor, radius: 70 });
            } catch (e) {}
          }
        }
      }
      this.mesh.visible = this.glow.visible = this.label.visible = true;
    }
  }

  // Boot: needs the engine (bare-name `rendererCore` — top-level let, NOT on window)
  // and the built HYG mesh (bare-name `hygStarfield` from main.js).
  const boot = setInterval(() => {
    let rc = null, hyg = null;
    try {
      rc = (typeof rendererCore !== 'undefined') ? rendererCore : null;
      hyg = (typeof hygStarfield !== 'undefined') ? hygStarfield : null;
    } catch (e) {}
    if (!rc || !rc.camera || !rc.scene || !hyg || !hyg.mesh || !window.THREE) return;
    clearInterval(boot);
    try {
      window.starProximity = new StarProximity(window.THREE, rc, hyg);
      // piggyback on rAF so no main.js edit is needed
      let last = performance.now();
      const tick = (t) => {
        window.starProximity.update(Math.min(0.1, (t - last) / 1000));
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      console.log('⭐ StarProximity ready — textured close-ups for all', window.starProximity.count, 'real stars');
    } catch (e) {
      console.warn('StarProximity init failed:', e);
    }
  }, 600);
})();
