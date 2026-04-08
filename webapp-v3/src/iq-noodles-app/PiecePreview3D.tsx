import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";

import PieceModel3D from "./PieceModel3D";

interface PiecePreview3DProps {
  modelUrl: string;
  colorHex: string;
}

/**
 * Small 3D preview of a piece in the inventory sidebar.
 * Uses a fixed scale since this is just a thumbnail — no board alignment needed.
 */
export default function PiecePreview3D({ modelUrl, colorHex }: PiecePreview3DProps) {
  return (
    <div className="piece-preview-3d">
      <Canvas orthographic camera={{ position: [0, 0, 3], zoom: 130 }} dpr={[1, 1]} frameloop="demand">
        <Suspense fallback={null}>
          <PieceModel3D
            modelUrl={modelUrl}
            colorHex={colorHex}
            pieceId={-1}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
