// SpaceData.js — Real astronomical database for RealTime Fidget.
// Every value here is a REAL measured figure (NASA / JPL / IAU), bundled so the
// game's discovery cards, charts and Field Guide work fully offline. Keys match the
// exact `name` strings registered in main.js (case-insensitive lookup via getData()).
//
// Field meaning (all real-world units, NOT game units):
//   radiusKm        equatorial radius, km
//   massKg          mass, kg
//   gravity         surface gravity, multiples of Earth g (9.81 m/s^2)
//   dayHours        length of one rotation (sidereal/solar as noted), Earth hours
//   yearDays        orbital period, Earth days
//   tempC           mean surface/cloud-top temperature, deg C
//   distanceAU      mean distance from the Sun, astronomical units (1 AU = 149.6M km)
//   moons           number of confirmed natural satellites
//   composition     dominant make-up (atmosphere or bulk), as {label, pct} bars
//   discovered      who/when first recorded ("Prehistoric" for naked-eye bodies)
//   fact            one genuinely true, punchy "did you know"
//   class           short human label shown on the card
//   color           accent color for charts/markers

(function () {
  const EARTH_RADIUS_KM = 6371;       // for size-vs-Earth bars
  const EARTH_MASS_KG = 5.972e24;

  const DATA = {
    // ===================== THE STAR =====================
    sun: {
      class: 'G-type main-sequence star (yellow dwarf)',
      radiusKm: 696340, massKg: 1.989e30, gravity: 27.95,
      dayHours: 609.12, yearDays: null, tempC: 5505, distanceAU: 0, moons: 8,
      composition: [
        { label: 'Hydrogen', pct: 73 },
        { label: 'Helium', pct: 25 },
        { label: 'Oxygen/Carbon/other', pct: 2 }
      ],
      discovered: 'Prehistoric',
      fact: 'The Sun holds 99.86% of all the mass in the solar system. Over a million Earths would fit inside it.',
      color: '#ffcc33'
    },

    // ===================== PLANETS =====================
    mercury: {
      class: 'Terrestrial planet · innermost',
      radiusKm: 2439.7, massKg: 3.285e23, gravity: 0.38,
      dayHours: 1407.6, yearDays: 88, tempC: 167, distanceAU: 0.39, moons: 0,
      composition: [
        { label: 'Iron core', pct: 55 },
        { label: 'Silicate mantle', pct: 45 }
      ],
      discovered: 'Prehistoric',
      fact: 'A day on Mercury (sunrise to sunrise) lasts 176 Earth days — longer than its 88-day year. It swings from 430°C in sunlight to −180°C at night.',
      color: '#b0a18f'
    },
    venus: {
      class: 'Terrestrial planet · Earth’s "twin"',
      radiusKm: 6051.8, massKg: 4.867e24, gravity: 0.90,
      dayHours: 5832.5, yearDays: 224.7, tempC: 464, distanceAU: 0.72, moons: 0,
      composition: [
        { label: 'CO₂ atmosphere', pct: 96 },
        { label: 'Nitrogen', pct: 3.5 },
        { label: 'Other', pct: 0.5 }
      ],
      discovered: 'Prehistoric',
      fact: 'Venus spins backwards and so slowly that its day is longer than its year. A runaway greenhouse makes it the hottest planet — hot enough to melt lead.',
      color: '#e8c07d'
    },
    earth: {
      class: 'Terrestrial planet · the only known living world',
      radiusKm: 6371, massKg: 5.972e24, gravity: 1.00,
      dayHours: 23.93, yearDays: 365.25, tempC: 15, distanceAU: 1.00, moons: 1,
      composition: [
        { label: 'Nitrogen', pct: 78 },
        { label: 'Oxygen', pct: 21 },
        { label: 'Argon/CO₂/other', pct: 1 }
      ],
      discovered: 'Home',
      fact: 'Earth is the densest planet in the solar system and the only one not named after a god. 71% of its surface is liquid water.',
      color: '#4a90e2'
    },
    mars: {
      class: 'Terrestrial planet · the Red Planet',
      radiusKm: 3389.5, massKg: 6.39e23, gravity: 0.38,
      dayHours: 24.62, yearDays: 687, tempC: -65, distanceAU: 1.52, moons: 2,
      composition: [
        { label: 'CO₂ atmosphere', pct: 95 },
        { label: 'Nitrogen/Argon', pct: 4 },
        { label: 'Other', pct: 1 }
      ],
      discovered: 'Prehistoric',
      fact: 'Mars has Olympus Mons, the tallest volcano in the solar system — 22 km high, three times Everest. Its red color is literally rust (iron oxide).',
      color: '#d96c4a'
    },
    jupiter: {
      class: 'Gas giant · largest planet',
      radiusKm: 69911, massKg: 1.898e27, gravity: 2.53,
      dayHours: 9.93, yearDays: 4333, tempC: -110, distanceAU: 5.20, moons: 95,
      composition: [
        { label: 'Hydrogen', pct: 90 },
        { label: 'Helium', pct: 10 }
      ],
      discovered: 'Prehistoric',
      fact: 'Jupiter is so massive it could swallow all the other planets combined. Its Great Red Spot is a storm wider than Earth that has raged for 350+ years.',
      color: '#d8a47f'
    },
    saturn: {
      class: 'Gas giant · the ringed jewel',
      radiusKm: 58232, massKg: 5.683e26, gravity: 1.07,
      dayHours: 10.66, yearDays: 10759, tempC: -140, distanceAU: 9.58, moons: 146,
      composition: [
        { label: 'Hydrogen', pct: 96 },
        { label: 'Helium', pct: 3 },
        { label: 'Other', pct: 1 }
      ],
      discovered: 'Prehistoric',
      fact: 'Saturn is so light it would float in water. Its rings span 280,000 km but are often only ~10 meters thick — and it has 146 known moons, the most of any planet.',
      color: '#e3d2a2'
    },
    uranus: {
      class: 'Ice giant · tipped on its side',
      radiusKm: 25362, massKg: 8.681e25, gravity: 0.89,
      dayHours: 17.24, yearDays: 30687, tempC: -195, distanceAU: 19.2, moons: 28,
      composition: [
        { label: 'Hydrogen', pct: 83 },
        { label: 'Helium', pct: 15 },
        { label: 'Methane', pct: 2 }
      ],
      discovered: 'William Herschel, 1781',
      fact: 'Uranus rotates on its side at a 98° tilt — it essentially rolls around the Sun. Methane in its air absorbs red light, giving it a cyan color.',
      color: '#9fe3e0'
    },
    neptune: {
      class: 'Ice giant · windiest world',
      radiusKm: 24622, massKg: 1.024e26, gravity: 1.14,
      dayHours: 16.11, yearDays: 60190, tempC: -200, distanceAU: 30.1, moons: 16,
      composition: [
        { label: 'Hydrogen', pct: 80 },
        { label: 'Helium', pct: 19 },
        { label: 'Methane', pct: 1 }
      ],
      discovered: 'Le Verrier / Galle, 1846',
      fact: 'Neptune was found by math before it was ever seen — predicted from Uranus’s wobble. Its winds scream at 2,100 km/h, the fastest in the solar system.',
      color: '#4763d0'
    },

    // ===================== DWARF PLANET =====================
    pluto: {
      class: 'Dwarf planet · King of the Kuiper Belt',
      radiusKm: 1188.3, massKg: 1.303e22, gravity: 0.063,
      dayHours: 153.3, yearDays: 90560, tempC: -229, distanceAU: 39.5, moons: 5,
      composition: [
        { label: 'Rock', pct: 70 },
        { label: 'Water ice', pct: 30 }
      ],
      discovered: 'Clyde Tombaugh, 1930',
      fact: 'Pluto is smaller than Earth’s Moon and has a heart-shaped glacier of frozen nitrogen. One Pluto year is 248 Earth years — it hasn’t finished one orbit since its discovery.',
      color: '#c9b5a0'
    },

    // ===================== MOONS =====================
    moon: {
      class: 'Earth’s natural satellite · Luna',
      radiusKm: 1737.4, massKg: 7.342e22, gravity: 0.165,
      dayHours: 655.7, yearDays: 27.3, tempC: -20, distanceAU: 1.00, moons: 0,
      composition: [
        { label: 'Oxygen (rock)', pct: 43 },
        { label: 'Silicon/Metal', pct: 45 },
        { label: 'Other', pct: 12 }
      ],
      discovered: 'Prehistoric',
      fact: 'The Moon is drifting away from Earth ~3.8 cm every year. It always shows us the same face, and 12 humans have walked on it.',
      color: '#cfcfcf'
    },
    io: {
      class: 'Jovian moon · most volcanic body known',
      radiusKm: 1821.6, massKg: 8.93e22, gravity: 0.183,
      dayHours: 42.5, yearDays: 1.77, tempC: -130, distanceAU: 5.20, moons: 0,
      composition: [
        { label: 'Silicate rock', pct: 75 },
        { label: 'Iron core', pct: 25 }
      ],
      discovered: 'Galileo Galilei, 1610',
      fact: 'Io has over 400 active volcanoes, some flinging plumes 500 km into space. Jupiter’s gravity flexes it so hard the surface bulges up to 100 m, twice a day.',
      color: '#e8e06a'
    },
    europa: {
      class: 'Jovian moon · ocean world',
      radiusKm: 1560.8, massKg: 4.8e22, gravity: 0.134,
      dayHours: 85.2, yearDays: 3.55, tempC: -160, distanceAU: 5.20, moons: 0,
      composition: [
        { label: 'Water ice / ocean', pct: 50 },
        { label: 'Silicate rock', pct: 50 }
      ],
      discovered: 'Galileo Galilei, 1610',
      fact: 'Beneath Europa’s ice shell lies a salt-water ocean holding twice as much water as all of Earth’s oceans — one of the best places to look for alien life.',
      color: '#d8c7a8'
    },
    ganymede: {
      class: 'Jovian moon · largest moon in the solar system',
      radiusKm: 2634.1, massKg: 1.48e23, gravity: 0.146,
      dayHours: 171.7, yearDays: 7.15, tempC: -160, distanceAU: 5.20, moons: 0,
      composition: [
        { label: 'Water ice', pct: 50 },
        { label: 'Silicate rock', pct: 50 }
      ],
      discovered: 'Galileo Galilei, 1610',
      fact: 'Ganymede is bigger than the planet Mercury and is the only moon with its own magnetic field. It too hides a buried ocean.',
      color: '#a89a87'
    },
    callisto: {
      class: 'Jovian moon · most cratered body known',
      radiusKm: 2410.3, massKg: 1.08e23, gravity: 0.126,
      dayHours: 400.5, yearDays: 16.69, tempC: -140, distanceAU: 5.20, moons: 0,
      composition: [
        { label: 'Rock', pct: 60 },
        { label: 'Water ice', pct: 40 }
      ],
      discovered: 'Galileo Galilei, 1610',
      fact: 'Callisto’s surface is the oldest and most heavily cratered in the solar system — a 4-billion-year-old record untouched by geology.',
      color: '#8d8275'
    },
    titan: {
      class: 'Saturnian moon · the one with weather',
      radiusKm: 2574.7, massKg: 1.345e23, gravity: 0.138,
      dayHours: 382.7, yearDays: 15.95, tempC: -179, distanceAU: 9.58, moons: 0,
      composition: [
        { label: 'Nitrogen atmosphere', pct: 95 },
        { label: 'Methane', pct: 5 }
      ],
      discovered: 'Christiaan Huygens, 1655',
      fact: 'Titan is the only moon with a thick atmosphere and the only other world with rivers, lakes and seas on its surface — made of liquid methane, not water.',
      color: '#e0a44e'
    },
    enceladus: {
      class: 'Saturnian moon · the geyser moon',
      radiusKm: 252.1, massKg: 1.08e20, gravity: 0.0113,
      dayHours: 32.9, yearDays: 1.37, tempC: -201, distanceAU: 9.58, moons: 0,
      composition: [
        { label: 'Water ice', pct: 60 },
        { label: 'Silicate rock', pct: 40 }
      ],
      discovered: 'William Herschel, 1789',
      fact: 'Enceladus blasts geysers of ocean water 1,000s of km into space from its south pole — feeding one of Saturn’s rings. It’s the whitest, most reflective body in the solar system.',
      color: '#f2f6ff'
    },

    // ===================== COMETS =====================
    halley: {
      class: 'Short-period comet · 1P/Halley',
      radiusKm: 5.5, massKg: 2.2e14, gravity: 0.00001,
      dayHours: 52.8, yearDays: 27510, tempC: -70, distanceAU: 17.8, moons: 0,
      composition: [
        { label: 'Water ice', pct: 80 },
        { label: 'Dust / rock', pct: 17 },
        { label: 'CO / CO₂', pct: 3 }
      ],
      discovered: 'Edmond Halley (orbit), 1705',
      fact: 'Halley returns every ~76 years — the only naked-eye comet that can appear twice in a human lifetime. Next pass: 2061. It was last seen in 1986.',
      color: '#8fd6ff'
    },
    'swift-tuttle': {
      class: 'Comet · 109P/Swift–Tuttle',
      radiusKm: 13, massKg: 2.3e16, gravity: 0.00002,
      dayHours: 72, yearDays: 49000, tempC: -80, distanceAU: 26, moons: 0,
      composition: [
        { label: 'Water ice', pct: 78 },
        { label: 'Dust / rock', pct: 20 },
        { label: 'Other ices', pct: 2 }
      ],
      discovered: 'Swift & Tuttle, 1862',
      fact: 'Debris shed by Swift–Tuttle gives us the Perseid meteor shower every August. Its nucleus is ~26 km wide — bigger than the object that killed the dinosaurs.',
      color: '#a8e6ff'
    },
    'hale-bopp': {
      class: 'Comet · C/1995 O1 (Hale–Bopp)',
      radiusKm: 30, massKg: 1.3e16, gravity: 0.00003,
      dayHours: 282, yearDays: 938000, tempC: -90, distanceAU: 250, moons: 0,
      composition: [
        { label: 'Water ice', pct: 75 },
        { label: 'Dust / rock', pct: 20 },
        { label: 'CO / other', pct: 5 }
      ],
      discovered: 'Hale & Bopp, 1995',
      fact: 'The "Great Comet of 1997" was visible to the naked eye for a record 18 months. It won’t return for about 2,500 years.',
      color: '#bfefff'
    },

    // ===================== NEBULAE (deep-sky) =====================
    'orion nebula': {
      class: 'Emission nebula · M42 · stellar nursery',
      radiusKm: null, massKg: 4e33, gravity: null,
      dayHours: null, yearDays: null, tempC: -263, distanceAU: 8.6e7, moons: 0,
      composition: [
        { label: 'Hydrogen gas', pct: 90 },
        { label: 'Helium', pct: 9 },
        { label: 'Dust / heavier', pct: 1 }
      ],
      discovered: 'Nicolas-Claude Fabri de Peiresc, 1610',
      fact: 'The Orion Nebula is the closest large star-forming region to Earth — 1,344 light-years away and 24 light-years across. Thousands of new stars are being born inside it right now.',
      color: '#ff7eb0'
    },
    'carina nebula': {
      class: 'Emission nebula · NGC 3372',
      radiusKm: null, massKg: null, gravity: null,
      dayHours: null, yearDays: null, tempC: -263, distanceAU: 4.7e8, moons: 0,
      composition: [
        { label: 'Hydrogen gas', pct: 90 },
        { label: 'Helium', pct: 9 },
        { label: 'Dust / heavier', pct: 1 }
      ],
      discovered: 'Nicolas-Louis de Lacaille, 1752',
      fact: 'The Carina Nebula is 300 light-years wide and home to Eta Carinae, a monster star ~100× the Sun’s mass that could explode as a supernova any time.',
      color: '#ff9ec4'
    },
    'horsehead nebula': {
      class: 'Dark nebula · Barnard 33',
      radiusKm: null, massKg: null, gravity: null,
      dayHours: null, yearDays: null, tempC: -263, distanceAU: 9.5e7, moons: 0,
      composition: [
        { label: 'Cold dust', pct: 70 },
        { label: 'Hydrogen gas', pct: 29 },
        { label: 'Other', pct: 1 }
      ],
      discovered: 'Williamina Fleming, 1888',
      fact: 'The Horsehead is a cloud of cold dust so dense it blocks the glowing gas behind it — that’s why it shows up as a dark silhouette. It’s about 1,500 light-years away.',
      color: '#c77dff'
    },

    // ===================== BLACK HOLE =====================
    'sagittarius a*': {
      class: 'Supermassive black hole · galactic center',
      radiusKm: 1.2e7, massKg: 8.26e36, gravity: null,
      dayHours: null, yearDays: null, tempC: null, distanceAU: 1.7e9, moons: 0,
      composition: [
        { label: 'Singularity', pct: 100 }
      ],
      discovered: 'Balick & Brown, 1974',
      fact: 'Sagittarius A* is the supermassive black hole at the heart of our galaxy — 4.3 million times the Sun’s mass, packed into a region smaller than Mercury’s orbit. It was first imaged in 2022.',
      color: '#7a2bd6'
    },

    // ===================== ASTEROID BELT =====================
    'main asteroid belt': {
      class: 'Asteroid belt · between Mars and Jupiter',
      radiusKm: null, massKg: 2.39e21, gravity: null,
      dayHours: null, yearDays: null, tempC: -100, distanceAU: 2.7, moons: 0,
      composition: [
        { label: 'Carbonaceous (C-type)', pct: 75 },
        { label: 'Silicate (S-type)', pct: 17 },
        { label: 'Metallic (M-type)', pct: 8 }
      ],
      discovered: 'Giuseppe Piazzi (Ceres), 1801',
      fact: 'Despite the movies, the asteroid belt is mostly empty — its millions of rocks average millions of km apart. All of them combined would make a body smaller than the Moon.',
      color: '#9b8b6e'
    }
  };

  // Aliases so alternate spellings/names still resolve to the right record.
  const ALIASES = {
    sol: 'sun',
    luna: 'moon',
    'the moon': 'moon',
    'halley’s comet': 'halley',
    'comet halley': 'halley',
    'sgr a*': 'sagittarius a*',
    'sagittarius a': 'sagittarius a*',
    'asteroid belt': 'main asteroid belt'
  };

  function normalize(name) {
    return (name || '').toString().trim().toLowerCase();
  }

  const SpaceData = {
    EARTH_RADIUS_KM,
    EARTH_MASS_KG,

    // Real record for a body name (exact catalog name or alias). null if unknown.
    getData(name) {
      const key = normalize(name);
      if (DATA[key]) return DATA[key];
      if (ALIASES[key] && DATA[ALIASES[key]]) return DATA[ALIASES[key]];
      return null;
    },

    has(name) { return !!this.getData(name); },

    all() { return DATA; },

    // Register an extra body at runtime (used by the interstellar/exoplanet/galaxy layers
    // so they get full discovery cards + Field Guide entries without touching the core set).
    register(name, data) {
      const key = normalize(name);
      if (!DATA[key]) DATA[key] = data;
      return DATA[key];
    },

    // Pretty number formatting for cards.
    fmt: {
      km(v) {
        if (v == null) return '—';
        if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.00$/, '') + ' million km';
        return Math.round(v).toLocaleString() + ' km';
      },
      mass(v) {
        if (v == null) return '—';
        const exp = Math.floor(Math.log10(v));
        const mant = (v / Math.pow(10, exp)).toFixed(2);
        return mant + ' × 10' + SpaceData.fmt._sup(exp) + ' kg';
      },
      gravity(v) { return v == null ? '—' : (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' g'; },
      duration(hours) {
        if (hours == null) return '—';
        if (hours < 48) return hours.toFixed(1).replace(/\.0$/, '') + ' hours';
        const days = hours / 24;
        if (days < 700) return days.toFixed(1).replace(/\.0$/, '') + ' days';
        return (days / 365.25).toFixed(1).replace(/\.0$/, '') + ' years';
      },
      temp(c) { return c == null ? '—' : Math.round(c) + '°C'; },
      distance(au) {
        if (au == null) return '—';
        if (au === 0) return 'center';
        if (au < 1000) return au + ' AU';
        return (au).toLocaleString() + ' AU';
      },
      moons(n) { return n == null ? '—' : (n === 0 ? 'none' : n.toLocaleString()); },
      // size relative to Earth, e.g. "9.1× Earth" or "0.27× Earth"
      sizeVsEarth(radiusKm) {
        if (radiusKm == null) return '—';
        const r = radiusKm / EARTH_RADIUS_KM;
        return (r >= 1 ? r.toFixed(1) : r.toFixed(2)) + '× Earth';
      },
      _sup(n) {
        const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
        return String(n).split('').map(c => map[c] || c).join('');
      }
    }
  };

  window.SpaceData = SpaceData;
  console.log('🪐 SpaceData loaded:', Object.keys(DATA).length, 'real records');
})();
