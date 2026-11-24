// Visor.js — the helmet visor / canopy glass you look THROUGH in first person.
//
// One full-screen ShaderPass, inserted just before the final gamma pass:
//   * micro-scratches and smudges that are invisible in the dark and only light up
//     when the Sun is near the view direction. Each scratch scatters light out of the
//     plane that contains it, so a scratch catches the Sun only when it runs
//     PERPENDICULAR to the screen-space line from the Sun to that pixel. That is why
//     real windshields and visors show scratches as concentric rings around a light.
//     We store each scratch's direction in the texture and do exactly that test.
//   * a forward-scatter lobe (grease/smudges + veiling glare) that falls off with the
//     angle to the Sun. Calibrated on ESA/NASA through-the-cupola footage
//     (rtspace-reference/1_earth_iss): glass is invisible on the night side; near the
//     Sun the whole frame gets a cool, low-contrast veil and bright sources throw a
//     faint offset "pane ghost" (the cupola is multi-pane glass).
//   * Schlick Fresnel at the rim (polycarbonate, n~1.5, R0=0.04) using the dome's
//     tilt toward the edge, a slight inward refraction at the rim, and an optional
//     gold sun-visor film (gold transmits green-ish, reflects yellow).
//   * frost / condensation that creeps in from the edges when the glass is cold:
//     sunlight on the glass follows 1/r^2 (scene distance mapped back to real AU via the
//     planet table, the scene compresses the outer system) and drops to zero in a
//     planet's shadow. Frost grows slowly and sublimes faster once sunlight returns.
//
// Tiers: high = full shader; medium = smaller textures, no chromatic rim / fewer frost
// taps; low = pass disabled (zero cost). Tier comes from window.RTQuality (?rtq= / ?tier= to
// force) and follows its 'rtquality' event; there is no separate probe here.
//
// API: window.galaxyExplorer.setVisorGlass(bool), setVisorGold(bool).
// Active in HELM and VISOR views, off in CHASE (camera is outside the ship).

(function () {
  'use strict';
  const T = window.THREE;
  if (!T) return;

  const STORE_ON = 'rtf_visor_glass';
  const STORE_GOLD = 'rtf_visor_gold';

  // ---------- deterministic RNG so the glass looks the same every launch
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- scratch texture: R = coverage, G/B = scratch direction as (cos2θ, sin2θ)
  // (the doubled angle makes a line and its reverse identical, which a scratch is)
  function buildScratchTex(N) {
    const R = new Float32Array(N * N), C = new Float32Array(N * N), S = new Float32Array(N * N);
    const rnd = rng(1977);
    const k = N / 1024;
    function splat(x, y, a, c2, s2) {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      for (let j = 0; j < 4; j++) {
        const px = ((xi + (j & 1)) % N + N) % N, py = ((yi + (j >> 1)) % N + N) % N;
        const i = py * N + px, v = a * w[j];
        if (v > R[i]) { R[i] = v; C[i] = c2; S[i] = s2; }
      }
    }
    function line(x0, y0, x1, y1, a, width) {
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
      const th = Math.atan2(dy, dx), c2 = Math.cos(2 * th), s2 = Math.sin(2 * th);
      const nx = -dy / L, ny = dx / L;
      const steps = Math.ceil(L * 2);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // scratches fade in/out at their ends and vary along their length
        const env = Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(t * 17 + x0));
        const x = x0 + dx * t, y = y0 + dy * t;
        splat(x, y, a * env, c2, s2);
        if (width > 1.1) splat(x + nx * 0.7, y + ny * 0.7, a * env * 0.6, c2, s2);
      }
    }
    // 1) fine random hairlines
    const nHair = Math.round(1400 * k * k + 200);
    for (let i = 0; i < nHair; i++) {
      const x = rnd() * N, y = rnd() * N, th = rnd() * Math.PI, L = (6 + rnd() * rnd() * 70) * k;
      line(x, y, x + Math.cos(th) * L, y + Math.sin(th) * L, 0.35 + rnd() * 0.5, 1);
    }
    // 2) wiping arcs: families of near-parallel arcs from a circular cleaning motion
    const nWipe = Math.round(55 * k + 10);
    for (let i = 0; i < nWipe; i++) {
      const cx = rnd() * N, cy = rnd() * N, rad = (60 + rnd() * 380) * k;
      const a0 = rnd() * Math.PI * 2, span = 0.25 + rnd() * 1.0;
      const fam = 3 + Math.floor(rnd() * 8);
      for (let f = 0; f < fam; f++) {
        const rr = rad + (rnd() - 0.5) * 18 * k, aa = a0 + (rnd() - 0.5) * 0.3, sp = span * (0.4 + rnd() * 0.6);
        const segs = Math.max(4, Math.round(rr * sp / 6));
        const amp = 0.25 + rnd() * 0.45;
        let px = cx + Math.cos(aa) * rr, py = cy + Math.sin(aa) * rr;
        for (let s = 1; s <= segs; s++) {
          const an = aa + sp * s / segs, qx = cx + Math.cos(an) * rr, qy = cy + Math.sin(an) * rr;
          line(px, py, qx, qy, amp, 1); px = qx; py = qy;
        }
      }
    }
    // 3) a few long straight gouges
    for (let i = 0; i < 14; i++) {
      const x = rnd() * N, y = rnd() * N, th = rnd() * Math.PI, L = (150 + rnd() * 450) * k;
      line(x, y, x + Math.cos(th) * L, y + Math.sin(th) * L, 0.75 + rnd() * 0.25, 1.6);
    }
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = Math.min(255, R[i] * 255);
      data[i * 4 + 1] = (C[i] * 0.5 + 0.5) * 255;
      data[i * 4 + 2] = (S[i] * 0.5 + 0.5) * 255;
      data[i * 4 + 3] = 255;
    }
    const tex = new T.DataTexture(data, N, N, T.RGBAFormat, T.UnsignedByteType);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.minFilter = tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // ---------- field texture: R = smudge/grease, G = frost growth order, B = frost crystal
  function buildFieldTex(N) {
    const rnd = rng(4242);
    const G = 64, lat = new Float32Array(G * G * 3);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const vnoise = (x, y, ch, per) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (a, b) => lat[(((b % per) + per) % per * G + (((a % per) + per) % per)) * 3 + ch];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
    const fbm = (x, y, ch, oct, base) => {
      let v = 0, amp = 0.5, f = base, n = 0;
      for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f, ch, f); n += amp; amp *= 0.5; f *= 2; }
      return v / n;
    };
    // fingerprints: concentric ridge ellipses (oil left by a glove/finger)
    const prints = [];
    for (let i = 0; i < 5; i++) prints.push({ x: rnd(), y: rnd(), r: 0.05 + rnd() * 0.05, a: rnd() * Math.PI, e: 0.6 + rnd() * 0.3 });
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let sm = fbm(u, v, 0, 4, 4);
      sm = Math.max(0, (sm - 0.48) * 3.2);              // patchy grease, mostly clean
      for (const p of prints) {
        let dx = u - p.x, dy = v - p.y; dx -= Math.round(dx); dy -= Math.round(dy);
        const ca = Math.cos(p.a), sa = Math.sin(p.a);
        const ex = (dx * ca + dy * sa) / p.e, ey = (-dx * sa + dy * ca);
        const d = Math.hypot(ex, ey) / p.r;
        if (d < 1) sm = Math.max(sm, (1 - d * d) * (0.5 + 0.5 * Math.sin(d * 60)) * 0.8);
      }
      const fr = fbm(u, v, 1, 5, 2);
      // dendritic crystal look: ridged noise (1-|2n-1|)^3
      const cr = Math.pow(1 - Math.abs(2 * fbm(u, v, 2, 4, 8) - 1), 3);
      const i = (y * N + x) * 4;
      data[i] = Math.min(255, sm * 255); data[i + 1] = fr * 255; data[i + 2] = cr * 255; data[i + 3] = 255;
    }
    const tex = new T.DataTexture(data, N, N, T.RGBAFormat, T.UnsignedByteType);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.minFilter = tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

  const FRAG = `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tScratch;
    uniform sampler2D tField;
    uniform float uAspect;
    uniform float uTanHalf;
    uniform vec3  uSunView;     // unit vector to the Sun, camera space
    uniform vec2  uSunUv;       // Sun projected to screen uv (valid when in front)
    uniform float uSunPower;    // sunlight on the glass: 1/r^2 (log-compressed) x not-eclipsed
    uniform float uSunDiskAng;  // angular radius of the Sun disk (rad) — kept glint-free
    uniform float uFrost;       // 0..1 frost coverage
    uniform float uGold;        // 0..1 gold sun-visor film
    uniform float uTexPerH;     // scratch texels per screen height / texture size
    uniform float uHigh;        // 1 on HIGH tier (uniform, not a define: a tier change never recompiles)
    varying vec2 vUv;

    void main() {
      vec2 c  = vUv - 0.5;
      vec2 ca = c * vec2(uAspect, 1.0);
      float r = length(c * 2.0);                    // 0 centre, 1 edge mid, 1.41 corner

      // Curved shell: rays near the rim pass the glass at a slant and bend inward a touch.
      float rim = smoothstep(0.55, 1.45, r);
      vec2 uv = vUv - c * (0.016 * rim * rim);
      vec3 col;
      if (uHigh > 0.5) {
        // slight lateral colour at the extreme rim (dispersion in the slanted shell)
        float ab = 0.0035 * rim * rim;
        col = vec3(texture2D(tDiffuse, uv - c * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + c * ab).b);
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // Gold film transmission: gold passes green best, cuts red and blue (darker view).
      col *= mix(vec3(1.0), vec3(0.55, 0.72, 0.52), uGold);

      // ---- angle from this pixel's view ray to the Sun
      vec3 d = normalize(vec3(c * 2.0 * vec2(uTanHalf * uAspect, uTanHalf), -1.0));
      float ang = acos(clamp(dot(d, uSunView), -1.0, 1.0));
      // the Sun is an extended source (huge at close range): measure from its limb
      float angE   = max(ang - uSunDiskAng, 0.0);
      float narrow = 0.003 / (angE * angE + 0.003);        // tight forward-scatter core
      float broad  = exp(-angE / 0.24);                     // reaches ~25 deg, gone by ~50
      float disk   = smoothstep(uSunDiskAng * 1.2, uSunDiskAng * 3.0, ang); // keep the disk readable
      float lit    = uSunPower * disk;

      vec3 sunCol = vec3(1.0, 0.95, 0.88);
      vec3 add = vec3(0.0);

      if (lit > 0.002) {
        // scratch glint: bright only where the scratch runs perpendicular to the Sun-to-pixel line
        vec2 tuv = vec2(vUv.x * uAspect, vUv.y) * uTexPerH;
        vec4 s = texture2D(tScratch, tuv);
        vec2 t2 = s.gb * 2.0 - 1.0;
        vec2 rad = ca - (uSunUv - 0.5) * vec2(uAspect, 1.0);
        rad /= max(length(rad), 1e-4);
        vec2 r2 = vec2(rad.x * rad.x - rad.y * rad.y, 2.0 * rad.x * rad.y);
        float perp = 0.5 * (1.0 - dot(t2, r2) / max(length(t2), 1e-3)); // = 1 - cos^2(scratch, radial)
        float sel = pow(clamp(perp, 0.0, 1.0), 22.0);
        add += sunCol * s.r * sel * (2.2 * narrow + 0.55 * broad) * lit;

        // grease / smudges: soft, broad, slightly cool-white scatter
        float sm = texture2D(tField, ca * 0.9 + 0.31).r;
        add += vec3(0.92, 0.95, 1.0) * sm * (0.10 * broad + 0.35 * narrow) * lit;

        // veiling glare across the whole visor (cupola sunrise frames: cool wash, contrast loss)
        add += vec3(0.80, 0.88, 1.0) * 0.035 * broad * lit;
      }

      // ---- Fresnel at the rim: the dome normal tilts toward the edge
      float cosI = mix(1.0, 0.30, rim);
      float R0 = mix(0.04, 0.30, uGold);
      float F = R0 + (1.0 - R0) * pow(1.0 - cosI, 5.0);
      vec3 reflTint = mix(vec3(0.75, 0.82, 0.95), vec3(1.0, 0.80, 0.38), uGold);
      // what the glass reflects: the dim helmet/cabin interior, lit up when the Sun is around
      add += reflTint * F * (0.012 + 0.10 * broad * uSunPower);
    #ifndef VISOR_LOW
      // multi-pane ghost: a faint, slightly enlarged copy of only the brightest sources
      vec3 g = texture2D(tDiffuse, 0.5 + c * 0.94 + vec2(0.004, -0.003)).rgb;
      add += reflTint * max(g - 0.75, 0.0) * (0.10 + 0.6 * F);
    #endif

      col += add;

      // ---- frost / condensation creeping in from the edges
      if (uFrost > 0.003) {
        // growth front: frost nucleates on the cold frame edges/corners and advances inward
        // along an irregular front (two noise scales so it never reads as a clean ellipse)
        float box   = max(abs(c.x), abs(c.y)) * 2.0;
        float edge  = mix(r * 0.72, box, 0.35);
        float field = texture2D(tField, ca * 0.45 + 0.17).g * 0.65 + texture2D(tField, ca * 1.7 + 0.53).g * 0.35;
        float m     = edge + 0.55 * (field - 0.5);
        float thr   = 1.12 - uFrost * 0.66;               // full frost still leaves the centre clear
        float dens  = smoothstep(thr, thr + 0.28, m);      // thicker toward the frame
        float fog   = smoothstep(thr - 0.20, thr, m) * (1.0 - smoothstep(thr, thr + 0.05, m)); // condensation fringe
        // feathery dendrites: ridged noise at two scales, rotated against each other
        vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * ca;
        float cry = max(texture2D(tField, ca * 2.3 + 0.11).b, 0.85 * texture2D(tField, q * 4.6 + 0.37).b);
        float frost = dens * clamp(0.25 + 1.1 * cry, 0.0, 1.0);
        // scatter direction varies per pixel with the crystal field, so point sources smear into
        // a soft diffuse patch instead of turning into 2-4 sharp copies
        float sa = (cry * 9.0 + field * 23.0);
        vec2 o = vec2(cos(sa), sin(sa)) * vec2(1.0 / uAspect, 1.0) * 0.0035 * (0.4 + dens);
        vec3 blur;
        if (uHigh > 0.5) {
          blur = (texture2D(tDiffuse, uv + o).rgb + texture2D(tDiffuse, uv - o).rgb +
                  texture2D(tDiffuse, uv + vec2(o.y, -o.x)).rgb + texture2D(tDiffuse, uv - vec2(o.y, -o.x)).rgb) * 0.25;
        } else {
          blur = (texture2D(tDiffuse, uv + o).rgb + texture2D(tDiffuse, uv - o).rgb) * 0.5;
        }
        // ice scatters whatever light reaches it: dim cabin glow, and the Sun when it is near
        vec3 frostLit = vec3(0.70, 0.80, 1.0) * (0.004 + 0.022 * cry * dens) + sunCol * 0.45 * broad * uSunPower * cry;
        col = mix(col, blur * 0.9 + vec3(0.004, 0.005, 0.007), fog * 0.6);
        col = mix(col, blur * 0.72 + frostLit, frost * 0.8);
      }

      gl_FragColor = vec4(col, 1.0);
    }`;

  // scene distance (Sun at origin) -> real AU: the exact inverse of the ephemeris radius
  // compression, so the visor's irradiance agrees with where the planets actually sit.
  function sceneToAU(d) {
    return window.Ephemeris && window.Ephemeris.unmapRadius ? window.Ephemeris.unmapRadius(d) : d / 85;
  }

  const Visor = {
    pass: null, rc: null, tier: null, on: true, gold: 0, frost: 0,
    _sunPow: 0, _lit: 1, _frame: 0,
    light: { sun: 0, lit: 1, facing: 0 },   // read by Cockpit.js to light the art

    // Tier = the global RTQuality tier (single source of truth; ?rtq= / ?tier= override there).
    _pickTier() {
      const t = window.RTQuality && window.RTQuality.tier;
      return (t === 'high' || t === 'medium' || t === 'low') ? t : 'medium';
    },

    // A tier change never rebuilds the pass or recompiles: it flips uHigh and swaps the
    // scratch map. Scratch maps are cached CPU-side per size; the one going out of use is
    // disposed (frees its GPU copy) and re-uploads from the cached pixels if needed again.
    _scratchFor(N) {
      this._scratchCache = this._scratchCache || {};
      return this._scratchCache[N] || (this._scratchCache[N] = buildScratchTex(N));
    },

    _setTierUniforms() {
      if (!this.pass) return;
      const hi = this.tier === 'high';
      const want = this._scratchFor(hi ? 1024 : 512);
      const u = this.pass.uniforms;
      u.uHigh.value = hi ? 1 : 0;
      if (this._scratch && this._scratch !== want) this._scratch.dispose();
      this._scratch = want;
      u.tScratch.value = want;
    },

    _retier() {
      const t = this._pickTier();
      if (t === this.tier) return;
      this.tier = t;
      // building a new-size scratch map is a one-off CPU job: keep it out of the frame
      // that handles the tier change
      setTimeout(() => this._setTierUniforms(), 0);
      this._apply();
    },

    attach(composer, rc) {
      if (this.pass || !composer || !T.ShaderPass) return;
      this.rc = rc;
      try { const v = localStorage.getItem(STORE_ON); if (v !== null) this.on = v === 'true'; } catch (e) {}
      try { this.gold = localStorage.getItem(STORE_GOLD) === 'true' ? 1 : 0; } catch (e) {}
      this.tier = this._pickTier();
      this._build(composer);
      window.addEventListener('rtquality', () => this._retier());
      this._installApi();
      console.log('🪖 Visor glass attached (tier ' + this.tier + ')');
    },

    _build(composer) {
      const hi = this.tier === 'high';
      this._scratch = this._scratchFor(hi ? 1024 : 512);
      this._field = this._field || buildFieldTex(256);
      const shader = {
        uniforms: {
          tDiffuse: { value: null },
          tScratch: { value: this._scratch },
          tField: { value: this._field },
          uAspect: { value: 1 }, uTanHalf: { value: 0.6 },
          uSunView: { value: new T.Vector3(0, 0, -1) }, uSunUv: { value: new T.Vector2(0.5, 0.5) },
          uSunPower: { value: 0 }, uSunDiskAng: { value: 0.01 },
          uFrost: { value: 0 }, uGold: { value: this.gold },
          uTexPerH: { value: 1 }, uHigh: { value: hi ? 1 : 0 }
        },
        vertexShader: VERT, fragmentShader: FRAG
      };
      const pass = new T.ShaderPass(shader);
      // The visor is glass in front of the camera lens: insert it after the light shafts and
      // BEFORE the camera's lens pass (CA/grain/flare happen inside the camera, behind the
      // visor), and before the film grade + gamma. Falls back to just before gamma.
      const ps = composer.passes;
      const camLens = window.cameraFX && window.cameraFX.lensPass;
      let idx = camLens ? ps.indexOf(camLens) : -1;
      if (idx < 0) idx = ps.findIndex(p => p && p.material && /LinearTosRGB/.test(p.material.fragmentShader || ''));
      if (idx < 0) idx = ps.length;
      composer.insertPass(pass, idx);
      this.pass = pass;
      this.composer = composer;
      this._apply();
    },

    _apply() {
      if (!this.pass) return;
      const mode = window.__viewMode || 'helm';
      this.pass.enabled = this.on && this.tier !== 'low' && mode !== 'chase';
    },

    setOn(v) { this.on = !!v; try { localStorage.setItem(STORE_ON, String(this.on)); } catch (e) {} this._apply(); },
    setGold(v) { this.gold = v ? 1 : 0; try { localStorage.setItem(STORE_GOLD, String(!!v)); } catch (e) {} },

    _installApi() {
      const hook = () => {
        window.galaxyExplorer = window.galaxyExplorer || {};
        window.galaxyExplorer.setVisorGlass = (v) => Visor.setOn(v);
        window.galaxyExplorer.setVisorGold = (v) => Visor.setGold(v);
      };
      hook();
      let n = 0;
      const keep = setInterval(() => {
        if (!window.galaxyExplorer || !window.galaxyExplorer.setVisorGlass) hook();
        if (++n > 40) clearInterval(keep);
      }, 500);
    },

    // eclipse: is any planet/moon sphere between the camera and the Sun?
    _inShadow(cam) {
      let list = [];
      try { list = (typeof objects !== 'undefined' && objects) || []; } catch (e) {}
      const P = cam.position, Lx = -P.x, Ly = -P.y, Lz = -P.z;
      const L = Math.hypot(Lx, Ly, Lz) || 1, dx = Lx / L, dy = Ly / L, dz = Lz / L;
      const w = this._sw || (this._sw = new T.Vector3());
      for (const o of list) {
        if (!o || !o.mesh || !o.radius || o.type === 'star' || o.name === 'Sun') continue;
        o.mesh.getWorldPosition(w);
        const ox = w.x - P.x, oy = w.y - P.y, oz = w.z - P.z;
        const t = ox * dx + oy * dy + oz * dz;
        if (t <= 0 || t >= L) continue;
        const px = ox - dx * t, py = oy - dy * t, pz = oz - dz * t;
        if (px * px + py * py + pz * pz < o.radius * o.radius) return true;
      }
      return false;
    },

    update(dt) {
      if (!this.pass) return;
      const rc = this.rc, cam = rc && rc.camera;
      if (!cam) return;
      dt = Math.min(Math.max(dt || 0.016, 0), 0.1);

      this._apply();
      if (!this.pass.enabled) return;
      const u = this.pass.uniforms;

      // camera-space direction to the Sun (Sun sits at the origin); scratch objects, no allocs
      const S_ = this._s || (this._s = { toSun: new T.Vector3(), camDir: new T.Vector3(), q: new T.Quaternion(),
                                          ndc: new T.Vector3(), size: new T.Vector2() });
      const toSun = S_.toSun.copy(cam.position).negate();
      const dist = toSun.length() || 1;
      toSun.divideScalar(dist);
      const facing = S_.camDir.set(0, 0, -1).applyQuaternion(cam.quaternion).dot(toSun);
      u.uSunView.value.copy(toSun).applyQuaternion(S_.q.copy(cam.quaternion).invert());
      const ndc = S_.ndc.set(0, 0, 0).project(cam);
      u.uSunUv.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
      u.uAspect.value = cam.aspect || 1;
      u.uTanHalf.value = Math.tan((cam.fov || 60) * Math.PI / 360);
      u.uSunDiskAng.value = Math.atan(15 / dist);           // Sun radius 15 scene units
      const size = rc.renderer.getDrawingBufferSize(S_.size);
      u.uTexPerH.value = size.y / this._scratch.image.height;

      // eclipse test ~6x a second
      if ((this._frame++ % 10) === 0) this._lit = this._inShadow(cam) ? 0 : 1;
      // irradiance at the glass: 1/r^2 in real AU, log-compressed to a visual 0..1.3
      const au = Math.max(0.05, sceneToAU(dist));
      const S = 1 / (au * au);
      const pw = Math.max(0, Math.min(1.3, 1 + 0.3 * Math.log10(S))) * this._lit;
      // the auto-darkening solar filter (Star.js) mutes the glints a little, never fully
      const target = pw * (1 - 0.35 * (window.__sunFilter || 0));
      this._sunPow += (target - this._sunPow) * Math.min(1, dt * 4);
      u.uSunPower.value = this._sunPow;

      // glass thermal proxy: cold (frost) below ~0.15 Earth sunlight or in shadow
      const Seff = S * this._lit;
      const wantFrost = Seff > 0.25 ? 0 : Math.min(1, Math.log10(0.25 / Math.max(Seff, 1e-4)) / 2.2);
      const rate = wantFrost > this.frost ? 1 / 25 : 1 / 5;   // creeps in ~25 s, sublimes ~5 s
      this.frost += (wantFrost - this.frost) * Math.min(1, dt * rate);
      if (window.__visorFrostOverride !== undefined) this.frost = window.__visorFrostOverride;
      u.uFrost.value = this.frost;
      u.uGold.value += (this.gold - u.uGold.value) * Math.min(1, dt * 3);

      this.light.sun = this._sunPow; this.light.lit = this._lit; this.light.facing = facing;
    }
  };

  window.Visor = Visor;

  // Driven by the engine's UpdateLoop tick (pauses with it, runs before the composer
  // render so the uniforms land in the same frame).
  if (window.rtAddTick) {
    window.rtAddTick('Visor', (dt) => {
      try { Visor.update(dt); } catch (e) { if (!Visor._warned) { Visor._warned = true; console.warn('Visor update', e); } }
    });
  }

  // Fallback attach if the main.js hook line is ever lost in a merge.
  let tries = 0;
  const fb = setInterval(() => {
    let rc = null;
    try { rc = (typeof rendererCore !== 'undefined') ? rendererCore : null; } catch (e) {}
    if (Visor.pass || ++tries > 60) { clearInterval(fb); return; }
    if (rc && rc.composer) { Visor.attach(rc.composer, rc); clearInterval(fb); }
  }, 1000);
})();
