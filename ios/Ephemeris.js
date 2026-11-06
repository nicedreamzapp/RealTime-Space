// Ephemeris.js - real positions of the planets and the Moon for any date.
//
// Planets: JPL "Keplerian Elements for Approximate Positions of the Major Planets"
// (E. M. Standish, JPL/Caltech), Table 1, valid 1800-2050 AD. Six elements per planet
// with linear rates per Julian century, J2000 ecliptic and equinox. Accuracy for
// 1800-2050 is well under a degree for every planet (arcminutes for the inner ones),
// far finer than one pixel of the compressed scene below.
//
// Moon: the low-precision lunar formulae of the Astronomical Almanac (also in Meeus,
// "Astronomical Algorithms"): the 6 biggest longitude terms, 4 latitude terms and the
// horizontal parallax. Good to about 0.3 degrees in direction and ~0.2% in distance,
// which is plenty to get the real phase and the real side of the sky tonight.
//
// Scene mapping (documented and monotonic, so ordering and directions are exact):
//   * Direction from the Sun is kept exactly. Ecliptic J2000 (X, Y, Z) maps to scene
//     (x, y, z) = (X, Z, -Y): scene +y is ecliptic north, and seen from above the
//     planets go round counter-clockwise, as they really do.
//   * Distance from the Sun r (AU) is squeezed by RADIUS_ANCHORS: piecewise linear in
//     log(r) through each planet's mean distance -> the app's historic scene radius.
//     Below Mercury it is linear down to the Sun's photosphere (0.00465 AU -> 15 units,
//     the Sun sphere's radius). Past Pluto it keeps going in log(r) with a gentler slope
//     so Voyager 1 (~170 AU) still lands inside the scene. Strictly increasing
//     everywhere, so which planet is nearer the Sun, and which side of the Sun every
//     body is on tonight, are both true.
//   * Around Earth (Moon, JWST, ISS) a separate linear scale is used: GEO_UNITS_PER_AU,
//     chosen so the Moon's mean distance (384,400 km) lands at 5 units as before.
//
// Sim clock: the scene runs on Ephemeris.clock. At time scale 1 it is LIVE (real time,
// locked to the device clock); faster scales run whole days per second (see rateFor).

(function () {
    'use strict';

    const DEG = Math.PI / 180;
    const J2000 = 2451545.0;

    // [a (AU), e, I (deg), L (deg), long.peri (deg), long.node (deg)] and rates per century
    const ELEMENTS = {
        Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
                  [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
        Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
                  [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
        // Earth = Earth-Moon barycenter (Standish gives EM-Bary; Earth itself sits 4,700 km off it)
        Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
                  [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
        Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
                  [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
        Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
                  [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
        Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
                  [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
        Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
                  [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
        Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
                  [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
        Pluto:   [[39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
                  [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482]]
    };

    // Monotonic radius compression: [AU, scene units]. Planet anchors are the planets'
    // mean distances (a) -> the scene radii the app has always used.
    const SUN_SURFACE_AU = 0.00465047;
    const RADIUS_ANCHORS = [
        [SUN_SURFACE_AU, 15],
        [0.38709927, 40],   // Mercury
        [0.72333566, 60],   // Venus
        [1.00000261, 85],   // Earth
        [1.52371034, 115],  // Mars
        [5.20288700, 200],  // Jupiter
        [9.53667594, 320],  // Saturn
        [19.18916464, 450], // Uranus
        [30.06992276, 550], // Neptune
        [39.48211675, 650]  // Pluto
    ];
    const OUTER_SLOPE = 200; // scene units per e-fold of distance beyond Pluto (Voyager 1 ~ 940)
    const GEO_UNITS_PER_AU = 5 / (384400 / 149597870.7); // Moon mean distance -> 5 units

    function mapRadius(r) {
        const A = RADIUS_ANCHORS;
        if (r <= A[0][0]) return A[0][1] * (r / A[0][0]);
        if (r <= A[1][0]) {   // Sun surface -> Mercury: linear (log would blow up near 0)
            return A[0][1] + (A[1][1] - A[0][1]) * (r - A[0][0]) / (A[1][0] - A[0][0]);
        }
        for (let i = 1; i < A.length - 1; i++) {
            if (r <= A[i + 1][0]) {
                const t = Math.log(r / A[i][0]) / Math.log(A[i + 1][0] / A[i][0]);
                return A[i][1] + t * (A[i + 1][1] - A[i][1]);
            }
        }
        const last = A[A.length - 1];
        return last[1] + OUTER_SLOPE * Math.log(r / last[0]);
    }
    // Exact inverse of mapRadius: scene units from the Sun -> real AU. The one shared
    // scene-to-AU mapping (Visor irradiance etc. use this, never their own table).
    function unmapRadius(d) {
        const A = RADIUS_ANCHORS;
        if (!(d > 0)) return 0;
        if (d <= A[0][1]) return A[0][0] * (d / A[0][1]);
        if (d <= A[1][1]) {
            return A[0][0] + (A[1][0] - A[0][0]) * (d - A[0][1]) / (A[1][1] - A[0][1]);
        }
        for (let i = 1; i < A.length - 1; i++) {
            if (d <= A[i + 1][1]) {
                const t = (d - A[i][1]) / (A[i + 1][1] - A[i][1]);
                return A[i][0] * Math.pow(A[i + 1][0] / A[i][0], t);
            }
        }
        const last = A[A.length - 1];
        return last[0] * Math.exp((d - last[1]) / OUTER_SLOPE);
    }

    function jdFromMs(ms) { return ms / 86400000 + 2440587.5; }

    function solveKepler(M, e) {
        let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
        for (let k = 0; k < 12; k++) {
            const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= dE;
            if (Math.abs(dE) < 1e-12) break;
        }
        return E;
    }

    // Heliocentric position from classical elements (angles in radians), AU, ecliptic J2000.
    function fromElements(a, e, I, w, Om, M, out) {
        let x, y;
        if (e < 1) {
            const E = solveKepler(M, e);
            x = a * (Math.cos(E) - e);
            y = a * Math.sqrt(1 - e * e) * Math.sin(E);
        } else {
            return null;
        }
        const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om);
        const cI = Math.cos(I), sI = Math.sin(I);
        const o = out || [0, 0, 0];   // optional out array: per-frame callers allocate nothing
        o[0] = (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y;
        o[1] = (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y;
        o[2] = (sw * sI) * x + (cw * sI) * y;
        return o;
    }

    function planetElements(name, jd) {
        const el = ELEMENTS[name];
        if (!el) return null;
        const T = (jd - J2000) / 36525;
        const v = el[0].map((x, i) => x + el[1][i] * T);
        const [a, e, I, L, peri, node] = v;
        let M = ((L - peri) % 360 + 540) % 360 - 180; // -180..180
        return { a, e, I: I * DEG, w: (peri - node) * DEG, Om: node * DEG, M: M * DEG };
    }

    // Heliocentric ecliptic J2000 position (AU) of a planet at Julian Date jd.
    function planetHelio(name, jd) {
        const k = planetElements(name, jd);
        if (!k) return null;
        return fromElements(k.a, k.e, k.I, k.w, k.Om, k.M);
    }

    // Sample one full orbit (elements frozen at jd) for drawing the true orbit path.
    function orbitPath(name, jd, segments) {
        const k = planetElements(name, jd);
        if (!k) return [];
        const pts = [];
        for (let i = 0; i <= segments; i++) {
            const M = (i / segments) * 2 * Math.PI;
            pts.push(helioToScene(fromElements(k.a, k.e, k.I, k.w, k.Om, M)));
        }
        return pts;
    }

    // Moon, geocentric ecliptic J2000 (AU). Astronomical Almanac low-precision formulae.
    function moonGeo(jd) {
        const T = (jd - J2000) / 36525;
        const s = (d) => Math.sin(d * DEG), c = (d) => Math.cos(d * DEG);
        let lam = 218.32 + 481267.881 * T
            + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T)
            + 0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T)
            - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
        const beta = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T)
            - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
        const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T)
            + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
        lam -= 1.3970 * T;               // ecliptic of date -> J2000 (general precession in longitude)
        const rKm = 6378.14 / Math.sin(par * DEG);
        const rAU = rKm / 149597870.7;
        const cb = Math.cos(beta * DEG);
        return [rAU * cb * Math.cos(lam * DEG), rAU * cb * Math.sin(lam * DEG), rAU * Math.sin(beta * DEG)];
    }

    // Ecliptic AU (heliocentric) -> scene units, direction exact, radius compressed.
    function helioToScene(v, out) {
        const o = out || [0, 0, 0];
        const r = Math.hypot(v[0], v[1], v[2]);
        if (r === 0) { o[0] = o[1] = o[2] = 0; return o; }
        const k = mapRadius(r) / r;
        const x = v[0] * k, y = v[2] * k, z = -v[1] * k;   // v may alias out
        o[0] = x; o[1] = y; o[2] = z;
        return o;
    }
    // Ecliptic AU (geocentric) -> scene offset from Earth, linear.
    function geoToScene(v, out) {
        const o = out || [0, 0, 0];
        const k = GEO_UNITS_PER_AU;
        const x = v[0] * k, y = v[2] * k, z = -v[1] * k;
        o[0] = x; o[1] = y; o[2] = z;
        return o;
    }

    // ---------------- sim clock ----------------
    // Time scale (the app's pill) -> simulated seconds per real second.
    //   0 paused, 1 LIVE (real time), 10 = 1 day/s, 100 = 10 days/s, 1000 = 100 days/s.
    function rateFor(scale) {
        if (!(scale > 0)) return 0;
        if (scale <= 1) return scale;
        return 86400 * scale / 10;
    }
    const clock = {
        simMs: Date.now(),
        scale: 1,
        get live() { return this.scale === 1; },
        jd() { return jdFromMs(this.simMs); },
        _lastWall: 0,
        // Uses its own wall-clock delta (clamped to 0.25 s, so a backgrounded app doesn't
        // leap years) rather than the render loop's dt, which is clamped to 0.1 s per frame
        // and would make "1 DAY/S" run slow whenever the frame rate dips below 10 fps.
        advance(dtSeconds, scale) {
            const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            const wall = this._lastWall ? Math.min(0.25, (now - this._lastWall) / 1000) : dtSeconds;
            this._lastWall = now;
            this.scale = scale;
            if (scale === 1) this.simMs = Date.now();         // LIVE: locked to the real clock
            else this.simMs += wall * 1000 * rateFor(scale);
        },
        date() { return new Date(this.simMs); }
    };

    window.Ephemeris = {
        ELEMENTS, RADIUS_ANCHORS, GEO_UNITS_PER_AU, SUN_SURFACE_AU,
        mapRadius, unmapRadius, jdFromMs, planetHelio, planetElements, orbitPath, moonGeo,
        helioToScene, geoToScene, fromElements, solveKepler, rateFor, clock
    };
})();
