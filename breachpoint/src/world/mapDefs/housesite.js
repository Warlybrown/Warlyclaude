// housesite.js — data definition for the original "SAFEHOUSE" map.
//
// A blocky, readable two-story building. Everything here is DATA; MapLoader.js
// turns it into geometry, colliders, destructible surfaces, spawns, and sites.
// Coordinates: X east, Y up, Z south. Ground floor y=0, upper floor y=3.2.
//
// IMPORTANT layout rule: structural walls are split into segments that leave
// DOORWAY GAPS, so the navmesh (which routes only around structural geometry)
// always has a way in and between rooms. Reinforceable/soft walls are alternate
// breach approaches around the bomb sites, not the only way in.
//
// Surface types (consumed by Destruction.js):
//   'structural'    — load-bearing, never destructible
//   'soft'          — drywall/wood: shootable-through, breaches into holes
//   'reinforceable' — soft wall defenders can convert to 'hard' in prep
//   'hatch'         — breakable floor panel for vertical play
//
// All names/branding original.

export const FLOOR_H = 3.2; // storey height
export const WALL_T = 0.2; // wall thickness

export const housesite = {
  name: 'SAFEHOUSE',
  callout: 'Two-storey residential · bomb defusal',
  bounds: { w: 28, d: 28 },

  lighting: { exterior: 0.7, interior: 0.34, sky: 0x0b1a12, sun: [10, 18, 6] },

  floors: [
    { y: 0.0, x: 0, z: 0, w: 28, d: 28 },
    { y: FLOOR_H, x: 0, z: 1, w: 24, d: 20 }, // upper slab (leaves a south balcony gap)
  ],

  // Structural walls (never destructible) — split to leave doorway gaps.
  walls: [
    // ===== exterior shell, ground =====
    { x: 0, z: -14, w: 28, d: WALL_T, h: FLOOR_H, type: 'structural' }, // north (solid)
    { x: 14, z: 0, w: WALL_T, d: 28, h: FLOOR_H, type: 'structural' },  // east (solid)
    // south wall (attacker entry) with a central doorway gap (x -4..4)
    { x: -9, z: 14, w: 10, d: WALL_T, h: FLOOR_H, type: 'structural' },
    { x: 9, z: 14, w: 10, d: WALL_T, h: FLOOR_H, type: 'structural' },
    // west wall (flank entry) with a doorway gap (z -3..4)
    { x: -14, z: -9, w: WALL_T, d: 10, h: FLOOR_H, type: 'structural' },
    { x: -14, z: 10, w: WALL_T, d: 8, h: FLOOR_H, type: 'structural' },

    // ===== interior spine (splits west rooms from east hall), two doorways =====
    { x: -1, z: -10, w: WALL_T, d: 8, h: FLOOR_H, type: 'structural' }, // z -14..-6
    { x: -1, z: 9, w: WALL_T, d: 6, h: FLOOR_H, type: 'structural' },   // z 6..12
    // (doorways at z -6..6 and z 12..14)

    // a short divider by the stairs (east hall)
    { x: 6, z: -10, w: WALL_T, d: 6, h: FLOOR_H, type: 'structural' }, // z -13..-7

    // ===== exterior shell, upper =====
    { x: 0, z: -9, w: 24, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    { x: -12, z: 1, w: WALL_T, d: 20, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    { x: 12, z: 1, w: WALL_T, d: 20, h: FLOOR_H, y: FLOOR_H, type: 'structural' },
    // upper south wall with a doorway from the stair landing (gap x 6..10)
    { x: -1, z: 11, w: 22, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'structural' },

    // upper interior divider with doorway (separates office from landing)
    { x: -2, z: 1, w: WALL_T, d: 6, h: FLOOR_H, y: FLOOR_H, type: 'structural' }, // z -2..4
  ],

  // Destructible surfaces — breach approaches around the sites + soft partitions.
  destructibles: [
    // STORAGE site (ground, west): reinforceable north & south faces.
    { x: -7.5, z: -5, w: 13, d: WALL_T, h: FLOOR_H, type: 'reinforceable' },
    { x: -7.5, z: 5, w: 13, d: WALL_T, h: FLOOR_H, type: 'reinforceable' },
    // soft partition inside the west area
    { x: -8, z: 0, w: WALL_T, d: 6, h: FLOOR_H, type: 'soft' },

    // East-hall soft partitions (rotamble / breachable cover).
    { x: 9, z: 3, w: WALL_T, d: 8, h: FLOOR_H, type: 'soft' },
    { x: 3, z: 6, w: 6, d: WALL_T, h: FLOOR_H, type: 'soft' },

    // OFFICE site (upper, east): reinforceable faces.
    { x: 4, z: 5, w: 12, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'reinforceable' },
    { x: 9, z: 8, w: WALL_T, d: 8, h: FLOOR_H, y: FLOOR_H, type: 'reinforceable' },
    // soft upper partition
    { x: -4, z: -2, w: 12, d: WALL_T, h: FLOOR_H, y: FLOOR_H, type: 'soft' },

    // Breakable floor hatches (vertical play).
    { x: 4, z: 8, w: 4, d: 4, type: 'hatch', y: FLOOR_H },   // office → ground east
    { x: -8, z: 0, w: 4, d: 4, type: 'hatch', y: FLOOR_H },  // above storage
  ],

  // Stairs connecting ground↔upper (east side, landing near upper doorway).
  stairs: [{ x: 9, z: -7, w: 4, d: 7, fromY: 0, toY: FLOOR_H }],

  // Bomb sites.
  sites: [
    { id: 'storage', name: 'STORAGE', floor: 0, x: -8, y: 0, z: 0, radius: 3.2 },
    { id: 'office', name: 'OFFICE', floor: 1, x: 4, y: FLOOR_H, z: 8, radius: 3.2 },
  ],

  // Spawns. Attackers outside south; defenders inside near sites.
  spawns: {
    attackers: [
      { x: -6, y: 0, z: 22 }, { x: -2, y: 0, z: 23 }, { x: 0, y: 0, z: 24 },
      { x: 2, y: 0, z: 23 }, { x: 6, y: 0, z: 22 },
    ],
    defenders: [
      { x: -8, y: 0, z: 0 }, { x: -6, y: 0, z: -2 }, { x: 4, y: FLOOR_H, z: 8 },
      { x: 6, y: FLOOR_H, z: 6 }, { x: 2, y: FLOOR_H, z: 6 },
    ],
  },

  exterior: { w: 80, d: 80 },
};

export default housesite;
