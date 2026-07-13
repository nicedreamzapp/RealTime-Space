// ISS.js — a real International Space Station orbiting Earth in the 3D scene.
// A small glowing marker + label circles Earth at low-orbit altitude and ~51.6° real
// inclination. Its starting longitude syncs to the REAL live ISS position (from
// LiveData) when available, then it visibly orbits so you can watch it fly around.
// Self-contained; reads Earth from the catalog and adds itself to the scene root.

(function () {
  'use strict';

  const INCLINATION = 51.6 * Math.PI / 180; // real ISS orbital inclination
  const ORBIT_SECONDS = 75;                 // visible orbit period (real is 92 min — too slow to see)

  class ISSTracker {
    constructor() {
      this.marker = null;
      this.scene = null;
      this.earthMesh = null;
      this.earthRadius = 1.6;
      this.phase = 0;
      this._t = 0;
      this._lastFrame = null;
      this._tmp = new (window.THREE.Vector3)();
      this._tryAttach(0);
    }

    _earth() {
      const cat = window.celestialCatalog || (window.explorationTracker && window.explorationTracker.catalog);
      return cat ? cat.getByName('Earth') : null;
    }

    _tryAttach(tries) {
      const earth = this._earth();
      if (!earth || !earth.mesh || !window.THREE) {
        if (tries < 40) setTimeout(() => this._tryAttach(tries + 1), 500);
        return;
      }
      this.earthMesh = earth.mesh;
      this.earthRadius = earth.radius || 1.6;
      // scene root = walk up the parent chain
      let n = this.earthMesh; while (n.parent) n = n.parent;
      this.scene = n;
      this._build();
      this._loop();
      console.log('🛰️ ISS marker attached to scene, orbiting Earth');
    }

    _build() {
      const THREE = window.THREE;
      const group = new THREE.Group();

      // glowing body
      const bodyGeo = new THREE.SphereGeometry(this.earthRadius * 0.035, 12, 12);
      const bodyMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff });
      group.add(new THREE.Mesh(bodyGeo, bodyMat));

      // soft halo so it's findable
      const haloMat = new THREE.SpriteMaterial({
        map: this._glowTexture(), color: 0x9fe6ff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(this.earthRadius * 0.3);
      group.add(halo);

      // label
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._labelTexture('🛰️ ISS'), transparent: true, depthTest: false, depthWrite: false
      }));
      label.scale.set(this.earthRadius * 0.9, this.earthRadius * 0.225, 1);
      label.position.y = this.earthRadius * 0.18;
      group.add(label);
      this._label = label;

      this.marker = group;
      this.scene.add(group);

      // Make the station a fly-to target (Destinations menu / flyToByName).
      window.__universe = window.__universe || [];
      window.__universe.push({ name: 'ISS', mesh: this.marker, radius: this.earthRadius * 0.6 });
    }

    _glowTexture() {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(180,235,255,0.9)');
      grd.addColorStop(0.4, 'rgba(120,200,255,0.35)');
      grd.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const t = new window.THREE.CanvasTexture(c); return t;
    }
    _labelTexture(text) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      g.font = '600 30px -apple-system, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(text, 129, 33);
      g.fillStyle = '#dff1ff'; g.fillText(text, 128, 32);
      return new window.THREE.CanvasTexture(c);
    }

    // map a real ISS longitude (deg) to our orbit phase so the marker starts where it is
    _syncToLive() {
      const live = window.liveData && window.liveData.iss;
      if (live && typeof live.lon === 'number') {
        this.phase = (live.lon + 180) * Math.PI / 180;
      }
    }

    _loop() {
      const THREE = window.THREE;
      const step = (ts) => {
        const dt = this._lastFrame ? Math.min(0.05, (ts - this._lastFrame) / 1000) : 0.016;
        this._lastFrame = ts;
        if (this.marker && this.earthMesh) {
          // periodically re-sync starting point to the real ISS longitude
          this._t += dt;
          if (this._t > 5) { this._t = 0; this._syncToLive(); }
          this.phase += (2 * Math.PI / ORBIT_SECONDS) * dt;

          const r = this.earthRadius * 1.09; // low-Earth-orbit altitude, scaled up to read
          // circular orbit in a plane tilted by the real inclination
          const x = Math.cos(this.phase) * r;
          const yz = Math.sin(this.phase) * r;
          const y = yz * Math.sin(INCLINATION);
          const z = yz * Math.cos(INCLINATION);

          this.earthMesh.getWorldPosition(this._tmp);
          this.marker.position.set(this._tmp.x + x, this._tmp.y + y, this._tmp.z + z);

          // fade the label/marker out when far from Earth so it isn't clutter system-wide
          const cam = window.explorationTracker && window.explorationTracker.camera;
          if (cam) {
            const dEarth = this._tmp.distanceTo(cam.position);
            const vis = dEarth < this.earthRadius * 40;
            this.marker.visible = vis;
          }
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  function boot() { if (!window.issTracker) { try { window.issTracker = new ISSTracker(); } catch (e) { console.error('ISS boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1500);
  else window.addEventListener('load', () => setTimeout(boot, 1500));
})();
