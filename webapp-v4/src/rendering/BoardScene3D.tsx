import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrthographicCamera } from "three";

import type { BoardCoordinator } from "../board/BoardCoordinator";
import { getPieceTuning } from "../pieces/tuning";
import PieceModel3D from "./PieceModel3D";

export interface PlacedModel {
  pieceId: number;
  colorHex: string;
  modelUrl: string;
  centerRow: number;
  centerCol: number;
  rotationSteps: 0 | 1 | 2 | 3;
  mirrored: boolean;
  orientationIndex: number;
  residualOffsetX?: number;
  residualOffsetY?: number;
  residualScale?: number;
}

interface BoardScene3DProps {
  coordinator: BoardCoordinator;
  placedModels: PlacedModel[];
}

/** Keeps the orthographic camera zoom locked to the board's pixel density. */
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

export default function BoardScene3D({ coordinator, placedModels }: Readonly<BoardScene3DProps>) {
  return (
    <div className="board-scene-3d">
      <Canvas orthographic camera={{ position: [0, 0, 10], zoom: 1 }} dpr={[1, 1]} frameloop="always">
        <CameraSync coordinator={coordinator} />

        <Suspense fallback={null}>
          {placedModels.map((model) => {
            const tuning = getPieceTuning(model.pieceId);

            // Combine logical orientation with the model's base orientation.
            const totalMirrored = model.mirrored !== tuning.baseMirrored;
            const rawSteps = (model.rotationSteps + tuning.baseRotationSteps + 4) % 4;
            const mirroredAdjustedSteps = (totalMirrored && tuning.invertRotationWhenMirrored)
              ? (4 - rawSteps) % 4
              : rawSteps;
            const totalSteps = ((totalMirrored && tuning.swapEvenStepsWhenMirrored)
              ? (mirroredAdjustedSteps === 0 ? 2 : mirroredAdjustedSteps === 2 ? 0 : mirroredAdjustedSteps)
              : mirroredAdjustedSteps) as 0 | 1 | 2 | 3;
            const rotationAngle = totalSteps * (Math.PI / 2);

            // World position + per-orientation offset correction.
            const world = coordinator.rowColToWorldPoint(model.centerRow, model.centerCol);
            const perOrientation = (model.residualOffsetX !== undefined || model.residualOffsetY !== undefined)
              ? { x: model.residualOffsetX ?? 0, y: model.residualOffsetY ?? 0 }
              : (tuning.orientationOffsets?.[model.orientationIndex] ?? { x: 0, y: 0 });
            const worldOffsetX = perOrientation.x * coordinator.cellSize;
            const worldOffsetY = perOrientation.y * coordinator.cellSize;
            const scale = model.residualScale ?? tuning.residualScale ?? 1;

            return (
              <PieceModel3D
                key={`${model.pieceId}-${model.rotationSteps}-${Number(model.mirrored)}-${model.centerRow}-${model.centerCol}`}
                modelUrl={model.modelUrl}
                colorHex={model.colorHex}
                position={[world.x + worldOffsetX, world.y + worldOffsetY, world.z]}
                rotationZ={rotationAngle}
                mirrored={totalMirrored}
                residualScale={scale}
              />
            );
          })}
        </Suspense>
      </Canvas>
    </div>
  );
}
