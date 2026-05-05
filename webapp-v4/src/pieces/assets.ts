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
  // Colors calibrated from phone camera captures (median of 3 scans, 2026-04-29)
  { pieceId: 0,  index: 0,  key: "J", colorName: "DarkRed",     colorRgb: [0x62, 0x24, 0x34], colorHex: "#622434", objUrl: "/models/piece_J.obj" },
  { pieceId: 1,  index: 1,  key: "C", colorName: "DarkBlue",    colorRgb: [0x14, 0x35, 0x9a], colorHex: "#14359A", objUrl: "/models/piece_C.obj" },
  { pieceId: 2,  index: 2,  key: "H", colorName: "Purple",      colorRgb: [0x6f, 0x47, 0x92], colorHex: "#6F4792", objUrl: "/models/piece_H.obj" },
  { pieceId: 3,  index: 3,  key: "B", colorName: "SkyBlue",     colorRgb: [0x05, 0x52, 0xa6], colorHex: "#0552A6", objUrl: "/models/piece_B.obj" },
  { pieceId: 4,  index: 4,  key: "A", colorName: "Yellow",      colorRgb: [0x8b, 0x8b, 0x1a], colorHex: "#8B8B1A", objUrl: "/models/piece_A.obj" },
  { pieceId: 5,  index: 5,  key: "K", colorName: "YellowGreen", colorRgb: [0x43, 0x8e, 0x2f], colorHex: "#438E2F", objUrl: "/models/piece_K.obj" },
  { pieceId: 6,  index: 6,  key: "I", colorName: "Orange",      colorRgb: [0x96, 0x52, 0x12], colorHex: "#965212", objUrl: "/models/piece_I.obj" },
  { pieceId: 7,  index: 7,  key: "G", colorName: "Pink",        colorRgb: [0x86, 0x37, 0x6d], colorHex: "#86376D", objUrl: "/models/piece_G.obj" },
  { pieceId: 8,  index: 8,  key: "D", colorName: "Green",       colorRgb: [0x11, 0x68, 0x45], colorHex: "#116845", objUrl: "/models/piece_D.obj" },
  { pieceId: 9,  index: 9,  key: "F", colorName: "Teal",        colorRgb: [0x3a, 0x7c, 0x68], colorHex: "#3A7C68", objUrl: "/models/piece_F.obj" },
  { pieceId: 10, index: 10, key: "E", colorName: "Red",         colorRgb: [0x7e, 0x1d, 0x23], colorHex: "#7E1D23", objUrl: "/models/piece_E.obj" },
];

export const PIECE_ASSET_BY_ID: Record<number, PieceAsset> = Object.fromEntries(
  PIECE_ASSETS.map((asset) => [asset.pieceId, asset]),
) as Record<number, PieceAsset>;
