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

      // ---- the ship: sleek dart — dark hull, canted wings, cyan engine glow
      const ship = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a3540, metalness: 0.7, roughness: 0.35 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x161d26, metalness: 0.6, roughness: 0.5 });

      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 12), hullMat);
      nose.rotation.x = -Math.PI / 2; nose.position.z = -1.0;
      ship.add(nose);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 2.4, 12), hullMat);
      body.rotation.x = -Math.PI / 2; body.position.z = 1.4;
      ship.add(body);
      const wingGeo = new THREE.BoxGeometry(2.6, 0.08, 1.0);
      const wingL = new THREE.Mesh(wingGeo, darkMat);
      wingL.position.set(-1.5, -0.1, 1.7); wingL.rotation.z = 0.18;
      ship.add(wingL);
      const wingR = new THREE.Mesh(wingGeo, darkMat);
      wingR.position.set(1.5, -0.1, 1.7); wingR.rotation.z = -0.18;
      ship.add(wingR);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.9), darkMat);
      fin.position.set(0, 0.55, 1.9);
      ship.add(fin);

      // engine glow — brightens with thrust
      const glowTex = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(160,240,255,1)');
        grd.addColorStop(0.4, 'rgba(60,190,255,0.55)');
        grd.addColorStop(1, 'rgba(0,120,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      this.engine = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      this.engine.position.set(0, 0, 2.8);
      this.engine.scale.setScalar(1.2);
      ship.add(this.engine);

      // nav lights
      const lightL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4455 }));
      lightL.position.set(-2.6, -0.05, 1.7); ship.add(lightL);
      const lightR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0x44ff88 }));
      lightR.position.set(2.6, -0.05, 1.7); ship.add(lightR);

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
        // engine glow breathes with thrust
        const thrusting = this.np.isThrusting || this.np.isBoosting;
        const target = thrusting ? (this.np.isBoosting ? 3.2 : 2.0) : 1.0;
        this.engine.scale.setScalar(this.engine.scale.x + (target - this.engine.scale.x) * 0.2);
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
