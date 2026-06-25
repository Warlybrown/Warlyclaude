// MapLoader.js — builds a playable level from a map data definition.
//
// Produces the shared `world` contract used everywhere:
//   world = {
//     solids:      THREE.Mesh[]            // raycast-able geometry (LOS, hitscan)
//     colliders:   THREE.Box3[]            // AABBs for movement collision
//     destructibles: DestructibleSurface[] // panel-grid walls/floors/hatches
//     sites:       [{id,name,floor,pos,radius}]
//     spawns:      { attackers:Vec3[], defenders:Vec3[] }
//     reinforce:   ReinforcementManager
//     def:         the raw map def
//   }
//
// Static structural geometry is plain boxes; destructible surfaces are handed to
// Destruction.js. Keeping both kinds in `solids`/`colliders` means gameplay code
// is agnostic to which is which.

import * as THREE from 'three';
import { DestructibleSurface } from './Destruction.js';
import { ReinforcementManager } from './Reinforcement.js';

export class MapLoader {
  constructor(scene) {
    this.scene = scene;
  }

  /** @param {object} def a map definition (e.g. housesite) */
  load(def) {
    const scene = this.scene;
    const world = {
      solids: [],
      colliders: [],
      staticColliders: [], // non-destructible only — used for nav clearance
      destructibles: [],
      sites: [],
      spawns: { attackers: [], defenders: [] },
      bots: [],
      soundEvents: [], // {pos, type, time} consumed by bot hearing
      def,
    };

    // --- lighting ---
    scene.background = new THREE.Color(def.lighting.sky);
    scene.fog = new THREE.FogExp2(def.lighting.sky, 0.01);
    scene.add(new THREE.HemisphereLight(0x90ffb0, 0x0a140d, def.lighting.interior));
    const sun = new THREE.DirectionalLight(0xffffff, def.lighting.exterior);
    sun.position.set(...def.lighting.sun);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.far = 80;
    scene.add(sun);
    // Soft interior fill lights at each site for readability.
    for (const s of def.sites) {
      const pt = new THREE.PointLight(0xffe0b0, 0.5, 14, 2);
      pt.position.set(s.x, s.y + 2.4, s.z);
      scene.add(pt);
    }

    // --- exterior ground ---
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x16261a, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(def.exterior.w, def.exterior.d), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    // The exterior ground is a nav surface (so the navmesh's downward raycast
    // finds floor outside the building and bots can path from exterior spawns).
    world.solids.push(ground);
    const grid = new THREE.GridHelper(def.exterior.w, def.exterior.w, 0x1d5c3a, 0x10301f);
    grid.material.transparent = true; grid.material.opacity = 0.18;
    scene.add(grid);

    // --- floor slabs ---
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2a2f26, roughness: 0.95 });
    for (const f of def.floors) {
      this._addBox(world, f.w, 0.2, f.d, f.x, f.y - 0.1, f.z, slabMat, true);
    }

    // --- static walls ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x39414c, roughness: 0.9 });
    const structMat = new THREE.MeshStandardMaterial({ color: 0x2e3640, roughness: 0.85 });
    for (const w of def.walls) {
      const y = (w.y ?? 0) + (w.h ?? 3) / 2;
      const mat = w.type === 'structural' ? structMat : wallMat;
      this._addBox(world, w.w, w.h ?? 3, w.d, w.x, y, w.z, mat, true);
    }

    // --- stairs (ramp boxes, walkable via collision step) ---
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x44372a, roughness: 1 });
    for (const st of def.stairs ?? []) {
      // Approximate a ramp with a few stepped boxes so the player/bots can climb.
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const y = st.fromY + (st.toY - st.fromY) * t;
        const z = st.z - st.d / 2 + st.d * t;
        this._addBox(world, st.w, 0.3, st.d / steps + 0.1, st.x, y - 0.15, z, stairMat, true);
      }
    }

    // --- destructible surfaces ---
    for (const d of def.destructibles) {
      new DestructibleSurface(scene, world, d);
    }

    // --- sites ---
    for (const s of def.sites) {
      world.sites.push({
        id: s.id,
        name: s.name,
        floor: s.floor,
        pos: new THREE.Vector3(s.x, s.y, s.z),
        radius: s.radius,
      });
      // Visual marker ring on the floor.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s.radius - 0.15, s.radius, 32),
        new THREE.MeshBasicMaterial({ color: 0xff8a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, s.y + 0.03, s.z);
      scene.add(ring);
    }

    // --- spawns ---
    world.spawns.attackers = def.spawns.attackers.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    world.spawns.defenders = def.spawns.defenders.map((p) => new THREE.Vector3(p.x, p.y, p.z));

    // --- reinforcement budget ---
    world.reinforce = new ReinforcementManager(world, 10);

    return world;
  }

  _addBox(world, w, h, d, x, y, z, mat, solid) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (solid) {
      world.solids.push(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      world.colliders.push(box);
      world.staticColliders.push(box); // structural — never removed
    }
    return mesh;
  }
}
