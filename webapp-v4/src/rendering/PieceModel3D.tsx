import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Box3, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";

/**
 * Global scale factor: maps OBJ model units → board SVG units.
 * Calibrated empirically against the board cell grid.
 * (Derived from 2.4672 base × 1.5 residual = 3.7008, tuned to 3.6508.)
 */
const GLOBAL_MODEL_SCALE = 3.6508;

/** Correct Blender's Z-up to Three.js Y-up. */
const AXIS_CORRECTION_X = Math.PI / 2;

interface PieceModel3DProps {
  modelUrl: string;
  colorHex: string;
  position?: [number, number, number];
  rotationZ?: number;
  mirrored?: boolean;
  residualScale?: number;
  /** When true: normalize bbox to unit cube for inventory thumbnails. Ignores board scale. */
  normalizeToFit?: boolean;
}

/**
 * Computes the vertex centroid of all mesh geometry in the object.
 * Falls back to bbox center when no geometry is found.
 * Used to offset the model along Z so it sits at the correct camera depth.
 */
function computeVertexCentroid(obj: Object3D): Vector3 {
  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  const pos = new Vector3();

  obj.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      const posAttr = child.geometry.getAttribute("position");
      if (!posAttr) return;
      for (let i = 0; i < posAttr.count; i++) {
        pos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        child.localToWorld(pos);
        sumX += pos.x; sumY += pos.y; sumZ += pos.z;
        count++;
      }
    }
  });

  if (count === 0) {
    const box = new Box3().setFromObject(obj);
    const center = new Vector3();
    box.getCenter(center);
    return center;
  }

  return new Vector3(sumX / count, sumY / count, sumZ / count);
}

export default function PieceModel3D({
  modelUrl,
  colorHex,
  position = [0, 0, 0],
  rotationZ = 0,
  mirrored = false,
  residualScale = 1,
  normalizeToFit = false,
}: Readonly<PieceModel3DProps>) {
  const loaded = useLoader(OBJLoader, modelUrl);

  const normalized = useMemo(() => {
    const clone = loaded.clone(true);

    // 1. Axis correction (Blender Z-up → Three.js Y-up)
    clone.rotation.set(AXIS_CORRECTION_X, 0, 0);
    clone.updateMatrixWorld(true);

    if (normalizeToFit) {
      // For inventory thumbnails: normalize bbox to unit cube, centered at origin.
      // Each piece has very different raw geometry extents so we can't use a fixed scale.
      const box = new Box3().setFromObject(clone);
      const size = new Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const s = maxDim > 0 ? 1 / maxDim : 1;
      const center = new Vector3();
      box.getCenter(center);
      clone.scale.set(s, s, s);
      clone.position.set(-center.x * s, -center.y * s, -center.z * s);
    } else {
      // For board rendering: apply board-coordinate scale, shift only Z to centroid depth.
      const center = computeVertexCentroid(clone);
      const s = GLOBAL_MODEL_SCALE * residualScale;
      clone.scale.set(s, s, s);
      clone.position.set(0, 0, -center.z * s);
    }

    // 2. Apply flat color material
    clone.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = new MeshBasicMaterial({ color: colorHex, side: DoubleSide });
      }
    });

    return clone;
  }, [loaded, colorHex, residualScale, normalizeToFit]);

  return (
    <group position={position}>
      {/* Mirror by negating X scale */}
      <group scale={[mirrored ? -1 : 1, 1, 1]}>
        <group rotation={[0, 0, rotationZ]}>
          <primitive object={normalized} />
        </group>
      </group>
    </group>
  );
}
