import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Box3, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";

/**
 * Global scale factor: maps model units → board SVG units.
 * Calibrated empirically: residualScale 1.5 was needed on top of the previous
 * 2.4672 derived value, so the true scale is 2.4672 × 1.5 = 3.7008.
 */
const GLOBAL_MODEL_SCALE = 3.6508;

interface PieceModel3DProps {
  modelUrl: string;
  colorHex: string;
  pieceId: number;
  position?: [number, number, number];
  rotationZ?: number;
  mirrored?: boolean;
  residualScale?: number;
}

/** Axis correction: match Blender's Z-up to Three.js Y-up. */
const AXIS_CORRECTION_X = Math.PI / 2;

/**
 * Compute vertex centroid of all mesh geometry in the object.
 * Falls back to bbox center if no geometry is found.
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
        sumX += pos.x;
        sumY += pos.y;
        sumZ += pos.z;
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
  pieceId,
  position = [0, 0, 0],
  rotationZ = 0,
  mirrored = false,
  residualScale = 1,
}: Readonly<PieceModel3DProps>) {
  const loaded = useLoader(OBJLoader, modelUrl);

  const normalized = useMemo(() => {
    const clone = loaded.clone(true);

    // 1. Axis correction rotation
    clone.rotation.set(AXIS_CORRECTION_X, 0, 0);
    clone.updateMatrixWorld(true);

    // 2. The OBJ files are pre-centered at the connector midpoint by align_piece_objs.py,
    // so the connector midpoint is exactly at OBJ origin in screen X/Y.
    // For X/Y: use 0 — trust the pre-centering.
    // For Z (depth): use the vertex centroid so the piece sits at the right camera depth.
    const center = computeVertexCentroid(clone);

    // 3. Apply global scale × per-piece residual scale
    const s = GLOBAL_MODEL_SCALE * residualScale;
    clone.scale.set(s, s, s);

    // 4. X/Y stay at 0 (pre-centered); only shift Z
    clone.position.set(0, 0, -center.z * s);

    // 5. Apply material
    clone.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = new MeshBasicMaterial({ color: colorHex, side: DoubleSide });
      }
    });

    return clone;
  }, [loaded, pieceId, colorHex, residualScale]);

  const sx = mirrored ? -1 : 1;

  return (
    <group position={position}>
      <group scale={[sx, 1, 1]}>
        <group rotation={[0, 0, rotationZ]}>
          <primitive object={normalized} />
        </group>
      </group>
    </group>
  );
}
