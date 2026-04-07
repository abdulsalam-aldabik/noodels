import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrthographicCamera } from "three";

import type { BoardCoordinator } from "./boardCoordinator";
import { getBoardPieceTuning } from "./boardPieceTuning";
import PieceModel3D from "./PieceModel3D";

interface PlacedModel {
  pieceId: number;
  colorHex: string;
  modelUrl: string;
  centerRow: number;
  centerCol: number;
  rotationSteps: 0 | 1 | 2 | 3;
  mirrored: boolean;
  modelSize: number;
}

interface BoardScene3DProps {
  coordinator: BoardCoordinator;
  placedModels: PlacedModel[];
}

function CameraSync({ coordinator }: { coordinator: BoardCoordinator }) {
  const lastZoom = useRef(0);

  useFrame((state) => {
    const zoom = state.size.width / coordinator.boardSize;
    if (Math.abs(zoom - lastZoom.current) > 0.001) {
      lastZoom.current = zoom;
      (state.camera as OrthographicCamera).zoom = zoom;
      state.camera.updateProjectionMatrix();
    }
  });

  return null;
}

export default function BoardScene3D({
  coordinator,
  placedModels,
}: Readonly<BoardScene3DProps>) {
  return (
    <div className="board-scene-3d">
      <Canvas orthographic camera={{ position: [0, 0, 10], zoom: 1 }} dpr={[1, 1]} frameloop="always">
        <CameraSync coordinator={coordinator} />

        <Suspense fallback={null}>
          {placedModels.map((model) => {
            const world = coordinator.rowColToWorldPoint(model.centerRow, model.centerCol);

            const tuning = getBoardPieceTuning(model.pieceId);
            const totalMirrored = model.mirrored !== tuning.baseMirrored;
            const rawSteps = (model.rotationSteps + tuning.baseRotationSteps + 4) % 4;
            const mirroredAdjustedSteps = ((totalMirrored && tuning.invertRotationWhenMirrored)
              ? (4 - rawSteps) % 4
              : rawSteps);
            const totalSteps = ((totalMirrored && tuning.swapEvenStepsWhenMirrored)
              ? (mirroredAdjustedSteps === 0 ? 2 : mirroredAdjustedSteps === 2 ? 0 : mirroredAdjustedSteps)
              : mirroredAdjustedSteps) as 0 | 1 | 2 | 3;
            const rotationAngle = totalSteps * (Math.PI / 2);

            const markerDiameter = coordinator.cellSize * (17 / 28);
            const baseSize = (Math.max(1, model.modelSize) - 1) * coordinator.cellSize + markerDiameter;
            const targetSize = baseSize * 0.95 * tuning.boardScale;

            return (
              <PieceModel3D
                key={`${model.pieceId}-${model.rotationSteps}-${Number(model.mirrored)}-${model.centerRow}-${model.centerCol}`}
                modelUrl={model.modelUrl}
                colorHex={model.colorHex}
                position={[world.x, world.y, world.z]}
                targetSize={targetSize}
                rotationZ={rotationAngle}
                mirrored={totalMirrored}
                normalizationMode="xy"
              />
            );
          })}
        </Suspense>
      </Canvas>
    </div>
  );
}
