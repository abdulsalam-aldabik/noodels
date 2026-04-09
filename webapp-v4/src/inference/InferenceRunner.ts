import { InferenceSession, Tensor } from "onnxruntime-web";
import { MODEL_INPUT_SIZE, INFERENCE_TIMEOUT_MS } from "./inferenceTypes";
import type { RawDetection, LetterboxParams } from "./inferenceTypes";
import { decodeDetections } from "./postprocessing";

// The ONNX model must be placed at public/models/yolo26n-seg.onnx
const MODEL_URL = "/models/yolo26n-seg.onnx";

export type ModelStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

/**
 * Singleton ONNX inference session manager.
 *
 * Usage:
 *   const runner = InferenceRunner.getInstance();
 *   await runner.load();               // call once at app start
 *   const detections = await runner.run(tensor, params);
 */
export class InferenceRunner {
  private static instance: InferenceRunner | null = null;

  private session: InferenceSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private _status: ModelStatus = { state: "idle" };
  private statusListeners: Array<(s: ModelStatus) => void> = [];

  static getInstance(): InferenceRunner {
    if (!InferenceRunner.instance) {
      InferenceRunner.instance = new InferenceRunner();
    }
    return InferenceRunner.instance;
  }

  get status(): ModelStatus {
    return this._status;
  }

  onStatusChange(listener: (s: ModelStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(s: ModelStatus): void {
    this._status = s;
    for (const l of this.statusListeners) l(s);
  }

  /**
   * Loads the ONNX model. Safe to call multiple times — subsequent calls return
   * the same promise. Prefers WebGL execution provider, falls back to WASM.
   */
  async load(): Promise<void> {
    if (this.session) return;
    if (this.loadPromise) return this.loadPromise;

    this.setStatus({ state: "loading" });

    this.loadPromise = (async () => {
      try {
        // Try WebGL first (GPU acceleration on mobile), fall back to WASM
        this.session = await InferenceSession.create(MODEL_URL, {
          executionProviders: ["webgl", "wasm"],
          graphOptimizationLevel: "all",
        });
        this.setStatus({ state: "ready" });
      } catch (err) {
        // WebGL may fail on some browsers — try WASM only
        try {
          this.session = await InferenceSession.create(MODEL_URL, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          });
          this.setStatus({ state: "ready" });
        } catch (err2) {
          const message = err2 instanceof Error ? err2.message : String(err2);
          this.setStatus({ state: "error", message });
          this.loadPromise = null;
          throw new Error(`Model load failed: ${message}`);
        }
      }
    })();

    return this.loadPromise;
  }

  /**
   * Runs inference on a preprocessed tensor.
   *
   * @param tensor - Float32Array in NCHW [1,3,640,640] layout
   * @param params - Letterbox parameters from preprocessing
   * @returns Decoded, NMS-filtered detections in original image space
   * @throws If model not loaded, or if inference exceeds INFERENCE_TIMEOUT_MS
   */
  async run(tensor: Float32Array, params: LetterboxParams): Promise<RawDetection[]> {
    if (!this.session) {
      throw new Error("Model not loaded. Call load() before run().");
    }

    const inputTensor = new Tensor("float32", tensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

    // Race inference against a hard timeout
    const inferencePromise = this.session.run({ images: inputTensor });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Inference timed out after ${INFERENCE_TIMEOUT_MS}ms`)), INFERENCE_TIMEOUT_MS),
    );

    const outputs = await Promise.race([inferencePromise, timeoutPromise]);

    // Retrieve output tensors. The exact output names depend on how the model was exported.
    // Standard YOLOv8-seg exports use 'output0' and 'output1'.
    const output0 = outputs["output0"] ?? outputs[Object.keys(outputs)[0]];
    const output1 = outputs["output1"] ?? outputs[Object.keys(outputs)[1]];

    if (!output0 || !output1) {
      throw new Error(
        `Unexpected model output names: ${Object.keys(outputs).join(", ")}. ` +
        "Expected 'output0' (detection head) and 'output1' (mask protos).",
      );
    }

    return decodeDetections(output0, output1, params);
  }

  /** True if the model is loaded and ready to run. */
  get isReady(): boolean {
    return this._status.state === "ready";
  }
}
