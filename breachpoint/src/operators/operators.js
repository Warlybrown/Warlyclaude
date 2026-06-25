// operators.js — the original WARL 5 SIEGE operator roster.
//
// Every name, callsign, and bit of lore here is original to this project. Each
// operator has: callsign, side, speed (1-3) / armor (1-3) — they trade off so
// speed+armor == 4 — a primary + secondary weapon, two utility/throwable slots
// with quantities, and one unique signature gadget (referenced by gadget id from
// gadgets/index.js). The unit is the fictional "WARLINE 5" task force.

export const Side = { ATTACK: 'ATTACK', DEFEND: 'DEFEND' };

// Secondary gadget / throwable definitions (quantities matter, like the genre).
export const UTILITY = {
  frag: { id: 'frag', name: 'FRAG GRENADE', icon: '✷' },
  breach: { id: 'breach', name: 'BREACH CHARGE', icon: '◈' },
  smoke: { id: 'smoke', name: 'SMOKE', icon: '◍' },
  flashbang: { id: 'flashbang', name: 'STUN', icon: '✦' },
  claymore: { id: 'claymore', name: 'TRIPMINE', icon: '⨂' },
  impact: { id: 'impact', name: 'IMPACT GRENADE', icon: '◆' },
};

export const OPERATORS = [
  // ---- ATTACKERS ----
  {
    callsign: 'RAMROD', side: Side.ATTACK, speed: 1, armor: 3,
    bio: 'Demolitions anchor. Cuts through hardened steel like paper.',
    primary: 'AR', secondary: 'PISTOL', gadget: 'hardbreach',
    utility: [{ ...UTILITY.frag, count: 2 }, { ...UTILITY.smoke, count: 1 }],
    accent: '#2e9bff',
  },
  {
    callsign: 'EMBER', side: Side.ATTACK, speed: 3, armor: 1,
    bio: 'Fast entry specialist. Blinds a room before anyone reacts.',
    primary: 'SMG', secondary: 'PISTOL', gadget: 'flash',
    utility: [{ ...UTILITY.breach, count: 1 }, { ...UTILITY.frag, count: 1 }],
    accent: '#2e9bff',
  },
  {
    callsign: 'ORACLE', side: Side.ATTACK, speed: 2, armor: 2,
    bio: 'Intel lead. Sonar pulse paints every body behind the wall.',
    primary: 'AR', secondary: 'PISTOL', gadget: 'recon',
    utility: [{ ...UTILITY.smoke, count: 2 }, { ...UTILITY.flashbang, count: 1 }],
    accent: '#2e9bff',
  },
  {
    callsign: 'MAUL', side: Side.ATTACK, speed: 2, armor: 2,
    bio: 'Silent breacher. Opens soft walls and hatches in one swing.',
    primary: 'SHOTGUN', secondary: 'PISTOL', gadget: 'meleebreach',
    utility: [{ ...UTILITY.frag, count: 1 }, { ...UTILITY.impact, count: 2 }],
    accent: '#2e9bff',
  },
  {
    callsign: 'AEGIS', side: Side.ATTACK, speed: 1, armor: 3,
    bio: 'Shield vanguard. Walks the front line and never blinks.',
    primary: 'SHOTGUN', secondary: 'PISTOL', gadget: 'shield',
    utility: [{ ...UTILITY.smoke, count: 1 }, { ...UTILITY.flashbang, count: 2 }],
    accent: '#2e9bff',
  },

  // ---- DEFENDERS ----
  {
    callsign: 'BRAMBLE', side: Side.DEFEND, speed: 2, armor: 2,
    bio: 'Trapper. Razor wire and proximity charges seal every approach.',
    primary: 'SMG', secondary: 'PISTOL', gadget: 'trap_prox',
    utility: [{ ...UTILITY.impact, count: 2 }, { ...UTILITY.claymore, count: 1 }],
    accent: '#ff8a2e',
  },
  {
    callsign: 'STATIC', side: Side.DEFEND, speed: 3, armor: 1,
    bio: 'Counter-intel. A nullfield kills drones and gadgets dead.',
    primary: 'SMG', secondary: 'PISTOL', gadget: 'jammer',
    utility: [{ ...UTILITY.impact, count: 1 }, { ...UTILITY.claymore, count: 2 }],
    accent: '#ff8a2e',
  },
  {
    callsign: 'WARDEN', side: Side.DEFEND, speed: 2, armor: 2,
    bio: 'Eyes of the site. Bulletproof cameras watch every lane.',
    primary: 'AR', secondary: 'PISTOL', gadget: 'camera',
    utility: [{ ...UTILITY.impact, count: 2 }, { ...UTILITY.claymore, count: 1 }],
    accent: '#ff8a2e',
  },
  {
    callsign: 'RIPOST', side: Side.DEFEND, speed: 2, armor: 2,
    bio: 'Reactive defender. Punishes a breach the instant it opens.',
    primary: 'AR', secondary: 'PISTOL', gadget: 'reactive',
    utility: [{ ...UTILITY.impact, count: 1 }, { ...UTILITY.claymore, count: 1 }],
    accent: '#ff8a2e',
  },
  {
    callsign: 'BULWARK', side: Side.DEFEND, speed: 1, armor: 3,
    bio: 'Site anchor. Plants bulletproof cover and holds the line.',
    primary: 'DMR', secondary: 'PISTOL', gadget: 'anchor',
    utility: [{ ...UTILITY.impact, count: 2 }, { ...UTILITY.claymore, count: 1 }],
    accent: '#ff8a2e',
  },
];

export function operatorsBySide(side) {
  return OPERATORS.filter((o) => o.side === side);
}

export function findOperator(callsign) {
  return OPERATORS.find((o) => o.callsign === callsign);
}
