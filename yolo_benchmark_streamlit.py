#!/usr/bin/env python3
"""
Comprehensive Streamlit benchmark app for YOLO ONNX segmentation/detection models.

Run:
  .\venv-streamlit311\Scripts\streamlit.exe run yolo_benchmark_streamlit.py

What it does:
- Loads an ONNX YOLO model (segmentation with proto output supported)
- Benchmarks inference on any image directory (recursive optional)
- Supports stress runs (multiple passes per image)
- Optional ground-truth evaluation from YOLO label files
- Visualizes latency, throughput, detections, classes, and qualitative overlays
- Exports raw results, summary CSV, and JSON report
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import io
import json
import time
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
import pandas as pd
import streamlit as st
import matplotlib.pyplot as plt


MODEL_INPUT_SIZE = 640
DEFAULT_CONF = 0.30
DEFAULT_MASK_THRESH = 0.50
DEFAULT_IOU_THRESH = 0.50
SUPPORTED_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")

# Default class names for the current IQ Noodles model (13 classes).
DEFAULT_CLASS_NAMES = [
    "A_Yellow",
    "B_SkyBlue",
    "C_DarkBlue",
    "D_Green",
    "E_Red",
    "F_Teal",
    "G_Pink",
    "H_Purple",
    "I_Orange",
    "J_DarkRed",
    "K_YellowGreen",
    "board",
    "hinge",
]

DEFAULT_CLASS_COLORS = [
    (249, 214, 94),
    (8, 167, 232),
    (32, 109, 217),
    (31, 161, 91),
    (238, 57, 79),
    (133, 218, 187),
    (236, 113, 168),
    (199, 120, 185),
    (252, 105, 12),
    (182, 48, 72),
    (149, 212, 80),
    (120, 120, 120),
    (210, 210, 210),
]


@dataclass
class InferenceTiming:
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float
    total_ms: float


@st.cache_resource
def load_model(model_path: str):
    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model_path, sess_options=sess_opts, providers=["CPUExecutionProvider"])
    meta = {
        "inputs": [(i.name, i.shape, i.type) for i in session.get_inputs()],
        "outputs": [(o.name, o.shape, o.type) for o in session.get_outputs()],
    }
    return session, meta


def preprocess(image_rgb: np.ndarray, model_size: int = MODEL_INPUT_SIZE):
    orig_h, orig_w = image_rgb.shape[:2]
    scale = min(model_size / orig_w, model_size / orig_h)
    new_w = int(round(orig_w * scale))
    new_h = int(round(orig_h * scale))
    pad_x = (model_size - new_w) // 2
    pad_y = (model_size - new_h) // 2

    resized = cv2.resize(image_rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((model_size, model_size, 3), 114, dtype=np.uint8)
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

    blob = canvas.astype(np.float32) / 255.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]

    return blob, scale, pad_x, pad_y, orig_w, orig_h


def infer_num_classes(row_len: int, num_protos: int) -> int:
    # Expected row format: [x1, y1, x2, y2, score, class_id, ...proto_coeffs]
    # So classes are not one-hot in this exported format.
    _ = row_len
    _ = num_protos
    return max(len(DEFAULT_CLASS_NAMES), 1)


def decode_detections(output0: np.ndarray, scale: float, pad_x: int, pad_y: int, conf_thresh: float):
    data = output0[0]
    detections: list[dict[str, Any]] = []

    if data.ndim != 2 or data.shape[1] < 6:
        return detections

    row_len = data.shape[1]
    # For this export, last values are proto coeffs.
    # If no proto coeffs exist, this still works as pure detection.
    coeff_start = 6

    for i in range(data.shape[0]):
        row = data[i]
        x1, y1, x2, y2 = map(float, row[0:4])
        score = float(row[4])
        class_id = int(round(float(row[5])))

        if score < conf_thresh:
            continue
        if class_id < 0:
            continue

        bx1 = (x1 - pad_x) / scale
        by1 = (y1 - pad_y) / scale
        bx2 = (x2 - pad_x) / scale
        by2 = (y2 - pad_y) / scale

        mask_coeffs = row[coeff_start:row_len].copy() if row_len > coeff_start else np.array([], dtype=np.float32)

        detections.append(
            {
                "class_id": class_id,
                "confidence": score,
                "bbox": [bx1, by1, bx2, by2],
                "mask_coeffs": mask_coeffs,
            }
        )

    return detections


def decode_masks(
    output1: np.ndarray,
    detections: list[dict[str, Any]],
    scale: float,
    pad_x: int,
    pad_y: int,
    orig_w: int,
    orig_h: int,
    mask_thresh: float,
):
    if output1 is None or output1.ndim != 4:
        return

    # proto shape: (1, nm, mh, mw)
    protos = output1[0]
    num_protos, proto_h, proto_w = protos.shape
    ratio_x = proto_w / MODEL_INPUT_SIZE
    ratio_y = proto_h / MODEL_INPUT_SIZE

    for det in detections:
        coeffs = det.get("mask_coeffs", np.array([], dtype=np.float32))
        if coeffs.size == 0:
            det["mask"] = np.zeros((orig_h, orig_w), dtype=np.uint8)
            continue

        if coeffs.size != num_protos:
            # If exported output layout differs from expected, skip mask decode safely.
            det["mask"] = np.zeros((orig_h, orig_w), dtype=np.uint8)
            continue

        mask_proto = np.einsum("i,ijk->jk", coeffs, protos)
        mask_proto = 1.0 / (1.0 + np.exp(-mask_proto))

        x1, y1, x2, y2 = det["bbox"]
        bx1 = max(0, int((x1 * scale + pad_x) * ratio_x))
        by1 = max(0, int((y1 * scale + pad_y) * ratio_y))
        bx2 = min(proto_w, int(np.ceil((x2 * scale + pad_x) * ratio_x)))
        by2 = min(proto_h, int(np.ceil((y2 * scale + pad_y) * ratio_y)))

        cropped = np.zeros_like(mask_proto)
        cropped[by1:by2, bx1:bx2] = mask_proto[by1:by2, bx1:bx2]

        src_x = int(pad_x * ratio_x)
        src_y = int(pad_y * ratio_y)
        src_w = int(orig_w * scale * ratio_x)
        src_h = int(orig_h * scale * ratio_y)

        src_x = max(0, src_x)
        src_y = max(0, src_y)
        src_w = min(proto_w - src_x, src_w)
        src_h = min(proto_h - src_y, src_h)

        if src_w <= 0 or src_h <= 0:
            det["mask"] = np.zeros((orig_h, orig_w), dtype=np.uint8)
            continue

        region = cropped[src_y : src_y + src_h, src_x : src_x + src_w]
        mask_full = cv2.resize(region, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        det["mask"] = (mask_full > mask_thresh).astype(np.uint8)


def clamp_bbox(bbox: list[float], w: int, h: int):
    x1, y1, x2, y2 = bbox
    x1 = max(0.0, min(float(w - 1), x1))
    y1 = max(0.0, min(float(h - 1), y1))
    x2 = max(0.0, min(float(w - 1), x2))
    y2 = max(0.0, min(float(h - 1), y2))
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    return [x1, y1, x2, y2]


def run_inference(session, image_rgb: np.ndarray, conf_thresh: float, mask_thresh: float):
    t0 = time.perf_counter()
    blob, scale, pad_x, pad_y, orig_w, orig_h = preprocess(image_rgb)
    t_pre = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: blob})
    t_inf = (time.perf_counter() - t1) * 1000

    t2 = time.perf_counter()
    output0 = outputs[0]
    output1 = outputs[1] if len(outputs) > 1 else None

    dets = decode_detections(output0, scale, pad_x, pad_y, conf_thresh)
    decode_masks(output1, dets, scale, pad_x, pad_y, orig_w, orig_h, mask_thresh)

    for d in dets:
        d["bbox"] = clamp_bbox(d["bbox"], orig_w, orig_h)

    t_post = (time.perf_counter() - t2) * 1000

    timing = InferenceTiming(
        preprocess_ms=t_pre,
        inference_ms=t_inf,
        postprocess_ms=t_post,
        total_ms=t_pre + t_inf + t_post,
    )
    return dets, timing


def parse_class_names(text_blob: str) -> list[str]:
    names = [line.strip() for line in text_blob.splitlines() if line.strip()]
    return names if names else DEFAULT_CLASS_NAMES


def class_color(class_id: int):
    if 0 <= class_id < len(DEFAULT_CLASS_COLORS):
        return DEFAULT_CLASS_COLORS[class_id]
    rng = np.random.default_rng(class_id + 42)
    return tuple(int(v) for v in rng.integers(20, 235, size=3))


def draw_annotated(
    image_rgb: np.ndarray,
    detections: list[dict[str, Any]],
    class_names: list[str],
    show_boxes: bool,
    show_masks: bool,
    show_labels: bool,
    mask_alpha: float,
):
    vis = image_rgb.copy()
    overlay = vis.copy()

    for det in detections:
        cid = int(det["class_id"])
        color = class_color(cid)
        x1, y1, x2, y2 = [int(v) for v in det["bbox"]]

        if show_masks and "mask" in det and det["mask"] is not None:
            mask = det["mask"]
            painted = np.zeros_like(overlay)
            painted[mask > 0] = color
            overlay = cv2.addWeighted(overlay, 1.0, painted, mask_alpha, 0)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, color, 2)

        if show_boxes:
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)

        if show_labels:
            label_name = class_names[cid] if 0 <= cid < len(class_names) else f"cls_{cid}"
            text = f"{label_name} {det['confidence']:.2f}"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            ty1 = max(0, y1 - th - 8)
            cv2.rectangle(overlay, (x1, ty1), (x1 + tw + 6, y1), color, -1)
            cv2.putText(overlay, text, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(overlay, text, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

    return overlay


def collect_images(image_dir: Path, recursive: bool):
    if recursive:
        files = [p for p in image_dir.rglob("*") if p.suffix.lower() in SUPPORTED_IMAGE_EXTS]
    else:
        files = [p for p in image_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_IMAGE_EXTS]
    return sorted(files)


def guess_label_path_for_image(image_path: Path, image_root: Path, labels_root: Path | None):
    stem_txt = image_path.with_suffix(".txt").name
    if labels_root is not None and labels_root.exists():
        rel = image_path.relative_to(image_root)
        return labels_root / rel.parent / stem_txt

    if image_path.parent.name == "images":
        candidate = image_path.parent.parent / "labels" / stem_txt
        if candidate.exists():
            return candidate

    if image_path.parent.parent.name == "images":
        split = image_path.parent.name
        candidate = image_path.parent.parent.parent / "labels" / split / stem_txt
        if candidate.exists():
            return candidate

    return image_path.with_suffix(".txt")


def yolo_line_to_bbox(parts: list[str], img_w: int, img_h: int):
    if len(parts) < 5:
        return None
    cls = int(float(parts[0]))
    vals = [float(v) for v in parts[1:]]

    if len(vals) == 4:
        cx, cy, bw, bh = vals
        x1 = (cx - bw / 2.0) * img_w
        y1 = (cy - bh / 2.0) * img_h
        x2 = (cx + bw / 2.0) * img_w
        y2 = (cy + bh / 2.0) * img_h
        return cls, [x1, y1, x2, y2]

    if len(vals) >= 6 and len(vals) % 2 == 0:
        pts = np.array(vals, dtype=np.float32).reshape(-1, 2)
        xs = pts[:, 0] * img_w
        ys = pts[:, 1] * img_h
        return cls, [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]

    return None


def load_gt_boxes(label_path: Path, img_w: int, img_h: int):
    if not label_path.exists():
        return []

    gt = []
    try:
        with open(label_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parsed = yolo_line_to_bbox(line.split(), img_w, img_h)
                if parsed is None:
                    continue
                cls, bbox = parsed
                gt.append({"class_id": cls, "bbox": clamp_bbox(bbox, img_w, img_h), "matched": False})
    except Exception:
        return []
    return gt


def bbox_iou(a: list[float], b: list[float]):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return inter / union


def evaluate_predictions(preds: list[dict[str, Any]], gt: list[dict[str, Any]], iou_thresh: float):
    # Greedy class-wise matching by confidence then IoU.
    preds_sorted = sorted(preds, key=lambda x: float(x["confidence"]), reverse=True)
    tp = 0
    fp = 0

    for p in preds_sorted:
        p_cls = int(p["class_id"])
        best_idx = -1
        best_iou = 0.0
        for i, g in enumerate(gt):
            if g["matched"]:
                continue
            if int(g["class_id"]) != p_cls:
                continue
            iou = bbox_iou(p["bbox"], g["bbox"])
            if iou > best_iou:
                best_iou = iou
                best_idx = i

        if best_idx >= 0 and best_iou >= iou_thresh:
            gt[best_idx]["matched"] = True
            tp += 1
        else:
            fp += 1

    fn = sum(1 for g in gt if not g["matched"])
    return tp, fp, fn


def dataframe_to_csv_bytes(df: pd.DataFrame):
    return df.to_csv(index=False).encode("utf-8")


def main():
    st.set_page_config(page_title="YOLO Full Benchmark", layout="wide", initial_sidebar_state="expanded")

    st.title("YOLO Full Benchmark and Visual Stress Test")
    st.caption("Benchmark your ONNX model on any directory with detailed metrics and visual analysis.")

    st.sidebar.header("Configuration")

    project_root = Path(__file__).resolve().parent
    default_model = project_root / "webapp-v4" / "public" / "models" / "yolo26n-seg.onnx"

    model_path = Path(st.sidebar.text_input("ONNX model path", str(default_model)))
    if not model_path.exists():
        st.sidebar.error("Model path does not exist.")
        st.stop()

    try:
        session, meta = load_model(str(model_path))
    except Exception as exc:
        st.error(f"Failed to load model: {exc}")
        st.stop()

    with st.sidebar.expander("Model metadata", expanded=False):
        st.write("Inputs")
        for i in meta["inputs"]:
            st.code(f"name={i[0]} shape={i[1]} type={i[2]}")
        st.write("Outputs")
        for o in meta["outputs"]:
            st.code(f"name={o[0]} shape={o[1]} type={o[2]}")

    st.sidebar.subheader("Thresholds")
    conf_thresh = st.sidebar.slider("Confidence", 0.0, 1.0, DEFAULT_CONF, 0.01)
    mask_thresh = st.sidebar.slider("Mask threshold", 0.0, 1.0, DEFAULT_MASK_THRESH, 0.01)

    st.sidebar.subheader("Stress parameters")
    repeats_per_image = int(st.sidebar.number_input("Repeats per image", min_value=1, max_value=50, value=1, step=1))
    warmup_runs = int(st.sidebar.number_input("Warmup runs", min_value=0, max_value=100, value=3, step=1))
    max_images = int(st.sidebar.number_input("Max images", min_value=1, max_value=50000, value=500, step=50))

    st.sidebar.subheader("Visual options")
    show_boxes = st.sidebar.checkbox("Show boxes", value=True)
    show_masks = st.sidebar.checkbox("Show masks", value=True)
    show_labels = st.sidebar.checkbox("Show labels", value=True)
    mask_alpha = st.sidebar.slider("Mask opacity", 0.0, 1.0, 0.40, 0.05)

    st.sidebar.subheader("Class names")
    class_text_default = "\n".join(DEFAULT_CLASS_NAMES)
    class_text = st.sidebar.text_area("One class per line", class_text_default, height=180)
    class_names = parse_class_names(class_text)

    st.sidebar.subheader("Optional GT evaluation")
    eval_enabled = st.sidebar.checkbox("Enable precision/recall evaluation", value=False)
    iou_thresh = st.sidebar.slider("IoU threshold", 0.1, 0.95, DEFAULT_IOU_THRESH, 0.05)

    st.subheader("Dataset input")
    c1, c2, c3 = st.columns([1.2, 1.2, 1.0])
    with c1:
        image_dir = Path(st.text_input("Image directory", str(project_root / "yolo_dataset" / "images" / "val")))
    with c2:
        labels_root_input = st.text_input(
            "Labels directory (optional, for eval)",
            str(project_root / "yolo_dataset" / "labels" / "val"),
        )
    with c3:
        recursive = st.checkbox("Recursive scan", value=True)
        random_sample = st.checkbox("Random sample", value=False)

    run_benchmark = st.button("Run Full Benchmark", type="primary")

    if not run_benchmark:
        st.info("Set paths and parameters, then click Run Full Benchmark.")
        st.stop()

    if not image_dir.exists() or not image_dir.is_dir():
        st.error("Image directory is invalid.")
        st.stop()

    labels_root = Path(labels_root_input) if labels_root_input.strip() else None
    if labels_root is not None and labels_root_input.strip() and not labels_root.exists():
        st.warning("Labels directory does not exist. Evaluation will skip missing labels.")

    image_files = collect_images(image_dir, recursive)
    if not image_files:
        st.error("No images found in the selected directory.")
        st.stop()

    if random_sample and len(image_files) > max_images:
        rng = np.random.default_rng(1337)
        sample_idx = rng.choice(len(image_files), size=max_images, replace=False)
        image_files = [image_files[int(i)] for i in sample_idx]
    else:
        image_files = image_files[:max_images]

    st.write(f"Images selected: {len(image_files)}")
    st.write(f"Total planned inferences: {len(image_files) * repeats_per_image}")

    for _ in range(warmup_runs):
        img_bgr = cv2.imread(str(image_files[0]))
        if img_bgr is None:
            break
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        run_inference(session, img_rgb, conf_thresh, mask_thresh)

    progress = st.progress(0)

    rows = []
    pred_rows = []
    per_image_last_pred = {}
    total_tp = 0
    total_fp = 0
    total_fn = 0
    failed_reads = 0

    start_wall = time.perf_counter()
    total_jobs = len(image_files) * repeats_per_image
    done_jobs = 0

    for image_path in image_files:
        img_bgr = cv2.imread(str(image_path))
        if img_bgr is None:
            failed_reads += 1
            done_jobs += repeats_per_image
            progress.progress(min(1.0, done_jobs / max(total_jobs, 1)))
            continue

        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        h, w = img_rgb.shape[:2]

        for repeat in range(repeats_per_image):
            dets, timing = run_inference(session, img_rgb, conf_thresh, mask_thresh)

            for d in dets:
                cid = int(d["class_id"])
                lbl = class_names[cid] if 0 <= cid < len(class_names) else f"cls_{cid}"
                x1, y1, x2, y2 = d["bbox"]
                pred_rows.append(
                    {
                        "image": str(image_path),
                        "repeat": repeat,
                        "class_id": cid,
                        "class_name": lbl,
                        "confidence": float(d["confidence"]),
                        "x1": float(x1),
                        "y1": float(y1),
                        "x2": float(x2),
                        "y2": float(y2),
                        "bbox_area": float(max(0.0, x2 - x1) * max(0.0, y2 - y1)),
                    }
                )

            tp = fp = fn = None
            if eval_enabled:
                label_path = guess_label_path_for_image(image_path, image_dir, labels_root)
                gt_boxes = load_gt_boxes(label_path, w, h)
                tp, fp, fn = evaluate_predictions(dets, gt_boxes, iou_thresh)
                total_tp += tp
                total_fp += fp
                total_fn += fn

            rows.append(
                {
                    "image": str(image_path),
                    "filename": image_path.name,
                    "repeat": repeat,
                    "width": w,
                    "height": h,
                    "pixels": int(w * h),
                    "num_detections": len(dets),
                    "preprocess_ms": timing.preprocess_ms,
                    "inference_ms": timing.inference_ms,
                    "postprocess_ms": timing.postprocess_ms,
                    "total_ms": timing.total_ms,
                    "tp": tp,
                    "fp": fp,
                    "fn": fn,
                }
            )

            if repeat == repeats_per_image - 1:
                per_image_last_pred[str(image_path)] = dets

            done_jobs += 1
            progress.progress(min(1.0, done_jobs / max(total_jobs, 1)))

    total_wall_s = time.perf_counter() - start_wall

    progress.empty()

    if not rows:
        st.error("No successful inferences. Check model or image inputs.")
        st.stop()

    df_runs = pd.DataFrame(rows)
    df_preds = pd.DataFrame(pred_rows) if pred_rows else pd.DataFrame(
        columns=["image", "repeat", "class_id", "class_name", "confidence", "x1", "y1", "x2", "y2", "bbox_area"]
    )

    mean_total_ms = float(df_runs["total_ms"].mean())
    median_total_ms = float(df_runs["total_ms"].median())
    p95_total_ms = float(np.percentile(df_runs["total_ms"], 95))
    fps = 1000.0 / mean_total_ms if mean_total_ms > 0 else 0.0

    mean_inference_ms = float(df_runs["inference_ms"].mean())
    p95_inference_ms = float(np.percentile(df_runs["inference_ms"], 95))
    total_detections = int(df_runs["num_detections"].sum())

    st.subheader("Summary")
    m1, m2, m3, m4, m5, m6 = st.columns(6)
    m1.metric("Images", f"{len(image_files)}")
    m2.metric("Runs", f"{len(df_runs)}")
    m3.metric("Mean total", f"{mean_total_ms:.2f} ms")
    m4.metric("P95 total", f"{p95_total_ms:.2f} ms")
    m5.metric("Approx FPS", f"{fps:.2f}")
    m6.metric("Detections", f"{total_detections}")

    st.write(
        f"Wall-clock: {total_wall_s:.2f}s | Mean inference: {mean_inference_ms:.2f}ms | "
        f"P95 inference: {p95_inference_ms:.2f}ms | Failed reads: {failed_reads}"
    )

    if eval_enabled:
        precision = total_tp / max(total_tp + total_fp, 1)
        recall = total_tp / max(total_tp + total_fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-12)
        e1, e2, e3, e4 = st.columns(4)
        e1.metric("TP", f"{total_tp}")
        e2.metric("FP", f"{total_fp}")
        e3.metric("FN", f"{total_fn}")
        e4.metric("F1", f"{f1:.3f}")
        st.caption(f"Precision: {precision:.3f} | Recall: {recall:.3f} | IoU threshold: {iou_thresh:.2f}")

    tab_overview, tab_latency, tab_detection, tab_visuals, tab_tables = st.tabs(
        ["Overview", "Latency", "Detections", "Visual Samples", "Tables and Export"]
    )

    with tab_overview:
        c1, c2 = st.columns(2)

        with c1:
            st.markdown("Detection count distribution")
            fig, ax = plt.subplots(figsize=(7, 4))
            ax.hist(df_runs["num_detections"].values, bins=30, color="#4f46e5", alpha=0.9)
            ax.set_xlabel("Detections per run")
            ax.set_ylabel("Count")
            ax.grid(alpha=0.2)
            st.pyplot(fig)

        with c2:
            st.markdown("Total latency distribution")
            fig, ax = plt.subplots(figsize=(7, 4))
            ax.hist(df_runs["total_ms"].values, bins=30, color="#059669", alpha=0.9)
            ax.axvline(mean_total_ms, color="black", linestyle="--", label=f"mean {mean_total_ms:.1f}ms")
            ax.axvline(p95_total_ms, color="red", linestyle="--", label=f"p95 {p95_total_ms:.1f}ms")
            ax.set_xlabel("Latency (ms)")
            ax.set_ylabel("Count")
            ax.grid(alpha=0.2)
            ax.legend()
            st.pyplot(fig)

    with tab_latency:
        st.markdown("Latency stage breakdown")
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.boxplot(
            [
                df_runs["preprocess_ms"].values,
                df_runs["inference_ms"].values,
                df_runs["postprocess_ms"].values,
                df_runs["total_ms"].values,
            ],
            tick_labels=["pre", "infer", "post", "total"],
            patch_artist=True,
        )
        ax.set_ylabel("ms")
        ax.grid(alpha=0.2)
        st.pyplot(fig)

        st.markdown("Latency over run index")
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.plot(df_runs.index.values, df_runs["inference_ms"].values, label="inference", alpha=0.85)
        ax.plot(df_runs.index.values, df_runs["total_ms"].values, label="total", alpha=0.75)
        ax.set_xlabel("Run index")
        ax.set_ylabel("ms")
        ax.grid(alpha=0.2)
        ax.legend()
        st.pyplot(fig)

        st.markdown("Latency vs image size")
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.scatter(df_runs["pixels"].values, df_runs["inference_ms"].values, s=12, alpha=0.65, c="#dc2626")
        ax.set_xlabel("Pixels (W*H)")
        ax.set_ylabel("Inference ms")
        ax.grid(alpha=0.2)
        st.pyplot(fig)

    with tab_detection:
        if not df_preds.empty:
            class_counts = (
                df_preds.groupby(["class_id", "class_name"]).size().reset_index(name="count").sort_values("count", ascending=False)
            )

            st.markdown("Per-class detections")
            fig, ax = plt.subplots(figsize=(10, 4))
            bars = ax.bar(class_counts["class_name"], class_counts["count"], alpha=0.9)
            for bar, cid in zip(bars, class_counts["class_id"]):
                r, g, b = class_color(int(cid))
                bar.set_color((r / 255.0, g / 255.0, b / 255.0))
            ax.set_ylabel("Detections")
            ax.grid(axis="y", alpha=0.2)
            plt.xticks(rotation=40, ha="right")
            plt.tight_layout()
            st.pyplot(fig)

            st.markdown("Confidence distribution")
            fig, ax = plt.subplots(figsize=(10, 4))
            ax.hist(df_preds["confidence"].values, bins=30, color="#2563eb", alpha=0.9)
            ax.set_xlabel("Confidence")
            ax.set_ylabel("Count")
            ax.grid(alpha=0.2)
            st.pyplot(fig)

            st.markdown("Detection area distribution")
            fig, ax = plt.subplots(figsize=(10, 4))
            area = df_preds["bbox_area"].values
            area = np.log10(np.maximum(area, 1.0))
            ax.hist(area, bins=30, color="#9333ea", alpha=0.9)
            ax.set_xlabel("log10(bbox area)")
            ax.set_ylabel("Count")
            ax.grid(alpha=0.2)
            st.pyplot(fig)
        else:
            st.info("No detections to plot.")

    with tab_visuals:
        by_image = df_runs.groupby("image", as_index=False).agg(
            runs=("repeat", "count"),
            mean_total_ms=("total_ms", "mean"),
            mean_detections=("num_detections", "mean"),
        )

        st.markdown("Sample visual inspection")
        col1, col2, col3 = st.columns(3)

        with col1:
            mode = st.selectbox("Sample mode", ["slowest", "fastest", "most detections", "least detections", "custom list"])

        with col2:
            k = int(st.slider("Number of samples", 1, 24, 8))

        with col3:
            min_conf_show = st.slider("Preview min confidence", 0.0, 1.0, conf_thresh, 0.01)

        if mode == "slowest":
            chosen = by_image.sort_values("mean_total_ms", ascending=False).head(k)["image"].tolist()
        elif mode == "fastest":
            chosen = by_image.sort_values("mean_total_ms", ascending=True).head(k)["image"].tolist()
        elif mode == "most detections":
            chosen = by_image.sort_values("mean_detections", ascending=False).head(k)["image"].tolist()
        elif mode == "least detections":
            chosen = by_image.sort_values("mean_detections", ascending=True).head(k)["image"].tolist()
        else:
            custom_paths = st.text_area("Custom image paths (one per line)", "", height=120)
            chosen = [line.strip() for line in custom_paths.splitlines() if line.strip()][:k]

        if chosen:
            cols = st.columns(min(3, len(chosen)))
            for i, img_path_str in enumerate(chosen):
                p = Path(img_path_str)
                if not p.exists():
                    continue
                img_bgr = cv2.imread(str(p))
                if img_bgr is None:
                    continue
                img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
                dets = [d for d in per_image_last_pred.get(str(p), []) if float(d["confidence"]) >= min_conf_show]
                ann = draw_annotated(img_rgb, dets, class_names, show_boxes, show_masks, show_labels, mask_alpha)

                with cols[i % len(cols)]:
                    st.image(ann, caption=f"{p.name} | dets={len(dets)}", use_container_width=True)

    with tab_tables:
        st.markdown("Run-level table")
        st.dataframe(df_runs, use_container_width=True, height=260)

        st.markdown("Prediction-level table")
        st.dataframe(df_preds, use_container_width=True, height=260)

        report = {
            "model": str(model_path),
            "image_dir": str(image_dir),
            "labels_dir": str(labels_root) if labels_root else None,
            "images": len(image_files),
            "runs": len(df_runs),
            "repeats_per_image": repeats_per_image,
            "warmup_runs": warmup_runs,
            "conf_thresh": conf_thresh,
            "mask_thresh": mask_thresh,
            "mean_total_ms": mean_total_ms,
            "median_total_ms": median_total_ms,
            "p95_total_ms": p95_total_ms,
            "mean_inference_ms": mean_inference_ms,
            "p95_inference_ms": p95_inference_ms,
            "fps_estimate": fps,
            "total_detections": total_detections,
            "failed_reads": failed_reads,
            "wall_seconds": total_wall_s,
            "evaluation_enabled": eval_enabled,
            "iou_threshold": iou_thresh,
        }

        if eval_enabled:
            precision = total_tp / max(total_tp + total_fp, 1)
            recall = total_tp / max(total_tp + total_fn, 1)
            f1 = 2 * precision * recall / max(precision + recall, 1e-12)
            report["eval"] = {
                "tp": total_tp,
                "fp": total_fp,
                "fn": total_fn,
                "precision": precision,
                "recall": recall,
                "f1": f1,
            }

        st.download_button(
            "Download run table CSV",
            data=dataframe_to_csv_bytes(df_runs),
            file_name="benchmark_runs.csv",
            mime="text/csv",
        )

        st.download_button(
            "Download prediction table CSV",
            data=dataframe_to_csv_bytes(df_preds),
            file_name="benchmark_predictions.csv",
            mime="text/csv",
        )

        st.download_button(
            "Download summary JSON",
            data=json.dumps(report, indent=2).encode("utf-8"),
            file_name="benchmark_summary.json",
            mime="application/json",
        )

        st.markdown("Summary JSON preview")
        st.json(report)


if __name__ == "__main__":
    main()
