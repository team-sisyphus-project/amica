/**
 * Measuring a loaded model's silhouette for the framing presets.
 *
 * {@link ./cameraFraming} decides what to frame from humanoid bones, but bones
 * only locate joints: they cannot say how far hair, heels or a hat reach past
 * them, and on every bundled avatar they reach further than a humanoid average
 * predicts. This module supplies the missing half — the model's real extent —
 * and is the one place in the framing path that touches three.js.
 */

import * as THREE from "three";

import { ModelBounds } from "./cameraFraming";

/**
 * Measure the world-space extent of a loaded model.
 *
 * Call it once the model is in the scene: the box is taken in world space, so
 * it already carries the facing rotation the viewer applies to VRM 0.x models
 * and any scaling the scene imposes.
 *
 * @returns the measured extent, or `null` when the object has no measurable
 *   geometry — framing then falls back to rig-only estimates rather than
 *   trusting an empty box.
 */
export function measureModelBounds(object: THREE.Object3D): ModelBounds | null {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;

  const center = box.getCenter(new THREE.Vector3());

  return {
    minY: box.min.y,
    maxY: box.max.y,
    // Depth on the axis the character faces, measured from its own centre: the
    // half a preset has to stand clear of to keep a nose or fringe in frame.
    frontDepth: Math.max(box.max.z - center.z, center.z - box.min.z),
  };
}
