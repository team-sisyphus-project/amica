import { describe, expect, test } from "@jest/globals";
import {
  computeFramingTargets,
  DEFAULT_VERTICAL_FOV_DEGREES,
  FramingTarget,
  FramingTargets,
  Vector3Like,
} from "../src/features/vrmViewer/cameraFraming";

/** Bone positions of a ~1.6 m adult-proportioned model. */
const TALL_MODEL = {
  head: { x: 0, y: 1.4, z: 0 },
  chest: { x: 0, y: 1.15, z: 0 },
  hips: { x: 0, y: 0.85, z: 0 },
};

/** Bone positions of a ~0.8 m chibi model — same rig, half the scale. */
const SHORT_MODEL = {
  head: { x: 0, y: 0.7, z: 0 },
  chest: { x: 0, y: 0.575, z: 0 },
  hips: { x: 0, y: 0.425, z: 0 },
};

function isFinitePoint(point: Vector3Like): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function eachTarget(targets: FramingTargets): FramingTarget[] {
  return [targets.face, targets.upperBody, targets.fullBody];
}

/** Vertical world extent visible at `distance` for the default camera FOV. */
function visibleHeightAt(distance: number, fovDegrees = DEFAULT_VERTICAL_FOV_DEGREES) {
  return 2 * distance * Math.tan((fovDegrees * Math.PI) / 360);
}

describe("computeFramingTargets", () => {
  describe("tall model", () => {
    const targets = computeFramingTargets(TALL_MODEL);

    test("produces three well-formed targets", () => {
      expect(Object.keys(targets).sort()).toEqual([
        "face",
        "fullBody",
        "upperBody",
      ]);
      for (const target of eachTarget(targets)) {
        expect(isFinitePoint(target.target)).toBe(true);
        expect(Number.isFinite(target.distance)).toBe(true);
        expect(target.distance).toBeGreaterThan(0);
        expect(target.framedHeight).toBeGreaterThan(0);
      }
    });

    test("face target sits on the head bone", () => {
      expect(targets.face.target).toEqual(TALL_MODEL.head);
    });

    test("face frames a head-sized region, not the whole model", () => {
      expect(targets.face.framedHeight).toBeGreaterThan(0.15);
      expect(targets.face.framedHeight).toBeLessThan(0.35);
    });

    test("upper body frames the chest up past the crown of the head", () => {
      const { framedHeight, target } = targets.upperBody;
      const top = target.y + framedHeight / 2;
      const bottom = target.y - framedHeight / 2;

      expect(top).toBeGreaterThan(TALL_MODEL.head.y);
      expect(bottom).toBeLessThan(TALL_MODEL.chest.y);
      expect(bottom).toBeGreaterThan(TALL_MODEL.hips.y - framedHeight);
    });

    test("full body frames the floor up past the crown of the head", () => {
      const { framedHeight, target } = targets.fullBody;

      expect(target.y - framedHeight / 2).toBeLessThanOrEqual(0);
      expect(target.y + framedHeight / 2).toBeGreaterThan(TALL_MODEL.head.y);
    });

    test("presets widen from face to upper body to full body", () => {
      expect(targets.face.framedHeight).toBeLessThan(
        targets.upperBody.framedHeight,
      );
      expect(targets.upperBody.framedHeight).toBeLessThan(
        targets.fullBody.framedHeight,
      );
      expect(targets.face.distance).toBeLessThan(targets.upperBody.distance);
      expect(targets.upperBody.distance).toBeLessThan(targets.fullBody.distance);
    });

    test("distance fits the framed height in the camera's field of view", () => {
      for (const target of eachTarget(targets)) {
        expect(visibleHeightAt(target.distance)).toBeCloseTo(
          target.framedHeight,
          6,
        );
      }
    });

    test("a wider field of view needs less distance", () => {
      const wide = computeFramingTargets(TALL_MODEL, { verticalFovDegrees: 40 });

      expect(wide.face.framedHeight).toBeCloseTo(targets.face.framedHeight, 6);
      expect(wide.face.distance).toBeLessThan(targets.face.distance);
      expect(visibleHeightAt(wide.face.distance, 40)).toBeCloseTo(
        wide.face.framedHeight,
        6,
      );
    });
  });

  describe("short model", () => {
    const targets = computeFramingTargets(SHORT_MODEL);

    test("produces three well-formed targets", () => {
      for (const target of eachTarget(targets)) {
        expect(isFinitePoint(target.target)).toBe(true);
        expect(target.distance).toBeGreaterThan(0);
        expect(target.framedHeight).toBeGreaterThan(0);
      }
    });

    test("frames tighter than the tall model", () => {
      const tall = computeFramingTargets(TALL_MODEL);

      for (const key of ["face", "upperBody", "fullBody"] as const) {
        expect(targets[key].framedHeight).toBeLessThan(tall[key].framedHeight);
        expect(targets[key].distance).toBeLessThan(tall[key].distance);
      }
    });

    test("scales proportionally with the model, so ratios are identical", () => {
      // SHORT_MODEL is exactly half of TALL_MODEL, so every derived length
      // should halve while the framing itself stays the same shot.
      const tall = computeFramingTargets(TALL_MODEL);

      for (const key of ["face", "upperBody", "fullBody"] as const) {
        expect(targets[key].framedHeight * 2).toBeCloseTo(
          tall[key].framedHeight,
          6,
        );
        expect(targets[key].target.y * 2).toBeCloseTo(tall[key].target.y, 6);
      }
    });

    test("full body still reaches the floor and clears the head", () => {
      const { framedHeight, target } = targets.fullBody;

      expect(target.y - framedHeight / 2).toBeLessThanOrEqual(0);
      expect(target.y + framedHeight / 2).toBeGreaterThan(SHORT_MODEL.head.y);
    });
  });

  describe("missing chest bone", () => {
    const withoutChest = { head: TALL_MODEL.head, hips: TALL_MODEL.hips };

    test.each([
      ["undefined", undefined],
      ["null", null],
    ])("falls back to the head/hips midpoint when chest is %s", (_label, chest) => {
      const targets = computeFramingTargets({ ...withoutChest, chest });
      const midpointChest = {
        x: (TALL_MODEL.head.x + TALL_MODEL.hips.x) / 2,
        y: (TALL_MODEL.head.y + TALL_MODEL.hips.y) / 2,
        z: (TALL_MODEL.head.z + TALL_MODEL.hips.z) / 2,
      };

      expect(targets).toEqual(
        computeFramingTargets({ ...withoutChest, chest: midpointChest }),
      );
    });

    test("still produces three well-formed targets", () => {
      const targets = computeFramingTargets(withoutChest);

      for (const target of eachTarget(targets)) {
        expect(isFinitePoint(target.target)).toBe(true);
        expect(target.distance).toBeGreaterThan(0);
        expect(target.framedHeight).toBeGreaterThan(0);
      }
    });

    test("leaves face and full body untouched", () => {
      const targets = computeFramingTargets(withoutChest);
      const withChest = computeFramingTargets(TALL_MODEL);

      expect(targets.face).toEqual(withChest.face);
      expect(targets.fullBody).toEqual(withChest.fullBody);
    });

    test("ignores a chest with non-finite components", () => {
      const targets = computeFramingTargets({
        ...withoutChest,
        chest: { x: 0, y: NaN, z: 0 },
      });

      expect(targets).toEqual(computeFramingTargets(withoutChest));
    });
  });

  describe("off-centre models", () => {
    test("targets follow the model's own x/z, they are not pinned to the origin", () => {
      const targets = computeFramingTargets({
        head: { x: 2, y: 1.4, z: -1 },
        chest: { x: 2.1, y: 1.15, z: -1.2 },
        hips: { x: 2, y: 0.85, z: -1 },
      });

      expect(targets.face.target.x).toBe(2);
      expect(targets.face.target.z).toBe(-1);
      expect(targets.upperBody.target.x).toBeCloseTo(2.1, 6);
      expect(targets.upperBody.target.z).toBeCloseTo(-1.2, 6);
      expect(targets.fullBody.target.x).toBe(2);
      expect(targets.fullBody.target.z).toBe(-1);
    });
  });

  describe("measured model bounds", () => {
    /** A 1.75 m model whose hair reaches well past what the rig implies. */
    const BOUNDS = { minY: -0.02, maxY: 1.75, frontDepth: 0.2 };

    test("frames the measured crown, not the estimated one", () => {
      const measured = computeFramingTargets(TALL_MODEL, {
        modelBounds: BOUNDS,
      });
      const estimated = computeFramingTargets(TALL_MODEL);

      const top = (t: FramingTarget) => t.target.y + t.framedHeight / 2;
      for (const key of ["face", "upperBody", "fullBody"] as const) {
        expect(top(measured[key])).toBeGreaterThanOrEqual(BOUNDS.maxY);
        expect(top(estimated[key])).toBeLessThan(BOUNDS.maxY);
      }
    });

    test("full body reaches the lowest measured point, below the floor", () => {
      const { target, framedHeight } = computeFramingTargets(TALL_MODEL, {
        modelBounds: BOUNDS,
      }).fullBody;

      expect(target.y - framedHeight / 2).toBeLessThanOrEqual(BOUNDS.minY);
    });

    test("stands the model's own depth further back", () => {
      const withDepth = computeFramingTargets(TALL_MODEL, {
        modelBounds: BOUNDS,
      }).face;
      const withoutDepth = computeFramingTargets(TALL_MODEL, {
        modelBounds: { ...BOUNDS, frontDepth: 0 },
      }).face;

      expect(withDepth.framedHeight).toBeCloseTo(withoutDepth.framedHeight, 6);
      expect(withDepth.distance - withoutDepth.distance).toBeCloseTo(
        BOUNDS.frontDepth,
        6,
      );
      // The framed height is the extent visible at the model's surface.
      expect(
        visibleHeightAt(withDepth.distance - BOUNDS.frontDepth),
      ).toBeCloseTo(withDepth.framedHeight, 6);
    });

    test.each([
      ["a crown at or below the head bone", { minY: 0, maxY: 1.4, frontDepth: 0.2 }],
      ["a floor above the head bone", { minY: 1.5, maxY: 1.75, frontDepth: 0.2 }],
      ["a non-finite extent", { minY: 0, maxY: NaN, frontDepth: 0.2 }],
      ["a non-finite depth", { minY: 0, maxY: 1.75, frontDepth: Infinity }],
    ])("falls back to rig estimates given %s", (_label, modelBounds) => {
      expect(computeFramingTargets(TALL_MODEL, { modelBounds })).toEqual(
        computeFramingTargets(TALL_MODEL),
      );
    });

    test("ignores bounds that are absent", () => {
      for (const modelBounds of [undefined, null]) {
        expect(computeFramingTargets(TALL_MODEL, { modelBounds })).toEqual(
          computeFramingTargets(TALL_MODEL),
        );
      }
    });
  });

  describe("degenerate input", () => {
    test("rejects a head that is not above the hips", () => {
      expect(() =>
        computeFramingTargets({
          head: { x: 0, y: 0.85, z: 0 },
          hips: { x: 0, y: 0.85, z: 0 },
        }),
      ).toThrow(RangeError);
    });

    test("rejects non-finite bone positions", () => {
      expect(() =>
        computeFramingTargets({
          head: { x: 0, y: Infinity, z: 0 },
          hips: TALL_MODEL.hips,
        }),
      ).toThrow(TypeError);
      expect(() =>
        computeFramingTargets({
          head: TALL_MODEL.head,
          hips: { x: NaN, y: 0.85, z: 0 },
        }),
      ).toThrow(TypeError);
    });

    test("rejects a model standing below the floor", () => {
      expect(() =>
        computeFramingTargets({
          head: { x: 0, y: -0.2, z: 0 },
          hips: { x: 0, y: -0.75, z: 0 },
        }),
      ).toThrow(RangeError);
    });

    test("rejects an unusable field of view", () => {
      expect(() =>
        computeFramingTargets(TALL_MODEL, { verticalFovDegrees: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        computeFramingTargets(TALL_MODEL, { verticalFovDegrees: 180 }),
      ).toThrow(RangeError);
    });
  });
});
