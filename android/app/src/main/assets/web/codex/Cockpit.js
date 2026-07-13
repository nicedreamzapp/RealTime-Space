// Cockpit.js — Matt's AI-generated cockpit interior as a LANDSCAPE overlay.
//
// The art (his Grok cockpit panorama, codex/cosmos/cockpit_land.png) has its three
// window openings cut to true transparency, so the live 3D universe shows through
// the windshield while the glowing consoles and struts frame it. Landscape-only:
// the portrait art had the pilot chair blocking the forward view, so portrait
// stays clean HUD. The old procedural 3D pillar frame is retired (Matt: "too
// thick, colors look bad").
//
// Toggle: window.galaxyExplorer.setCockpitVisible(bool) — ⋯ menu "Cockpit" row.

(function () {
  'use strict';

  const STORE = 'rtf_cockpit_on';

  class Cockpit {
    constructor() {
      const img = document.createElement('img');
      img.id = 'cockpit-art';
      img.src = 'codex/cosmos/cockpit_land.png';
      // Gentle 106% zoom — the wide-glass art is already mostly windshield.
      img.style.cssText = [
        'position:fixed', 'left:-3vw', 'top:-3vh', 'width:106vw', 'height:106vh',
        'object-fit:fill', 'pointer-events:none', 'z-index:60',   // UNDER the HUD pills (z≥100) — art must never hide TIME/heading/velocity
        'display:none', 'user-select:none', '-webkit-user-select:none'
      ].join(';');
      document.body.appendChild(img);
      this.img = img;

      // HARDWIRED ON: the art cockpit IS the landscape experience. A stale stored
      // flag kept vetoing Swift's "on" pushes across builds, so persistence lost
      // its vote — setVisible only affects the current session (⋯ toggle still
      // works while the app is open).
      this.on = true;
      this.forceHidden = false;  // HELM default — the green-screen key made the cockpit exact
      window.addEventListener('resize', () => this._apply());
      this._apply();
    }

    setVisible(_) { /* no external off-switch — landscape cockpit is always on */ }

    _apply() {
      const landscape = window.innerWidth > window.innerHeight;
      // forceHidden is set by the view switcher (VISOR / CHASE modes hide the art)
      this.img.style.display = (this.on && landscape && !this.forceHidden) ? 'block' : 'none';
    }
  }

  // Boot immediately — pure DOM, no engine dependency.
  try {
    window.cockpit = new Cockpit();
    // main.js REBUILDS window.galaxyExplorer during engine init, which wipes hooks
    // attached this early — keep re-installing until the API stabilizes.
    const hook = () => {
      window.galaxyExplorer = window.galaxyExplorer || {};
      window.galaxyExplorer.setCockpitVisible = (v) => window.cockpit.setVisible(v);
    };
    hook();
    let tries = 0;
    const keep = setInterval(() => {
      if (!window.galaxyExplorer || !window.galaxyExplorer.setCockpitVisible) hook();
      if (++tries > 40) clearInterval(keep);   // ~20s covers any boot
    }, 500);
    console.log('🛩️ Cockpit art overlay ready (always on in landscape)');
  } catch (e) {
    console.warn('Cockpit init failed:', e);
  }
})();
