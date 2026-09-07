/**
 * Eased camera moves for the VRM viewer.
 *
 * A framing preset changes two things at once — where the camera sits and what
 * the orbit control looks at. Snapping both is disorienting: the viewer appears
 * to teleport and the eye loses track of the character. Interpolating them over
 * a short, decelerating curve keeps the motion readable.
 *
 * The transition is a plain state machine driven by elapsed time, so it is
 * exercised in tests without a render loop, a canvas or a WebGL context. It
 * knows nothing about `Viewer`, three.js or `OrbitControls`; it only reads and
 * returns plain `{x, y, z}` points (a `THREE.Vector3` satisfies that shape).
 *
 * Ownership rule: while a transition is running it is the sole author of the
 * camera pose. The moment the user grabs the camera the transition is cancelled
 * rather than blended, so input never fights an animation.
 */

import { Vector3Like } from "./cameraFraming";

/** Where the camera is and what it looks at — the complete framing state. */
export interface CameraPose {
  /** World position of the camera. */
  readonly position: Vector3Like;
  /** World point the orbit control targets. */
  readonly target: Vector3Like;
}

/**
 * Duration of a framing preset move, in milliseconds.
 *
 * Long enough to read as motion rather than a cut, short enough that it never
 * feels like waiting.
 */
export const CAMERA_TRANSITION_DURATION_MS = 400;

/**
 * Ease-out cubic: fast departure, gentle arrival.
 *
 * The camera covers most of the distance early and settles into the final
 * framing, which reads as the camera coming to rest rather than stopping dead.
 * Input outside `[0, 1]` is clamped, so callers cannot overshoot the curve.
 */
export function easeOutCubic(t: number): number {
  if (!Number.isFinite(t)) {
    throw new TypeError(`easeOutCubic: t must be a finite number, got ${t}`);
  }
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const remaining = 1 - t;
  return 1 - remaining * remaining * remaining;
}

function lerpPoint(from: Vector3Like, to: Vector3Like, t: number): Vector3Like {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

function assertFinitePoint(point: Vector3Like, label: string): void {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z)
  ) {
    throw new TypeError(
      `CameraTransition: ${label} must be a finite point, got ${JSON.stringify(point)}`,
    );
  }
}

function copyPose(pose: CameraPose, label: string): CameraPose {
  assertFinitePoint(pose?.position, `${label}.position`);
  assertFinitePoint(pose?.target, `${label}.target`);
  return {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
  };
}

/**
 * Interpolate a camera pose along the ease-out curve.
 *
 * Position and target share one curve, so the framing stays coherent for the
 * whole move — the subject does not slide across the frame while the camera
 * catches up.
 *
 * @param progress linear progress in `[0, 1]`; values outside are clamped.
 */
export function interpolatePose(
  from: CameraPose,
  to: CameraPose,
  progress: number,
): CameraPose {
  const eased = easeOutCubic(progress);
  return {
    position: lerpPoint(from.position, to.position, eased),
    target: lerpPoint(from.target, to.target, eased),
  };
}

/** Why a transition stopped producing poses. */
export type CameraTransitionState = "running" | "finished" | "cancelled";

/**
 * A single camera move from one pose to another over a fixed duration.
 *
 * Drive it by calling {@link advance} once per frame with the elapsed time.
 * Once it reaches its destination — or is cancelled by user input — it goes
 * inert and {@link advance} returns `null` forever after, so a stale reference
 * can never re-grab the camera.
 */
export class CameraTransition {
  private readonly from: CameraPose;
  private readonly to: CameraPose;
  private readonly durationMs: number;

  private elapsedMs = 0;
  private state: CameraTransitionState = "running";

  /**
   * @param from pose the camera is in right now.
   * @param to pose to settle on.
   * @param durationMs how long the move takes. `0` lands on `to` at the first
   *   {@link advance}.
   * @throws {TypeError} if either pose has a non-finite component.
   * @throws {RangeError} if `durationMs` is negative or not finite.
   */
  constructor(
    from: CameraPose,
    to: CameraPose,
    durationMs: number = CAMERA_TRANSITION_DURATION_MS,
  ) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError(
        `CameraTransition: durationMs must be a finite, non-negative number, got ${durationMs}`,
      );
    }

    // Copied so a later mutation of the caller's vectors — three.js reuses
    // them heavily — cannot warp a move that is already in flight.
    this.from = copyPose(from, "from");
    this.to = copyPose(to, "to");
    this.durationMs = durationMs;
  }

  /** `true` while the transition still owns the camera. */
  public get isRunning(): boolean {
    return this.state === "running";
  }

  /** How the transition ended, or `"running"` if it has not. */
  public get status(): CameraTransitionState {
    return this.state;
  }

  /** Linear progress in `[0, 1]`, before easing. */
  public get progress(): number {
    if (this.durationMs === 0) return this.state === "running" ? 0 : 1;
    return Math.min(this.elapsedMs / this.durationMs, 1);
  }

  /** The pose this transition is heading for. */
  public get destination(): CameraPose {
    return this.to;
  }

  /**
   * Step the transition forward and get the pose to apply this frame.
   *
   * @param deltaMs time since the previous frame, in milliseconds. A negative
   *   delta (a clock that jumped backwards) is treated as a stalled frame
   *   rather than rewinding the animation.
   * @returns the pose to apply, or `null` once the transition has finished or
   *   been cancelled — nothing left to drive.
   * @throws {TypeError} if `deltaMs` is not a finite number.
   */
  public advance(deltaMs: number): CameraPose | null {
    if (!Number.isFinite(deltaMs)) {
      throw new TypeError(
        `CameraTransition.advance: deltaMs must be a finite number, got ${deltaMs}`,
      );
    }
    if (this.state !== "running") return null;

    this.elapsedMs += Math.max(deltaMs, 0);

    if (this.elapsedMs >= this.durationMs) {
      this.state = "finished";
      // Land exactly on the destination — a curve evaluated at 0.999 leaves a
      // sub-pixel offset that would persist until the next transition.
      return this.to;
    }

    return interpolatePose(this.from, this.to, this.elapsedMs / this.durationMs);
  }

  /**
   * Hand the camera back, leaving it wherever the animation had reached.
   *
   * Called when the user grabs the camera: their drag is the newer intent, so
   * the transition yields instead of dragging them back toward its target.
   * Cancelling an already-settled transition is a no-op.
   */
  public cancel(): void {
    if (this.state === "running") this.state = "cancelled";
  }
}

/**
 * The camera state a transition reads from and writes to.
 *
 * Implemented by the viewer over its `PerspectiveCamera` and `OrbitControls`;
 * implemented by a plain object in tests. Keeping the animation behind this
 * two-method seam is what lets the whole feature — including the cancel-on-drag
 * rule — be verified without a WebGL context.
 */
export interface CameraPoseIO {
  /** Where the camera is right now. */
  readPose(): CameraPose;
  /** Move the camera to `pose`. */
  writePose(pose: CameraPose): void;
}

/**
 * Anything that announces the user taking hold of the camera.
 *
 * `OrbitControls` satisfies this: it emits `"start"` on drag, wheel and touch,
 * and never for programmatic writes.
 */
export interface UserInputSource {
  addEventListener(type: "start", listener: () => void): void;
  removeEventListener(type: "start", listener: () => void): void;
}

/**
 * Owns the camera move in flight: starts it, steps it, and drops it the moment
 * the user takes over.
 *
 * At most one move exists at a time. A new one replaces its predecessor from
 * the current pose, so requests can be issued as fast as a person can click
 * without the camera ever jumping.
 */
export class CameraTransitionController {
  private transition: CameraTransition | null = null;

  constructor(private readonly io: CameraPoseIO) {}

  /** `true` while a move is animating. */
  public get isActive(): boolean {
    return this.transition !== null;
  }

  /** The pose the current move is heading for, or `null` when at rest. */
  public get destination(): CameraPose | null {
    return this.transition?.destination ?? null;
  }

  /**
   * Begin easing to `to`, starting from wherever the camera is now.
   *
   * @throws the same errors as the {@link CameraTransition} constructor when
   *   the destination or duration cannot be animated.
   */
  public start(
    to: CameraPose,
    durationMs: number = CAMERA_TRANSITION_DURATION_MS,
  ): void {
    this.transition = new CameraTransition(this.io.readPose(), to, durationMs);
  }

  /**
   * Step the move forward and write this frame's pose.
   *
   * @param deltaMs frame time in milliseconds.
   * @returns `true` if a pose was written this frame.
   */
  public update(deltaMs: number): boolean {
    const transition = this.transition;
    if (!transition) return false;

    const pose = transition.advance(deltaMs);
    if (!pose) {
      this.transition = null;
      return false;
    }

    this.io.writePose(pose);
    // The last frame lands exactly on the destination; release the camera so
    // the next interaction starts from a clean, un-animated state.
    if (!transition.isRunning) this.transition = null;
    return true;
  }

  /** Drop the move in flight, leaving the camera where it reached. */
  public cancel(): void {
    this.transition?.cancel();
    this.transition = null;
  }

  /**
   * Cancel automatically whenever the user takes hold of the camera.
   *
   * Their input is the newer intent, so the animation yields rather than
   * dragging them back toward a target they have moved on from.
   *
   * @returns a function that removes the subscription.
   */
  public cancelOnUserInput(source: UserInputSource): () => void {
    const listener = () => this.cancel();
    source.addEventListener("start", listener);
    return () => source.removeEventListener("start", listener);
  }
}
