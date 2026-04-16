import { describe, expect, it } from "vitest";

import type { LetterboxInfo } from "../preprocessing";
import {
  END2END_ATTRS,
  MASK_COEFFS,
  postprocessEnd2End,
  type ProtoTensor,
} from "../postprocessing";

const LETTERBOX_INFO: LetterboxInfo = {
  inputSize: 640,
  sourceSize: { width: 640, height: 640 },
  resizedSize: { width: 640, height: 640 },
  scale: 1,
  padX: 0,
  padY: 0,
};

const PROTO: ProtoTensor = {
  data: new Float32Array(MASK_COEFFS * 160 * 160),
  count: MASK_COEFFS,
  height: 160,
  width: 160,
};

describe("postprocessEnd2End", () => {
  it("decodes row-major [numDetections, attrs] outputs", () => {
    const numDetections = 2;
    const attrs = END2END_ATTRS;
    const output = new Float32Array(numDetections * attrs);

    // Detection 0 (kept)
    output[0 * attrs + 0] = 10;
    output[0 * attrs + 1] = 20;
    output[0 * attrs + 2] = 110;
    output[0 * attrs + 3] = 220;
    output[0 * attrs + 4] = 0.85;
    output[0 * attrs + 5] = 11;

    // Detection 1 (filtered by confidence)
    output[1 * attrs + 0] = 100;
    output[1 * attrs + 1] = 100;
    output[1 * attrs + 2] = 130;
    output[1 * attrs + 3] = 130;
    output[1 * attrs + 4] = 0.1;
    output[1 * attrs + 5] = 0;

    const detections = postprocessEnd2End(
      output,
      numDetections,
      attrs,
      PROTO,
      LETTERBOX_INFO,
      0.25,
      false,
    );

    expect(detections).toHaveLength(1);
    expect(detections[0].classId).toBe(11);
    expect(detections[0].className).toBe("board");
    expect(detections[0].score).toBeCloseTo(0.85, 5);
    expect(detections[0].bbox).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 200,
    });
  });

  it("decodes transposed [attrs, numDetections] outputs", () => {
    const numDetections = 2;
    const attrs = END2END_ATTRS;
    const output = new Float32Array(numDetections * attrs);

    const set = (detIdx: number, attrIdx: number, value: number) => {
      output[attrIdx * numDetections + detIdx] = value;
    };

    set(0, 0, 12);
    set(0, 1, 24);
    set(0, 2, 112);
    set(0, 3, 224);
    set(0, 4, 0.9);
    set(0, 5, 12); // hinge

    set(1, 0, 100);
    set(1, 1, 100);
    set(1, 2, 130);
    set(1, 3, 130);
    set(1, 4, 0.1);
    set(1, 5, 0);

    const detections = postprocessEnd2End(
      output,
      numDetections,
      attrs,
      PROTO,
      LETTERBOX_INFO,
      0.25,
      true,
    );

    expect(detections).toHaveLength(1);
    expect(detections[0].classId).toBe(12);
    expect(detections[0].className).toBe("hinge");
    expect(detections[0].bbox).toEqual({
      x: 12,
      y: 24,
      width: 100,
      height: 200,
    });
  });
});
