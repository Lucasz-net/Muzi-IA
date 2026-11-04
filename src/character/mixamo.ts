import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/**
 * Carga una animación de Mixamo (FBX, vale "Without Skin") y la retargetea a los huesos
 * normalizados de un VRM. Basado en el ejemplo oficial de three-vrm (humanoidAnimation).
 *
 * También acepta esqueletos humanoides estándar sin el prefijo `mixamorig` (Hips, Spine, Chest,
 * LeftArm...), siempre que partan de una T-pose mirando a +Z como Mixamo.
 */

/** Hueso del rig (con el prefijo mixamorig) -> hueso humanoide VRM. */
const MIXAMO_TO_VRM: Record<string, VRMHumanBoneName> = {
  mixamorigHips: "hips",
  mixamorigSpine: "spine",
  mixamorigSpine1: "chest",
  mixamorigSpine2: "upperChest",
  mixamorigNeck: "neck",
  mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder",
  mixamorigLeftArm: "leftUpperArm",
  mixamorigLeftForeArm: "leftLowerArm",
  mixamorigLeftHand: "leftHand",
  mixamorigLeftHandThumb1: "leftThumbMetacarpal",
  mixamorigLeftHandThumb2: "leftThumbProximal",
  mixamorigLeftHandThumb3: "leftThumbDistal",
  mixamorigLeftHandIndex1: "leftIndexProximal",
  mixamorigLeftHandIndex2: "leftIndexIntermediate",
  mixamorigLeftHandIndex3: "leftIndexDistal",
  mixamorigLeftHandMiddle1: "leftMiddleProximal",
  mixamorigLeftHandMiddle2: "leftMiddleIntermediate",
  mixamorigLeftHandMiddle3: "leftMiddleDistal",
  mixamorigLeftHandRing1: "leftRingProximal",
  mixamorigLeftHandRing2: "leftRingIntermediate",
  mixamorigLeftHandRing3: "leftRingDistal",
  mixamorigLeftHandPinky1: "leftLittleProximal",
  mixamorigLeftHandPinky2: "leftLittleIntermediate",
  mixamorigLeftHandPinky3: "leftLittleDistal",
  mixamorigRightShoulder: "rightShoulder",
  mixamorigRightArm: "rightUpperArm",
  mixamorigRightForeArm: "rightLowerArm",
  mixamorigRightHand: "rightHand",
  mixamorigRightHandPinky1: "rightLittleProximal",
  mixamorigRightHandPinky2: "rightLittleIntermediate",
  mixamorigRightHandPinky3: "rightLittleDistal",
  mixamorigRightHandRing1: "rightRingProximal",
  mixamorigRightHandRing2: "rightRingIntermediate",
  mixamorigRightHandRing3: "rightRingDistal",
  mixamorigRightHandMiddle1: "rightMiddleProximal",
  mixamorigRightHandMiddle2: "rightMiddleIntermediate",
  mixamorigRightHandMiddle3: "rightMiddleDistal",
  mixamorigRightHandIndex1: "rightIndexProximal",
  mixamorigRightHandIndex2: "rightIndexIntermediate",
  mixamorigRightHandIndex3: "rightIndexDistal",
  mixamorigRightHandThumb1: "rightThumbMetacarpal",
  mixamorigRightHandThumb2: "rightThumbProximal",
  mixamorigRightHandThumb3: "rightThumbDistal",
  mixamorigLeftUpLeg: "leftUpperLeg",
  mixamorigLeftLeg: "leftLowerLeg",
  mixamorigLeftFoot: "leftFoot",
  mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg",
  mixamorigRightLeg: "rightLowerLeg",
  mixamorigRightFoot: "rightFoot",
  mixamorigRightToeBase: "rightToes",
};

/** Mismo mapa sin el prefijo, más los nombres que usan otros rigs (Chest en lugar de Spine1/Spine2). */
const RIG_TO_VRM: Record<string, VRMHumanBoneName> = {
  ...Object.fromEntries(Object.entries(MIXAMO_TO_VRM).map(([k, v]) => [k.replace(/^mixamorig/, ""), v])),
  Chest: "chest",
};
const baseName = (rigName: string) => rigName.replace(/^mixamorig:?/, "");

export async function loadMixamoClip(url: string, vrm: VRM): Promise<THREE.AnimationClip> {
  const asset = await new FBXLoader().loadAsync(url);
  const source = THREE.AnimationClip.findByName(asset.animations, "mixamo.com") ?? asset.animations[0];
  if (!source) throw new Error(`${url} no contiene ninguna animación`);

  const hips = asset.getObjectByName("mixamorigHips") ?? asset.getObjectByName("Hips");
  if (!hips) throw new Error(`${url} no tiene un esqueleto humanoide reconocible (falta el hueso Hips)`);

  // Escala del movimiento de caderas: altura de caderas del VRM / altura en el FBX (cm o m según el rig).
  const vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? 1;
  const hipsPositionScale = vrmHipsHeight / hips.position.y;
  // Los VRM 0.x miran a -Z, así que x y z se invierten; los 1.0 no necesitan nada.
  const flip = vrm.meta?.metaVersion === "0";

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of source.tracks) {
    const [rigName, property] = track.name.split(".");
    const boneName = RIG_TO_VRM[baseName(rigName)];
    const nodeName = boneName ? vrm.humanoid.getNormalizedBoneNode(boneName)?.name : undefined;
    const rigNode = asset.getObjectByName(rigName);
    if (!nodeName || !rigNode?.parent) continue; // hueso que este VRM no tiene

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // Retarget de rotación: (rotación de reposo del padre) * (rotación de la pista) * (inversa del reposo).
      rigNode.getWorldQuaternion(restRotationInverse).invert();
      rigNode.parent.getWorldQuaternion(parentRestWorldRotation);
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i).premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        q.toArray(values, i);
        if (flip) {
          values[i] = -values[i];
          values[i + 2] = -values[i + 2];
        }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${nodeName}.${property}`, track.times, values));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const values = Float32Array.from(track.values, (v, i) => (flip && i % 3 !== 1 ? -v : v) * hipsPositionScale);
      tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.${property}`, track.times, values));
    }
  }

  return new THREE.AnimationClip(url, source.duration, tracks);
}
