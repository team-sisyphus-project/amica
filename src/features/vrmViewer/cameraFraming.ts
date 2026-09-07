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
  /**
   * Distance from the target that fits `framedHeight` vertically.
   *
   * When {@link ModelBounds} are supplied the distance also clears the model's
   * `frontDepth`, so `framedHeight` is the extent visible at the model's own
   * surface — the part of it nearest the camera — rather than at the orbit
   * target sitting inside the body.
   */
  readonly distance: number;
  /** Vertical world-space extent this preset frames, in metres. */
  readonly framedHeight: number;
}

/**
 * Measured world-space extent of a loaded model's geometry.
 *
 * Bones say where a character's joints are; they say nothing about how far the
 * hair, ears or hem reach past them. Every bundled avatar's crown sits above
 * the ratio a rig alone can predict — by 3 cm on the shortest-haired model and
 * 12 cm on the tallest-haired one — so framing derived from bones alone crops
 * the top of the head. Supplying the measured box replaces every estimate with
 * the model's real silhouette.
 */
export interface ModelBounds {
  /** Lowest point of the geometry: soles, or a hem that dips below the floor. */
  readonly minY: number;
  /** Highest point of the geometry: the crown, including hair and headwear. */
  readonly maxY: number;
  /**
   * How far the geometry reaches toward the camera from the model's own axis,
   * along the axis it faces. The framing distance clears it so a nose or a
   * fringe nearer the camera than the orbit target is still fully in frame.
   */
  readonly frontDepth: number;
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
  /**
   * Measured extent of the model's geometry, when the caller can measure it.
   *
   * Omitted — or measured into something that contradicts the rig, such as a
   * crown at or below the head bone — the framing falls back to rig-only
   * estimates. That keeps a model whose geometry cannot be measured framed
   * approximately rather than not at all.
   */
  readonly modelBounds?: ModelBounds | null;
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
/** Height of a face close-up, as a multiple of the span. Estimate-only. */
const FACE_HEIGHT_RATIO = 0.45;
/** How far below the chest the upper-body shot starts, as a multiple of the span. */
const UPPER_BODY_BELOW_CHEST_RATIO = 0.35;
/** Breathing room around a framed region, so nothing sits on the frame edge. */
const FRAME_PADDING = 1.06;
/**
 * How far below the head bone a face shot reaches, as a multiple of the
 * measured head height (head bone to crown). The VRM head bone sits at the top
 * of the neck, so the chin, jaw and a little neck live below it.
 */
const FACE_BELOW_HEAD_RATIO = 0.55;

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
  frontDepth: number,
): FramingTarget {
  return {
    target,
    // Standing the model's own depth further back keeps `framedHeight` the
    // extent visible at its surface, not at the axis buried inside it.
    distance: frontDepth + distanceForHeight(framedHeight, verticalFovDegrees),
    framedHeight,
  };
}

/**
 * Frame the vertical band `[bottomY, topY]`, padded, centred on `anchor`'s
 * horizontal position.
 */
function targetForBand(
  anchor: Vector3Like,
  bottomY: number,
  topY: number,
  verticalFovDegrees: number,
  frontDepth: number,
): FramingTarget {
  return makeTarget(
    { x: anchor.x, y: (topY + bottomY) / 2, z: anchor.z },
    (topY - bottomY) * FRAME_PADDING,
    verticalFovDegrees,
    frontDepth,
  );
}

/**
 * Accept measured bounds only when they agree with the rig they will be mixed
 * with: a crown above the head bone and a lowest point below it. Anything else
 * is a measurement of something other than this model — an empty box, a stray
 * helper object — and the rig-only estimates are the safer answer.
 */
function usableBounds(
  bounds: ModelBounds | null | undefined,
  head: Vector3Like,
): ModelBounds | null {
  if (!bounds) return null;

  const { minY, maxY, frontDepth } = bounds;
  if (
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY) ||
    !Number.isFinite(frontDepth)
  ) {
    return null;
  }
  if (maxY <= head.y || minY >= head.y) return null;

  return { minY, maxY, frontDepth: Math.max(frontDepth, 0) };
}

/**
 * Derive the `face`, `upperBody` and `fullBody` orbit targets for one model.
 *
 * The floor is `y = 0`, the VRM convention the viewer already relies on, so the
 * full-body shot spans ground to crown. Pass {@link FramingOptions.modelBounds}
 * whenever the model's geometry can be measured: the crown, the lowest point
 * and the depth then come from the model itself instead of from humanoid
 * averages, which is what keeps hair, heels and noses out of the frame edge.
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

  // Measured silhouette when the caller has one, rig estimate otherwise.
  const bounds = usableBounds(options.modelBounds, head);
  const crownY = bounds
    ? bounds.maxY
    : head.y + CROWN_ABOVE_HEAD_RATIO * span;
  if (crownY <= 0) {
    throw new RangeError(
      `computeFramingTargets: model crown (y=${crownY}) must be above the floor at y=0`,
    );
  }

  // A hem or a heel may dip under the floor plane; frame from whichever is
  // lower so nothing is cut off at the bottom of a full-body shot.
  const floorY = bounds ? Math.min(bounds.minY, 0) : 0;
  const frontDepth = bounds ? bounds.frontDepth : 0;
  const upperBodyBottomY = chest.y - UPPER_BODY_BELOW_CHEST_RATIO * span;

  if (!bounds) {
    // Rig-only fallback: every extent is a proportion of the hips-to-head span,
    // and the camera sits on the target's own plane because nothing is known
    // about how far the model's surface reaches toward it.
    return {
      face: makeTarget(
        { x: head.x, y: head.y, z: head.z },
        FACE_HEIGHT_RATIO * span,
        verticalFovDegrees,
        0,
      ),
      upperBody: makeTarget(
        { x: chest.x, y: (crownY + upperBodyBottomY) / 2, z: chest.z },
        crownY - upperBodyBottomY,
        verticalFovDegrees,
        0,
      ),
      fullBody: makeTarget(
        { x: hips.x, y: crownY / 2, z: hips.z },
        crownY * FRAME_PADDING,
        verticalFovDegrees,
        0,
      ),
    };
  }

  // Measured: every shot is a band with the real crown as its ceiling, so the
  // top of the head is in frame on a model with tall hair as reliably as on a
  // bald one.
  const headHeight = crownY - head.y;

  return {
    face: targetForBand(
      head,
      head.y - FACE_BELOW_HEAD_RATIO * headHeight,
      crownY,
      verticalFovDegrees,
      frontDepth,
    ),
    upperBody: targetForBand(
      chest,
      upperBodyBottomY,
      crownY,
      verticalFovDegrees,
      frontDepth,
    ),
    fullBody: targetForBand(
      hips,
      floorY,
      crownY,
      verticalFovDegrees,
      frontDepth,
    ),
  };
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
