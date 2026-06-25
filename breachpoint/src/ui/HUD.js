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
        /* objective / phase bar, top-center */
        #objbar { position:absolute; left:50%; top:12px; transform:translateX(-50%);
                  text-align:center; min-width:340px; }
        #objbar .timer { font-size:30px; font-weight:700; letter-spacing:.06em; line-height:1; }
        #objbar .timer.plant { color:var(--accent-defend); }
        #objbar .phase { font-size:11px; letter-spacing:.32em; color:var(--ink-dim);
                         text-transform:uppercase; margin-top:3px; }
        #objbar .obj { font-size:12px; letter-spacing:.18em; color:var(--ink);
                       margin-top:2px; text-transform:uppercase; min-height:15px; }
        #objbar .obj b.atk { color:var(--accent-attack); }
        #objbar .obj b.def { color:var(--accent-defend); }
        /* team pips, top corners */
        .pips { position:absolute; top:16px; display:flex; gap:6px; }
        #pips-human { left:24px; }
        #pips-ai { right:24px; flex-direction:row-reverse; }
        .pip { width:10px; height:10px; border-radius:2px; background:#2a3138;
               border:1px solid #3a444d; }
        .pip.alive.atk { background:var(--accent-attack); border-color:var(--accent-attack); }
        .pip.alive.def { background:var(--accent-defend); border-color:var(--accent-defend); }
        .pips .lbl { font-size:10px; letter-spacing:.2em; color:var(--ink-dim);
                     align-self:center; margin:0 6px; }
        /* round score under objbar */
        #scoreline { position:absolute; left:50%; top:70px; transform:translateX(-50%);
                     font-size:12px; letter-spacing:.3em; color:var(--ink-dim); }
        #scoreline b { color:var(--ink); font-size:14px; }
        /* center banner (round/match end, plant alerts) */
        #banner { position:absolute; left:50%; top:42%; transform:translate(-50%,-50%);
                  text-align:center; opacity:0; transition:opacity .35s ease; }
        #banner .big { font-size:46px; font-weight:800; letter-spacing:.06em; }
        #banner .sub { font-size:15px; letter-spacing:.28em; color:var(--ink-dim);
                       margin-top:8px; text-transform:uppercase; }
        #banner.show { opacity:1; }
        #banner.atk .big { color:var(--accent-attack); }
        #banner.def .big { color:var(--accent-defend); }
        /* damage direction + low-level flashes */
        #dmgflash { position:absolute; inset:0; box-shadow:inset 0 0 120px rgba(255,40,40,.0);
                    transition:box-shadow .12s ease; }
        /* progress (plant/defuse) ring text, center-bottom */
        #channel { position:absolute; left:50%; top:58%; transform:translateX(-50%);
                   text-align:center; opacity:0; }
        #channel.show { opacity:1; }
        #channel .bar { width:200px; height:5px; background:#222a30; margin:6px auto 0; }
        #channel .bar i { display:block; height:100%; width:0; background:var(--accent-attack); }
        #channel .txt { font-size:12px; letter-spacing:.25em; color:var(--ink); text-transform:uppercase; }
        #flashblind { position:absolute; inset:0; background:#ffffff; opacity:0;
                      pointer-events:none; }
        /* spotted-enemy world markers */
        #markers { position:absolute; inset:0; pointer-events:none; }
        #markers .mk { position:absolute; transform:translate(-50%,-50%);
          color:#ff5a5a; font-size:13px; font-weight:700; letter-spacing:.05em;
          text-shadow:0 0 4px #000; white-space:nowrap; }
        #markers .mk .tri { display:block; text-align:center; font-size:10px; line-height:1; }
        #markers .mk .dist { font-size:9px; color:#ffb0b0; opacity:.85; }
        /* damage-direction indicator (rotates around centre) */
        #dmgdir { position:absolute; left:50%; top:50%; width:0; height:0; opacity:0;
          transition:opacity .15s ease; }
        #dmgdir .arrow { position:absolute; left:-12px; top:-150px; width:24px; text-align:center;
          color:#ff3a3a; font-size:26px; text-shadow:0 0 6px #000;
          transform-origin:12px 162px; }
        /* gadget block, above stance bottom-left */
        #gadget { position:absolute; left:26px; bottom:54px; font-size:12px;
                  letter-spacing:.18em; color:var(--ink-dim); text-transform:uppercase; }
        #gadget b { color:var(--ink); }
        #gadget .charge { color:var(--accent-attack); }
      </style>
      <div id="dmgflash"></div>
      <div id="flashblind"></div>
      <div id="markers"></div>
      <div id="dmgdir"><div class="arrow" id="dmgdir-a">▲</div></div>
      <div id="xhair">
        <div class="dot"></div>
        <div class="l v top"></div><div class="l v bot"></div>
        <div class="l h left"></div><div class="l h right"></div>
      </div>
      <div id="hitmarker"><span class="a"></span><span class="b"></span></div>
      <div id="objbar">
        <div class="timer" id="timer">--</div>
        <div class="phase" id="phase">PRACTICE</div>
        <div class="obj" id="obj"></div>
      </div>
      <div class="pips" id="pips-human"><span class="lbl">YOU</span></div>
      <div class="pips" id="pips-ai"><span class="lbl">ENEMY</span></div>
      <div id="scoreline">ROUND <b id="rnd">1</b> &nbsp;·&nbsp; <b id="sc-h">0</b> — <b id="sc-a">0</b></div>
      <div id="banner"><div class="big" id="banner-big"></div><div class="sub" id="banner-sub"></div></div>
      <div id="channel"><div class="txt" id="channel-txt"></div><div class="bar"><i id="channel-bar"></i></div></div>
      <div id="ammo">
        <div class="mag"><span id="mag">30</span> / <span class="res" id="res">120</span></div>
        <div class="wname" id="wname">VK-9 CARBINE</div>
        <div class="prompt" id="prompt"></div>
      </div>
      <div id="gadget"><b id="gname">—</b> <span class="charge" id="gcharge"></span></div>
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

    // Phase 3 objective/round elements.
    this.timerEl = el.querySelector('#timer');
    this.phaseEl = el.querySelector('#phase');
    this.objEl = el.querySelector('#obj');
    this.pipsHuman = el.querySelector('#pips-human');
    this.pipsAi = el.querySelector('#pips-ai');
    this.rndEl = el.querySelector('#rnd');
    this.scHEl = el.querySelector('#sc-h');
    this.scAEl = el.querySelector('#sc-a');
    this.bannerEl = el.querySelector('#banner');
    this.bannerBig = el.querySelector('#banner-big');
    this.bannerSub = el.querySelector('#banner-sub');
    this.channelEl = el.querySelector('#channel');
    this.channelTxt = el.querySelector('#channel-txt');
    this.channelBar = el.querySelector('#channel-bar');
    this.dmgflash = el.querySelector('#dmgflash');
    this.flashblind = el.querySelector('#flashblind');
    this.markersEl = el.querySelector('#markers');
    this.dmgdirEl = el.querySelector('#dmgdir');
    this.dmgdirArrow = el.querySelector('#dmgdir-a');
    this._markerPool = [];
    this._dmgDirTimer = 0;
    this.gnameEl = el.querySelector('#gname');
    this.gchargeEl = el.querySelector('#gcharge');
    this._dmgTimer = 0;
    this._blindTimer = 0;
    this._blindMax = 1;

    // Size the hit marker arms once.
    for (const s of [this.hmA, this.hmB]) {
      s.style.width = '2px'; s.style.height = '2px';
    }
  }

  // --- Phase 3 objective / round API ---------------------------------------

  /** Build the team alive-pip rows. */
  setTeams(humanCount, aiCount, humanSide, aiSide) {
    const make = (host, count, side, label) => {
      host.querySelectorAll('.pip').forEach((p) => p.remove());
      for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = `pip alive ${side === 'ATTACK' ? 'atk' : 'def'}`;
        host.appendChild(p);
      }
    };
    make(this.pipsHuman, humanCount, humanSide);
    make(this.pipsAi, aiCount, aiSide);
    this._humanSide = humanSide;
    this._aiSide = aiSide;
  }

  /** Update alive pips: arrays of booleans (true = alive). */
  setAlive(humanAlive, aiAlive) {
    const apply = (host, arr, side) => {
      const pips = host.querySelectorAll('.pip');
      arr.forEach((alive, i) => {
        if (!pips[i]) return;
        pips[i].classList.toggle('alive', alive);
        pips[i].classList.toggle(side === 'ATTACK' ? 'atk' : 'def', alive);
      });
    };
    apply(this.pipsHuman, humanAlive, this._humanSide);
    apply(this.pipsAi, aiAlive, this._aiSide);
  }

  /** Top-center phase/timer/objective + score. */
  setObjective({ phaseLabel, timer, objective, plantMode, round, scoreH, scoreA }) {
    if (timer != null) {
      const m = Math.floor(timer / 60);
      const s = Math.floor(timer % 60);
      this.timerEl.textContent = plantMode ? `${Math.ceil(timer)}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    this.timerEl.classList.toggle('plant', !!plantMode);
    if (phaseLabel != null) this.phaseEl.textContent = phaseLabel;
    if (objective != null) this.objEl.innerHTML = objective;
    if (round != null) this.rndEl.textContent = round;
    if (scoreH != null) this.scHEl.textContent = scoreH;
    if (scoreA != null) this.scAEl.textContent = scoreA;
  }

  /** Channel progress bar for plant/defuse (progress 0..1, null hides). */
  setChannel(text, progress, accent = 'atk') {
    if (progress == null) { this.channelEl.classList.remove('show'); return; }
    this.channelEl.classList.add('show');
    this.channelTxt.textContent = text;
    this.channelBar.style.width = `${Math.round(progress * 100)}%`;
    this.channelBar.style.background = accent === 'def'
      ? 'var(--accent-defend)' : 'var(--accent-attack)';
  }

  /** Center banner. side: 'atk'|'def'|null. duration in seconds (0 = sticky). */
  showBanner(big, sub, side = null, duration = 4) {
    this.bannerBig.textContent = big;
    this.bannerSub.textContent = sub || '';
    this.bannerEl.className = 'show' + (side ? ' ' + side : '');
    if (this._bannerTO) clearTimeout(this._bannerTO);
    if (duration > 0) {
      this._bannerTO = setTimeout(() => this.bannerEl.classList.remove('show'), duration * 1000);
    }
  }

  hideBanner() { this.bannerEl.classList.remove('show'); }

  /** Red directional damage flash. */
  flashDamage() { this._dmgTimer = 0.4; }

  /** White-out flash blind, strength 0..1 → up to ~3s of fade. */
  flashBlind(strength) {
    const dur = 0.6 + strength * 2.4;
    this._blindTimer = Math.max(this._blindTimer, dur);
    this._blindMax = Math.max(this._blindMax, dur);
  }

  /** Signature gadget readout. */
  setGadget(name, charges, ready) {
    this.gnameEl.textContent = name || '—';
    this.gchargeEl.textContent = charges == null ? '' :
      (charges > 90 ? '∞' : `×${charges}`) + (ready ? '' : ' …');
    this.gchargeEl.style.color = ready ? 'var(--accent-attack)' : 'var(--ink-dim)';
  }

  onWeaponEvent(ev) {
    if (ev.type === 'hit') {
      this._hitTimer = 0.12;
      this.hitmarker.classList.toggle('kill', !!ev.killed);
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

    // Damage flash decay.
    if (this._dmgTimer > 0) {
      this._dmgTimer -= dt;
      const a = Math.max(0, this._dmgTimer / 0.4);
      this.dmgflash.style.boxShadow = `inset 0 0 120px rgba(255,40,40,${a * 0.7})`;
    } else {
      this.dmgflash.style.boxShadow = 'inset 0 0 120px rgba(255,40,40,0)';
    }

    // Flash-blind decay (full white, then fades).
    if (this._blindTimer > 0) {
      this._blindTimer -= dt;
      this.flashblind.style.opacity = Math.max(0, this._blindTimer / this._blindMax);
    } else {
      this.flashblind.style.opacity = 0;
    }

    // Damage-direction indicator decay.
    if (this._dmgDirTimer > 0) {
      this._dmgDirTimer -= dt;
      this.dmgdirEl.style.opacity = Math.min(1, this._dmgDirTimer);
    } else {
      this.dmgdirEl.style.opacity = 0;
    }
  }

  /** True while the player is significantly flash-blinded (accuracy penalty). */
  get isBlinded() { return this._blindTimer > 0.3; }

  /**
   * Draw spotted-enemy markers at screen positions.
   * @param {Array} list [{ x, y, dist, onScreen }] x/y in CSS pixels
   */
  setSpotMarkers(list) {
    // Grow the pool as needed.
    while (this._markerPool.length < list.length) {
      const m = document.createElement('div');
      m.className = 'mk';
      m.innerHTML = '<span class="tri">▼</span><span class="dist"></span>';
      this.markersEl.appendChild(m);
      this._markerPool.push(m);
    }
    for (let i = 0; i < this._markerPool.length; i++) {
      const m = this._markerPool[i];
      const d = list[i];
      if (!d || !d.onScreen) { m.style.display = 'none'; continue; }
      m.style.display = 'block';
      m.style.left = `${d.x}px`;
      m.style.top = `${d.y}px`;
      m.querySelector('.dist').textContent = `${Math.round(d.dist)}m`;
    }
  }

  /** Point the damage-direction arrow toward a relative angle (radians), or hide. */
  setDamageDir(angleRad) {
    if (angleRad == null) return;
    this._dmgDirTimer = 1.2;
    this.dmgdirArrow.style.transform = `rotate(${angleRad}rad)`;
  }

  /** Hide all the in-round combat HUD (used in prep/drone/menus). */
  setCombatVisible(on) {
    const ids = ['#xhair', '#ammo', '#stance'];
    for (const id of ids) {
      const e = this.root.querySelector(id);
      if (e) e.style.display = on ? '' : 'none';
    }
  }
}
