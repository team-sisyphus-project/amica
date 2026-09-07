import { describe, expect, test } from "@jest/globals";

import {
  CameraPose,
  CameraTransition,
  CameraTransitionController,
  CAMERA_TRANSITION_DURATION_MS,
  easeOutCubic,
  interpolatePose,
} from "../src/features/vrmViewer/cameraTransition";

const FROM: CameraPose = {
  position: { x: 0, y: 1.3, z: 3 },
  target: { x: 0, y: 1.3, z: 0 },
};

const TO: CameraPose = {
  position: { x: 1, y: 0.9, z: 1 },
  target: { x: 0.2, y: 1.4, z: 0 },
};

function expectPoseClose(actual: CameraPose, expected: CameraPose): void {
  for (const part of ["position", "target"] as const) {
    for (const axis of ["x", "y", "z"] as const) {
      expect(actual[part][axis]).toBeCloseTo(expected[part][axis], 10);
    }
  }
}

describe("easeOutCubic", () => {
  test("runs from 0 to 1 across the unit interval", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  test("clamps input outside the unit interval", () => {
    expect(easeOutCubic(-2)).toBe(0);
    expect(easeOutCubic(4)).toBe(1);
  });

  test("increases monotonically", () => {
    let previous = easeOutCubic(0);
    for (let step = 1; step <= 100; step++) {
      const current = easeOutCubic(step / 100);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  test("decelerates: every step covers less ground than the one before", () => {
    let previous = easeOutCubic(0);
    let previousStepSize = Infinity;

    for (let step = 1; step <= 100; step++) {
      const current = easeOutCubic(step / 100);
      const stepSize = current - previous;
      expect(stepSize).toBeLessThan(previousStepSize);
      previous = current;
      previousStepSize = stepSize;
    }
  });

  test("is front-loaded: half the time covers most of the distance", () => {
    // Distinguishes an ease-out from a linear ramp, which would give exactly 0.5.
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  test("rejects a non-finite input rather than producing NaN", () => {
    expect(() => easeOutCubic(NaN)).toThrow(TypeError);
    expect(() => easeOutCubic(Infinity)).toThrow(TypeError);
  });
});

describe("interpolatePose", () => {
  test("returns the endpoints exactly", () => {
    expectPoseClose(interpolatePose(FROM, TO, 0), FROM);
    expectPoseClose(interpolatePose(FROM, TO, 1), TO);
  });

  test("moves position and target on the same curve", () => {
    const eased = easeOutCubic(0.25);
    const pose = interpolatePose(FROM, TO, 0.25);

    expectPoseClose(pose, {
      position: {
        x: FROM.position.x + (TO.position.x - FROM.position.x) * eased,
        y: FROM.position.y + (TO.position.y - FROM.position.y) * eased,
        z: FROM.position.z + (TO.position.z - FROM.position.z) * eased,
      },
      target: {
        x: FROM.target.x + (TO.target.x - FROM.target.x) * eased,
        y: FROM.target.y + (TO.target.y - FROM.target.y) * eased,
        z: FROM.target.z + (TO.target.z - FROM.target.z) * eased,
      },
    });
  });
});

describe("CameraTransition", () => {
  test("defaults to the 400 ms preset duration", () => {
    expect(CAMERA_TRANSITION_DURATION_MS).toBe(400);

    const transition = new CameraTransition(FROM, TO);
    transition.advance(CAMERA_TRANSITION_DURATION_MS - 1);
    expect(transition.isRunning).toBe(true);

    transition.advance(1);
    expect(transition.isRunning).toBe(false);
  });

  test("animates position and target together along the ease-out curve", () => {
    const transition = new CameraTransition(FROM, TO, 400);

    const pose = transition.advance(100);

    expect(pose).not.toBeNull();
    expectPoseClose(pose!, interpolatePose(FROM, TO, 0.25));
    expect(transition.progress).toBeCloseTo(0.25, 10);
  });

  test("accumulates deltas across frames", () => {
    const stepped = new CameraTransition(FROM, TO, 400);
    for (let frame = 0; frame < 12; frame++) stepped.advance(16);

    const single = new CameraTransition(FROM, TO, 400);
    const expected = single.advance(16 * 12);

    expectPoseClose(stepped.advance(0)!, expected!);
  });

  test("lands exactly on the destination and then goes inert", () => {
    const transition = new CameraTransition(FROM, TO, 400);

    const pose = transition.advance(400);

    expectPoseClose(pose!, TO);
    expect(transition.isRunning).toBe(false);
    expect(transition.status).toBe("finished");
    expect(transition.progress).toBe(1);
    expect(transition.advance(16)).toBeNull();
  });

  test("clamps an overshooting delta instead of flying past the destination", () => {
    const transition = new CameraTransition(FROM, TO, 400);

    // A dropped frame or a backgrounded tab hands us a huge delta.
    expectPoseClose(transition.advance(10_000)!, TO);
  });

  test("treats a backwards clock as a stalled frame", () => {
    const transition = new CameraTransition(FROM, TO, 400);
    transition.advance(200);

    transition.advance(-500);

    expect(transition.progress).toBeCloseTo(0.5, 10);
    expect(transition.isRunning).toBe(true);
  });

  test("a zero duration lands on the destination at the first step", () => {
    const transition = new CameraTransition(FROM, TO, 0);

    expectPoseClose(transition.advance(0)!, TO);
    expect(transition.status).toBe("finished");
  });

  describe("cancel", () => {
    test("stops producing poses, leaving the camera where it reached", () => {
      const transition = new CameraTransition(FROM, TO, 400);
      const midway = transition.advance(100)!;

      transition.cancel();

      expect(transition.status).toBe("cancelled");
      expect(transition.isRunning).toBe(false);
      expect(transition.advance(300)).toBeNull();
      // The pose already handed out is untouched by the cancellation.
      expectPoseClose(midway, interpolatePose(FROM, TO, 0.25));
    });

    test("never resurrects a cancelled transition", () => {
      const transition = new CameraTransition(FROM, TO, 400);
      transition.advance(100);
      transition.cancel();

      for (let frame = 0; frame < 60; frame++) {
        expect(transition.advance(16)).toBeNull();
      }
    });

    test("is a no-op once the transition has finished", () => {
      const transition = new CameraTransition(FROM, TO, 400);
      transition.advance(400);

      transition.cancel();

      expect(transition.status).toBe("finished");
    });
  });

  test("is immune to later mutation of the caller's vectors", () => {
    const from = {
      position: { x: 0, y: 0, z: 3 },
      target: { x: 0, y: 0, z: 0 },
    };
    const to = { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 } };
    const transition = new CameraTransition(from, to, 400);

    // three.js reuses Vector3 instances; a shared reference would warp the move.
    from.position.z = 99;
    to.position.z = -99;

    expectPoseClose(transition.advance(400)!, {
      position: { x: 0, y: 0, z: 1 },
      target: { x: 0, y: 0, z: 0 },
    });
  });

  test("rejects poses and durations it cannot animate", () => {
    const broken = { position: { x: NaN, y: 0, z: 0 }, target: FROM.target };

    expect(() => new CameraTransition(broken, TO)).toThrow(TypeError);
    expect(() => new CameraTransition(FROM, broken)).toThrow(TypeError);
    expect(() => new CameraTransition(FROM, TO, -1)).toThrow(RangeError);
    expect(() => new CameraTransition(FROM, TO, NaN)).toThrow(RangeError);
    expect(() => new CameraTransition(FROM, TO).advance(NaN)).toThrow(TypeError);
  });
});

/**
 * Stands in for the viewer's camera and orbit control: the transition reads the
 * current pose from it and writes each frame back to it.
 */
class FakeCamera {
  public pose: CameraPose;
  public writes = 0;

  constructor(pose: CameraPose = FROM) {
    this.pose = pose;
  }

  public readPose(): CameraPose {
    return this.pose;
  }

  public writePose(pose: CameraPose): void {
    this.pose = pose;
    this.writes++;
  }
}

/** Stands in for `OrbitControls`, which emits "start" when the user grabs it. */
class FakeControls {
  private listeners: Array<() => void> = [];

  public addEventListener(_type: "start", listener: () => void): void {
    this.listeners.push(listener);
  }

  public removeEventListener(_type: "start", listener: () => void): void {
    this.listeners = this.listeners.filter((entry) => entry !== listener);
  }

  /** The user starts dragging, wheeling or pinching the camera. */
  public userGrabsCamera(): void {
    for (const listener of [...this.listeners]) listener();
  }

  public get listenerCount(): number {
    return this.listeners.length;
  }
}

describe("CameraTransitionController", () => {
  test("starts at rest", () => {
    const controller = new CameraTransitionController(new FakeCamera());

    expect(controller.isActive).toBe(false);
    expect(controller.destination).toBeNull();
    expect(controller.update(16)).toBe(false);
  });

  test("writes an eased pose every frame until it settles on the destination", () => {
    const camera = new FakeCamera();
    const controller = new CameraTransitionController(camera);

    controller.start(TO, 400);
    expect(controller.isActive).toBe(true);

    controller.update(100);
    expectPoseClose(camera.pose, interpolatePose(FROM, TO, 0.25));

    controller.update(300);
    expectPoseClose(camera.pose, TO);
    expect(controller.isActive).toBe(false);

    // Released: no further writes once the move has landed.
    const settledWrites = camera.writes;
    expect(controller.update(16)).toBe(false);
    expect(camera.writes).toBe(settledWrites);
  });

  test("a new move starts from the current pose, not the old origin", () => {
    const camera = new FakeCamera();
    const controller = new CameraTransitionController(camera);

    controller.start(TO, 400);
    controller.update(100);
    const interrupted = camera.pose;

    const elsewhere: CameraPose = {
      position: { x: -2, y: 2, z: 2 },
      target: { x: 0, y: 1, z: 0 },
    };
    controller.start(elsewhere, 400);
    controller.update(100);

    expectPoseClose(camera.pose, interpolatePose(interrupted, elsewhere, 0.25));
  });

  describe("cancel on user drag", () => {
    test("a grab stops the move and leaves the camera where it reached", () => {
      const camera = new FakeCamera();
      const controls = new FakeControls();
      const controller = new CameraTransitionController(camera);
      controller.cancelOnUserInput(controls);

      controller.start(TO, 400);
      controller.update(100);
      const poseWhenGrabbed = camera.pose;

      controls.userGrabsCamera();

      expect(controller.isActive).toBe(false);
      expect(controller.update(300)).toBe(false);
      expect(camera.pose).toBe(poseWhenGrabbed);
      expectPoseClose(camera.pose, interpolatePose(FROM, TO, 0.25));
    });

    test("later frames never drag the camera back toward the target", () => {
      const camera = new FakeCamera();
      const controls = new FakeControls();
      const controller = new CameraTransitionController(camera);
      controller.cancelOnUserInput(controls);

      controller.start(TO, 400);
      controller.update(100);
      controls.userGrabsCamera();

      // The user orbits somewhere of their own choosing.
      const userChosen: CameraPose = {
        position: { x: 3, y: 0.5, z: -1 },
        target: { x: 0, y: 1, z: 0 },
      };
      camera.pose = userChosen;
      for (let frame = 0; frame < 60; frame++) controller.update(16);

      expect(camera.pose).toBe(userChosen);
    });

    test("a grab before any move has started is harmless", () => {
      const controls = new FakeControls();
      const controller = new CameraTransitionController(new FakeCamera());
      controller.cancelOnUserInput(controls);

      expect(() => controls.userGrabsCamera()).not.toThrow();
      expect(controller.isActive).toBe(false);
    });

    test("a grab does not stop later moves from running", () => {
      const camera = new FakeCamera();
      const controls = new FakeControls();
      const controller = new CameraTransitionController(camera);
      controller.cancelOnUserInput(controls);

      controller.start(TO, 400);
      controller.update(100);
      controls.userGrabsCamera();

      controller.start(TO, 400);
      controller.update(400);

      expectPoseClose(camera.pose, TO);
    });

    test("unsubscribing removes the listener", () => {
      const controls = new FakeControls();
      const controller = new CameraTransitionController(new FakeCamera());

      const unbind = controller.cancelOnUserInput(controls);
      expect(controls.listenerCount).toBe(1);

      unbind();

      expect(controls.listenerCount).toBe(0);
      controller.start(TO, 400);
      controls.userGrabsCamera();
      expect(controller.isActive).toBe(true);
    });
  });
});
