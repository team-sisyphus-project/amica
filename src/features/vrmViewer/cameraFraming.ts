/**
 * Pure framing-target computation for the VRM viewer camera.
 *
 * Given the world positions of a model's `head`, `chest` and `hips` humanoid
 * bones, this module derives the three orbit targets the framing presets use:
 * `face`, `upperBody` and `fullBody`.
 *
 * Everything is expressed relative to the measured hips-to-head span, so the
 * same ratios frame a 1.2 m chibi and a 1.9 m model equally well — no absolute
 * distances are baked in.
 *
 * This module is deliberately standalone: it knows nothing about `Viewer`,
 * three.js or the scene graph. It only reads plain `{x, y, z}` points (a
 * `THREE.Vector3` satisfies that shape) and returns plain data.
 */

/** Minimal structural shape of a world position. `THREE.Vector3` satisfies it. */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** World positions of the humanoid bones framing is derived from. */
export interface FramingBones {
  /** `head` bone world position. Required. */
  readonly head: Vector3Like;
  /**
   * `chest` bone world position. Optional — some models omit it, in which case
   * the midpoint of `head` and `hips` is used instead.
   */
  readonly chest?: Vector3Like | null;
  /** `hips` bone world position. Required. */
  readonly hips: Vector3Like;
}

/** A single framing preset: where the orbit control looks, and from how far. */
export interface FramingTarget {
  /** Point the orbit control should target. */
  readonly target: Vector3Like;
  /** Distance from the target that fits `framedHeight` vertically. */
  readonly distance: number;
  /** Vertical world-space extent this preset frames, in metres. */
  readonly framedHeight: number;
}

/** The full set of framing presets for one model. */
export interface FramingTargets {
  readonly face: FramingTarget;
  readonly upperBody: FramingTarget;
  readonly fullBody: FramingTarget;
}

export interface FramingOptions {
  /**
   * Vertical field of view of the camera the distances are computed for, in
   * degrees. Defaults to the viewer's camera FOV.
   */
  readonly verticalFovDegrees?: number;
}

/**
 * Vertical FOV of the viewer's perspective camera. Kept as a default rather
 * than a hard dependency so this module stays scene-agnostic.
 */
export const DEFAULT_VERTICAL_FOV_DEGREES = 20;

/**
 * Humanoid proportions, all as multiples of the measured hips-to-head span.
 *
 * On a standard VRM rig the hips sit near 0.53 of total height and the head
 * bone near 0.87, so the span is roughly a third of the body. The crown of the
 * head sits about a third of that span above the head bone.
 */
const CROWN_ABOVE_HEAD_RATIO = 0.33;
/** Height of a face close-up, as a multiple of the span. */
const FACE_HEIGHT_RATIO = 0.45;
/** How far below the chest the upper-body shot starts, as a multiple of the span. */
const UPPER_BODY_BELOW_CHEST_RATIO = 0.35;
/** Breathing room around the full-body shot, so feet and hair are not clipped. */
const FULL_BODY_PADDING = 1.06;

function isFinitePoint(point: Vector3Like | null | undefined): point is Vector3Like {
  return (
    !!point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function midpoint(a: Vector3Like, b: Vector3Like): Vector3Like {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

/** Distance at which a vertical extent exactly fills the given field of view. */
function distanceForHeight(framedHeight: number, verticalFovDegrees: number): number {
  const halfFovRadians = (verticalFovDegrees * Math.PI) / 360;
  return framedHeight / 2 / Math.tan(halfFovRadians);
}

function makeTarget(
  target: Vector3Like,
  framedHeight: number,
  verticalFovDegrees: number,
): FramingTarget {
  return {
    target,
    distance: distanceForHeight(framedHeight, verticalFovDegrees),
    framedHeight,
  };
}

/**
 * Derive the `face`, `upperBody` and `fullBody` orbit targets for one model.
 *
 * The floor is assumed to be `y = 0`, which is the VRM convention the viewer
 * already relies on, so the full-body shot spans ground to crown.
 *
 * @throws {TypeError} if `head` or `hips` is missing or has a non-finite component.
 * @throws {RangeError} if the head is not above the hips, which would make every
 *   height-relative ratio meaningless.
 */
export function computeFramingTargets(
  bones: FramingBones,
  options: FramingOptions = {},
): FramingTargets {
  const { head, hips } = bones;

  if (!isFinitePoint(head)) {
    throw new TypeError(
      `computeFramingTargets: head must be a finite world position, got ${JSON.stringify(head)}`,
    );
  }
  if (!isFinitePoint(hips)) {
    throw new TypeError(
      `computeFramingTargets: hips must be a finite world position, got ${JSON.stringify(hips)}`,
    );
  }

  const verticalFovDegrees =
    options.verticalFovDegrees ?? DEFAULT_VERTICAL_FOV_DEGREES;
  if (!Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 || verticalFovDegrees >= 180) {
    throw new RangeError(
      `computeFramingTargets: verticalFovDegrees must be within (0, 180), got ${verticalFovDegrees}`,
    );
  }

  // The one measurement every ratio below is relative to.
  const span = head.y - hips.y;
  if (span <= 0) {
    throw new RangeError(
      `computeFramingTargets: head (y=${head.y}) must be above hips (y=${hips.y})`,
    );
  }

  // A model may omit the optional `chest` bone; the midpoint of head and hips
  // is the closest stand-in that stays on the model's own axis.
  const chest = isFinitePoint(bones.chest) ? bones.chest : midpoint(head, hips);

  const crownY = head.y + CROWN_ABOVE_HEAD_RATIO * span;
  if (crownY <= 0) {
    throw new RangeError(
      `computeFramingTargets: model crown (y=${crownY}) must be above the floor at y=0`,
    );
  }

  const face = makeTarget(
    { x: head.x, y: head.y, z: head.z },
    FACE_HEIGHT_RATIO * span,
    verticalFovDegrees,
  );

  const upperBodyBottomY = chest.y - UPPER_BODY_BELOW_CHEST_RATIO * span;
  const upperBody = makeTarget(
    { x: chest.x, y: (crownY + upperBodyBottomY) / 2, z: chest.z },
    crownY - upperBodyBottomY,
    verticalFovDegrees,
  );

  const fullBody = makeTarget(
    { x: hips.x, y: crownY / 2, z: hips.z },
    crownY * FULL_BODY_PADDING,
    verticalFovDegrees,
  );

  return { face, upperBody, fullBody };
}

/** Humanoid bones the framing presets read, in the order they are consulted. */
export const FRAMING_BONE_NAMES = [
  "head",
  "chest",
  "upperChest",
  "hips",
] as const;

export type FramingBoneName = (typeof FRAMING_BONE_NAMES)[number];

/**
 * Looks up the world position of one humanoid bone, or `null` when the model
 * does not have that bone.
 */
export type BonePositionLookup = (
  name: FramingBoneName,
) => Vector3Like | null | undefined;

/**
 * Derive framing targets by pulling bone world positions from a humanoid rig.
 *
 * This is the humanoid-facing entry point: it owns the bone selection rules so
 * every caller resolves them identically. `chest` is optional in the VRM
 * humanoid spec, so `upperChest` is consulted next; when neither exists
 * {@link computeFramingTargets} falls back to the head/hips midpoint.
 *
 * @returns the three presets, or `null` when the rig has no usable `head` or
 *   `hips` — a model that cannot be measured cannot be framed.
 * @throws the same errors as {@link computeFramingTargets} when the bones exist
 *   but describe an impossible model (head at or below hips, crown below the
 *   floor).
 */
export function framingTargetsFromBonePositions(
  getBonePosition: BonePositionLookup,
  options: FramingOptions = {},
): FramingTargets | null {
  const head = getBonePosition("head");
  const hips = getBonePosition("hips");
  if (!isFinitePoint(head) || !isFinitePoint(hips)) return null;

  const chest = getBonePosition("chest") ?? getBonePosition("upperChest");

  return computeFramingTargets({ head, chest, hips }, options);
}
