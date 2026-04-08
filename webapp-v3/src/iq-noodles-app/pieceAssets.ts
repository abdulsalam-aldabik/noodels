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
  { pieceId: 0, index: 0, key: "J", colorName: "DarkRed", colorRgb: [0xb6, 0x30, 0x48], colorHex: "#B63048", objUrl: "/models/piece_J.obj" },
  { pieceId: 1, index: 1, key: "C", colorName: "DarkBlue", colorRgb: [0x20, 0x6d, 0xd9], colorHex: "#206DD9", objUrl: "/models/piece_C.obj" },
  { pieceId: 2, index: 2, key: "H", colorName: "Purple", colorRgb: [0xc7, 0x78, 0xb9], colorHex: "#C778B9", objUrl: "/models/piece_H.obj" },
  { pieceId: 3, index: 3, key: "B", colorName: "SkyBlue", colorRgb: [0x08, 0xa7, 0xe8], colorHex: "#08A7E8", objUrl: "/models/piece_B.obj" },
  { pieceId: 4, index: 4, key: "A", colorName: "Yellow", colorRgb: [0xf9, 0xd6, 0x5e], colorHex: "#F9D65E", objUrl: "/models/piece_A.obj" },
  { pieceId: 5, index: 5, key: "K", colorName: "YellowGreen", colorRgb: [0x95, 0xd4, 0x50], colorHex: "#95D450", objUrl: "/models/piece_K.obj" },
  { pieceId: 6, index: 6, key: "I", colorName: "Orange", colorRgb: [0xfc, 0x69, 0x0c], colorHex: "#FC690C", objUrl: "/models/piece_I.obj" },
  { pieceId: 7, index: 7, key: "G", colorName: "Pink", colorRgb: [0xec, 0x71, 0xa8], colorHex: "#EC71A8", objUrl: "/models/piece_G.obj" },
  { pieceId: 8, index: 8, key: "D", colorName: "Green", colorRgb: [0x1f, 0xa1, 0x5b], colorHex: "#1FA15B", objUrl: "/models/piece_D.obj" },
  { pieceId: 9, index: 9, key: "F", colorName: "Teal", colorRgb: [0x85, 0xda, 0xbb], colorHex: "#85DABB", objUrl: "/models/piece_F.obj" },
  { pieceId: 10, index: 10, key: "E", colorName: "Red", colorRgb: [0xee, 0x39, 0x4f], colorHex: "#EE394F", objUrl: "/models/piece_E.obj" },
];

export const PIECE_ASSET_BY_ID: Record<number, PieceAsset> = Object.fromEntries(
  PIECE_ASSETS.map((asset) => [asset.pieceId, asset]),
) as Record<number, PieceAsset>;
