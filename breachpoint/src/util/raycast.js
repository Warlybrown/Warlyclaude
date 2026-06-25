// raycast.js — thin wrapper around THREE.Raycaster for hitscan + LOS checks.
//
// Phase 1 scope: cast a ray from the camera through a (possibly spread-offset)
// direction and return the nearest hit among a set of meshes, tagging whether it
// hit a "target" (damageable) or solid geometry. Bullet penetration / damage
// falloff through destructibles is stubbed here and fleshed out in Phase 2.

import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();

/**
 * @param {THREE.Vector3} origin ray start (world space)
 * @param {THREE.Vector3} dir normalized direction
 * @param {THREE.Object3D[]} objects meshes to test (recursive)
 * @param {number} far max distance
 * @returns {null | {object, point, distance, normal, face}}
 */
export function castRay(origin, dir, objects, far = 200) {
  _raycaster.set(origin, dir);
  _raycaster.far = far;
  const hits = _raycaster.intersectObjects(objects, true);
  if (hits.length === 0) return null;
  const h = hits[0];
  return {
    object: h.object,
    point: h.point,
    distance: h.distance,
    normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null,
    face: h.face,
  };
}

/**
 * Return all hits sorted by distance — used later for penetration (a ray that
 * passes through thin/destructible surfaces and keeps going with falloff).
 */
export function castRayAll(origin, dir, objects, far = 200) {
  _raycaster.set(origin, dir);
  _raycaster.far = far;
  return _raycaster.intersectObjects(objects, true);
}
