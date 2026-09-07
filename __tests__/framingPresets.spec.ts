import { describe, expect, test } from "@jest/globals";

import { FramingTarget, FramingTargets } from "../src/features/vrmViewer/cameraFraming";
import {
  FRAMING_PRESET_IDS,
  framingPose,
  selectFramingTarget,
} from "../src/features/vrmViewer/framingPresets";

function target(
  point: { x: number; y: number; z: number },
  distance: number,
): FramingTarget {
  return { target: point, distance, framedHeight: distance };
}

const HEAD = target({ x: 0.1, y: 1.35, z: 0.05 }, 0.8);

describe("FRAMING_PRESET_IDS", () => {
  test("offers the three presets, tightest shot first", () => {
    expect([...FRAMING_PRESET_IDS]).toEqual(["face", "upperBody", "fullBody"]);
  });
});

describe("selectFramingTarget", () => {
  const targets: FramingTargets = {
    face: HEAD,
    upperBody: target({ x: 0, y: 1.1, z: 0 }, 2),
    fullBody: target({ x: 0, y: 0.8, z: 0 }, 4.5),
  };

  test("returns the target for each preset", () => {
    for (const preset of FRAMING_PRESET_IDS) {
      expect(selectFramingTarget(targets, preset)).toBe(targets[preset]);
    }
  });

  test("returns null when no model has been measured", () => {
    expect(selectFramingTarget(null, "face")).toBeNull();
    expect(selectFramingTarget(undefined, "fullBody")).toBeNull();
  });
});

describe("framingPose", () => {
  test("looks at the framing target", () => {
    const pose = framingPose(HEAD, { x: 0, y: 1.3, z: 3 });

    expect(pose.target).toEqual({ x: 0.1, y: 1.35, z: 0.05 });
  });

  test("stands exactly the framing distance away, on the ground plane", () => {
    const pose = framingPose(HEAD, { x: 2, y: 1.3, z: 2 });

    const dx = pose.position.x - HEAD.target.x;
    const dz = pose.position.z - HEAD.target.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(HEAD.distance, 10);
  });

  test("keeps the heading the user is orbiting from", () => {
    // Camera due -X of the target: the preset must stay on that side.
    const pose = framingPose(HEAD, { x: HEAD.target.x - 3, y: 0.4, z: HEAD.target.z });

    expect(pose.position.x).toBeCloseTo(HEAD.target.x - HEAD.distance, 10);
    expect(pose.position.z).toBeCloseTo(HEAD.target.z, 10);
  });

  test("levels the shot at the target's height, whatever the camera's elevation", () => {
    for (const cameraY of [8.5, 1.3, -2]) {
      const pose = framingPose(HEAD, { x: 0, y: cameraY, z: 3 });
      expect(pose.position.y).toBeCloseTo(HEAD.target.y, 10);
    }
  });

  test("frames a taller preset from further back", () => {
    const camera = { x: 0, y: 1.3, z: 3 };
    const face = framingPose(HEAD, camera);
    const fullBody = framingPose(target({ x: 0, y: 0.82, z: 0 }, 4.6), camera);

    expect(fullBody.position.z).toBeGreaterThan(face.position.z);
  });

  test("falls back to a front-on shot when the camera is above the target", () => {
    const pose = framingPose(HEAD, { x: HEAD.target.x, y: 9, z: HEAD.target.z });

    expect(pose.position.x).toBeCloseTo(HEAD.target.x, 10);
    expect(pose.position.z).toBeCloseTo(HEAD.target.z + HEAD.distance, 10);
  });

  test("falls back to a front-on shot when the camera position is unusable", () => {
    for (const camera of [null, undefined, { x: NaN, y: 0, z: 0 }]) {
      const pose = framingPose(HEAD, camera);
      expect(pose.position.z).toBeCloseTo(HEAD.target.z + HEAD.distance, 10);
    }
  });

  test("never returns a non-finite component", () => {
    const pose = framingPose(HEAD, { x: 1, y: 2, z: 3 });

    for (const part of ["position", "target"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        expect(Number.isFinite(pose[part][axis])).toBe(true);
      }
    }
  });

  test("copies the target so a later mutation cannot warp the pose", () => {
    const point = { x: 0, y: 1, z: 0 };
    const pose = framingPose(target(point, 2), { x: 0, y: 1, z: 3 });

    point.y = 99;

    expect(pose.target.y).toBe(1);
  });

  test("rejects a target it cannot aim at", () => {
    expect(() => framingPose(target({ x: 0, y: NaN, z: 0 }, 2), null)).toThrow(TypeError);
    expect(() =>
      framingPose(undefined as unknown as FramingTarget, null),
    ).toThrow(TypeError);
  });

  test("rejects a distance that cannot be stood off at", () => {
    for (const distance of [0, -1, Number.POSITIVE_INFINITY, NaN]) {
      expect(() => framingPose(target({ x: 0, y: 1, z: 0 }, distance), null)).toThrow(
        RangeError,
      );
    }
  });
});
