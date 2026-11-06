// Spacecraft.js - real spacecraft at their true current positions.
//
// All numbers below came from JPL Horizons (ssd.jpl.nasa.gov, public domain), fetched
// 2026-11-05, ecliptic J2000, AU and AU/day. Nothing here calls a service at runtime:
//   * Voyager 1 / Voyager 2 / New Horizons: heliocentric state vector at JD 2461349.5
//     (2026-11-05 00:00 TDB), extrapolated linearly. They coast on near-straight escape
//     paths (the Sun's pull changes their speed by ~0.01%/yr), so this stays within a
//     tiny fraction of a degree for years.
//   * Parker Solar Probe: osculating heliocentric Keplerian elements at the same epoch,
//     propagated with Kepler's equation (its final 88-day orbit, no more Venus flybys).
//   * JWST: geocentric vectors every 5 days, 2026-09-01 to 2028-12-29, from the Goddard
//     FDF predicted ephemeris, linearly interpolated (so its real halo orbit around
//     Sun-Earth L2 shows). Outside that window it sits at the L2 point itself.
// Positions use the same scene mapping as the planets (Ephemeris.helioToScene for the
// Sun-centred ones, Ephemeris.geoToScene around Earth for JWST) and the shared sim clock.

(function () {
  'use strict';

  const EPOCH_JD = 2461349.5;
  const LINEAR = [
    { name: 'Voyager 1',    color: 0xffd27a, p: [-32.204861, -137.099740, 99.193974],  v: [-0.0011952839, -0.0078611949, 0.0056782331] },
    { name: 'Voyager 2',    color: 0xffd27a, p: [39.975240, -105.653154, -89.932067],  v: [0.0024276556, -0.0053944122, -0.0065356843] },
    { name: 'New Horizons', color: 0xa8e0ff, p: [20.954452, -62.528278, 2.300454],     v: [0.0030648529, -0.0072112494, 0.0002837909] }
  ];
  // Parker Solar Probe osculating elements (Horizons, heliocentric, epoch EPOCH_JD)
  const PARKER = { e: 0.88202525, q: 0.045825328, i: 3.3911031, node: 76.481630, peri: 68.641022, tp: 2461376.5312349, n: 4.0712643 };
  // JWST geocentric ecliptic J2000, units of 1e-6 AU, every JW_STEP days from JW_START
  const JW_START = 2461284.5, JW_STEP = 5;
  const JW = [6494,-5456,1506,7111,-3990,1702,7571,-2432,1818,7869,-802,1848,7976,871,1791,7863,2528,1651,7533,4082,1435,7043,5456,1155,6483,6633,831,5901,7645,480,5304,8516,116,4691,9244,-252,4083,9802,-615,3538,10189,-965,3097,10457,-1289,2750,10660,-1579,2462,10822,-1831,2207,10931,-2042,1999,10966,-2209,1870,10958,-2326,1804,10950,-2388,1753,10972,-2393,1664,11014,-2343,1517,11034,-2244,1333,11011,-2095,1122,10974,-1896,848,10941,-1649,464,10896,-1362,-54,10790,-1044,-687,10565,-703,-1386,10212,-343,-2141,9750,29,-2968,9172,403,-3870,8436,763,-4812,7490,1092,-5708,6309,1376,-6483,4938,1604,-7106,3433,1760,-7565,1836,1831,-7846,173,1806,-7917,-1516,1687,-7753,-3151,1489,-7391,-4640,1227,-6911,-5936,918,-6383,-7048,574,-5842,-8011,208,-5280,-8843,-167,-4701,-9518,-534,-4150,-10021,-884,-3679,-10377,-1213,-3308,-10639,-1516,-3011,-10856,-1787,-2747,-11028,-2018,-2518,-11129,-2203,-2349,-11163,-2338,-2255,-11166,-2426,-2212,-11188,-2466,-2157,-11239,-2455,-2056,-11285,-2391,-1918,-11296,-2273,-1760,-11280,-2108,-1576,-11262,-1902,-1321,-11263,-1657,-944,-11245,-1375,-448,-11150,-1059,134,-10955,-718,778,-10664,-361,1488,-10294,1,2297,-9827,362,3203,-9200,717,4147,-8370,1051,5064,-7335,1348,5904,-6128,1591,6651,-4784,1766,7293,-3304,1864,7777,-1691,1877,8040,-3,1801,8055,1667,1636,7857,3224,1394,7524,4622,1093,7109,5875,752,6620,6993,387,6065,7958,8,5472,8739,-374,4904,9328,-748,4415,9768,-1099,4004,10118,-1421,3642,10398,-1707,3313,10598,-1955,3034,10702,-2161,2842,10733,-2317,2734,10750,-2417,2662,10786,-2460,2576,10834,-2449,2458,10863,-2385,2324,10856,-2269,2185,10842,-2097,2004,10853,-1874,1727,10875,-1608,1323,10865,-1305,803,10771,-974,206,10580,-617,-462,10315,-240,-1230,9968,145,-2112,9495,523,-3086,8838,882,-4081,7960,1209,-5027,6883,1492,-5899,5645,1715,-6678,4254,1859,-7327,2717,1910,-7787,1059,1863,-7997,-642,1723,-7964,-2274,1503,-7753,-3767,1217,-7430,-5105,879,-7032,-6303,504,-6562,-7368,112,-6028,-8266,-281,-5483,-8971,-663,-4989,-9507,-1029,-4571,-9924,-1373,-4217,-10267,-1685,-3891,-10543,-1958,-3597,-10725,-2184,-3368,-10817,-2361,-3225,-10861,-2491,-3146,-10907,-2570,-3078,-10974,-2595,-2982,-11032,-2563,-2867,-11056,-2475,-2753,-11056,-2336,-2631,-11065,-2151,-2455,-11105,-1922,-2171,-11148,-1650,-1773,-11140,-1338,-1290,-11055,-997,-740,-10904,-635,-113,-10702,-261,630,-10434,120,1499,-10038,501,2447,-9464,870,3417,-8704,1210,4371,-7780,1506,5297,-6709,1745,6188,-5472,1915,6985,-4047,2005,7602,-2469,2002,7988,-821,1900,8144,802,1707,8122,2334,1437,7967,3768,1110,7680,5099,740,7269,6288,342,6770,7295,-70,6246,8100,-481,5763,8735,-876,5331,9259,-1245,4924,9689,-1583,4537,10014,-1885,4194,10219,-2145,3933,10326,-2354,3767,10392,-2505,3649,10463,-2599,3535,10530,-2636,3411,10571,-2616,3291,10575,-2537,3189,10571,-2397,3071,10601,-2199,2875,10660,-1952,2568,10707,-1662];
  const L2_AU = 0.0100; // Sun-Earth L2 is ~1.5 million km anti-sunward of Earth

  const DEG = Math.PI / 180;

  function jwstGeo(jd, out) {
    const n = JW.length / 3;
    const f = (jd - JW_START) / JW_STEP;
    if (f < 0 || f > n - 1) return null;
    const i = Math.min(n - 2, Math.floor(f)), t = f - i;
    const a = i * 3, b = a + 3;
    const o = out || [0, 0, 0];
    for (let k = 0; k < 3; k++) o[k] = (JW[a + k] + (JW[b + k] - JW[a + k]) * t) * 1e-6;
    return o;
  }

  function parkerHelio(jd, out) {
    const Eph = window.Ephemeris;
    const a = PARKER.q / (1 - PARKER.e);
    let M = (PARKER.n * (jd - PARKER.tp)) % 360;
    return Eph.fromElements(a, PARKER.e, PARKER.i * DEG, PARKER.peri * DEG, PARKER.node * DEG, M * DEG, out);
  }

  class SpacecraftLayer {
    constructor() {
      this.craft = [];
      this._tmp = new window.THREE.Vector3();
      this._a = [0, 0, 0];   // scratch arrays: _place runs every frame and allocates nothing
      this._b = [0, 0, 0];
      this._tryAttach(0);
    }

    _earth() {
      const cat = window.celestialCatalog || (window.explorationTracker && window.explorationTracker.catalog);
      return cat ? cat.getByName('Earth') : null;
    }

    _tryAttach(tries) {
      const earth = this._earth();
      if (!earth || !earth.mesh || !window.THREE || !window.Ephemeris) {
        if (tries < 40) setTimeout(() => this._tryAttach(tries + 1), 500);
        return;
      }
      this.earthMesh = earth.mesh;
      let n = earth.mesh; while (n.parent) n = n.parent;
      this.scene = n;
      LINEAR.forEach(c => this._add(c.name, c.color, 'linear', c));
      this._add('Parker Solar Probe', 0xffa060, 'parker', null);
      this._add('JWST', 0xffe7a0, 'jwst', null);
      this._loop();
      console.log('🛰️ Spacecraft placed at real positions: ' + this.craft.map(c => c.name).join(', '));
    }

    _add(name, color, kind, data) {
      const THREE = window.THREE;
      const group = new THREE.Group();
      // screen-constant marker + label (sizeAttenuation off) so a probe 170 AU out is findable
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glow(), color, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, sizeAttenuation: false
      }));
      dot.scale.setScalar(0.022);
      group.add(dot);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._label(name), transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false
      }));
      label.scale.set(0.16, 0.03, 1);
      label.center.set(0.5, -0.35);
      group.add(label);
      this.scene.add(group);
      const entry = { name, kind, data, mesh: group, radius: kind === 'jwst' ? 1.2 : 4 };
      this.craft.push(entry);
      window.__universe = window.__universe || [];
      window.__universe.push({ name, mesh: group, radius: entry.radius });
    }

    _glow() {
      if (this._glowTex) return this._glowTex;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      this._glowTex = new window.THREE.CanvasTexture(c);
      return this._glowTex;
    }

    _label(text) {
      const c = document.createElement('canvas'); c.width = 320; c.height = 60;
      const g = c.getContext('2d');
      g.font = '600 28px -apple-system, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(text, 161, 31);
      g.fillStyle = '#e6f2ff'; g.fillText(text, 160, 30);
      return new window.THREE.CanvasTexture(c);
    }

    _place() {
      const Eph = window.Ephemeris;
      const jd = Eph.clock.jd();
      this.earthMesh.getWorldPosition(this._tmp);
      const earthW = this._tmp;
      const cam = window.explorationTracker && window.explorationTracker.camera;
      const A = this._a, B = this._b;
      for (let ci = 0; ci < this.craft.length; ci++) {
        const c = this.craft[ci];
        let p = B;
        if (c.kind === 'linear') {
          const dt = jd - EPOCH_JD;
          A[0] = c.data.p[0] + c.data.v[0] * dt; A[1] = c.data.p[1] + c.data.v[1] * dt; A[2] = c.data.p[2] + c.data.v[2] * dt;
          Eph.helioToScene(A, B);
        } else if (c.kind === 'parker') {
          Eph.helioToScene(parkerHelio(jd, A), B);
        } else {
          let g = jwstGeo(jd, A);
          if (!g) {
            // outside the tabulated window only (rare): planetHelio allocates, acceptable here
            const e = Eph.planetHelio('Earth', jd), r = Math.hypot(e[0], e[1], e[2]);
            A[0] = e[0] / r * L2_AU; A[1] = e[1] / r * L2_AU; A[2] = e[2] / r * L2_AU; g = A;
          }
          Eph.geoToScene(g, B);
          B[0] += earthW.x; B[1] += earthW.y; B[2] += earthW.z;
          // only near Earth: from across the system its label would sit on top of Earth's
          if (cam) c.mesh.visible = cam.position.distanceTo(earthW) < 300;
        }
        c.mesh.position.set(p[0], p[1], p[2]);
      }
    }

    // Runs inside the engine's UpdateLoop tick (pauses with it, positions land the same frame).
    _loop() {
      let dead = false;
      window.rtAddTick('Spacecraft', () => {
        if (dead) return;
        try { this._place(); } catch (e) { dead = true; console.error('Spacecraft update failed', e); }
      });
    }
  }

  window.SpacecraftData = { EPOCH_JD, LINEAR, PARKER, jwstGeo, parkerHelio };
  function boot() { if (!window.spacecraftLayer) { try { window.spacecraftLayer = new SpacecraftLayer(); } catch (e) { console.error('Spacecraft boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1500);
  else window.addEventListener('load', () => setTimeout(boot, 1500));
})();
