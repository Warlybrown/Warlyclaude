// index.js — gadget registry. Maps a gadget id to its constructor so operators
// can reference gadgets by id and the loadout can instantiate them uniformly.

import { HardBreach } from './HardBreach.js';
import { MeleeBreach } from './MeleeBreach.js';
import { FlashThrow } from './FlashThrow.js';
import { ReconScan } from './ReconScan.js';
import { BallisticShield } from './BallisticShield.js';
import { Trap } from './Trap.js';
import { Jammer } from './Jammer.js';
import { DeployCamera } from './DeployCamera.js';
import { Reactive } from './Reactive.js';
import { AnchorShield } from './AnchorShield.js';

export const GADGETS = {
  hardbreach: (ctx) => new HardBreach(ctx),
  meleebreach: (ctx) => new MeleeBreach(ctx),
  flash: (ctx) => new FlashThrow(ctx),
  recon: (ctx) => new ReconScan(ctx),
  shield: (ctx) => new BallisticShield(ctx),
  trap_prox: (ctx) => new Trap(ctx, 'proximity'),
  trap_wire: (ctx) => new Trap(ctx, 'wire'),
  jammer: (ctx) => new Jammer(ctx),
  camera: (ctx) => new DeployCamera(ctx),
  reactive: (ctx) => new Reactive(ctx),
  anchor: (ctx) => new AnchorShield(ctx),
};

export function makeGadget(id, ctx) {
  const factory = GADGETS[id];
  return factory ? factory(ctx) : null;
}
