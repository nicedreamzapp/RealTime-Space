// Galaxies.js — real galaxies as dense, TRUE-3D star-clouds (never flat billboards). Each
// is built from tens of thousands of points forming a real logarithmic-spiral disk (with a
// glowing golden bulge, dark dust lanes, blue OB associations and pink HII star-forming
// knots along the arms), a triaxial elliptical swarm, or an irregular cloud. Fly toward one
// and it resolves from a faint patch into a 3D structure you can circle and pass through.
// Real sky directions; scannable. Additive & depth-safe.
//
// [name, RA h, Dec deg, distance Mly, kind, apparent size, fact]

(function () {
  'use strict';

  const GALAXIES = [
    ['Large Magellanic Cloud', 5.392, -69.76, 0.16, 'irregular', 1.6, 'A satellite galaxy of the Milky Way, 160,000 light-years away — home to the Tarantula Nebula.'],
    ['Small Magellanic Cloud', 0.877, -72.83, 0.20, 'irregular', 1.1, 'A dwarf companion galaxy visible to the naked eye from the southern sky.'],
    ['Andromeda (M31)', 0.712, 41.27, 2.50, 'spiral', 2.2, 'The nearest major galaxy and the most distant thing visible to the naked eye. It will collide with the Milky Way in ~4.5 billion years.'],
    ['Triangulum (M33)', 1.564, 30.66, 2.73, 'spiral', 1.5, 'The third-largest galaxy in our Local Group, a delicate face-on spiral.'],
    ["Bode's Galaxy (M81)", 9.926, 69.07, 12.0, 'spiral', 1.1, 'A grand-design spiral with a supermassive black hole 70 million times the Sun.'],
    ['Centaurus A', 13.425, -43.02, 13.0, 'elliptical', 1.2, 'A peculiar elliptical galaxy blasting jets from a giant black hole, wrapped in a dark dust lane.'],
    ['Pinwheel (M101)', 14.053, 54.35, 21.0, 'spiral', 1.2, 'A huge face-on spiral nearly twice the width of the Milky Way.'],
    ['Whirlpool (M51)', 13.498, 47.20, 23.0, 'spiral', 1.0, 'The classic spiral, caught mid-interaction with a smaller companion galaxy.'],
    ['Sombrero (M104)', 12.667, -11.62, 29.0, 'elliptical', 1.0, 'An edge-on galaxy with a brilliant bulge and a dark dust lane like a hat brim.']
  ];

  function dir(raH, decDeg) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
  }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.7; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // Stellar palette (linear-ish RGB, additive).
  const C_BULGE = [1.00, 0.83, 0.55];   // old golden core stars
  const C_DISK  = [1.00, 0.92, 0.78];   // general disk (yellow-white)
  const C_ARM   = [0.62, 0.76, 1.00];   // young blue OB associations in the arms
  const C_HII   = [1.00, 0.44, 0.62];   // pink H-alpha star-forming knots
  const C_ELL   = [1.00, 0.86, 0.66];   // elliptical (old, warm)

  class Galaxies {
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
      this._dot = this._dotTex(THREE);
      this._glow = this._glowTex(THREE);
      this._mat = this._starMaterial(THREE);
      let total = 0;
      GALAXIES.forEach(g => { total += this._add(THREE, g); });
      scene.add(this.group);
      window.__universe = window.__universe || [];
      console.log('🌌 Galaxies layer:', GALAXIES.length, 'dense 3D star-clouds,', total.toLocaleString(), 'stars');
    }

    _add(THREE, [name, raH, decDeg, mly, kind, size, fact]) {
      const [dx, dy, dz] = dir(raH, decDeg);
      const dist = 4000 + Math.sqrt(mly) * 650;
      const c = new THREE.Vector3(dx * dist, dy * dist, dz * dist);
      const R = 130 * size;

      // Dense clouds — scale star count with apparent size (hero galaxies get far more).
      const N = Math.round((kind === 'irregular' ? 16000 : kind === 'elliptical' ? 24000 : 34000) * size);
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N);

      // Random orientation so galaxies don't all face the same way.
      const ax = Math.random() * 6.28, ay = Math.random() * 6.28;
      const rot = (x, y, z) => {
        let y1 = y * Math.cos(ax) - z * Math.sin(ax), z1 = y * Math.sin(ax) + z * Math.cos(ax);
        let x2 = x * Math.cos(ay) + z1 * Math.sin(ay), z2 = -x * Math.sin(ay) + z1 * Math.cos(ay);
        return [x2, y1, z2];
      };

      const arms = 2 + (Math.floor(Math.random() * 2));   // 2–3 spiral arms
      const pitch = 0.22 + Math.random() * 0.10;          // arm winding tightness
      const bulgeFrac = kind === 'spiral' ? 0.22 : 0.0;   // fraction of stars in the central bulge

      for (let i = 0; i < N; i++) {
        let x, y, z, t, base, bright = 0.75 + Math.random() * 0.25, psize;

        if (kind === 'spiral') {
          if (i < N * bulgeFrac) {
            // Central bulge — dense golden spheroid, slightly flattened.
            t = Math.pow(Math.random(), 2.2); const r = t * R * 0.32;
            const u = Math.random() * 6.283, v = Math.acos(2 * Math.random() - 1);
            x = r * Math.sin(v) * Math.cos(u);
            z = r * Math.sin(v) * Math.sin(u);
            y = r * Math.cos(v) * 0.55;
            base = mix(C_BULGE, [1, 1, 0.95], Math.random() * 0.3);
            bright *= 0.8; psize = 1.0 + Math.random() * 1.3;
          } else {
            // Disk with log-spiral arms + a dust lane just inside each arm.
            t = Math.pow(Math.random(), 0.5); const r = 0.06 * R + t * R;
            const inArm = Math.random() < 0.72;              // 72% of disk stars hug the arms
            const a = Math.floor(Math.random() * arms);
            const armTheta = (a / arms) * 6.283 + Math.log(r / (0.06 * R) + 1) / pitch;
            let th;
            if (inArm) {
              th = armTheta + gauss() * 0.30;                // tight to the arm
            } else {
              th = Math.random() * 6.283;                    // scattered inter-arm field
            }
            const spread = 3 + (1 - t) * R * 0.05;
            x = Math.cos(th) * r + gauss() * spread;
            z = Math.sin(th) * r + gauss() * spread;
            y = gauss() * R * 0.045 * (0.5 + (1 - t));       // thin disk

            // Dust lane: dim/skip stars that fall just on the leading edge of an arm.
            const dustPhase = th - armTheta + 0.34;
            const inDust = inArm && Math.abs(((dustPhase + 3.1416) % 6.283) - 3.1416) < 0.16;
            if (inDust && Math.random() < 0.7) bright *= 0.12;

            // Color: blue OB + pink HII beads on the arms, yellow-white in the field.
            if (inArm) {
              const roll = Math.random();
              if (roll < 0.08) { base = C_HII; bright *= 1.25; psize = 1.6 + Math.random() * 2.2; }      // star-forming knot
              else if (roll < 0.55) { base = mix(C_ARM, C_DISK, Math.random() * 0.5); psize = 1.0 + Math.random() * 1.4; }
              else { base = mix(C_DISK, C_ARM, Math.random() * 0.4); psize = 0.7 + Math.random() * 1.0; }
            } else {
              base = mix(C_DISK, C_BULGE, Math.random() * 0.4); psize = 0.6 + Math.random() * 0.9;
            }
            // Brighten toward the core.
            bright *= 0.7 + (1 - t) * 0.6;
          }
        } else if (kind === 'elliptical') {
          // Triaxial old-star swarm, denser toward the center.
          t = Math.pow(Math.random(), 0.75); const r = t * R;
          const u = Math.random() * 6.283, v = Math.acos(2 * Math.random() - 1);
          x = r * Math.sin(v) * Math.cos(u);
          y = r * Math.sin(v) * Math.sin(u) * 0.62;
          z = r * Math.cos(v) * 0.8;
          base = mix(C_ELL, [1, 1, 0.9], (1 - t) * 0.4);
          bright *= 0.7 + (1 - t) * 0.6; psize = 0.8 + Math.random() * 1.3 + (1 - t) * 1.2;
        } else { // irregular (LMC/SMC) — an off-center BAR + scattered clumps, plus one
          // bright pink star-forming region (like the Tarantula Nebula), not a symmetric blob.
          const roll = Math.random();
          if (roll < 0.42) {
            // Central bar — elongated, dense, warm-white.
            x = gauss() * R * 0.85 + R * 0.12; y = gauss() * R * 0.16; z = gauss() * R * 0.24;
            base = mix(C_DISK, C_BULGE, Math.random() * 0.5); psize = 0.7 + Math.random() * 0.9;
            bright *= 0.85;
          } else if (roll < 0.52) {
            // Tarantula-like HII complex, concentrated in one offset knot.
            x = -R * 0.45 + gauss() * R * 0.22; y = gauss() * R * 0.18; z = R * 0.2 + gauss() * R * 0.22;
            base = mix(C_HII, C_ARM, Math.random() * 0.3); bright *= 1.15; psize = 1.4 + Math.random() * 1.8;
          } else {
            // Scattered clumps of young blue + field stars.
            x = gauss() * R * 1.05; y = gauss() * R * 0.5; z = gauss() * R * 0.75;
            base = Math.random() < 0.5 ? mix(C_ARM, C_DISK, Math.random()) : mix(C_DISK, C_BULGE, Math.random() * 0.5);
            psize = 0.6 + Math.random() * 0.9; bright *= 0.9;
          }
        }

        const [rx, ry, rz] = rot(x, y, z);
        pos[i * 3] = rx; pos[i * 3 + 1] = ry; pos[i * 3 + 2] = rz;   // relative — mesh carries the center
        col[i * 3] = base[0] * bright; col[i * 3 + 1] = base[1] * bright; col[i * 3 + 2] = base[2] * bright;
        siz[i] = psize;
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      const pts = new THREE.Points(g, this._mat);
      pts.position.copy(c);
      pts.frustumCulled = false;
      this.group.add(pts);

      // Soft additive core glow so the nucleus reads as a bright bulge from far away.
      const glowColor = kind === 'spiral' ? 0xfff0d0 : kind === 'elliptical' ? 0xffe6c0 : 0xdfe8ff;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glow, color: glowColor, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: kind === 'irregular' ? 0.18 : 0.42
      }));
      glow.scale.setScalar(R * (kind === 'elliptical' ? 2.2 : 1.5));
      glow.position.copy(c);
      this.group.add(glow);

      this._label(THREE, name, mly + ' million ly', c);
      if (window.SpaceData) window.SpaceData.register(name, {
        class: kind === 'elliptical' ? 'Elliptical galaxy' : kind === 'irregular' ? 'Irregular galaxy' : 'Spiral galaxy',
        distanceLabel: mly + ' million light-years',
        composition: [{ label: 'Stars', pct: 10 }, { label: 'Gas & dust', pct: 15 }, { label: 'Dark matter', pct: 75 }],
        fact: fact, discovered: 'Catalogued galaxy', color: '#b9a7ff', icon: '🌌', moons: null,
        radiusKm: null, gravity: null, dayHours: null, yearDays: null, tempC: null, massKg: null, distanceAU: null
      });
      window.__universe = window.__universe || []; window.__universe.push({ name, mesh: pts, radius: R });
      return N;
    }

    // Distance-attenuated star sprite: bright core + soft glow, size varies per-star.
    _starMaterial(THREE) {
      return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uPixel: { value: Math.min(2.5, window.devicePixelRatio || 2) } },
        vertexShader: `
          attribute float aSize;
          varying vec3 vColor;
          uniform float uPixel;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // size grows as you approach; clamped so distant galaxies stay a soft glow.
            gl_PointSize = clamp(aSize * uPixel * (2600.0 / max(40.0, -mv.z)), 0.6, 22.0);
          }`,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float r = length(d);
            if (r > 0.5) discard;
            float core = smoothstep(0.5, 0.0, r);
            float glow = pow(core, 2.4);
            // Dimmer, tighter falloff so overlapping stars don't stack to a white blob.
            gl_FragColor = vec4(vColor * glow, glow * 0.7);
          }`
      });
    }

    _dotTex(THREE) {
      const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
    }
    _glowTex(THREE) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.25, 'rgba(255,250,235,0.45)');
      grd.addColorStop(0.6, 'rgba(255,240,210,0.12)'); grd.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
    }
    _label(THREE, name, sub, pos) {
      const c = document.createElement('canvas'); c.width = 360; c.height = 80; const g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 26px -apple-system, sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(name, 181, 26); g.fillStyle = '#eadfff'; g.fillText(name, 180, 25);
      g.font = '400 17px -apple-system'; g.fillStyle = 'rgba(190,170,255,0.85)'; g.fillText(sub, 180, 56);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, sizeAttenuation: false }));
      lab.scale.set(0.2, 0.05, 1); lab.center.set(0.5, -1.0); lab.position.copy(pos);
      this.group.add(lab);
    }
  }

  function boot() { if (!window.galaxies) { try { window.galaxies = new Galaxies(); } catch (e) { console.error('Galaxies boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1900);
  else window.addEventListener('load', () => setTimeout(boot, 1900));
})();
