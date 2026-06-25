// OperatorSelect.js — pre-round operator pick screen (DOM overlay).
//
// Shows a grid of operator cards for the human's side this round (speed/armor
// pips, gadget, weapons, bio), a side indicator with accent colour, a loadout
// summary, and the round/score header. Picking a card selects that operator;
// [ENTER] locks in (ready-up). Hidden during all other phases.

export class OperatorSelect {
  constructor(root) {
    this.root = root;
    this.onPick = null;   // (operator) => void
    this.onReady = null;  // () => void
    this._build();
    this.hide();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'opselect';
    el.innerHTML = `
      <style>
        #opselect { position:absolute; inset:0; display:flex; flex-direction:column;
          background:linear-gradient(180deg, rgba(4,7,10,.96), rgba(6,10,16,.99));
          font-family:var(--hud-font); color:var(--ink); pointer-events:auto; z-index:20; }
        #opselect.hidden { display:none; }
        #opselect .top { display:flex; justify-content:space-between; align-items:center;
          padding:18px 28px; border-bottom:1px solid #1b2228; }
        #opselect .side { font-size:22px; font-weight:800; letter-spacing:.2em; }
        #opselect .side.atk { color:var(--accent-attack); }
        #opselect .side.def { color:var(--accent-defend); }
        #opselect .meta { text-align:right; font-size:12px; letter-spacing:.2em; color:var(--ink-dim); }
        #opselect .meta b { color:var(--ink); font-size:16px; }
        #opselect .grid { flex:1; display:grid; grid-template-columns:repeat(5,1fr);
          gap:14px; padding:24px 28px; align-content:center; }
        .opcard { border:1px solid #232c34; background:#0c1116; border-radius:6px;
          padding:16px; cursor:pointer; transition:all .15s ease; display:flex; flex-direction:column; gap:8px; }
        .opcard:hover { border-color:#3a4650; transform:translateY(-3px); }
        .opcard.sel { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent), 0 0 24px rgba(46,155,255,.2); }
        .opcard .portrait { height:96px; border-radius:4px; display:flex; align-items:center;
          justify-content:center; font-size:34px; font-weight:800; letter-spacing:.05em;
          background:radial-gradient(circle at 50% 40%, #1a232c, #0a0e13); color:#2c3742; }
        .opcard .name { font-size:16px; font-weight:700; letter-spacing:.12em; }
        .opcard .pips { display:flex; gap:10px; font-size:10px; letter-spacing:.12em; color:var(--ink-dim); }
        .opcard .pips .dot { display:inline-block; width:7px; height:7px; border-radius:50%;
          background:#2a323a; margin-left:2px; }
        .opcard .pips .dot.on { background:var(--ink); }
        .opcard .gadget { font-size:12px; letter-spacing:.1em; color:var(--accent); text-transform:uppercase; }
        .opcard .bio { font-size:11px; line-height:1.4; color:var(--ink-dim); min-height:30px; }
        .opcard .wpn { font-size:10px; letter-spacing:.1em; color:#5b6670; text-transform:uppercase; }
        #opselect .bottom { display:flex; justify-content:space-between; align-items:center;
          padding:16px 28px; border-top:1px solid #1b2228; }
        #opselect .loadout { font-size:12px; letter-spacing:.14em; color:var(--ink-dim); }
        #opselect .loadout b { color:var(--ink); }
        #opselect .ready { font-size:15px; letter-spacing:.3em; text-transform:uppercase;
          border:1px solid var(--accent); color:var(--accent); padding:12px 28px;
          animation:pulse 2s ease-in-out infinite; }
        #opselect .timer { font-size:30px; font-weight:800; color:var(--ink); }
      </style>
      <div class="top">
        <div class="side" id="op-side">ATTACK</div>
        <div class="meta">ROUND <b id="op-round">1</b> &nbsp; SAFEHOUSE &nbsp;·&nbsp; <b id="op-score">0 — 0</b></div>
      </div>
      <div class="grid" id="op-grid"></div>
      <div class="bottom">
        <div class="loadout" id="op-loadout">—</div>
        <div class="timer" id="op-timer">15</div>
        <div class="ready" id="op-ready">[ENTER] READY</div>
      </div>
    `;
    this.root.appendChild(el);
    this.el = el;
    this.sideEl = el.querySelector('#op-side');
    this.roundEl = el.querySelector('#op-round');
    this.scoreEl = el.querySelector('#op-score');
    this.gridEl = el.querySelector('#op-grid');
    this.loadoutEl = el.querySelector('#op-loadout');
    this.timerEl = el.querySelector('#op-timer');
    el.querySelector('#op-ready').addEventListener('click', () => this.onReady?.());
  }

  /** Populate with operators for the human's side. */
  show(operators, side, round, scoreH, scoreA, selected) {
    this.el.classList.remove('hidden');
    const atk = side === 'ATTACK';
    this.sideEl.textContent = atk ? 'ATTACK' : 'DEFEND';
    this.sideEl.className = 'side ' + (atk ? 'atk' : 'def');
    this.el.style.setProperty('--accent', atk ? 'var(--accent-attack)' : 'var(--accent-defend)');
    this.roundEl.textContent = round;
    this.scoreEl.textContent = `${scoreH} — ${scoreA}`;

    this.gridEl.innerHTML = '';
    this._operators = operators;
    for (const op of operators) {
      const card = document.createElement('div');
      card.className = 'opcard' + (op === selected ? ' sel' : '');
      const pip = (n, max = 3) => Array.from({ length: max }, (_, i) =>
        `<span class="dot ${i < n ? 'on' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="portrait">${op.callsign.slice(0, 2)}</div>
        <div class="name">${op.callsign}</div>
        <div class="pips">SPD ${pip(op.speed)} &nbsp; ARM ${pip(op.armor)}</div>
        <div class="gadget">◈ ${this._gadgetName(op.gadget)}</div>
        <div class="bio">${op.bio}</div>
        <div class="wpn">${op.primary} · ${op.secondary}</div>
      `;
      card.addEventListener('click', () => this.onPick?.(op));
      this.gridEl.appendChild(card);
    }
    this._refreshLoadout(selected);
  }

  _gadgetName(id) {
    const names = {
      hardbreach: 'THERMAL CUTTER', meleebreach: 'BREACHING MAUL', flash: 'PULSE FLASH',
      recon: 'SONAR PULSE', shield: 'BULWARK SHIELD', trap_prox: 'PROXIMITY CHARGE',
      jammer: 'NULLFIELD', camera: 'WATCHER CAM', reactive: 'COUNTERMINE', anchor: 'HOLDFAST COVER',
    };
    return names[id] || id;
  }

  _refreshLoadout(op) {
    if (!op) { this.loadoutEl.textContent = '—'; return; }
    const util = (op.utility || []).map((u) => `${u.name}×${u.count}`).join(' · ');
    this.loadoutEl.innerHTML = `<b>${op.callsign}</b> &nbsp; ${op.primary} / ${op.secondary} &nbsp;·&nbsp; ${util}`;
  }

  setSelected(op) {
    const cards = this.gridEl.querySelectorAll('.opcard');
    cards.forEach((c, i) => c.classList.toggle('sel', this._operators[i] === op));
    this._refreshLoadout(op);
  }

  setTimer(t) { this.timerEl.textContent = Math.ceil(t); }
  hide() { this.el.classList.add('hidden'); }
}
