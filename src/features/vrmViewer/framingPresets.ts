/**
 * The three framing presets the toolbar offers, and the camera pose each one
 * resolves to.
 *
 * {@link ./cameraFraming} answers *what* to look at — the orbit target and the
 * distance that fits the intended region. This module answers *where the camera
 * stands* to shoot it: it turns a framing target plus the camera's current
 * position into a complete {@link CameraPose} that
 * {@link ./cameraTransition | the transition controller} can ease toward.
 *
 * Like its two neighbours it is deliberately standalone — no `Viewer`, no
 * three.js, no React. Plain `{x, y, z}` points in, plain points out, so the
 * whole framing decision is verifiable without a WebGL context.
 */

import { FramingTarget, FramingTargets, Vector3Like } from "./cameraFraming";
import { CameraPose } from "./cameraTransition";

/** Identifier of a framing preset. Matches the keys of {@link FramingTargets}. */
export type FramingPresetId = keyof FramingTargets;

/**
 * The presets in the order they are offered, tightest shot first.
 *
 * Ordering is a design decision, not an implementation detail: the toolbar
 * reads left-to-right / top-to-bottom from closest to widest, so the row maps
 * onto a single mental axis — how much of the character you want in frame.
 */
export const FRAMING_PRESET_IDS = ["face", "upperBody", "fullBody"] as const;

/**
 * How close the camera may sit to the orbit target before its horizontal
 * heading is considered undefined. Below this the camera is effectively on top
 * of the target and any heading derived from it is numerical noise.
 */
const MIN_HORIZONTAL_OFFSET = 1e-6;

/** Heading used when the current one cannot be read: straight in front (+Z). */
const DEFAULT_HEADING: Readonly<{ x: number; z: number }> = { x: 0, z: 1 };

/** Look up one preset's framing target. `null` when no model is measured yet. */
export function selectFramingTarget(
  targets: FramingTargets | null | undefined,
  preset: FramingPresetId,
): FramingTarget | null {
  return targets?.[preset] ?? null;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Resolve the camera pose for one framing preset.
 *
 * Two rules shape the result:
 *
 * 1. **The heading is the user's.** The camera keeps the compass direction it
 *    currently orbits from, so a preset never spins a character the user
 *    deliberately turned to look at from the side. The preset is a starting
 *    point, not a reset.
 * 2. **The shot is level.** The camera is placed at the target's own height, so
 *    the framed region is exactly `framedHeight` tall. Shooting from an angle
 *    would tilt that extent out of frame and clip the very region the preset
 *    promises — feet on a full-body shot, the crown on a close-up.
 *
 * @param target the framing target to shoot, from `computeFramingTargets`.
 * @param cameraPosition where the camera is right now; only its heading is
 *   used. A degenerate or non-finite position falls back to a front-on shot.
 * @throws {TypeError} if `target` is missing or has a non-finite component.
 * @throws {RangeError} if `target.distance` is not a positive, finite number.
 */
export function framingPose(
  target: FramingTarget,
  cameraPosition: Vector3Like | null | undefined,
): CameraPose {
  const point = target?.target;
  if (
    !point ||
    !isFiniteNumber(point.x) ||
    !isFiniteNumber(point.y) ||
    !isFiniteNumber(point.z)
  ) {
    throw new TypeError(
      `framingPose: target.target must be a finite point, got ${JSON.stringify(point)}`,
    );
  }
  if (!isFiniteNumber(target.distance) || target.distance <= 0) {
    throw new RangeError(
      `framingPose: target.distance must be a positive, finite number, got ${target.distance}`,
    );
  }

  const heading = horizontalHeading(point, cameraPosition);

  return {
    position: {
      x: point.x + heading.x * target.distance,
      y: point.y,
      z: point.z + heading.z * target.distance,
    },
    target: { x: point.x, y: point.y, z: point.z },
  };
}

/**
 * Unit vector on the ground plane pointing from `target` toward the camera —
 * the direction the character is currently viewed from.
 */
function horizontalHeading(
  target: Vector3Like,
  cameraPosition: Vector3Like | null | undefined,
): { x: number; z: number } {
  if (
    !cameraPosition ||
    !isFiniteNumber(cameraPosition.x) ||
    !isFiniteNumber(cameraPosition.z)
  ) {
    return DEFAULT_HEADING;
  }

  const dx = cameraPosition.x - target.x;
  const dz = cameraPosition.z - target.z;
  const length = Math.hypot(dx, dz);
  if (length < MIN_HORIZONTAL_OFFSET) return DEFAULT_HEADING;

  return { x: dx / length, z: dz / length };
}
