// GameState.js — match → round → phase finite state machine.
//
// Owns the high-level flow and timers; the orchestrator (main.js) reacts to
// phase changes by enabling/disabling systems and evaluates win conditions,
// calling endRound() when one is met.
//
// Match: first team to `roundsToWin` wins, capped at `maxRounds`. Sides swap
// each round, so the human alternates ATTACK/DEFEND. No respawns within a round.
//
// Phases per round:
//   OPERATOR_SELECT (~15s) → PREP/drone (~45s) → ACTION (~180s) → ROUND_END (~6s)
// then next round or MATCH_END.

export const Phase = {
  MENU: 'MENU',
  OPERATOR_SELECT: 'OPERATOR_SELECT',
  PREP: 'PREP',
  ACTION: 'ACTION',
  ROUND_END: 'ROUND_END',
  MATCH_END: 'MATCH_END',
};

export const Team = { ATTACK: 'ATTACK', DEFEND: 'DEFEND' };

const DEFAULT_DURATIONS = {
  [Phase.OPERATOR_SELECT]: 15,
  [Phase.PREP]: 45,
  [Phase.ACTION]: 180,
  [Phase.ROUND_END]: 6,
};

export class GameState {
  constructor(config = {}) {
    this.config = {
      roundsToWin: config.roundsToWin ?? 4,
      maxRounds: config.maxRounds ?? 7,
      durations: { ...DEFAULT_DURATIONS, ...(config.durations || {}) },
      // Which side the human starts on (round 1).
      humanStartSide: config.humanStartSide ?? Team.ATTACK,
    };

    this.phase = Phase.MENU;
    this.round = 0;
    this.timer = 0; // seconds remaining in the current phase
    this.score = { human: 0, ai: 0 }; // tracked from the human's perspective
    this.lastRound = null; // { winner:'human'|'ai', side, reason }

    this._listeners = new Set();
    this._paused = true;
  }

  // --- subscriptions --------------------------------------------------------
  onPhaseChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(prev) { this._listeners.forEach((fn) => fn(this.phase, prev, this)); }

  // --- derived state --------------------------------------------------------
  /** Which side is the human on THIS round? Sides swap every round. */
  get humanSide() {
    const flip = (this.round - 1) % 2 === 1;
    const start = this.config.humanStartSide;
    if (!flip) return start;
    return start === Team.ATTACK ? Team.DEFEND : Team.ATTACK;
  }

  get aiSide() {
    return this.humanSide === Team.ATTACK ? Team.DEFEND : Team.ATTACK;
  }

  get timeRemaining() { return Math.max(0, this.timer); }

  isMatchPoint() {
    return this.score.human === this.config.roundsToWin - 1 ||
      this.score.ai === this.config.roundsToWin - 1;
  }

  // --- control --------------------------------------------------------------
  startMatch() {
    this.round = 0;
    this.score = { human: 0, ai: 0 };
    this._paused = false;
    this._nextRound();
  }

  _nextRound() {
    this.round++;
    this._setPhase(Phase.OPERATOR_SELECT);
  }

  _setPhase(phase) {
    const prev = this.phase;
    this.phase = phase;
    this.timer = this.config.durations[phase] ?? 0;
    this._emit(prev);
  }

  /** Skip the rest of the current phase (e.g. "ready up"). */
  skipPhase() {
    if (this.phase === Phase.OPERATOR_SELECT || this.phase === Phase.PREP) {
      this.timer = 0;
    }
  }

  /**
   * End the action phase. winner is 'human' or 'ai'.
   * @param {string} winner
   * @param {string} reason  e.g. 'Defuser detonated', 'Defenders eliminated'
   */
  endRound(winner, reason) {
    if (this.phase !== Phase.ACTION) return;
    const side = winner === 'human' ? this.humanSide : this.aiSide;
    this.lastRound = { winner, side, reason, round: this.round };
    this.score[winner]++;
    this._setPhase(Phase.ROUND_END);
  }

  // --- per-tick advance -----------------------------------------------------
  update(dt) {
    if (this._paused) return;
    if (this.phase === Phase.MENU || this.phase === Phase.MATCH_END) return;

    this.timer -= dt;
    if (this.timer > 0) return;

    switch (this.phase) {
      case Phase.OPERATOR_SELECT:
        this._setPhase(Phase.PREP);
        break;
      case Phase.PREP:
        this._setPhase(Phase.ACTION);
        break;
      case Phase.ACTION:
        // Time ran out with no plant → defenders win (attackers failed to plant).
        this._timeoutRound();
        break;
      case Phase.ROUND_END:
        this._afterRound();
        break;
      default:
        break;
    }
  }

  _timeoutRound() {
    // If the action timer expires, the DEFENDING side wins the round.
    const winner = this.humanSide === Team.DEFEND ? 'human' : 'ai';
    this.lastRound = { winner, side: Team.DEFEND, reason: 'Time expired — site held', round: this.round };
    this.score[winner]++;
    this._setPhase(Phase.ROUND_END);
  }

  _afterRound() {
    const { roundsToWin, maxRounds } = this.config;
    if (
      this.score.human >= roundsToWin ||
      this.score.ai >= roundsToWin ||
      this.round >= maxRounds
    ) {
      this._setPhase(Phase.MATCH_END);
    } else {
      this._nextRound();
    }
  }

  get matchWinner() {
    if (this.phase !== Phase.MATCH_END) return null;
    return this.score.human > this.score.ai ? 'human' : 'ai';
  }
}
