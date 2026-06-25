// DronePhaseUI.js — overlay for the prep/drone phase.
//
// Attacker view: a "DRONE" framed border, battery/health, spot prompt, and a
// count of objectives/enemies found. Defender view: a reinforcement prompt with
// remaining charges. Shown only during PREP; hidden otherwise.

export class DronePhaseUI {
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.id = 'droneui';
    el.innerHTML = `
      <style>
        #droneui { position:absolute; inset:0; pointer-events:none; font-family:var(--hud-font);
          display:none; }
        #droneui.show { display:block; }
        #droneui .frame { position:absolute; inset:24px; border:1px solid rgba(46,155,255,.35);
          border-radius:4px; box-shadow:inset 0 0 60px rgba(0,0,0,.5); }
        #droneui .frame::before { content:'◣ DRONE FEED'; position:absolute; top:8px; left:12px;
          font-size:11px; letter-spacing:.3em; color:var(--accent-attack); }
        #droneui .scan { position:absolute; inset:0; background:
          repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(46,155,255,.025) 4px); }
        #droneui .tl { position:absolute; top:38px; left:40px; font-size:12px; letter-spacing:.18em;
          color:var(--ink); }
        #droneui .tl .bat { color:var(--accent-attack); }
        #droneui .br { position:absolute; bottom:40px; right:40px; font-size:12px;
          letter-spacing:.18em; color:var(--ink-dim); text-align:right; }
        #droneui .br b { color:var(--ink); }
        #droneui .prompt { position:absolute; bottom:40px; left:50%; transform:translateX(-50%);
          font-size:13px; letter-spacing:.22em; color:var(--ink); text-transform:uppercase; }
        #droneui .prompt .key { color:var(--accent-attack); }
        /* defender prep panel */
        #droneui .defpanel { position:absolute; top:40px; left:50%; transform:translateX(-50%);
          text-align:center; }
        #droneui .defpanel .h { font-size:13px; letter-spacing:.3em; color:var(--accent-defend); }
        #droneui .defpanel .s { font-size:12px; letter-spacing:.16em; color:var(--ink-dim); margin-top:6px; }
        #droneui.def .frame { display:none; }
      </style>
      <div class="frame"></div>
      <div class="scan"></div>
      <div class="tl">BATTERY <span class="bat" id="dr-bat">100%</span> · INTEGRITY <span id="dr-hp">100%</span></div>
      <div class="br">SPOTTED <b id="dr-spot">0</b><br>OBJECTIVE <b id="dr-obj">SCANNING…</b></div>
      <div class="prompt"><span class="key">[WASD]</span> DRIVE · <span class="key">[MOUSE]</span> STEER · ENEMIES AUTO-TAGGED</div>
      <div class="defpanel">
        <div class="h">PREPARATION — SET THE SITE</div>
        <div class="s"><span style="color:var(--accent-defend)">[V]</span> reinforce wall · <span style="color:var(--accent-defend)">[F]</span> place gadget · <span id="dr-reinf">10</span> charges left</div>
      </div>
    `;
    this.el = el;
    this.root.appendChild(el);
    this.batEl = el.querySelector('#dr-bat');
    this.hpEl = el.querySelector('#dr-hp');
    this.spotEl = el.querySelector('#dr-spot');
    this.objEl = el.querySelector('#dr-obj');
    this.reinfEl = el.querySelector('#dr-reinf');
  }

  showAttacker() { this.el.className = 'show atk'; }
  showDefender() { this.el.className = 'show def'; }
  hide() { this.el.className = ''; }

  update({ battery, hp, spotted, objective, reinforce }) {
    if (battery != null) this.batEl.textContent = `${Math.round(battery)}%`;
    if (hp != null) this.hpEl.textContent = `${Math.round(hp)}%`;
    if (spotted != null) this.spotEl.textContent = spotted;
    if (objective != null) this.objEl.textContent = objective;
    if (reinforce != null) this.reinfEl.textContent = reinforce;
  }
}
