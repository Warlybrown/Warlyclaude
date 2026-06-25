// housesite.js — data definition for the original "SAFEHOUSE" map.
//
// A blocky, readable two-story building. Everything here is DATA; MapLoader.js
// turns it into geometry, colliders, destructible surfaces, spawns, and sites.
// Coordinates: X east, Y up, Z south. Ground floor y=0, upper floor y=3.2.
//
// Surface types (consumed by Destruction.js):
//   'structural'    — load-bearing, never destructible (also exterior shell)
//   'soft'          — drywall/wood: shootable-through, breaches into holes
//   'reinforceable' — soft wall defenders can convert to 'hard' in prep
//   'hatch'         — breakable floor panel for vertical play
//   'floor'         — solid floor (non-destructible)
//
// All names/branding original.

export const FLOOR_H = 3.2; // storey height
export const WALL_T = 0.2; // wall thickness

export const housesite = {
  name: 'SAFEHOUSE',
  callout: 'Two-storey residential · bomb defusal',
  bounds: { w: 28, d: 28 }, // building footprint (metres)

  // Ambient/lighting hints for MapLoader.
  lighting: {
    exterior: 0.7,
    interior: 0.32,
    sky: 0x0b1a12,
    sun: [10, 18, 6],
  },

  // Floor slabs: {y, x, z, w, d}. Centered boxes (thin).
  floors: [
    { y: 0.0, x: 0, z: 0, w: 28, d: 28 }, // ground slab
    { y: FLOOR_H, x: 0, z: 2, w: 24, d: 22 }, // upper slab (smaller, leaves an open exterior balcony to south)
  ],

  // Static (non-destructible) walls / cover. {x,z,w,d,h,y? , type}
  // Orientation inferred from w vs d (the thin dimension is the facing normal).
  walls: [
    // ---- exterior shell, ground floor (structural) ----
    { x: 0, z: -14, w: 28, d: WALL_T, h: FLOOR_H, type: 'structural' }, // north
    { x: 0, z: 14, w: 28, d: WALL_T, h: FLOOR_H, type: 'structural' }, // south
    { x: -14, z: 0, w: WALL_T, d: 28, h: FLOOR_H, type: 'structural' }, // west
    { x: 14, z: 0, w: WALL_T, d: 28, h: FLOOR_H, type: 'structural' }, // east
    // ---- exterior shell, upper floor ----
    { x: 0, z: -9, w: 24, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    { x: 0, z: 13, w: 24, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    { x: -12, z: 2, w: WALL_T, d: 22, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    { x: 12, z: 2, w: WALL_T, d: 22, h: FLOOR_H, y: FLOOR_H, type: 'structural' },

    // ---- interior dividers, ground floor ----
    // Central spine wall splitting west rooms from east hall.
    { x: -2, z: -4, w: WALL_T, d: 20, h: FLOOR_H, type: 'structural' },
    // A short structural nub by the stairs.
    { x: 6, z: -4, w: WALL_T, d: 8, h: FLOOR_H, type: 'structural' },
  ],

  // Destructible surfaces: soft walls, reinforceable walls, hatches.
  // {x,z,w,d,h,y?, type, cols?, rows?}
  destructibles: [
    // Reinforceable walls around GROUND bomb-site "STORAGE" (west room).
    { x: -8, z: -4, w: 8, d: WALL_T, h: FLOOR_H, type: 'reinforceable' }, // storage north wall
    { x: -8, z: 4, w: 8, d: WALL_T, h: FLOOR_H, type: 'reinforceable' }, // storage south wall
    // Soft wall between storage and central corridor.
    { x: -2, z: 0, w: WALL_T, d: 8, h: FLOOR_H, type: 'soft' },

    // Soft interior partitions, ground floor (rotamble/breachable).
    { x: 4, z: 6, w: 8, d: WALL_T, h: FLOOR_H, type: 'soft' },
    { x: 9, z: 2, w: WALL_T, d: 8, h: FLOOR_H, type: 'soft' },

    // Reinforceable walls around UPPER bomb-site "OFFICE" (east room).
    { x: 4, z: 8, w: 12, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'reinforceable' },
    { x: 6, z: 2, w: WALL_T, d: 12, h: FLOOR_H, y: FLOOR_H, type: 'reinforceable' },
    // Soft walls upper floor.
    { x: -4, z: -2, w: 14, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'soft' },

    // ---- breakable floor hatches (vertical play): drop from upper OFFICE to ground ----
    { x: 4, z: 8, w: 4, d: 4, type: 'hatch', y: FLOOR_H }, // above east ground room
    { x: -8, z: 0, w: 4, d: 4, type: 'hatch', y: FLOOR_H }, // above storage
  ],

  // Stairs connecting ground↔upper (simple ramp box for walkability).
  stairs: [{ x: 9, z: -8, w: 4, d: 6, fromY: 0, toY: FLOOR_H }],

  // Bomb sites: defenders defend, attackers plant. {id, name, floor, x,y,z, radius}
  sites: [
    { id: 'storage', name: 'STORAGE', floor: 0, x: -8, y: 0, z: 0, radius: 3.5 },
    { id: 'office', name: 'OFFICE', floor: 1, x: 4, y: FLOOR_H, z: 8, radius: 3.5 },
  ],

  // Spawns. Attackers outside (south exterior), defenders inside.
  spawns: {
    attackers: [
      { x: -8, y: 0, z: 22 }, { x: -4, y: 0, z: 23 }, { x: 0, y: 0, z: 24 },
      { x: 4, y: 0, z: 23 }, { x: 8, y: 0, z: 22 },
    ],
    defenders: [
      { x: -8, y: 0, z: 0 }, { x: -6, y: 0, z: 2 }, { x: 4, y: FLOOR_H, z: 8 },
      { x: 6, y: FLOOR_H, z: 6 }, { x: 0, y: FLOOR_H, z: 4 },
    ],
  },

  // Exterior ground plane size.
  exterior: { w: 80, d: 80 },
};

export default housesite;
