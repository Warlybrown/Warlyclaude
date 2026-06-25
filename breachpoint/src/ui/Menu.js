// Menu.js — main menu, map/mode select, and in-game settings (DOM overlays).
//
// Main flow: TITLE → PLAY → map/mode select → start match. The settings panel
// (sensitivity, FOV, volume, difficulty) is reachable from the title and via a
// pause key during a match. All original branding.

export class Menu {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings; // shared { difficulty, sensitivity, fov, volume }
    this.onStart = null;      // ({ mode }) => void
    this.onSettingsChange = null;
    this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'menu';
    el.innerHTML = `
      <style>
        #menu { position:absolute; inset:0; font-family:var(--hud-font); color:var(--ink);
          z-index:30; pointer-events:auto;
          background:radial-gradient(circle at 50% 40%, rgba(10,16,24,.7), rgba(3,5,8,.97)); }
        #menu.hidden { display:none; }
        #menu .screen { position:absolute; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:22px; }
        #menu .screen.hidden { display:none; }
        #menu .brand { font-size:72px; font-weight:800; letter-spacing:.1em; line-height:.9; }
        #menu .brand .n { color:var(--accent-attack); }
        #menu .tag { font-size:13px; letter-spacing:.5em; color:var(--ink-dim); text-transform:uppercase; }
        #menu .btns { display:flex; flex-direction:column; gap:12px; margin-top:30px; width:280px; }
        #menu button { font-family:var(--hud-font); font-size:15px; letter-spacing:.25em;
          text-transform:uppercase; background:#0c1218; color:var(--ink); border:1px solid #28323c;
          padding:14px; cursor:pointer; transition:all .15s ease; }
        #menu button:hover { border-color:var(--accent-attack); color:var(--accent-attack); }
        #menu button.primary { border-color:var(--accent-attack); color:var(--accent-attack); }
        #menu h2 { font-size:14px; letter-spacing:.35em; color:var(--ink-dim); text-transform:uppercase; }
        #menu .cards { display:flex; gap:16px; }
        #menu .mcard { width:220px; border:1px solid #232c34; background:#0c1116; border-radius:6px;
          padding:18px; cursor:pointer; transition:all .15s ease; }
        #menu .mcard:hover { border-color:var(--accent-attack); transform:translateY(-3px); }
        #menu .mcard .mt { font-size:17px; font-weight:700; letter-spacing:.12em; }
        #menu .mcard .md { font-size:12px; color:var(--ink-dim); line-height:1.5; margin-top:8px; }
        #menu .mcard .badge { font-size:10px; letter-spacing:.2em; color:var(--accent-defend); margin-top:10px; }
        #menu .set { width:420px; display:flex; flex-direction:column; gap:18px; }
        #menu .row { display:flex; flex-direction:column; gap:6px; }
        #menu .row label { font-size:12px; letter-spacing:.2em; color:var(--ink-dim);
          text-transform:uppercase; display:flex; justify-content:space-between; }
        #menu .row label b { color:var(--accent-attack); }
        #menu input[type=range] { width:100%; accent-color:var(--accent-attack); }
        #menu .seg { display:flex; gap:8px; }
        #menu .seg button { flex:1; padding:8px; font-size:12px; }
        #menu .seg button.on { border-color:var(--accent-attack); color:var(--accent-attack); }
        #menu .back { font-size:12px; color:var(--ink-dim); cursor:pointer; letter-spacing:.2em; }
        #menu .foot { position:absolute; bottom:18px; font-size:11px; letter-spacing:.2em; color:var(--ink-dim); }
      </style>

      <div class="screen" id="scr-title">
        <div class="brand">WARL <span class="n">5</span> SIEGE</div>
        <div class="tag">Breach · Hold · Defuse</div>
        <div class="btns">
          <button class="primary" id="btn-play">Play vs Bots</button>
          <button id="btn-settings">Settings</button>
        </div>
        <div class="foot">Original tactical FPS · 100% original assets · Three.js prototype</div>
      </div>

      <div class="screen hidden" id="scr-select">
        <h2>Select Mode</h2>
        <div class="cards">
          <div class="mcard" data-mode="bomb">
            <div class="mt">BOMB DEFUSAL</div>
            <div class="md">5v5 attack/defend. Plant the defuser or hold the site. No respawns. First to 4 rounds.</div>
            <div class="badge">SAFEHOUSE</div>
          </div>
          <div class="mcard" data-mode="bomb" style="opacity:.5;cursor:default">
            <div class="mt">SECURE AREA</div>
            <div class="md">Hold a contested zone. (Coming soon — falls back to Bomb Defusal.)</div>
            <div class="badge">SAFEHOUSE</div>
          </div>
        </div>
        <div class="back" id="back-select">‹ BACK</div>
      </div>

      <div class="screen hidden" id="scr-settings">
        <h2>Settings</h2>
        <div class="set">
          <div class="row"><label>Mouse Sensitivity <b id="v-sens"></b></label>
            <input type="range" id="s-sens" min="0.5" max="3" step="0.05"></div>
          <div class="row"><label>Field of View <b id="v-fov"></b></label>
            <input type="range" id="s-fov" min="65" max="100" step="1"></div>
          <div class="row"><label>Volume <b id="v-vol"></b></label>
            <input type="range" id="s-vol" min="0" max="1" step="0.05"></div>
          <div class="row"><label>Difficulty <b id="v-diff"></b></label>
            <div class="seg" id="s-diff">
              <button data-d="0.25">RECRUIT</button>
              <button data-d="0.5">REGULAR</button>
              <button data-d="0.8">VETERAN</button>
              <button data-d="1">ELITE</button>
            </div></div>
        </div>
        <div class="back" id="back-settings">‹ BACK</div>
      </div>
    `;
    this.el = el;
    this.root.appendChild(el);
    this._wire();
    this._refresh();
  }

  _wire() {
    const $ = (s) => this.el.querySelector(s);
    this.screens = {
      title: $('#scr-title'), select: $('#scr-select'), settings: $('#scr-settings'),
    };
    $('#btn-play').onclick = () => this._go('select');
    $('#btn-settings').onclick = () => this._go('settings');
    $('#back-select').onclick = () => this._go('title');
    $('#back-settings').onclick = () => this._go(this._cameFromGame ? 'title' : 'title');
    this.el.querySelectorAll('.mcard[data-mode]').forEach((c) => {
      if (c.style.cursor === 'default') return;
      c.onclick = () => { this.hide(); this.onStart?.({ mode: c.dataset.mode }); };
    });

    const sens = $('#s-sens'), fov = $('#s-fov'), vol = $('#s-vol');
    sens.oninput = () => { this.settings.sensitivity = +sens.value; this._refresh(); this.onSettingsChange?.(); };
    fov.oninput = () => { this.settings.fov = +fov.value; this._refresh(); this.onSettingsChange?.(); };
    vol.oninput = () => { this.settings.volume = +vol.value; this._refresh(); this.onSettingsChange?.(); };
    this._sens = sens; this._fov = fov; this._vol = vol;
    this.el.querySelectorAll('#s-diff button').forEach((b) => {
      b.onclick = () => { this.settings.difficulty = +b.dataset.d; this._refresh(); this.onSettingsChange?.(); };
    });
  }

  _refresh() {
    const s = this.settings;
    this.el.querySelector('#v-sens').textContent = s.sensitivity.toFixed(2) + '×';
    this.el.querySelector('#v-fov').textContent = s.fov + '°';
    this.el.querySelector('#v-vol').textContent = Math.round(s.volume * 100) + '%';
    const dn = s.difficulty <= 0.3 ? 'RECRUIT' : s.difficulty <= 0.6 ? 'REGULAR' : s.difficulty <= 0.85 ? 'VETERAN' : 'ELITE';
    this.el.querySelector('#v-diff').textContent = dn;
    if (this._sens) { this._sens.value = s.sensitivity; this._fov.value = s.fov; this._vol.value = s.volume; }
    this.el.querySelectorAll('#s-diff button').forEach((b) =>
      b.classList.toggle('on', Math.abs(+b.dataset.d - s.difficulty) < 0.01));
  }

  _go(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('hidden', k !== name);
  }

  show(screen = 'title', fromGame = false) {
    this._cameFromGame = fromGame;
    this.el.classList.remove('hidden');
    this._go(screen);
    this._refresh();
  }
  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }
}
