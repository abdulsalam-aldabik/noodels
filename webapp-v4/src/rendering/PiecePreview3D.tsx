import { Suspense } from "react";
import { View, OrthographicCamera } from "@react-three/drei";

import PieceModel3D from "./PieceModel3D";

interface PiecePreview3DProps {
  modelUrl: string;
  colorHex: string;
}

/**
 * Renders a piece thumbnail inside the shared inventory WebGL context (SharedInventoryCanvas).
 *
 * When rendered outside a Canvas, drei's View uses HtmlView: it creates its own
 * tracking <div className="piece-preview-3d"> and sends a CanvasView through the
 * tunnel-rat tunnel to View.Port inside SharedInventoryCanvas. The canvas scissor-renders
 * the model into the exact screen rect of that div — no separate WebGL context per piece.
 *
 * Key: do NOT wrap in your own div — HtmlView must own the tracking element so it
 * has the correct screen size for the scissor rect. Pass className directly to View.
 */
export default function PiecePreview3D({ modelUrl, colorHex }: Readonly<PiecePreview3DProps>) {
  return (
    <View className="piece-preview-3d">
      {/*
        zoom=90: visible world = pixelSize / 90.
        On a 150px div: 150/90 ≈ 1.67 units visible, so a 1-unit normalized
        model fills ~60% — consistent across all 11 pieces.
        prepareSkissor (inside View) sets the camera frustum to pixel dimensions
        and leaves zoom intact, so this calculation holds.
      */}
      <OrthographicCamera makeDefault position={[0, 0, 5]} zoom={90} />
      <Suspense fallback={null}>
        <PieceModel3D modelUrl={modelUrl} colorHex={colorHex} normalizeToFit />
      </Suspense>
    </View>
  );
}
