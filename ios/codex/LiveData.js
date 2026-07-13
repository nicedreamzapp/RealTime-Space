// LiveData.js — "what's actually happening in space right now" for RealTime Fidget.
// Pulls the REAL live position of the ISS and today's REAL near-Earth asteroids from
// public NASA / open APIs, shown in a panel. Network-optional: if a feed can't be
// reached it falls back gracefully (last good data, or a clear "no signal" message) so
// the app never hangs or looks broken offline.
//
// Both endpoints are HTTPS with permissive CORS, so they work from the WKWebView.
//   ISS:        https://api.wheretheiss.at/v1/satellites/25544
//   Asteroids:  https://api.nasa.gov/neo/rest/v1/feed  (NASA NeoWs, personal api.nasa.gov key)

(function () {
  'use strict';

  const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
  const NEO_URL = 'https://api.nasa.gov/neo/rest/v1/feed';
  const NASA_KEY = 'MRMjXemYylfzVcgrZodu5wY87T9iItdpvNXGEzio'; // Matt's api.nasa.gov key (1,000 req/hr)

  const LUNAR_KM = 384400; // 1 lunar distance, for "how many Moons away"

  class LiveData {
    constructor() {
      this.iss = null;
      this.asteroids = null;
      this.lastUpdated = null;
      this.loading = false;
      this._reqSeq = 0;
      this._pending = {};
      this._buildDOM();
    }

    // ---- networking ----------------------------------------------------------
    // On iOS the page is served from a custom URL scheme, so cross-origin fetch() is blocked
    // by WKWebView CORS. Route through the native side (URLSession, no CORS) when available.
    _getJSON(url, timeoutMs) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iosHandler) {
        return this._nativeFetch(url, timeoutMs || 12000);
      }
      return this._browserFetch(url, timeoutMs || 8000);
    }

    async _browserFetch(url, timeoutMs) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } finally { clearTimeout(t); }
    }

    _nativeFetch(url, timeoutMs) {
      return new Promise((resolve, reject) => {
        const id = 'f' + (++this._reqSeq);
        const to = setTimeout(() => { delete this._pending[id]; reject(new Error('timeout')); }, timeoutMs);
        this._pending[id] = { resolve, reject, to };
        try {
          window.webkit.messageHandlers.iosHandler.postMessage({ type: 'FETCH', url, reqId: id });
        } catch (e) { clearTimeout(to); delete this._pending[id]; reject(e); }
      });
    }

    // Called by the native bridge with a base64'd UTF-8 response body.
    _onFetch(id, ok, status, b64) {
      const p = this._pending[id];
      if (!p) return;
      clearTimeout(p.to); delete this._pending[id];
      if (!ok) { p.reject(new Error('native fetch failed: ' + status)); return; }
      try {
        const text = decodeURIComponent(escape(atob(b64)));
        p.resolve(JSON.parse(text));
      } catch (e) { p.reject(e); }
    }

    _today() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    async refresh() {
      this.loading = true;
      this._render();
      const results = await Promise.allSettled([
        this._getJSON(ISS_URL),
        this._getJSON(`${NEO_URL}?start_date=${this._today()}&end_date=${this._today()}&api_key=${NASA_KEY}`)
      ]);

      const [issR, neoR] = results;
      if (issR.status === 'fulfilled' && issR.value) {
        const v = issR.value;
        this.iss = {
          lat: v.latitude, lon: v.longitude,
          altKm: v.altitude, speedKmh: v.velocity,
          daynight: v.visibility
        };
      }
      if (neoR.status === 'fulfilled' && neoR.value) {
        const day = (neoR.value.near_earth_objects || {})[this._today()] || [];
        const list = day.map(o => {
          const ca = (o.close_approach_data || [])[0] || {};
          const dia = o.estimated_diameter && o.estimated_diameter.meters;
          return {
            name: o.name.replace(/[()]/g, ''),
            missKm: ca.miss_distance ? parseFloat(ca.miss_distance.kilometers) : null,
            missLD: ca.miss_distance ? parseFloat(ca.miss_distance.lunar) : null,
            speedKmh: ca.relative_velocity ? parseFloat(ca.relative_velocity.kilometers_per_hour) : null,
            diaM: dia ? (dia.estimated_diameter_min + dia.estimated_diameter_max) / 2 : null,
            hazard: !!o.is_potentially_hazardous_asteroid,
            timeUTC: ca.close_approach_date_full || ''
          };
        }).sort((a, b) => (a.missKm || 1e12) - (b.missKm || 1e12));
        this.asteroids = list;
      }

      this.loading = false;
      this.failed = (issR.status !== 'fulfilled') && (neoR.status !== 'fulfilled');
      this.lastUpdated = new Date();
      this._render();
    }

    // ---- UI -------------------------------------------------------------------
    open() {
      this.el.classList.add('show');
      if (window.codex) window.codex._chrome(true);
      else document.body.classList.add('cx-modal-open');
      this._render();
      // auto-refresh on open if data is stale (>60s) or missing
      if (!this.lastUpdated || (Date.now() - this.lastUpdated.getTime() > 60000)) this.refresh();
    }
    close() {
      this.el.classList.remove('show');
      if (window.codex) window.codex._chrome(false);
      else document.body.classList.remove('cx-modal-open');
    }

    _fmtKm(v) {
      if (v == null) return '—';
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M km';
      return Math.round(v).toLocaleString() + ' km';
    }

    _render() {
      if (!this.el.classList.contains('show')) return;
      const muted = window.codex ? window.codex.muted : true;
      const iss = this.iss, ast = this.asteroids;

      const issBlock = iss ? `
        <div class="cx-live-grid">
          <div class="cx-stat"><div class="cx-stat-k">Latitude</div><div class="cx-stat-v">${iss.lat.toFixed(2)}°</div></div>
          <div class="cx-stat"><div class="cx-stat-k">Longitude</div><div class="cx-stat-v">${iss.lon.toFixed(2)}°</div></div>
          <div class="cx-stat"><div class="cx-stat-k">Altitude</div><div class="cx-stat-v">${Math.round(iss.altKm)} km</div></div>
          <div class="cx-stat"><div class="cx-stat-k">Speed</div><div class="cx-stat-v">${Math.round(iss.speedKmh).toLocaleString()} km/h</div></div>
        </div>
        <div class="cx-live-note">Orbiting Earth once every ~92 minutes · currently in ${iss.daynight === 'daylight' ? 'daylight ☀️' : 'Earth\'s shadow 🌑'}</div>`
        : `<div class="cx-live-empty">${this.loading ? 'Locating the ISS…' : 'No ISS signal — check connection'}</div>`;

      let astBlock;
      if (ast && ast.length) {
        const rows = ast.slice(0, 6).map(a => `
          <div class="cx-ast ${a.hazard ? 'haz' : ''}">
            <div class="cx-ast-name">${a.hazard ? '⚠️ ' : ''}${a.name}</div>
            <div class="cx-ast-stats">
              <span>${this._fmtKm(a.missKm)} away${a.missLD != null ? ` · ${a.missLD.toFixed(1)} LD` : ''}</span>
              <span>${a.diaM != null ? `~${Math.round(a.diaM)} m wide` : ''}${a.speedKmh != null ? ` · ${Math.round(a.speedKmh).toLocaleString()} km/h` : ''}</span>
            </div>
          </div>`).join('');
        const hazN = ast.filter(a => a.hazard).length;
        astBlock = `<div class="cx-live-note">${ast.length} passing near Earth today${hazN ? ` · ${hazN} flagged potentially hazardous` : ''}. "LD" = Moon-distances away.</div>${rows}`;
      } else {
        astBlock = `<div class="cx-live-empty">${this.loading ? 'Asking NASA…' : 'No asteroid data — check connection'}</div>`;
      }

      const updated = this.lastUpdated ? this.lastUpdated.toLocaleTimeString() : '—';
      this.el.innerHTML = `
        <div class="cx-live-inner glasscx">
          <div class="cx-guide-head">
            <div>
              <div class="cx-guide-title">LIVE · RIGHT NOW</div>
              <div class="cx-guide-sub">real feeds · updated ${updated}</div>
            </div>
            <div class="cx-head-btns">
              <button class="cx-mute cx-icon-btn" title="Sound on/off">${muted ? '🔇' : '🔊'}</button>
              <button class="cx-close" aria-label="close">✕</button>
            </div>
          </div>
          <div class="cx-live-scroll">
            <div class="cx-section-title">🛰️ International Space Station</div>
            ${issBlock}
            <div class="cx-section-title" style="margin-top:18px;">☄️ Near-Earth Asteroids Today</div>
            ${astBlock}
          </div>
          <button class="cx-live-refresh" ${this.loading ? 'disabled' : ''}>${this.loading ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>`;
      this.el.querySelector('.cx-close').onclick = () => this.close();
      this.el.onclick = (e) => { if (e.target === this.el) this.close(); };
      const rb = this.el.querySelector('.cx-live-refresh');
      if (rb) rb.onclick = () => { if (!this.loading) this.refresh(); };
    }

    _buildDOM() {
      const el = document.createElement('div');
      el.className = 'cx-live';
      document.body.appendChild(el);
      this.el = el;
      const s = document.createElement('style');
      s.textContent = `
        .cx-live{position:absolute;inset:0;z-index:600;display:none;align-items:center;justify-content:center;
          background:rgba(0,1,6,0.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
          font-family:-apple-system,'SF Pro Display',sans-serif;-webkit-user-select:none;}
        .cx-live.show{display:flex;animation:cxFade .3s;}
        .cx-live-inner{width:min(560px,93vw);max-height:90vh;display:flex;flex-direction:column;border-radius:22px;padding:20px;color:#dff1ff;animation:cxRise .35s cubic-bezier(.2,.9,.3,1.1);}
        .cx-live-scroll{overflow-y:auto;flex:1;}
        .cx-live-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
        .cx-live-note{font-size:12px;color:rgba(160,210,255,0.8);margin:10px 0 8px;line-height:1.4;}
        .cx-live-empty{font-size:13px;color:rgba(160,190,225,0.7);padding:14px;text-align:center;background:rgba(120,200,255,0.05);border-radius:12px;}
        .cx-ast{background:rgba(120,200,255,0.06);border:1px solid rgba(120,200,255,0.1);border-radius:12px;padding:10px 12px;margin-bottom:7px;}
        .cx-ast.haz{border-color:rgba(255,140,90,0.5);background:rgba(255,120,70,0.08);}
        .cx-ast-name{font-size:14px;font-weight:600;color:#eaf6ff;}
        .cx-ast-stats{display:flex;flex-direction:column;gap:1px;font-size:11px;color:rgba(190,215,245,0.85);margin-top:3px;}
        .cx-live-refresh{margin-top:14px;height:42px;border-radius:14px;cursor:pointer;font-size:13px;font-weight:600;letter-spacing:1px;
          border:1px solid rgba(120,200,255,0.3);color:#9fe6ff;background:rgba(120,200,255,0.1);}
        .cx-live-refresh:disabled{opacity:.5;}
      `;
      document.head.appendChild(s);
    }
  }

  function boot() {
    if (window.liveData) return;
    try { window.liveData = new LiveData(); } catch (e) { console.error('LiveData boot failed', e); }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 1300);
  else window.addEventListener('load', () => setTimeout(boot, 1300));

  window.LiveData = LiveData;
})();
