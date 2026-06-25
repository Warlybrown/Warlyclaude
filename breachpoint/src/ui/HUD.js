// HUD.js — Phase 1 minimal heads-up display (DOM overlay).
//
// Just enough to TEST the FPS core: a dynamic crosshair that expands with
// spread, an ammo/reserve counter, reload + low-ammo prompts, a hit marker, and
// a stance/lean readout. Phase 6 replaces this with the full tactical HUD
// (team pips, kill feed, objective timers, etc.).

export class HUD {
  /** @param {HTMLElement} root the #ui overlay element */
  constructor(root) {
    this.root = root;
    this._build();
    this._hitTimer = 0;
    this._killTimer = 0;
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'hud-p1';
    el.innerHTML = `
      <style>
        #hud-p1 { position:absolute; inset:0; pointer-events:none;
                  font-family: var(--hud-font); color: var(--ink); }
        /* dynamic crosshair: four lines that push out with spread */
        #xhair { position:absolute; left:50%; top:50%; width:0; height:0; }
        #xhair .l { position:absolute; background:#dfe7ee; opacity:.85;
                    box-shadow:0 0 2px rgba(0,0,0,.8); }
        #xhair .dot { position:absolute; width:2px; height:2px; left:-1px; top:-1px;
                      background:#dfe7ee; opacity:.9; }
        #xhair .v { width:2px; height:7px; }
        #xhair .h { height:2px; width:7px; }
        #hitmarker { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) rotate(45deg);
                     opacity:0; }
        #hitmarker span { position:absolute; background:#ffffff; box-shadow:0 0 3px #000; }
        #hitmarker.kill span { background:#ff5a5a; }
        /* ammo block, bottom-right */
        #ammo { position:absolute; right:26px; bottom:22px; text-align:right; }
        #ammo .mag { font-size:38px; font-weight:700; letter-spacing:.04em; line-height:1; }
        #ammo .mag .res { font-size:18px; color:var(--ink-dim); font-weight:400; }
        #ammo .wname { font-size:12px; letter-spacing:.25em; color:var(--ink-dim);
                       margin-top:4px; text-transform:uppercase; }
        #ammo .prompt { font-size:13px; letter-spacing:.2em; color:var(--accent-defend);
                        margin-top:6px; min-height:16px; }
        #ammo.low .mag { color:var(--accent-defend); }
        /* stance, bottom-left */
        #stance { position:absolute; left:26px; bottom:22px; font-size:12px;
                  letter-spacing:.2em; color:var(--ink-dim); text-transform:uppercase; }
        #stance b { color:var(--ink); }
        #stance .lean.on { color:var(--accent-attack); }
        /* score readout, top-center */
        #practice { position:absolute; left:50%; top:14px; transform:translateX(-50%);
                    font-size:12px; letter-spacing:.25em; color:var(--ink-dim); }
        #practice b { color:var(--accent-attack); }
      </style>
      <div id="xhair">
        <div class="dot"></div>
        <div class="l v top"></div><div class="l v bot"></div>
        <div class="l h left"></div><div class="l h right"></div>
      </div>
      <div id="hitmarker"><span class="a"></span><span class="b"></span></div>
      <div id="practice">DOWNED TARGETS&nbsp; <b id="kills">0</b></div>
      <div id="ammo">
        <div class="mag"><span id="mag">30</span> / <span class="res" id="res">120</span></div>
        <div class="wname" id="wname">VK-9 CARBINE</div>
        <div class="prompt" id="prompt"></div>
      </div>
      <div id="stance">
        <span id="st">STAND</span> · <span class="lean" id="ln">LEAN —</span>
        · <span id="md">HIP</span>
      </div>
    `;
    this.root.appendChild(el);

    this.x = {
      top: el.querySelector('#xhair .top'),
      bot: el.querySelector('#xhair .bot'),
      left: el.querySelector('#xhair .left'),
      right: el.querySelector('#xhair .right'),
    };
    this.hitmarker = el.querySelector('#hitmarker');
    this.hmA = el.querySelector('#hitmarker .a');
    this.hmB = el.querySelector('#hitmarker .b');
    this.magEl = el.querySelector('#mag');
    this.resEl = el.querySelector('#res');
    this.wnameEl = el.querySelector('#wname');
    this.promptEl = el.querySelector('#prompt');
    this.ammoEl = el.querySelector('#ammo');
    this.stEl = el.querySelector('#st');
    this.lnEl = el.querySelector('#ln');
    this.mdEl = el.querySelector('#md');
    this.killsEl = el.querySelector('#kills');
    this._kills = 0;

    // Size the hit marker arms once.
    for (const s of [this.hmA, this.hmB]) {
      s.style.width = '2px'; s.style.height = '2px';
    }
  }

  onWeaponEvent(ev) {
    if (ev.type === 'hit') {
      this._hitTimer = 0.12;
      this.hitmarker.classList.toggle('kill', !!ev.killed);
    }
    if (ev.type === 'kill') {
      this._kills++;
      this.killsEl.textContent = this._kills;
    }
  }

  /**
   * @param {object} s { spread(rad), ammo, reserve, reloading, weaponName,
   *                     crouch01, lean, leanAllowed, ads, sprinting }
   */
  update(s, dt) {
    // Crosshair gap scales with spread (px). Tune factor for readability.
    const gap = 4 + s.spread * 520;
    const len = 7;
    this.x.top.style.left = '-1px';
    this.x.top.style.top = `${-gap - len}px`;
    this.x.bot.style.left = '-1px';
    this.x.bot.style.top = `${gap}px`;
    this.x.left.style.top = '-1px';
    this.x.left.style.left = `${-gap - len}px`;
    this.x.right.style.top = '-1px';
    this.x.right.style.left = `${gap}px`;

    // Ammo.
    this.magEl.textContent = s.ammo;
    this.resEl.textContent = s.reserve;
    this.wnameEl.textContent = s.weaponName;
    this.ammoEl.classList.toggle('low', s.ammo <= 5 && !s.reloading);

    // Prompts.
    if (s.reloading) this.promptEl.textContent = 'RELOADING…';
    else if (s.ammo === 0) this.promptEl.textContent = '⟳ RELOAD [R]';
    else if (s.ammo <= 5) this.promptEl.textContent = 'LOW AMMO';
    else this.promptEl.textContent = '';

    // Stance / lean / fire mode.
    this.stEl.textContent = s.crouch01 > 0.5 ? 'CROUCH' : 'STAND';
    const dir = s.lean < -0.1 ? 'LEAN ◄' : s.lean > 0.1 ? 'LEAN ►' : 'LEAN —';
    this.lnEl.textContent = dir + (s.lean !== 0 && !s.leanAllowed ? ' ✕' : '');
    this.lnEl.classList.toggle('on', s.lean !== 0 && s.leanAllowed);
    this.mdEl.textContent = s.sprinting ? 'SPRINT' : s.ads ? 'ADS' : 'HIP';

    // Hit marker fade.
    if (this._hitTimer > 0) {
      this._hitTimer -= dt;
      const o = Math.max(0, this._hitTimer / 0.12);
      this.hitmarker.style.opacity = o;
      const spread = 6 + (1 - o) * 4;
      this.hmA.style.transform = `translate(${spread}px,${spread}px)`;
      this.hmA.style.width = '6px'; this.hmA.style.height = '2px';
      this.hmB.style.transform = `translate(${spread}px,${spread}px)`;
      this.hmB.style.width = '2px'; this.hmB.style.height = '6px';
    } else {
      this.hitmarker.style.opacity = 0;
    }
  }
}
