// KillFeed.js — top-right rolling kill feed.
//
// Each entry: "<killer> ▸ <weapon> ▸ <victim>", colour-coded by team, with a
// headshot marker. Entries fade and auto-expire. Fed by the orchestrator from
// combat kill events.

export class KillFeed {
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.id = 'killfeed';
    el.innerHTML = `
      <style>
        #killfeed { position:absolute; top:54px; right:18px; display:flex; flex-direction:column;
          align-items:flex-end; gap:5px; font-family:var(--hud-font); pointer-events:none; }
        #killfeed .kf { font-size:12px; letter-spacing:.06em; background:rgba(8,12,16,.72);
          padding:5px 9px; border-radius:3px; border-left:2px solid #444; opacity:1;
          transition:opacity .4s ease; white-space:nowrap; }
        #killfeed .kf.fade { opacity:0; }
        #killfeed .kf .atk { color:var(--accent-attack); font-weight:700; }
        #killfeed .kf .def { color:var(--accent-defend); font-weight:700; }
        #killfeed .kf .you { text-decoration:underline; }
        #killfeed .kf .sep { color:var(--ink-dim); margin:0 6px; }
        #killfeed .kf .hs { color:#ff5a5a; margin-left:6px; }
      </style>
    `;
    this.el = el;
    this.root.appendChild(el);
    this._entries = [];
  }

  /**
   * @param {object} e { killer, killerSide, victim, victimSide, weapon,
   *                     headshot, killerIsYou, victimIsYou }
   */
  add(e) {
    const div = document.createElement('div');
    div.className = 'kf';
    const k = `<span class="${e.killerSide === 'ATTACK' ? 'atk' : 'def'} ${e.killerIsYou ? 'you' : ''}">${e.killer}</span>`;
    const v = `<span class="${e.victimSide === 'ATTACK' ? 'atk' : 'def'} ${e.victimIsYou ? 'you' : ''}">${e.victim}</span>`;
    div.innerHTML = `${k}<span class="sep">▸ ${e.weapon || ''} ▸</span>${v}${e.headshot ? '<span class="hs">⊕</span>' : ''}`;
    this.el.appendChild(div);
    const rec = { div, life: 6 };
    this._entries.push(rec);
    // Cap visible entries.
    while (this._entries.length > 6) {
      const old = this._entries.shift();
      old.div.remove();
    }
  }

  update(dt) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const e = this._entries[i];
      e.life -= dt;
      if (e.life < 0.6) e.div.classList.add('fade');
      if (e.life <= 0) { e.div.remove(); this._entries.splice(i, 1); }
    }
  }

  clear() {
    for (const e of this._entries) e.div.remove();
    this._entries = [];
  }
}
