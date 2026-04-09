import { Canvas } from "@react-three/fiber";
import { View } from "@react-three/drei";

/**
 * Single shared WebGL context for all inventory piece thumbnails.
 *
 * Mobile browsers cap WebGL contexts at ~8 (Safari iOS) to ~16 (Android Chrome).
 * 11 separate <Canvas> elements would hit that limit and cause random blank renders.
 *
 * This fixed-position canvas uses @react-three/drei <View> to scissor-render each
 * piece into its tracked DOM element — all from one context.
 */
export default function SharedInventoryCanvas() {
  return (
    <Canvas
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 200,
      }}
      gl={{ antialias: false, powerPreference: "low-power", alpha: true }}
      dpr={[1, 1.5]}
      frameloop="always"
    >
      <View.Port />
    </Canvas>
  );
}
