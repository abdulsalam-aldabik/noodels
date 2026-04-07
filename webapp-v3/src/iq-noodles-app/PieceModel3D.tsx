import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from "three";

interface PieceModel3DProps {
  modelUrl: string;
  colorHex: string;
  targetSize?: number;
  position?: [number, number, number];
  rotationZ?: number;
  mirrored?: boolean;
  normalizationMode?: "xy" | "xyz";
}

export default function PieceModel3D({
  modelUrl,
  colorHex,
  targetSize = 1,
  position = [0, 0, 0],
  rotationZ = 0,
  mirrored = false,
  normalizationMode = "xyz",
}: Readonly<PieceModel3DProps>) {
  const loaded = useLoader(OBJLoader, modelUrl);

  const normalized = useMemo(() => {
    const clone = loaded.clone(true);
    clone.updateMatrixWorld(true);

    const box = new Box3().setFromObject(clone);
    const size = new Vector3();
    box.getSize(size);
    const normalizationAxis = normalizationMode === "xy"
      ? Math.max(size.x, size.y)
      : Math.max(size.x, size.y, size.z);
    const uniformScale = targetSize / (normalizationAxis || 1);

    clone.scale.set(uniformScale, uniformScale, uniformScale);

    const centeredBox = new Box3().setFromObject(clone);
    const center = new Vector3();
    centeredBox.getCenter(center);
    clone.position.sub(center);

    clone.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = new MeshBasicMaterial({ color: colorHex, side: DoubleSide });
      }
    });

    return clone;
  }, [colorHex, loaded, normalizationMode, targetSize]);

  const sx = mirrored ? -1 : 1;
  // OBJ exports are authored in a different up-axis; rotate once so top-view camera sees the full shape.
  const axisCorrectionX = Math.PI / 2;

  return (
    <group position={position}>
      <group scale={[sx, 1, 1]}>
        <group rotation={[0, 0, rotationZ]}>
          <group rotation={[axisCorrectionX, 0, 0]}>
            <primitive object={normalized} />
          </group>
        </group>
      </group>
    </group>
  );
}
