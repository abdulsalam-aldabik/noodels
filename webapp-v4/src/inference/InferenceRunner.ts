import { InferenceSession, Tensor } from "onnxruntime-web";
import { MODEL_INPUT_SIZE, INFERENCE_TIMEOUT_MS } from "./inferenceTypes";
import type { RawDetection, LetterboxParams } from "./inferenceTypes";
import { decodeDetections } from "./postprocessing";
import type { PostprocessDebug } from "./postprocessing";

const MODEL_URL = "/models/yolo26n-seg.onnx";

export type ModelStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

export interface RunResult {
  detections: RawDetection[];
  debug: PostprocessDebug;
}

export class InferenceRunner {
  private static instance: InferenceRunner | null = null;
  private session: InferenceSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private _status: ModelStatus = { state: "idle" };
  private statusListeners: Array<(s: ModelStatus) => void> = [];

  static getInstance(): InferenceRunner {
    if (!InferenceRunner.instance) InferenceRunner.instance = new InferenceRunner();
    return InferenceRunner.instance;
  }

  get status(): ModelStatus { return this._status; }

  onStatusChange(listener: (s: ModelStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => { this.statusListeners = this.statusListeners.filter((l) => l !== listener); };
  }

  private setStatus(s: ModelStatus): void {
    this._status = s;
    for (const l of this.statusListeners) l(s);
  }

  async load(): Promise<void> {
    if (this.session) return;
    if (this.loadPromise !== null) return this.loadPromise;
    this.setStatus({ state: "loading" });

    this.loadPromise = (async () => {
      try {
        this.session = await InferenceSession.create(MODEL_URL, {
          executionProviders: ["webgl", "wasm"],
          graphOptimizationLevel: "all",
        });
        this.setStatus({ state: "ready" });
      } catch {
        try {
          this.session = await InferenceSession.create(MODEL_URL, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          });
          this.setStatus({ state: "ready" });
        } catch (error_) {
          const msg = error_ instanceof Error ? error_.message : String(error_);
          this.setStatus({ state: "error", message: msg });
          this.loadPromise = null;
          throw new Error(`Model load failed: ${msg}`);
        }
      }
    })();

    return this.loadPromise;
  }

  async run(tensor: Float32Array, params: LetterboxParams): Promise<RunResult> {
    if (!this.session) throw new Error("Model not loaded. Call load() first.");

    const inputTensor = new Tensor("float32", tensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

    const inferencePromise = this.session.run({ images: inputTensor });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Inference timed out after ${INFERENCE_TIMEOUT_MS}ms`)), INFERENCE_TIMEOUT_MS),
    );

    const outputs = await Promise.race([inferencePromise, timeoutPromise]);

    const output0 = outputs["output0"] ?? outputs[Object.keys(outputs)[0]];
    const output1 = outputs["output1"] ?? outputs[Object.keys(outputs)[1]];

    if (!output0 || !output1) {
      throw new Error(
        `Unexpected model outputs: [${Object.keys(outputs).join(", ")}]. ` +
        "Expected 'output0' (detection head) and 'output1' (mask protos).",
      );
    }

    return decodeDetections(output0, output1, params);
  }

  get isReady(): boolean { return this._status.state === "ready"; }
}
