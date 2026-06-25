// Scoreboard.js — full match scoreboard shown while holding Tab.
//
// Two team columns: operator callsign, K/D, alive status. Header shows the
// round, score, and current sides. Built from the live player + bot rosters.

export class Scoreboard {
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.id = 'scoreboard';
    el.innerHTML = `
      <style>
        #scoreboard { position:absolute; inset:0; display:none; align-items:center;
          justify-content:center; background:rgba(4,7,10,.82); font-family:var(--hud-font);
          color:var(--ink); pointer-events:none; z-index:18; }
        #scoreboard.show { display:flex; }
        #scoreboard .panel { width:760px; background:#0a0e13; border:1px solid #1d262e;
          border-radius:8px; overflow:hidden; }
        #scoreboard .hdr { display:flex; justify-content:space-between; align-items:center;
          padding:16px 22px; border-bottom:1px solid #1d262e; }
        #scoreboard .hdr .t { font-size:18px; font-weight:800; letter-spacing:.2em; }
        #scoreboard .hdr .sc { font-size:26px; font-weight:800; }
        #scoreboard .cols { display:grid; grid-template-columns:1fr 1fr; }
        #scoreboard .col { padding:10px 0; }
        #scoreboard .col.atk .ch { color:var(--accent-attack); }
        #scoreboard .col.def .ch { color:var(--accent-defend); }
        #scoreboard .ch { font-size:12px; letter-spacing:.25em; padding:6px 22px; color:var(--ink-dim); }
        #scoreboard .row { display:flex; justify-content:space-between; padding:7px 22px;
          font-size:13px; border-top:1px solid #11171d; }
        #scoreboard .row.dead { opacity:.4; }
        #scoreboard .row.you { background:rgba(46,155,255,.07); }
        #scoreboard .row .nm { letter-spacing:.08em; }
        #scoreboard .row .kd { color:var(--ink-dim); font-variant-numeric:tabular-nums; }
      </style>
      <div class="panel">
        <div class="hdr">
          <div class="t" id="sb-h" style="color:var(--accent-attack)">YOU</div>
          <div class="sc"><span id="sb-sh">0</span> <span style="color:#5b6670">—</span> <span id="sb-sa">0</span></div>
          <div class="t" id="sb-a" style="color:var(--accent-defend)">ENEMY</div>
        </div>
        <div class="cols">
          <div class="col atk" id="sb-cola"><div class="ch">YOUR TEAM</div></div>
          <div class="col def" id="sb-colb"><div class="ch">ENEMY TEAM</div></div>
        </div>
      </div>
    `;
    this.el = el;
    this.root.appendChild(el);
    this.colA = el.querySelector('#sb-cola');
    this.colB = el.querySelector('#sb-colb');
    this.shEl = el.querySelector('#sb-sh');
    this.saEl = el.querySelector('#sb-sa');
  }

  /**
   * @param {object} d { humanSide, aiSide, scoreH, scoreA,
   *   humanTeam:[{name,k,d,alive,you,side}], aiTeam:[...] }
   */
  render(d) {
    this.shEl.textContent = d.scoreH;
    this.saEl.textContent = d.scoreA;
    const fill = (col, team, sideCls, label) => {
      col.className = 'col ' + sideCls;
      col.innerHTML = `<div class="ch">${label}</div>` + team.map((p) =>
        `<div class="row ${p.alive ? '' : 'dead'} ${p.you ? 'you' : ''}">
          <span class="nm">${p.you ? '▸ ' : ''}${p.name}</span>
          <span class="kd">${p.k} / ${p.d}</span>
        </div>`).join('');
    };
    fill(this.colA, d.humanTeam, d.humanSide === 'ATTACK' ? 'atk' : 'def', 'YOUR TEAM');
    fill(this.colB, d.aiTeam, d.aiSide === 'ATTACK' ? 'atk' : 'def', 'ENEMY TEAM');
  }

  show() { this.el.classList.add('show'); }
  hide() { this.el.classList.remove('show'); }
}
