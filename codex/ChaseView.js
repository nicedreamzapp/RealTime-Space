// ChaseView.js — the OUTSIDE-THE-SHIP camera (view mode: CHASE).
//
// Validated design: NavigationPhysics flies whatever object is `navPhysics.camera`.
// In chase mode we hand it an invisible rig, park a ship model on the rig, and the
// real camera trails behind with soft lag — every existing system (thrust, scan,
// star proximity, HUD) keeps working because the camera stays within ~15 units of
// the "you" point. Leaving chase mode hands the camera back seamlessly.

(function () {
  'use strict';

  class ChaseView {
    constructor(THREE, rc, np) {
      this.THREE = THREE; this.rc = rc; this.np = np;
      this.active = false;

      this.rig = new THREE.Object3D();
      rc.scene.add(this.rig);

      // ---- STARGAZER-class explorer: chrome hull that mirrors the real Milky Way
      // (scene.environment IBL), dark glass canopy, gold engine rings, cyan trim,
      // twin engines that idle blue and burn ORANGE under thrust — modeled on
      // Matt's Stargazer-07 concept art.
      const ship = new THREE.Group();
      const chrome = new THREE.MeshStandardMaterial({ color: 0xaebbc8, metalness: 0.95, roughness: 0.15 });
      chrome.envMapIntensity = 1.8;
      const darkMetal = new THREE.MeshStandardMaterial({ color: 0x232c36, metalness: 0.85, roughness: 0.3 });
      darkMetal.envMapIntensity = 1.2;
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1622, metalness: 0.9, roughness: 0.05 });
      glassMat.envMapIntensity = 2.2;
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a34a, metalness: 1.0, roughness: 0.25 });
      goldMat.envMapIntensity = 1.6;
      const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x35e0ff });

      // sleek teardrop hull
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 2.4, 20), chrome);
      nose.rotation.x = -Math.PI / 2; nose.position.z = -1.2;
      ship.add(nose);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.78, 2.6, 20), chrome);
      body.rotation.x = -Math.PI / 2; body.position.z = 1.3;
      ship.add(body);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.5, 0.8, 20), darkMetal);
      tail.rotation.x = -Math.PI / 2; tail.position.z = 3.0;
      ship.add(tail);

      // glass canopy bubble up front (the Stargazer's signature)
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
      canopy.scale.set(1, 0.7, 1.7);
      canopy.position.set(0, 0.4, -0.4);
      ship.add(canopy);

      // swept wings
      const wingGeo = new THREE.BoxGeometry(2.7, 0.07, 1.1);
      const wingL = new THREE.Mesh(wingGeo, chrome);
      wingL.position.set(-1.6, -0.08, 1.8); wingL.rotation.z = 0.16; wingL.rotation.y = -0.22;
      ship.add(wingL);
      const wingR = new THREE.Mesh(wingGeo, chrome);
      wingR.position.set(1.6, -0.08, 1.8); wingR.rotation.z = -0.16; wingR.rotation.y = 0.22;
      ship.add(wingR);

      // twin wing-tip engine nacelles with GOLD intake rings
      const nacGeo = new THREE.CylinderGeometry(0.3, 0.36, 1.5, 16);
      const ringGeo = new THREE.TorusGeometry(0.34, 0.07, 10, 24);
      this.engines = [];
      for (const side of [-1, 1]) {
        const nac = new THREE.Mesh(nacGeo, darkMetal);
        nac.rotation.x = -Math.PI / 2;
        nac.position.set(side * 2.5, -0.02, 1.9);
        ship.add(nac);
        const ring = new THREE.Mesh(ringGeo, goldMat);
        ring.position.set(side * 2.5, -0.02, 1.2);
        ship.add(ring);
        const ring2 = new THREE.Mesh(ringGeo, goldMat);
        ring2.position.set(side * 2.5, -0.02, 2.6);
        ship.add(ring2);
      }

      // cyan running-light strips along the hull (Stargazer trim)
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 3.6), cyanGlow);
        strip.position.set(side * 0.56, 0.12, 0.8);
        ship.add(strip);
      }

      // engine glow — blue at idle, ORANGE under thrust (like the concept art)
      const mkGlowTex = (r1, g1, b1) => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.35, 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',0.6)');
        grd.addColorStop(1, 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      };
      this._glowBlue = mkGlowTex(60, 190, 255);
      this._glowOrange = mkGlowTex(255, 150, 40);
      for (const side of [-1, 1]) {
        const e = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._glowBlue, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        e.position.set(side * 2.5, -0.02, 2.9);
        e.scale.setScalar(0.9);
        ship.add(e);
        this.engines.push(e);
      }
      this.engine = this.engines[0];   // legacy handle used by _tick scaling

      // nav lights
      const lightL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4455 }));
      lightL.position.set(-2.9, -0.05, 1.8); ship.add(lightL);
      const lightR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0x44ff88 }));
      lightR.position.set(2.9, -0.05, 1.8); ship.add(lightR);

      ship.visible = false;
      this.ship = ship;
      this.rig.add(ship);

      this._off = new THREE.Vector3(0, 3.5, 14);
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
    }

    enable() {
      if (this.active) return;
      const cam = this.rc.camera;
      this.rig.position.copy(cam.position);
      this.rig.quaternion.copy(cam.quaternion);
      this.np.camera = this.rig;      // physics now flies the rig
      this.ship.visible = true;
      this.active = true;
    }

    disable() {
      if (!this.active) return;
      const cam = this.rc.camera;
      // hand the camera back exactly where the ship is pointing
      cam.position.copy(this.rig.position);
      cam.quaternion.copy(this.rig.quaternion);
      this.np.camera = cam;
      this.ship.visible = false;
      this.active = false;
    }

    _tick() {
      if (this.active) {
        const cam = this.rc.camera;
        const want = this._off.clone().applyQuaternion(this.rig.quaternion).add(this.rig.position);
        cam.position.lerp(want, 0.16);
        cam.quaternion.slerp(this.rig.quaternion, 0.14);
        // engines: breathe with thrust, and burn ORANGE when firing (blue at idle)
        const thrusting = this.np.isThrusting || this.np.isBoosting;
        const target = thrusting ? (this.np.isBoosting ? 3.4 : 2.1) : 0.9;
        const wantTex = thrusting ? this._glowOrange : this._glowBlue;
        for (const e of (this.engines || [])) {
          e.scale.setScalar(e.scale.x + (target - e.scale.x) * 0.2);
          if (e.material.map !== wantTex) { e.material.map = wantTex; e.material.needsUpdate = true; }
        }
      }
      requestAnimationFrame(this._tick);
    }
  }

  // ---- boot + the three-mode view switcher (HELM / VISOR / CHASE)
  const boot = setInterval(() => {
    let rc = null, np = null;
    try {
      rc = (typeof rendererCore !== 'undefined') ? rendererCore : null;
      np = (typeof navPhysics !== 'undefined') ? navPhysics : null;
    } catch (e) {}
    if (!rc || !rc.camera || !rc.scene || !np || !window.THREE) return;
    clearInterval(boot);
    try {
      window.chaseView = new ChaseView(window.THREE, rc, np);

      const setMode = (mode) => {
        window.__viewMode = mode;
        if (mode === 'chase') {
          window.chaseView.enable();
          if (window.cockpit) { window.cockpit.forceHidden = true; window.cockpit._apply(); }
        } else {
          window.chaseView.disable();
          if (window.cockpit) {
            window.cockpit.forceHidden = (mode === 'visor');
            window.cockpit._apply();
          }
        }
        console.log('👁 view mode:', mode);
      };
      // keep re-installing (main.js rebuilds galaxyExplorer during boot)
      let tries = 0;
      const keep = setInterval(() => {
        window.galaxyExplorer = window.galaxyExplorer || {};
        if (!window.galaxyExplorer.setViewMode) window.galaxyExplorer.setViewMode = setMode;
        if (++tries > 40) clearInterval(keep);
      }, 500);
      window.galaxyExplorer = window.galaxyExplorer || {};
      window.galaxyExplorer.setViewMode = setMode;
      console.log('🚀 ChaseView ready — HELM / VISOR / CHASE');
    } catch (e) {
      console.warn('ChaseView init failed:', e);
    }
  }, 600);
})();
