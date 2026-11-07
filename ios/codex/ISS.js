// ISS.js — a real International Space Station orbiting Earth in the 3D scene.
// A small glowing marker + label circles Earth at the real 51.6° inclination with the
// real 92.9-minute period, played back TIME_SCALE times faster (labelled on the marker,
// e.g. "ISS · 60× speed") so you can watch it go round. When LiveData has the real ISS
// latitude, the orbit phase starts at that latitude (once; at 60× it would not stay synced).
// Self-contained; reads Earth from the catalog and adds itself to the scene root.

(function () {
  'use strict';

  const INCLINATION = 51.6 * Math.PI / 180; // real ISS orbital inclination
  const REAL_PERIOD_S = 92.9 * 60;          // real ISS orbital period (~92.9 min at ~420 km)
  const TIME_SCALE = 60;                    // played back 60x: one lap = 92.9 s on screen
  const ORBIT_SECONDS = REAL_PERIOD_S / TIME_SCALE;

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
        map: this._labelTexture('🛰️ ISS · ' + TIME_SCALE + '× speed'), transparent: true, depthTest: false, depthWrite: false
      }));
      label.scale.set(this.earthRadius * 1.2, this.earthRadius * 0.225, 1);
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
      const c = document.createElement('canvas'); c.width = 340; c.height = 64;
      const g = c.getContext('2d');
      g.font = '600 30px -apple-system, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(text, 171, 33);
      g.fillStyle = '#dff1ff'; g.fillText(text, 170, 32);
      return new window.THREE.CanvasTexture(c);
    }

    // Start the orbit phase at the REAL ISS latitude: on a circular orbit inclined i,
    // latitude = asin(sin(i) * sin(u)), so u = asin(sin(lat) / sin(i)). (Whether it is
    // heading north or south is not in the feed; we take the northbound solution.)
    _syncToLive() {
      const live = window.liveData && window.liveData.iss;
      if (this._synced || !live || typeof live.lat !== 'number') return;
      const s = Math.max(-1, Math.min(1, Math.sin(live.lat * Math.PI / 180) / Math.sin(INCLINATION)));
      this.phase = Math.asin(s);
      this._synced = true;
    }

    // The orbit phase advances on its own rAF; where the station and its label are drawn is
    // decided by place(), called from main.js's scene render hook after the planet labels,
    // so it uses the camera's final pose for that frame and Earth's current name box.
    _loop() {
      const step = (ts) => {
        const dt = this._lastFrame ? Math.min(0.05, (ts - this._lastFrame) / 1000) : 0.016;
        this._lastFrame = ts;
        if (this.marker && this.earthMesh) {
          // pick up the real latitude once it arrives
          this._t += dt;
          if (!this._synced && this._t > 2) { this._t = 0; this._syncToLive(); }
          // holds still while orbital time is paused
          const paused = window.Ephemeris && window.Ephemeris.clock.scale === 0;
          if (!paused) this.phase += (2 * Math.PI / ORBIT_SECONDS) * dt;
          // no render hook (should not happen): place it here against the last camera
          if (!this._hooked) { const cam = window.explorationTracker && window.explorationTracker.camera; if (cam) this._place(cam); }
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // Called by main.js (render hook) with the camera the frame is drawn from.
    place(cam) { this._hooked = true; if (this.marker && this.earthMesh && cam) this._place(cam); }

    _place(cam) {
      const THREE = window.THREE;
      const r = this.earthRadius * 1.09; // low-Earth-orbit altitude, scaled up to read
      // circular orbit in a plane tilted by the real inclination (Earth's own axial
      // tilt is not added: the plane is tilted from the ecliptic, an approximation)
      const x = Math.cos(this.phase) * r;
      const yz = Math.sin(this.phase) * r;
      const y = yz * Math.sin(INCLINATION);
      const z = yz * Math.cos(INCLINATION);
      this.earthMesh.getWorldPosition(this._tmp);
      this.marker.position.set(this._tmp.x + x, this._tmp.y + y, this._tmp.z + z);

      // fade the label/marker out when far from Earth so it isn't clutter system-wide
      const vis = this._tmp.distanceTo(cam.position) < this.earthRadius * 40;
      this.marker.visible = vis;
      this.marker.updateMatrixWorld(true);
      if (!vis || !this._label) return;

      // Laid out in SCREEN space, so it stays right whatever the camera's roll (looking
      // down from a pole included): the sprite is held at 26 CSS px (glyphs ~12 px), its
      // centre 21 px straight above the marker on screen, or 21 px below it when the spot
      // above would cover Earth's name label. Then it is put back on the ray through that
      // point at the marker's depth.
      const W = window.innerWidth, H = Math.max(1, window.innerHeight);
      const v = this._v || (this._v = new THREE.Vector3());
      const fwd = this._f || (this._f = new THREE.Vector3());
      v.copy(this.marker.position).project(cam);
      if (v.z > 1 || v.z < -1) { this._label.visible = false; return; }
      this._label.visible = true;
      const sx = (v.x * 0.5 + 0.5) * W, sy = (0.5 - v.y * 0.5) * H;
      const PX = 26, GAP = PX * 0.8, HW = 58, HH = 9;
      let ly = sy - GAP;
      const box = this._earthNameBox();
      if (box && sx - HW < box.x1 && sx + HW > box.x0 && ly - HH < box.y1 && ly + HH > box.y0) ly = sy + GAP;
      fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const depth = Math.max(1e-4, fwd.dot(v.copy(this.marker.position).sub(cam.position)));
      const p = v.set(sx / W * 2 - 1, 1 - ly / H * 2, 0.5).unproject(cam).sub(cam.position).normalize();
      p.multiplyScalar(depth / Math.max(1e-6, p.dot(fwd))).add(cam.position);
      const tanH = Math.tan((cam.fov || 60) * Math.PI / 360);
      const h = PX * 2 * depth * tanH / H;
      this._label.scale.set(h * (1.2 / 0.225), h, 1);
      this._label.position.copy(p).sub(this.marker.position);   // group has no rotation/scale
      this._label.updateMatrixWorld(true);
    }

    // Earth's name label box on screen (CSS px), from main.js's layout this frame.
    _earthNameBox() {
      try {
        if (typeof planetHighlights === 'undefined') return null;
        const ph = planetHighlights.find(h => h.planet && h.planet.name === 'Earth');
        if (!ph || !ph._box || !ph.label.visible || ph.label.material.opacity < 0.02) return null;
        return ph._box;
      } catch (e) { return null; }
    }
  }

  function boot() { if (!window.issTracker) { try { window.issTracker = new ISSTracker(); } catch (e) { console.error('ISS boot failed', e); } } }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1500);
  else window.addEventListener('load', () => setTimeout(boot, 1500));
})();
