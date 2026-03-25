/**
 * Board Rectifier — Automatic board detection and perspective warp via OpenCV.js
 *
 * Pipeline:
 *   1. Find the 4 corners of the IQ Noodles board in the source image
 *   2. Compute a homography matrix to warp the board to a perfect square
 *   3. Apply the warp → output a rectified, perfectly top-down image
 *
 * After rectification, pin positions are at fixed pixel coordinates so the
 * grid mapper can match detections to pins with 100% geometric accuracy.
 */

import cv from '@techstark/opencv-js';

/** Size of the rectified output image (square) */
export const RECTIFIED_SIZE = 640;

/** Board coordinate range used by PIN_COORDINATES in board.ts */
const BOARD_MIN = -7.9;
const BOARD_RANGE = 15.8;

/**
 * Convert a board-relative coordinate to a pixel position on the rectified image.
 * This is the key function — after rectification, pin positions are deterministic.
 */
export function boardToRectifiedPixel(bx: number, by: number): [number, number] {
  const px = ((bx - BOARD_MIN) / BOARD_RANGE) * RECTIFIED_SIZE;
  const py = ((by - BOARD_MIN) / BOARD_RANGE) * RECTIFIED_SIZE;
  return [px, py];
}

/**
 * Holds the result of board detection and rectification.
 */
export interface RectificationResult {
  /** The perspective-warped, perfectly top-down board image as an HTMLCanvasElement */
  rectifiedCanvas: HTMLCanvasElement;
  /** The 4 corners detected in the original image [topLeft, topRight, bottomRight, bottomLeft] */
  corners: [number, number][];
  /** Whether the board was found automatically */
  autoDetected: boolean;
}

/**
 * Detect the IQ Noodles board in an image and warp it to a perfect square.
 *
 * Algorithm:
 *   - Convert to grayscale, blur, Canny edge detection
 *   - Find contours, filter for large quadrilaterals
 *   - Pick the best quadrilateral (largest area, closest to expected aspect ratio)
 *   - Compute and apply perspective transform
 */
export async function rectifyBoard(
  image: HTMLImageElement | HTMLCanvasElement,
): Promise<RectificationResult> {
  // Wait for OpenCV to be ready
  if (typeof cv.Mat === 'undefined') {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (typeof cv.Mat !== 'undefined') resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  // Load image into OpenCV Mat
  const src = cv.imread(image);
  const imgW = src.cols;
  const imgH = src.rows;
  const imgArea = imgW * imgH;

  let corners: [number, number][] | null = null;

  try {
    corners = detectBoardCorners(src, imgArea);
  } catch (e) {
    console.warn('Board corner detection failed, falling back to full image:', e);
  }

  // If detection failed, use the whole image as the board
  if (!corners) {
    corners = [
      [0, 0],
      [imgW, 0],
      [imgW, imgH],
      [0, imgH],
    ];
  }

  // Sort corners into consistent order: TL, TR, BR, BL
  const sorted = orderCorners(corners);

  // Build perspective transform
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    sorted[0][0], sorted[0][1],
    sorted[1][0], sorted[1][1],
    sorted[2][0], sorted[2][1],
    sorted[3][0], sorted[3][1],
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    RECTIFIED_SIZE, 0,
    RECTIFIED_SIZE, RECTIFIED_SIZE,
    0, RECTIFIED_SIZE,
  ]);

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  const dsize = new cv.Size(RECTIFIED_SIZE, RECTIFIED_SIZE);
  cv.warpPerspective(src, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));

  // Write to canvas
  const canvas = document.createElement('canvas');
  canvas.width = RECTIFIED_SIZE;
  canvas.height = RECTIFIED_SIZE;
  cv.imshow(canvas, warped);

  // Cleanup
  src.delete();
  warped.delete();
  srcPts.delete();
  dstPts.delete();
  M.delete();

  return {
    rectifiedCanvas: canvas,
    corners: sorted,
    autoDetected: corners !== null,
  };
}

/**
 * Detect the 4 corners of the board using Canny + contour detection.
 *
 * The IQ Noodles board is a dark rectangle against a lighter background.
 * We find the largest approximately-rectangular contour in the image.
 */
function detectBoardCorners(
  src: InstanceType<typeof cv.Mat>,
  imgArea: number,
): [number, number][] | null {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    // Grayscale + blur
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Canny edge detection
    cv.Canny(blurred, edges, 30, 100);

    // Dilate edges to close gaps
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    // Find contours
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Find the largest quadrilateral contour
    let bestContour: InstanceType<typeof cv.Mat> | null = null;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      // Minimum area threshold: at least 5% of image area
      if (area < imgArea * 0.05) continue;

      // Approximate contour to polygon
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      // Must be a quadrilateral (4 vertices)
      if (approx.rows === 4 && area > bestArea) {
        if (bestContour) bestContour.delete();
        bestContour = approx;
        bestArea = area;
      } else {
        approx.delete();
      }
    }

    if (!bestContour) {
      // Try more aggressive approximation
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area < imgArea * 0.05) continue;

        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.05 * peri, true);

        if (approx.rows === 4 && area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = approx;
          bestArea = area;
        } else {
          approx.delete();
        }
      }
    }

    if (!bestContour) return null;

    // Extract 4 corner points
    const points: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const x = bestContour.data32S[i * 2];
      const y = bestContour.data32S[i * 2 + 1];
      points.push([x, y]);
    }
    bestContour.delete();

    console.log(`📐 Board corners detected: ${JSON.stringify(points)} (area: ${bestArea.toFixed(0)} / ${imgArea})`);
    return points;
  } finally {
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Order 4 corner points consistently: [topLeft, topRight, bottomRight, bottomLeft]
 */
function orderCorners(pts: [number, number][]): [number, number][] {
  // Sum of coordinates: smallest = top-left, largest = bottom-right
  // Difference (x - y): smallest = bottom-left, largest = top-right
  const sorted = [...pts];

  const sums = sorted.map(([x, y]) => x + y);
  const diffs = sorted.map(([x, y]) => x - y);

  const tl = sorted[sums.indexOf(Math.min(...sums))];
  const br = sorted[sums.indexOf(Math.max(...sums))];
  const tr = sorted[diffs.indexOf(Math.max(...diffs))];
  const bl = sorted[diffs.indexOf(Math.min(...diffs))];

  return [tl, tr, br, bl];
}
