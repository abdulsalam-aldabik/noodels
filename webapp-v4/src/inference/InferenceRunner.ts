import * as ort from "onnxruntime-web";

import {
  CLASS_NAMES,
  type InferenceResult,
  type RawDetection,
} from "./types";
import { MODEL_INPUT_SIZE, imageToTensor } from "./preprocessing";
import {
  DEFAULT_CONF_THRESHOLD,
  DEFAULT_IOU_THRESHOLD,
  END2END_ATTRS,
  MASK_COEFFS,
  postprocess,
  postprocessEnd2End,
  type ProtoTensor,
} from "./postprocessing";

export const DEFAULT_MODEL_PATH = "/models/yolo26n-seg.onnx";

export interface InferenceRunnerOptions {
  modelPath?: string;
  confThreshold?: number;
  iouThreshold?: number;
  executionProviders?: ort.InferenceSession.ExecutionProviderConfig[];
}

/**
 * Thin wrapper around onnxruntime-web that owns the model session and performs
 * a single preprocess -> run -> postprocess pass per image. Session creation is
 * deferred to the first `run()` call so the caller controls initialization
 * timing.
 */
export class InferenceRunner {
  private session: ort.InferenceSession | null = null;
  private readonly modelPath: string;
  private readonly confThreshold: number;
  private readonly iouThreshold: number;
  private readonly executionProviders: ort.InferenceSession.ExecutionProviderConfig[];

  constructor(options: InferenceRunnerOptions = {}) {
    this.modelPath = options.modelPath ?? DEFAULT_MODEL_PATH;
    this.confThreshold = options.confThreshold ?? DEFAULT_CONF_THRESHOLD;
    this.iouThreshold = options.iouThreshold ?? DEFAULT_IOU_THRESHOLD;
    this.executionProviders = options.executionProviders ?? ["wasm"];
  }

  async ensureLoaded(): Promise<void> {
    if (this.session) return;
    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: this.executionProviders,
      graphOptimizationLevel: "all",
    });
  }

  get isLoaded(): boolean {
    return this.session !== null;
  }

  async run(
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  ): Promise<InferenceResult> {
    await this.ensureLoaded();
    const session = this.session;
    if (!session) throw new Error("InferenceRunner: session not initialized");

    const t0 = performance.now();
    const { tensor, info } = imageToTensor(image, MODEL_INPUT_SIZE);
    const inputTensor = new ort.Tensor("float32", tensor, [
      1,
      3,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
    ]);

    const inputName = session.inputNames[0];
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const outputs = await session.run(feeds);

    // output0: either raw head [1, 4+numClasses+32, numAnchors]
    //          or end-to-end [1, numDetections, 6+32] (or transposed)
    // output1: mask protos [1, 32, protoH, protoW]
    const [output0Name, output1Name] = session.outputNames;
    const det = outputs[output0Name];
    const proto = outputs[output1Name];
    if (!det || !proto) {
      throw new Error("InferenceRunner: missing expected output tensors");
    }

    const detDims = det.dims;
    const protoDims = proto.dims;

    if (detDims.length !== 3) {
      throw new Error(
        `InferenceRunner: unsupported output0 rank ${detDims.length}; expected rank 3`,
      );
    }

    const protoTensor: ProtoTensor = {
      data: proto.data as Float32Array,
      count: protoDims[1],
      height: protoDims[2],
      width: protoDims[3],
    };

    const detData = det.data as Float32Array;
    let detections: RawDetection[] = [];

    if (detDims[2] >= END2END_ATTRS && detDims[2] <= END2END_ATTRS + 4) {
      detections = postprocessEnd2End(
        detData,
        detDims[1],
        detDims[2],
        protoTensor,
        info,
        this.confThreshold,
        false,
      );
    } else if (detDims[1] >= END2END_ATTRS && detDims[1] <= END2END_ATTRS + 4) {
      detections = postprocessEnd2End(
        detData,
        detDims[2],
        detDims[1],
        protoTensor,
        info,
        this.confThreshold,
        true,
      );
    } else {
      const channels = detDims[1];
      const numAnchors = detDims[2];
      const numClasses = channels - 4 - MASK_COEFFS;
      if (numClasses !== CLASS_NAMES.length) {
        // Not fatal for raw-mode models; labels still map in-range classes.
        console.warn(
          `InferenceRunner: model outputs ${numClasses} classes, expected ${CLASS_NAMES.length}`,
        );
      }

      detections = postprocess(
        detData,
        protoTensor,
        numClasses,
        numAnchors,
        info,
        this.confThreshold,
        this.iouThreshold,
      );
    }

    const t1 = performance.now();
    return {
      modelPath: this.modelPath,
      imageSize: info.sourceSize,
      detections,
      durationMs: t1 - t0,
    };
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}
