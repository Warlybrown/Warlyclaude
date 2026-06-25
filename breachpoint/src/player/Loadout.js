// Loadout.js — weapon attachments + secondary gadget quantities.
//
// Attachments modify weapon feel:
//   sight  — ADS zoom / clarity (affects adsFov)
//   grip   — vertical recoil control (scales recoilPattern pitch)
//   barrel — spread control (scales spread.base/moving)
// The loadout produces a "tuned" weapon def by cloning the base def and applying
// the selected attachment multipliers, so the Weapon stays attachment-agnostic.

export const ATTACHMENTS = {
  sight: {
    none: { name: 'IRON SIGHTS', adsFovMul: 1.0 },
    red: { name: 'RED DOT', adsFovMul: 0.95 },
    holo: { name: 'HOLO', adsFovMul: 0.92 },
    scope2x: { name: '2× SCOPE', adsFovMul: 0.7 },
  },
  grip: {
    none: { name: 'NO GRIP', recoilMul: 1.0 },
    vertical: { name: 'VERTICAL GRIP', recoilMul: 0.82 },
    angled: { name: 'ANGLED GRIP', recoilMul: 0.9, recoverMul: 1.2 },
  },
  barrel: {
    none: { name: 'STANDARD', spreadMul: 1.0 },
    compensator: { name: 'COMPENSATOR', spreadMul: 0.85, recoilDriftMul: 0.7 },
    suppressor: { name: 'SUPPRESSOR', spreadMul: 0.95, quiet: true, damageMul: 0.92 },
  },
};

export class Loadout {
  /**
   * @param {object} operator from operators.js
   * @param {object} sel selected attachment ids { sight, grip, barrel }
   */
  constructor(operator, sel = {}) {
    this.operator = operator;
    this.sel = {
      sight: sel.sight || 'red',
      grip: sel.grip || 'vertical',
      barrel: sel.barrel || 'none',
    };
    // Secondary gadget quantities, copied so per-round counts can decrement.
    this.utility = (operator.utility || []).map((u) => ({ ...u }));
  }

  get sight() { return ATTACHMENTS.sight[this.sel.sight]; }
  get grip() { return ATTACHMENTS.grip[this.sel.grip]; }
  get barrel() { return ATTACHMENTS.barrel[this.sel.barrel]; }

  /** Produce an attachment-tuned clone of a base weapon def. */
  tuneWeapon(baseDef) {
    const grip = this.grip, barrel = this.barrel, sight = this.sight;
    const def = JSON.parse(JSON.stringify(baseDef));
    // Recoil: scale vertical kicks by grip, horizontal drift by barrel.
    def.recoilPattern = def.recoilPattern.map(([p, y]) => [
      p * (grip.recoilMul ?? 1),
      y * (barrel.recoilDriftMul ?? 1),
    ]);
    if (grip.recoverMul) def.recoilRecover *= grip.recoverMul;
    // Spread: scale by barrel.
    def.spread.base *= barrel.spreadMul ?? 1;
    def.spread.moving *= barrel.spreadMul ?? 1;
    // Damage: suppressor trades a little damage.
    if (barrel.damageMul) def.damage *= barrel.damageMul;
    // Sight: ADS FOV handled by FirstPersonCamera via adsFovMul.
    def._adsFovMul = sight.adsFovMul ?? 1;
    def._quiet = !!barrel.quiet;
    return def;
  }

  /** Consume one of a utility item by id; returns remaining or -1 if none. */
  consumeUtility(id) {
    const u = this.utility.find((x) => x.id === id);
    if (!u || u.count <= 0) return -1;
    u.count--;
    return u.count;
  }

  resetUtility() {
    this.utility = (this.operator.utility || []).map((u) => ({ ...u }));
  }
}
