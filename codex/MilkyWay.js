// MilkyWay.js — our own galaxy's band as REAL 3D structure (not a painted canvas).
//
// The naked-eye Milky Way is billions of unresolved disk stars concentrated along
// the galactic plane, brightest toward the core in Sagittarius. This layer builds
// that band from ~55,000 faint points at plausible disk distances (1k–40k ly,
// sqrt-compressed like every other layer), oriented along the REAL galactic plane
// (north galactic pole at RA 12.857h, Dec +27.13°; center at RA 17.76h, Dec −29°).
// So: it parallaxes as you fly, the core glows in the right part of the sky, the
// band sits exactly where the real Milky Way sits — honest statistics standing in
// for stars no instrument can resolve individually.

(function () {
  'use strict';

  const N = 55000;

  // J2000 equatorial unit vector from RA (hours) / Dec (deg), in scene axes (Y up).
  function dir(raH, decDeg) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
  }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.7; }

  class MilkyWay {
    constructor(THREE, scene) {
      // Galactic basis in scene coordinates: Z' → galactic center, Y' → north
      // galactic pole, X' completes the frame.
      const gc = new THREE.Vector3(...dir(17.761, -28.94)).normalize();   // Sgr A* direction
      const ngp = new THREE.Vector3(...dir(12.857, 27.13)).normalize();   // north galactic pole
      const gx = new THREE.Vector3().crossVectors(ngp, gc).normalize();
      const gy = ngp, gz = gc;

      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const siz = new Float32Array(N);
      const gameRadius = (ly) => Math.sqrt(ly) * 150;

      for (let i = 0; i < N; i++) {
        // Distance: disk stars 1k–40k ly, biased near (they dominate the glow).
        const ly = 1000 + Math.pow(Math.random(), 1.6) * 39000;
        const R = gameRadius(ly);

        // Angle around the band; density rises toward the galactic center (the
        // Sagittarius glow) and dips behind us toward the anticenter.
        let theta;
        do { theta = (Math.random() * 2 - 1) * Math.PI; }
        while (Math.random() > 0.35 + 0.65 * Math.pow(Math.cos(theta / 2), 2));

        // Height above the plane: thin disk, slightly thicker far out.
        const h = gauss() * 0.05 * (0.7 + ly / 40000);

        const inPlane = Math.cos(theta), across = Math.sin(theta);
        const v = new THREE.Vector3()
          .addScaledVector(gz, inPlane)
          .addScaledVector(gx, across)
          .addScaledVector(gy, h)
          .normalize()
          .multiplyScalar(R);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;

        // Warm faint stars; a slice of dust-reddened dark patches along the core.
        const dust = Math.abs(theta) < 1.1 && Math.abs(h) < 0.02 && Math.random() < 0.22;
        const w = 0.55 + Math.random() * 0.45;
        if (dust) {
          col[i * 3] = 0.10 * w; col[i * 3 + 1] = 0.07 * w; col[i * 3 + 2] = 0.05 * w;
        } else {
          const blue = Math.random() < 0.18;
          col[i * 3]     = (blue ? 0.75 : 1.00) * 0.5 * w;
          col[i * 3 + 1] = (blue ? 0.82 : 0.93) * 0.5 * w;
          col[i * 3 + 2] = (blue ? 1.00 : 0.80) * 0.5 * w;
        }
        siz[i] = 0.8 + Math.random() * 1.4;
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: `
          attribute float aSize;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize;
          }`,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            gl_FragColor = vec4(vColor, smoothstep(0.5, 0.1, d) * 0.55);
          }`
      });

      this.mesh = new THREE.Points(g, m);
      this.mesh.renderOrder = -3;   // behind everything, with the deep sky
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
    }
  }

  const boot = setInterval(() => {
    let rc = null;
    try { rc = (typeof rendererCore !== 'undefined') ? rendererCore : null; } catch (e) {}
    if (!rc || !rc.scene || !window.THREE) return;
    clearInterval(boot);
    try {
      window.milkyWay = new MilkyWay(window.THREE, rc.scene);
      console.log('🌌 Milky Way band: 55k real-3D disk stars along the true galactic plane');
    } catch (e) {
      console.warn('MilkyWay init failed:', e);
    }
  }, 600);
})();
