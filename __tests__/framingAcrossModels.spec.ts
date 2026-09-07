import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";

import {
  framingTargetsFromBonePositions,
  FramingBoneName,
  FramingTargets,
  ModelBounds,
  Vector3Like,
} from "../src/features/vrmViewer/cameraFraming";
import {
  CameraPose,
  CameraPoseIO,
  CameraTransitionController,
  CAMERA_TRANSITION_DURATION_MS,
} from "../src/features/vrmViewer/cameraTransition";
import { measureModelBounds } from "../src/features/vrmViewer/modelBounds";
import {
  framingPose,
  FramingPresetId,
  FRAMING_PRESET_IDS,
  selectFramingTarget,
} from "../src/features/vrmViewer/framingPresets";

/**
 * Acceptance for the framing presets: each one frames its intended region, on
 * every model the app ships with plus a taller custom one, without clipping —
 * and gets there as a smooth move rather than a cut.
 *
 * The measurements are read straight out of the shipped `.vrm` files, so this
 * is the real geometry the viewer loads, not invented coordinates. What a
 * headless test cannot see (pixels) it replaces with the projection those
 * pixels come from: a point is "in frame" when it falls inside the camera
 * frustum the preset produces.
 */

// The viewer's perspective camera, as constructed in Viewer.setup().
const VIEWER_FOV = 20;
const VIEWER_NEAR = 0.1;
const VIEWER_FAR = 20;

/**
 * Window shapes the presets promise their framing for, widest first. A window
 * narrower than square can still crop wide poses horizontally; the presets are
 * defined on the vertical axis and only claim that axis.
 */
const SUPPORTED_ASPECTS = [16 / 9, 4 / 3, 1];

/** Frame rate the transition is stepped at, matching a normal render loop. */
const FRAME_MS = 1000 / 60;

const VRM_DIR = path.join(process.cwd(), "public", "vrm");

interface MeasuredModel {
  readonly name: string;
  readonly bones: Partial<Record<FramingBoneName, Vector3Like>>;
  readonly bounds: ModelBounds;
  /** Horizontal extent of the geometry, for the full-body width check. */
  readonly minX: number;
  readonly maxX: number;
}

/**
 * Read the rest-pose bone positions and the geometry extent out of a `.vrm`.
 *
 * A VRM is a GLB: a 12-byte header, then chunks, the first being the glTF JSON.
 * Walking that JSON yields the same numbers the viewer derives at load time —
 * `humanoid.getNormalizedBoneNode(name).getWorldPosition()` for the bones and
 * `Box3.setFromObject(vrm.scene)` for the box — without a WebGL context.
 *
 * The file's own coordinate frame is used as-is. Framing is decided on the Y
 * axis, and the facing rotation the viewer applies to VRM 0.x models turns
 * about Y, so every assertion here holds in either frame.
 */
function measureVrm(name: string, buffer: Buffer): MeasuredModel {
  const GLB_HEADER_BYTES = 12;
  const CHUNK_HEADER_BYTES = 8;
  const jsonChunkLength = buffer.readUInt32LE(GLB_HEADER_BYTES);
  const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  const gltf = JSON.parse(
    buffer.toString("utf8", jsonStart, jsonStart + jsonChunkLength),
  );

  const nodes: any[] = gltf.nodes ?? [];
  const parentOf = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parentOf[child] = index;
  });

  const localMatrix = nodes.map((node) => {
    const matrix = new THREE.Matrix4();
    if (node.matrix) return matrix.fromArray(node.matrix);
    return matrix.compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
  });

  const worldMatrix = (nodeIndex: number): THREE.Matrix4 => {
    const chain: number[] = [];
    for (let i = nodeIndex; i >= 0; i = parentOf[i]) chain.push(i);

    const matrix = new THREE.Matrix4();
    for (const index of chain.reverse()) matrix.multiply(localMatrix[index]);
    return matrix;
  };

  // VRM 0.x lists bones as an array; VRM 1.0 keys them by bone name.
  const boneToNode = new Map<string, number>();
  for (const bone of gltf.extensions?.VRM?.humanoid?.humanBones ?? []) {
    boneToNode.set(bone.bone, bone.node);
  }
  for (const [boneName, bone] of Object.entries<any>(
    gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {},
  )) {
    boneToNode.set(boneName, bone.node);
  }

  const bones: Partial<Record<FramingBoneName, Vector3Like>> = {};
  for (const boneName of ["head", "chest", "upperChest", "hips"] as const) {
    const nodeIndex = boneToNode.get(boneName);
    if (nodeIndex !== undefined) {
      bones[boneName] = new THREE.Vector3().setFromMatrixPosition(
        worldMatrix(nodeIndex),
      );
    }
  }

  // Same rule three.js applies in Box3.setFromObject: a skinned mesh's vertices
  // are already in model space, so its node transform is not applied to them.
  const box = new THREE.Box3();
  nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    const matrix =
      node.skin !== undefined ? new THREE.Matrix4() : worldMatrix(index);

    for (const primitive of gltf.meshes[node.mesh].primitives ?? []) {
      const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;

      const [minX, minY, minZ] = accessor.min;
      const [maxX, maxY, maxZ] = accessor.max;
      for (const x of [minX, maxX]) {
        for (const y of [minY, maxY]) {
          for (const z of [minZ, maxZ]) {
            box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
          }
        }
      }
    }
  });
  expect(box.isEmpty()).toBe(false);

  const center = box.getCenter(new THREE.Vector3());
  return {
    name,
    bones,
    bounds: {
      minY: box.min.y,
      maxY: box.max.y,
      frontDepth: Math.max(box.max.z - center.z, center.z - box.min.z),
    },
    minX: box.min.x,
    maxX: box.max.x,
  };
}

/**
 * A 1.95 m custom model — taller than anything bundled, with hair reaching a
 * further 12 cm above the head bone.
 *
 * Built here rather than committed as a binary: the point is a rig with
 * proportions no bundled avatar has, read through exactly the same path as the
 * shipped files. It is also VRM 1.0, whose humanoid is keyed by bone name
 * rather than listed, so that branch is covered by a real file too.
 */
function buildTallCustomVrm(): Buffer {
  const CROWN_Y = 1.95;
  const positions = new Float32Array([
    -0.35, -0.02, -0.16, 0.35, -0.02, -0.16, -0.35, -0.02, 0.16, 0.35, -0.02,
    0.16, -0.35, CROWN_Y, -0.16, 0.35, CROWN_Y, -0.16, -0.35, CROWN_Y, 0.16,
    0.35, CROWN_Y, 0.16,
  ]);
  const bin = Buffer.from(positions.buffer);

  const gltf = {
    asset: { version: "2.0" },
    extensionsUsed: ["VRMC_vrm"],
    scene: 0,
    scenes: [{ nodes: [0, 4] }],
    nodes: [
      { name: "hips", translation: [0, 1.05, 0], children: [1] },
      { name: "spine", translation: [0, 0.2, 0], children: [2] },
      { name: "chest", translation: [0, 0.17, 0.01], children: [3] },
      { name: "head", translation: [0, 0.41, -0.01] },
      { name: "body", mesh: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-0.35, -0.02, -0.16],
        max: [0.35, CROWN_Y, 0.16],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        humanoid: {
          humanBones: {
            hips: { node: 0 },
            spine: { node: 1 },
            chest: { node: 2 },
            head: { node: 3 },
          },
        },
      },
    },
  };

  const jsonChunk = padTo4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const binChunk = padTo4(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a), // "JSON"
    jsonChunk,
    chunkHeader(binChunk.length, 0x004e4942), // "BIN"
    binChunk,
  ]);
}

function padTo4(buffer: Buffer, fill: number): Buffer {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0
    ? buffer
    : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function chunkHeader(length: number, type: number): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(length, 0);
  header.writeUInt32LE(type, 4);
  return header;
}

const BUNDLED_MODELS: MeasuredModel[] = fs
  .readdirSync(VRM_DIR)
  .filter((name) => name.endsWith(".vrm"))
  .sort()
  .map((name) => measureVrm(name, fs.readFileSync(path.join(VRM_DIR, name))));

const TALL_CUSTOM_MODEL = measureVrm("tall-custom.vrm", buildTallCustomVrm());

const ALL_MODELS: MeasuredModel[] = [...BUNDLED_MODELS, TALL_CUSTOM_MODEL];

function targetsFor(model: MeasuredModel): FramingTargets {
  const targets = framingTargetsFromBonePositions(
    (name: FramingBoneName) => model.bones[name] ?? null,
    { verticalFovDegrees: VIEWER_FOV, modelBounds: model.bounds },
  );
  expect(targets).not.toBeNull();
  return targets!;
}

/**
 * The pose the viewer is in right after a model loads: `resetCamera()` has put
 * the camera at head height, still on the Z the scene starts on.
 */
function restingPose(model: MeasuredModel): CameraPose {
  const head = model.bones.head!;
  return {
    position: { x: 0, y: head.y, z: 3.5 },
    target: { x: head.x, y: head.y, z: head.z },
  };
}

function poseForPreset(
  model: MeasuredModel,
  preset: FramingPresetId,
): CameraPose {
  const target = selectFramingTarget(targetsFor(model), preset);
  expect(target).not.toBeNull();
  return framingPose(target!, restingPose(model).position);
}

interface Projected {
  /** Distance in front of the camera, along the direction it looks. */
  readonly depth: number;
  /** Offset from the centre of the frame, in world units at that depth. */
  readonly vertical: number;
  readonly horizontal: number;
}

/**
 * Project a world point into the frame of a level, roll-free camera.
 *
 * `framingPose` always places the camera at its target's height, so "up" in the
 * frame is world up and the vertical offset is a plain Y difference.
 */
function project(point: Vector3Like, pose: CameraPose): Projected {
  const axis = new THREE.Vector3(
    pose.target.x - pose.position.x,
    0,
    pose.target.z - pose.position.z,
  ).normalize();
  const right = new THREE.Vector3().crossVectors(
    axis,
    new THREE.Vector3(0, 1, 0),
  );
  const relative = new THREE.Vector3(
    point.x - pose.position.x,
    point.y - pose.position.y,
    point.z - pose.position.z,
  );

  return {
    depth: relative.dot(axis),
    vertical: relative.y,
    horizontal: relative.dot(right),
  };
}

/**
 * Sample the worst case for a region of the model: its whole silhouette pulled
 * forward to the surface nearest the camera. A point closer to the camera is
 * magnified, so if the near surface fits, everything behind it fits too.
 */
function surfaceSamples(
  model: MeasuredModel,
  pose: CameraPose,
  bottomY: number,
  topY: number,
  xs: number[],
): Vector3Like[] {
  const towardCamera = new THREE.Vector3(
    pose.position.x - pose.target.x,
    0,
    pose.position.z - pose.target.z,
  )
    .normalize()
    .multiplyScalar(model.bounds.frontDepth);

  const samples: Vector3Like[] = [];
  for (const y of [bottomY, topY]) {
    for (const x of xs) {
      samples.push({
        x: x + towardCamera.x,
        y,
        z: pose.target.z + towardCamera.z,
      });
    }
  }
  return samples;
}

function halfFrame(depth: number, aspect: number) {
  const halfHeight = depth * Math.tan((VIEWER_FOV * Math.PI) / 360);
  return { halfHeight, halfWidth: halfHeight * aspect };
}

/**
 * Assert every sample is inside the frustum, at every supported window shape.
 *
 * Reported as the fraction of the frame each sample lands at — `1` is the frame
 * edge — so a failure says how badly the region was cropped, not just that it
 * was.
 */
function expectInFrame(samples: Vector3Like[], pose: CameraPose): void {
  for (const sample of samples) {
    const { depth, vertical, horizontal } = project(sample, pose);

    // In front of the camera, and clear of the planes it would be sliced by.
    expect(depth).toBeGreaterThan(VIEWER_NEAR);
    expect(depth).toBeLessThan(VIEWER_FAR);

    for (const aspect of SUPPORTED_ASPECTS) {
      const { halfHeight, halfWidth } = halfFrame(depth, aspect);
      // A sample exactly on the frame edge is not clipped; floating-point
      // slack only.
      expect({
        aspect,
        vertical: Math.abs(vertical) / halfHeight <= 1 + 1e-9,
        horizontal: Math.abs(horizontal) / halfWidth <= 1 + 1e-9,
      }).toEqual({ aspect, vertical: true, horizontal: true });
    }
  }
}

describe("bundled models are measurable", () => {
  test("every shipped avatar is covered", () => {
    expect(BUNDLED_MODELS.length).toBeGreaterThanOrEqual(4);
  });

  test.each(ALL_MODELS.map((model) => [model.name, model] as const))(
    "%s has a crown above its head bone that no rig ratio predicts",
    (_name, model) => {
      expect(model.bones.head).toBeDefined();
      expect(model.bones.hips).toBeDefined();
      expect(model.bounds.maxY).toBeGreaterThan(model.bones.head!.y);
      expect(model.bounds.frontDepth).toBeGreaterThan(0);
    },
  );

  test("the custom model is taller than every bundled one", () => {
    for (const bundled of BUNDLED_MODELS) {
      expect(TALL_CUSTOM_MODEL.bounds.maxY).toBeGreaterThan(bundled.bounds.maxY);
    }
  });
});

describe.each(ALL_MODELS.map((model) => [model.name, model] as const))(
  "%s framing presets",
  (_name, model) => {
    const head = model.bones.head!;
    const chest = model.bones.chest ?? model.bones.upperChest ?? head;
    const crownY = model.bounds.maxY;
    const headHeight = crownY - head.y;

    test("the face preset holds the whole head, chin to crown", () => {
      const pose = poseForPreset(model, "face");
      // The head bone sits at the top of the neck, so the chin hangs below it.
      const chinY = head.y - 0.35 * headHeight;

      expectInFrame(
        surfaceSamples(model, pose, chinY, crownY, [head.x]),
        pose,
      );
    });

    test("the face preset stays a close-up rather than backing off", () => {
      const face = targetsFor(model).face;

      expect(face.framedHeight).toBeLessThan(3 * headHeight);
      expect(face.framedHeight).toBeGreaterThan(headHeight);
    });

    test("the upper body preset holds chest to crown", () => {
      const pose = poseForPreset(model, "upperBody");

      expectInFrame(
        surfaceSamples(model, pose, chest.y, crownY, [chest.x]),
        pose,
      );
    });

    test("the full body preset holds the floor to the crown, at full width", () => {
      const pose = poseForPreset(model, "fullBody");
      const floorY = Math.min(model.bounds.minY, 0);

      expectInFrame(
        surfaceSamples(model, pose, floorY, crownY, [model.minX, model.maxX]),
        pose,
      );
    });

    test("the full body preset frames the model, not the empty room", () => {
      const fullBody = targetsFor(model).fullBody;
      const modelHeight = crownY - Math.min(model.bounds.minY, 0);

      expect(fullBody.framedHeight).toBeGreaterThanOrEqual(modelHeight);
      expect(fullBody.framedHeight).toBeLessThan(1.35 * modelHeight);
    });

    test("the presets stay ordered from tightest to widest", () => {
      const targets = targetsFor(model);

      expect(targets.face.framedHeight).toBeLessThan(
        targets.upperBody.framedHeight,
      );
      expect(targets.upperBody.framedHeight).toBeLessThan(
        targets.fullBody.framedHeight,
      );
      expect(targets.face.distance).toBeLessThan(targets.upperBody.distance);
      expect(targets.upperBody.distance).toBeLessThan(targets.fullBody.distance);
    });

    test.each(FRAMING_PRESET_IDS)(
      "the %s preset sits between the camera's near and far planes",
      (preset) => {
        const target = selectFramingTarget(targetsFor(model), preset)!;

        expect(target.distance - model.bounds.frontDepth).toBeGreaterThan(
          VIEWER_NEAR,
        );
        expect(target.distance + model.bounds.frontDepth).toBeLessThan(
          VIEWER_FAR,
        );
      },
    );
  },
);

describe.each(ALL_MODELS.map((model) => [model.name, model] as const))(
  "%s preset transitions",
  (_name, model) => {
    /** Step a preset move at 60 fps and record the pose of every frame. */
    function runTransition(preset: FramingPresetId): CameraPose[] {
      let pose = restingPose(model);
      const io: CameraPoseIO = {
        readPose: () => pose,
        writePose: (next) => {
          pose = next;
        },
      };
      const controller = new CameraTransitionController(io);
      controller.start(poseForPreset(model, preset));

      const frames: CameraPose[] = [];
      // Two extra frames of headroom, so a move that overruns is visible as a
      // failure rather than silently truncated.
      const budget = Math.ceil(CAMERA_TRANSITION_DURATION_MS / FRAME_MS) + 2;
      for (let i = 0; i < budget && controller.isActive; i++) {
        controller.update(FRAME_MS);
        frames.push(pose);
      }
      return frames;
    }

    function distance(a: Vector3Like, b: Vector3Like): number {
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    test.each(FRAMING_PRESET_IDS)(
      "the %s move settles exactly on the preset within its 400 ms",
      (preset) => {
        const frames = runTransition(preset);
        const destination = poseForPreset(model, preset);

        expect(frames.length).toBeLessThanOrEqual(
          Math.ceil(CAMERA_TRANSITION_DURATION_MS / FRAME_MS),
        );
        // A move that lands in a frame or two is a cut, not a transition.
        expect(frames.length).toBeGreaterThan(20);
        expect(distance(frames[frames.length - 1].position, destination.position)).
          toBeLessThan(1e-9);
        expect(distance(frames[frames.length - 1].target, destination.target)).
          toBeLessThan(1e-9);
      },
    );

    test.each(FRAMING_PRESET_IDS)(
      "the %s move starts without a jump and decelerates to rest",
      (preset) => {
        const start = restingPose(model);
        const frames = runTransition(preset);
        const totalDistance = distance(
          start.position,
          frames[frames.length - 1].position,
        );
        expect(totalDistance).toBeGreaterThan(0);

        const steps: number[] = [];
        let previous = start;
        for (const frame of frames) {
          steps.push(distance(previous.position, frame.position));
          previous = frame;
        }

        // No visible jump on the first frame: a preset reframes, it does not cut.
        expect(steps[0] / totalDistance).toBeLessThan(0.15);
        // Every frame covers less ground than the one before it, so the camera
        // eases to a stop instead of stopping dead.
        for (let i = 1; i < steps.length; i++) {
          expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-12);
        }
        // ...and it is always closing on the destination, never overshooting.
        let remaining = totalDistance;
        for (const frame of frames) {
          const next = distance(frame.position, frames[frames.length - 1].position);
          expect(next).toBeLessThanOrEqual(remaining + 1e-12);
          remaining = next;
        }
        expect(remaining).toBeLessThan(1e-9);
      },
    );
  },
);

describe("measureModelBounds", () => {
  /** A 1 x 2 x 0.4 box, centred on the origin in x and z, standing on y = 0. */
  function standingBox(): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.4));
    mesh.position.set(0, 1, 0);
    return mesh;
  }

  test("reports the extent a preset has to frame", () => {
    const bounds = measureModelBounds(standingBox())!;

    expect(bounds.minY).toBeCloseTo(0, 6);
    expect(bounds.maxY).toBeCloseTo(2, 6);
    expect(bounds.frontDepth).toBeCloseTo(0.2, 6);
  });

  test("includes geometry parented anywhere under the model", () => {
    const root = new THREE.Group();
    root.add(standingBox());
    // Hair sitting above and in front of the body, the case bones cannot see.
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4));
    hair.position.set(0, 2.2, 0.3);
    root.add(hair);

    const bounds = measureModelBounds(root)!;

    expect(bounds.maxY).toBeCloseTo(2.45, 6);
    expect(bounds.frontDepth).toBeGreaterThan(0.2);
  });

  test("follows the transform the viewer applies to the model", () => {
    const root = new THREE.Group();
    root.add(standingBox());
    root.scale.setScalar(0.5);

    const bounds = measureModelBounds(root)!;

    expect(bounds.maxY).toBeCloseTo(1, 6);
    expect(bounds.frontDepth).toBeCloseTo(0.1, 6);
  });

  test("returns null for an object with no geometry to measure", () => {
    expect(measureModelBounds(new THREE.Group())).toBeNull();
  });
});
