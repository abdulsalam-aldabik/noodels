export type PieceKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";

export interface PieceAsset {
  pieceId: number;
  index: number;
  key: PieceKey;
  colorName: string;
  colorRgb: [number, number, number];
  colorHex: string;
  objUrl: string;
}

export const PIECE_ASSETS: PieceAsset[] = [
  // Colors calibrated from phone camera captures (auto-extracted, 2026-05-06)
  { pieceId: 0,  index: 0,  key: "J", colorName: "DarkRed",     colorRgb: [0x62, 0x24, 0x34], colorHex: "#622434", objUrl: "/models/piece_J.obj" },
  { pieceId: 1,  index: 1,  key: "C", colorName: "DarkBlue",    colorRgb: [0x0d, 0x36, 0x8e], colorHex: "#0D368E", objUrl: "/models/piece_C.obj" },
  { pieceId: 2,  index: 2,  key: "H", colorName: "Purple",      colorRgb: [0x5b, 0x43, 0x82], colorHex: "#5B4382", objUrl: "/models/piece_H.obj" },
  { pieceId: 3,  index: 3,  key: "B", colorName: "SkyBlue",     colorRgb: [0x0a, 0x61, 0x9d], colorHex: "#0A619D", objUrl: "/models/piece_B.obj" },
  { pieceId: 4,  index: 4,  key: "A", colorName: "Yellow",      colorRgb: [0x8b, 0x8b, 0x1a], colorHex: "#8B8B1A", objUrl: "/models/piece_A.obj" },
  { pieceId: 5,  index: 5,  key: "K", colorName: "YellowGreen", colorRgb: [0x4c, 0x7c, 0x30], colorHex: "#4C7C30", objUrl: "/models/piece_K.obj" },
  { pieceId: 6,  index: 6,  key: "I", colorName: "Orange",      colorRgb: [0x96, 0x52, 0x12], colorHex: "#965212", objUrl: "/models/piece_I.obj" },
  { pieceId: 7,  index: 7,  key: "G", colorName: "Pink",        colorRgb: [0x6b, 0x3d, 0x6e], colorHex: "#6B3D6E", objUrl: "/models/piece_G.obj" },
  { pieceId: 8,  index: 8,  key: "D", colorName: "Green",       colorRgb: [0x11, 0x68, 0x45], colorHex: "#116845", objUrl: "/models/piece_D.obj" },
  { pieceId: 9,  index: 9,  key: "F", colorName: "Teal",        colorRgb: [0x56, 0x80, 0x8a], colorHex: "#56808A", objUrl: "/models/piece_F.obj" },
  { pieceId: 10, index: 10, key: "E", colorName: "Red",         colorRgb: [0x5e, 0x0d, 0x0f], colorHex: "#5E0D0F", objUrl: "/models/piece_E.obj" },
];

export const PIECE_ASSET_BY_ID: Record<number, PieceAsset> = Object.fromEntries(
  PIECE_ASSETS.map((asset) => [asset.pieceId, asset]),
) as Record<number, PieceAsset>;
