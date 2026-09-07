import { describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";

import {
  framingTargetsFromBonePositions,
  FramingBoneName,
  FramingTarget,
  FramingTargets,
  Vector3Like,
} from "../src/features/vrmViewer/cameraFraming";

const VRM_DIR = path.join(process.cwd(), "public", "vrm");

/**
 * Every avatar the app ships with, read from disk so a newly bundled model is
 * covered automatically instead of silently skipped.
 */
const BUNDLED_MODELS = fs
  .readdirSync(VRM_DIR)
  .filter((name) => name.endsWith(".vrm"))
  .sort();

type BonePositions = Partial<Record<FramingBoneName, Vector3Like>>;

/**
 * Read the rest-pose world positions of the framing bones straight out of a
 * bundled `.vrm` file.
 *
 * A VRM is a GLB: a 12-byte header followed by chunks, the first of which is
 * the glTF JSON. Walking that JSON gives the same numbers the viewer gets from
 * `humanoid.getNormalizedBoneNode(name).getWorldPosition()` at load time, but
 * without needing a WebGL context. That keeps this test honest — it runs on the
 * real shipped assets rather than on invented coordinates.
 */
function readBonePositions(fileName: string): BonePositions {
  const buffer = fs.readFileSync(path.join(VRM_DIR, fileName));

  const GLB_HEADER_BYTES = 12;
  const CHUNK_HEADER_BYTES = 8;
  const jsonChunkLength = buffer.readUInt32LE(GLB_HEADER_BYTES);
  const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  const gltf = JSON.parse(
    buffer.toString("utf8", jsonStart, jsonStart + jsonChunkLength),
  );

  const nodes: any[] = gltf.nodes;
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

  const worldPosition = (nodeIndex: number): THREE.Vector3 => {
    const chain: number[] = [];
    for (let i = nodeIndex; i >= 0; i = parentOf[i]) chain.push(i);

    const matrix = new THREE.Matrix4();
    for (const index of chain.reverse()) matrix.multiply(localMatrix[index]);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  };

  // VRM 0.x lists bones as an array; VRM 1.0 keys them by bone name.
  const boneToNode = new Map<string, number>();
  for (const bone of gltf.extensions?.VRM?.humanoid?.humanBones ?? []) {
    boneToNode.set(bone.bone, bone.node);
  }
  for (const [name, bone] of Object.entries<any>(
    gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {},
  )) {
    boneToNode.set(name, bone.node);
  }

  const positions: BonePositions = {};
  for (const name of ["head", "chest", "upperChest", "hips"] as const) {
    const nodeIndex = boneToNode.get(name);
    if (nodeIndex !== undefined) positions[name] = worldPosition(nodeIndex);
  }
  return positions;
}

/** Turn a bone map into the lookup the framing module consumes. */
function lookupFrom(positions: BonePositions) {
  return (name: FramingBoneName): Vector3Like | null =>
    positions[name] ?? null;
}

function expectFiniteTarget(target: FramingTarget): void {
  expect(Number.isFinite(target.target.x)).toBe(true);
  expect(Number.isFinite(target.target.y)).toBe(true);
  expect(Number.isFinite(target.target.z)).toBe(true);
  expect(Number.isFinite(target.distance)).toBe(true);
  expect(Number.isFinite(target.framedHeight)).toBe(true);
  expect(target.distance).toBeGreaterThan(0);
  expect(target.framedHeight).toBeGreaterThan(0);
}

function expectFiniteTargets(targets: FramingTargets): void {
  expectFiniteTarget(targets.face);
  expectFiniteTarget(targets.upperBody);
  expectFiniteTarget(targets.fullBody);
}

describe("framingTargetsFromBonePositions with bundled models", () => {
  // The viewer's perspective camera FOV, as set up in Viewer.setup().
  const VIEWER_FOV = 20;

  it("finds the bundled models on disk", () => {
    expect(BUNDLED_MODELS.length).toBeGreaterThan(0);
  });

  it.each(BUNDLED_MODELS)(
    "%s exposes the head, chest and hips bones framing needs",
    (fileName) => {
      const positions = readBonePositions(fileName);

      expect(positions.head).toBeDefined();
      expect(positions.hips).toBeDefined();
      expect(positions.head!.y).toBeGreaterThan(positions.hips!.y);
    },
  );

  it.each(BUNDLED_MODELS)(
    "%s yields three finite framing targets",
    (fileName) => {
      const targets = framingTargetsFromBonePositions(
        lookupFrom(readBonePositions(fileName)),
        { verticalFovDegrees: VIEWER_FOV },
      );

      expect(targets).not.toBeNull();
      expectFiniteTargets(targets!);
    },
  );

  it.each(BUNDLED_MODELS)(
    "%s is framed tightest on the face and widest on the full body",
    (fileName) => {
      const positions = readBonePositions(fileName);
      const targets = framingTargetsFromBonePositions(lookupFrom(positions), {
        verticalFovDegrees: VIEWER_FOV,
      })!;

      expect(targets.face.framedHeight).toBeLessThan(
        targets.upperBody.framedHeight,
      );
      expect(targets.upperBody.framedHeight).toBeLessThan(
        targets.fullBody.framedHeight,
      );
      expect(targets.face.distance).toBeLessThan(targets.fullBody.distance);

      // The face shot looks at the head; the full-body shot sits above the floor
      // and below the crown, so the whole model is on screen.
      expect(targets.face.target.y).toBeCloseTo(positions.head!.y, 6);
      expect(targets.fullBody.target.y).toBeGreaterThan(0);
      expect(targets.fullBody.target.y).toBeLessThan(positions.head!.y);
    },
  );
});

describe("framingTargetsFromBonePositions bone selection", () => {
  const head = { x: 0, y: 1.4, z: 0 };
  const hips = { x: 0, y: 0.9, z: 0 };
  const chest = { x: 0, y: 1.1, z: 0.02 };
  const upperChest = { x: 0, y: 1.2, z: 0.05 };

  it("prefers chest when the rig has one", () => {
    const targets = framingTargetsFromBonePositions((name) =>
      ({ head, hips, chest, upperChest })[name],
    )!;

    expect(targets.upperBody.target.z).toBeCloseTo(chest.z, 6);
  });

  it("falls back to upperChest when chest is missing", () => {
    const targets = framingTargetsFromBonePositions(
      (name) => ({ head, hips, chest: null, upperChest })[name],
    )!;

    expect(targets.upperBody.target.z).toBeCloseTo(upperChest.z, 6);
  });

  it("still frames a rig with neither chest nor upperChest", () => {
    const targets = framingTargetsFromBonePositions((name) =>
      name === "head" ? head : name === "hips" ? hips : null,
    );

    expect(targets).not.toBeNull();
    expectFiniteTargets(targets!);
  });

  it("returns null when head is missing", () => {
    expect(
      framingTargetsFromBonePositions((name) => (name === "hips" ? hips : null)),
    ).toBeNull();
  });

  it("returns null when hips is missing", () => {
    expect(
      framingTargetsFromBonePositions((name) => (name === "head" ? head : null)),
    ).toBeNull();
  });

  it("returns null when a bone position is non-finite", () => {
    expect(
      framingTargetsFromBonePositions((name) =>
        name === "head" ? { x: 0, y: NaN, z: 0 } : hips,
      ),
    ).toBeNull();
  });
});
