#!/usr/bin/env python3
"""
Streamlit ONNX Model Tester — Intensive Testing for IQ Noodles YOLO Segmentation

Run:
  cd project
  .\venv-streamlit311\Scripts\streamlit.exe run onnx_model_tester.py

Features:
  - Upload images or use webcam for inference
  - Adjustable confidence & mask thresholds
  - Bounding boxes + segmentation mask overlay
  - Per-detection details table
  - Batch testing on dataset folders
  - Performance benchmarking (latency stats)
  - Side-by-side comparison (original vs annotated)
  - Per-class detection statistics
"""

from pathlib import Path
import time
import io
import random

import cv2
import numpy as np
import streamlit as st
import onnxruntime as ort
from PIL import Image

# ─── Constants ───────────────────────────────────────────────

MODEL_INPUT_SIZE = 640
MASK_PROTO_SIZE = 160
NUM_PROTOS = 32
NUM_CLASSES = 13
DEFAULT_CONF = 0.30
DEFAULT_MASK_THRESH = 0.50

CLASS_NAMES = [
    'A_Yellow', 'B_SkyBlue', 'C_DarkBlue', 'D_Green', 'E_Red',
    'F_Teal', 'G_Pink', 'H_Purple', 'I_Orange', 'J_DarkRed',
    'K_YellowGreen', 'board', 'hinge',
]

# RGB colours matching the webapp
CLASS_COLORS = [
    (249, 214,  94),   # 0  A Yellow
    (  8, 167, 232),   # 1  B SkyBlue
    ( 32, 109, 217),   # 2  C DarkBlue
    ( 31, 161,  91),   # 3  D Green
    (238,  57,  79),   # 4  E Red
    (133, 218, 187),   # 5  F Teal
    (236, 113, 168),   # 6  G Pink
    (199, 120, 185),   # 7  H Purple
    (252, 105,  12),   # 8  I Orange
    (182,  48,  72),   # 9  J DarkRed
    (149, 212,  80),   # 10 K YellowGreen
    (100, 100, 100),   # 11 board
    (200, 200, 200),   # 12 hinge
]

PROJECT_ROOT = Path(__file__).parent
DEFAULT_MODEL = PROJECT_ROOT / 'webapp-v3' / 'public' / 'models' / 'best.onnx'


# ─── Model Loading ───────────────────────────────────────────

@st.cache_resource
def load_model(model_path: str):
    """Load ONNX model with caching."""
    sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
    meta = {
        'inputs': [(i.name, i.shape, i.type) for i in sess.get_inputs()],
        'outputs': [(o.name, o.shape, o.type) for o in sess.get_outputs()],
    }
    return sess, meta


# ─── Preprocessing ───────────────────────────────────────────

def preprocess(image_rgb: np.ndarray):
    """Letterbox + normalise to [1, 3, 640, 640] float32."""
    orig_h, orig_w = image_rgb.shape[:2]
    scale = min(MODEL_INPUT_SIZE / orig_w, MODEL_INPUT_SIZE / orig_h)
    new_w = int(round(orig_w * scale))
    new_h = int(round(orig_h * scale))
    pad_x = (MODEL_INPUT_SIZE - new_w) // 2
    pad_y = (MODEL_INPUT_SIZE - new_h) // 2

    # Resize and pad
    resized = cv2.resize(image_rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 3), 114, dtype=np.uint8)
    canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized

    # HWC → CHW, float32, normalise
    blob = canvas.astype(np.float32) / 255.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]  # (1, 3, 640, 640)

    return blob, scale, pad_x, pad_y, orig_w, orig_h


# ─── Postprocessing ──────────────────────────────────────────

def decode_detections(output0, scale, pad_x, pad_y, conf_thresh):
    """Decode end2end output: (1, 300, 38) → list of dicts."""
    data = output0[0]  # (300, 38)
    detections = []

    for i in range(data.shape[0]):
        row = data[i]
        x1, y1, x2, y2 = row[0], row[1], row[2], row[3]
        score = float(row[4])
        class_id = int(round(row[5]))

        if score < conf_thresh:
            continue
        if class_id < 0 or class_id >= NUM_CLASSES:
            continue

        # Undo letterbox → original image coords
        bx1 = (x1 - pad_x) / scale
        by1 = (y1 - pad_y) / scale
        bx2 = (x2 - pad_x) / scale
        by2 = (y2 - pad_y) / scale

        mask_coeffs = row[6:38].copy()

        detections.append({
            'class_id': class_id,
            'label': CLASS_NAMES[class_id] if class_id < len(CLASS_NAMES) else f'cls_{class_id}',
            'confidence': score,
            'bbox': [float(bx1), float(by1), float(bx2), float(by2)],
            'mask_coeffs': mask_coeffs,
        })

    return detections


def decode_masks(output1, detections, scale, pad_x, pad_y, orig_w, orig_h, mask_thresh):
    """Decode segmentation masks from prototypes + coefficients."""
    protos = output1[0]  # (32, 160, 160)

    for det in detections:
        coeffs = det['mask_coeffs']  # (32,)
        # Linear combination: (160, 160)
        mask_160 = np.einsum('i,ijk->jk', coeffs, protos)
        # Sigmoid
        mask_160 = 1.0 / (1.0 + np.exp(-mask_160))

        # Crop to bbox in 160-scale coords
        ratio = MASK_PROTO_SIZE / MODEL_INPUT_SIZE
        bx1 = max(0, int((det['bbox'][0] * scale + pad_x) * ratio))
        by1 = max(0, int((det['bbox'][1] * scale + pad_y) * ratio))
        bx2 = min(MASK_PROTO_SIZE, int(np.ceil((det['bbox'][2] * scale + pad_x) * ratio)))
        by2 = min(MASK_PROTO_SIZE, int(np.ceil((det['bbox'][3] * scale + pad_y) * ratio)))

        cropped = np.zeros_like(mask_160)
        cropped[by1:by2, bx1:bx2] = mask_160[by1:by2, bx1:bx2]

        # Extract the letterboxed region and resize to original image size
        src_x = int(pad_x * ratio)
        src_y = int(pad_y * ratio)
        src_w = int(orig_w * scale * ratio)
        src_h = int(orig_h * scale * ratio)
        src_x = max(0, src_x)
        src_y = max(0, src_y)
        src_w = min(MASK_PROTO_SIZE - src_x, src_w)
        src_h = min(MASK_PROTO_SIZE - src_y, src_h)

        if src_w <= 0 or src_h <= 0:
            det['mask'] = np.zeros((orig_h, orig_w), dtype=np.uint8)
            continue

        region = cropped[src_y:src_y + src_h, src_x:src_x + src_w]
        mask_full = cv2.resize(region, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        det['mask'] = (mask_full > mask_thresh).astype(np.uint8)


# ─── Drawing ─────────────────────────────────────────────────

def draw_results(image_rgb, detections, show_boxes, show_masks, show_labels, mask_alpha):
    """Draw bounding boxes + masks on image."""
    vis = image_rgb.copy()
    overlay = vis.copy()

    for det in detections:
        cid = det['class_id']
        color = CLASS_COLORS[cid] if cid < len(CLASS_COLORS) else (128, 128, 128)
        x1, y1, x2, y2 = [int(v) for v in det['bbox']]

        # Draw mask
        if show_masks and 'mask' in det and det['mask'] is not None:
            mask = det['mask']
            colored_mask = np.zeros_like(overlay)
            colored_mask[mask > 0] = color
            overlay = cv2.addWeighted(overlay, 1.0, colored_mask, mask_alpha, 0)
            # Contour outline
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, color, 2)

        # Draw box
        if show_boxes:
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)

        # Draw label
        if show_labels:
            label = f"{det['label']} {det['confidence']:.2f}"
            font_scale = 0.6
            thickness = 1
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
            # Background rectangle
            cv2.rectangle(overlay, (x1, max(y1 - th - 8, 0)), (x1 + tw + 4, max(y1, th + 8)), color, -1)
            cv2.putText(overlay, label, (x1 + 2, max(y1 - 4, th + 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), thickness + 1, cv2.LINE_AA)
            cv2.putText(overlay, label, (x1 + 2, max(y1 - 4, th + 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    return overlay


# ─── Single Image Inference ──────────────────────────────────

def run_inference(session, image_rgb, conf_thresh, mask_thresh):
    """Run full pipeline: preprocess → inference → postprocess."""
    t0 = time.perf_counter()
    blob, scale, pad_x, pad_y, orig_w, orig_h = preprocess(image_rgb)
    t_pre = time.perf_counter() - t0

    t1 = time.perf_counter()
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: blob})
    t_inf = time.perf_counter() - t1

    t2 = time.perf_counter()
    output0 = outputs[0]  # (1, 300, 38)
    output1 = outputs[1]  # (1, 32, 160, 160)

    detections = decode_detections(output0, scale, pad_x, pad_y, conf_thresh)
    decode_masks(output1, detections, scale, pad_x, pad_y, orig_w, orig_h, mask_thresh)
    t_post = time.perf_counter() - t2

    return detections, {
        'preprocess_ms': t_pre * 1000,
        'inference_ms': t_inf * 1000,
        'postprocess_ms': t_post * 1000,
        'total_ms': (t_pre + t_inf + t_post) * 1000,
    }


# ─── UI ──────────────────────────────────────────────────────

def main():
    st.set_page_config(
        page_title='IQ Noodles — ONNX Model Tester',
        layout='wide',
        initial_sidebar_state='expanded',
    )

    st.markdown("""
    <style>
        .stApp { background: #0e1117; }
        .metric-card {
            background: linear-gradient(135deg, #1a1f2e 0%, #151926 100%);
            border: 1px solid #2d3450;
            border-radius: 12px;
            padding: 16px 20px;
            text-align: center;
        }
        .metric-value { font-size: 28px; font-weight: 700; color: #60a5fa; }
        .metric-label { font-size: 13px; color: #9ca3af; margin-top: 4px; }
    </style>
    """, unsafe_allow_html=True)

    st.title('🍜 IQ Noodles — ONNX Model Tester')
    st.caption('Intensive testing for YOLO segmentation model')

    # ─── Sidebar ─────────────────────────────────────────────
    st.sidebar.header('⚙️ Configuration')

    model_path = st.sidebar.text_input('Model path', str(DEFAULT_MODEL))
    if not Path(model_path).exists():
        st.sidebar.error('Model file not found!')
        return

    # Load model
    try:
        session, meta = load_model(model_path)
    except Exception as e:
        st.error(f'Failed to load model: {e}')
        return

    # Show model info
    with st.sidebar.expander('📋 Model Info', expanded=False):
        for inp in meta['inputs']:
            st.text(f"Input:  {inp[0]}\n  shape: {inp[1]}\n  type:  {inp[2]}")
        for out in meta['outputs']:
            st.text(f"Output: {out[0]}\n  shape: {out[1]}\n  type:  {out[2]}")

    st.sidebar.divider()
    st.sidebar.subheader('Detection Settings')
    conf_thresh = st.sidebar.slider('Confidence threshold', 0.0, 1.0, DEFAULT_CONF, 0.05)
    mask_thresh = st.sidebar.slider('Mask threshold', 0.0, 1.0, DEFAULT_MASK_THRESH, 0.05)

    st.sidebar.divider()
    st.sidebar.subheader('Visualisation')
    show_boxes = st.sidebar.checkbox('Show bounding boxes', value=True)
    show_masks = st.sidebar.checkbox('Show segmentation masks', value=True)
    show_labels = st.sidebar.checkbox('Show labels', value=True)
    mask_alpha = st.sidebar.slider('Mask opacity', 0.0, 1.0, 0.45, 0.05)

    # Filter classes
    st.sidebar.divider()
    st.sidebar.subheader('Class Filter')
    filter_classes = st.sidebar.multiselect(
        'Show only these classes (empty = all)',
        options=CLASS_NAMES,
        default=[],
    )

    # ─── Main Tabs ───────────────────────────────────────────
    tab_single, tab_batch, tab_benchmark = st.tabs([
        '📸 Single Image', '📁 Batch Testing', '⏱️ Benchmark'
    ])

    # ═══ TAB 1: Single Image ═════════════════════════════════
    with tab_single:
        source_option = st.radio(
            'Image source', ['Upload image(s)', 'Camera capture'],
            horizontal=True
        )

        images_rgb = []
        filenames = []

        if source_option == 'Upload image(s)':
            uploaded = st.file_uploader(
                'Upload images', type=['png', 'jpg', 'jpeg', 'bmp', 'webp'],
                accept_multiple_files=True, key='single_upload'
            )
            if uploaded:
                for f in uploaded:
                    pil_img = Image.open(f).convert('RGB')
                    images_rgb.append(np.array(pil_img))
                    filenames.append(f.name)
        else:
            cam_img = st.camera_input('Take a photo')
            if cam_img:
                pil_img = Image.open(cam_img).convert('RGB')
                images_rgb.append(np.array(pil_img))
                filenames.append('camera_capture')

        if images_rgb:
            for idx, (img_rgb, fname) in enumerate(zip(images_rgb, filenames)):
                st.divider()
                st.subheader(f'Results: {fname}')

                detections, timing = run_inference(session, img_rgb, conf_thresh, mask_thresh)

                # Apply class filter
                if filter_classes:
                    detections = [d for d in detections if d['label'] in filter_classes]

                # Timing metrics
                cols_metrics = st.columns(4)
                metrics = [
                    ('Preprocess', f"{timing['preprocess_ms']:.1f} ms"),
                    ('Inference', f"{timing['inference_ms']:.1f} ms"),
                    ('Postprocess', f"{timing['postprocess_ms']:.1f} ms"),
                    ('Total', f"{timing['total_ms']:.1f} ms"),
                ]
                for col, (label, val) in zip(cols_metrics, metrics):
                    col.markdown(f"""
                    <div class="metric-card">
                        <div class="metric-value">{val}</div>
                        <div class="metric-label">{label}</div>
                    </div>
                    """, unsafe_allow_html=True)

                st.markdown(f"**{len(detections)} detections** above {conf_thresh:.0%} confidence")

                # Side-by-side view
                annotated = draw_results(img_rgb, detections, show_boxes, show_masks, show_labels, mask_alpha)
                col_orig, col_ann = st.columns(2)
                with col_orig:
                    st.image(img_rgb, caption='Original', use_container_width=True)
                with col_ann:
                    st.image(annotated, caption='Annotated', use_container_width=True)

                # Individual mask visualisation
                if show_masks and detections:
                    with st.expander(f'🎭 Individual Masks ({len(detections)})', expanded=False):
                        mask_cols = st.columns(min(4, len(detections)))
                        for i, det in enumerate(detections):
                            col = mask_cols[i % len(mask_cols)]
                            if 'mask' in det and det['mask'] is not None:
                                cid = det['class_id']
                                color = CLASS_COLORS[cid] if cid < len(CLASS_COLORS) else (128, 128, 128)
                                mask_vis = np.zeros((*det['mask'].shape, 3), dtype=np.uint8)
                                mask_vis[det['mask'] > 0] = color
                                col.image(mask_vis, caption=f"{det['label']} ({det['confidence']:.2f})",
                                          use_container_width=True)

                # Detection details table
                if detections:
                    with st.expander('📊 Detection Details', expanded=True):
                        rows = []
                        for d in sorted(detections, key=lambda x: x['confidence'], reverse=True):
                            x1, y1, x2, y2 = d['bbox']
                            area = (x2 - x1) * (y2 - y1)
                            mask_pixels = int(d['mask'].sum()) if 'mask' in d and d['mask'] is not None else 0
                            rows.append({
                                'Class': d['label'],
                                'Confidence': f"{d['confidence']:.3f}",
                                'BBox (x1,y1,x2,y2)': f"({int(x1)},{int(y1)},{int(x2)},{int(y2)})",
                                'BBox Area': f"{area:.0f} px²",
                                'Mask Pixels': mask_pixels,
                            })
                        st.dataframe(rows, use_container_width=True)

                # Per-class summary
                with st.expander('📈 Class Summary', expanded=False):
                    class_counts = {}
                    class_avg_conf = {}
                    for d in detections:
                        lbl = d['label']
                        class_counts[lbl] = class_counts.get(lbl, 0) + 1
                        class_avg_conf.setdefault(lbl, []).append(d['confidence'])

                    summary_rows = []
                    for lbl in sorted(class_counts.keys()):
                        confs = class_avg_conf[lbl]
                        summary_rows.append({
                            'Class': lbl,
                            'Count': class_counts[lbl],
                            'Avg Confidence': f"{np.mean(confs):.3f}",
                            'Min Confidence': f"{np.min(confs):.3f}",
                            'Max Confidence': f"{np.max(confs):.3f}",
                        })
                    st.dataframe(summary_rows, use_container_width=True)

    # ═══ TAB 2: Batch Testing ════════════════════════════════
    with tab_batch:
        st.subheader('📁 Batch Inference on Image Folder')
        st.caption('Point to a folder of images to test the model on all of them at once.')

        default_img_dir = str(PROJECT_ROOT / 'yolo_dataset' / 'images' / 'val')
        img_dir = st.text_input('Image directory', default_img_dir)
        max_images = st.number_input('Max images to process', 1, 500, 50, step=10)
        randomize = st.checkbox('Randomize selection', value=True)

        if st.button('🚀 Run Batch Inference', key='batch_run'):
            img_path = Path(img_dir)
            if not img_path.exists():
                st.error(f'Directory not found: {img_dir}')
            else:
                extensions = ['*.png', '*.jpg', '*.jpeg', '*.bmp', '*.webp']
                all_images = []
                for ext in extensions:
                    all_images.extend(img_path.glob(ext))
                all_images = sorted(all_images)

                if not all_images:
                    st.warning('No images found in directory')
                else:
                    if randomize and len(all_images) > max_images:
                        sample = random.sample(all_images, max_images)
                    else:
                        sample = all_images[:max_images]

                    st.info(f'Processing {len(sample)} / {len(all_images)} images...')
                    progress = st.progress(0)

                    all_results = []
                    total_detections = 0
                    class_totals = {}
                    timing_totals = {'preprocess_ms': [], 'inference_ms': [], 'postprocess_ms': [], 'total_ms': []}
                    failed = 0

                    for i, img_file in enumerate(sample):
                        try:
                            img_bgr = cv2.imread(str(img_file))
                            if img_bgr is None:
                                failed += 1
                                continue
                            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
                            dets, timing = run_inference(session, img_rgb, conf_thresh, mask_thresh)

                            if filter_classes:
                                dets = [d for d in dets if d['label'] in filter_classes]

                            total_detections += len(dets)
                            for d in dets:
                                class_totals[d['label']] = class_totals.get(d['label'], 0) + 1

                            for k in timing_totals:
                                timing_totals[k].append(timing[k])

                            all_results.append({
                                'file': img_file.name,
                                'detections': len(dets),
                                'details': dets,
                                'timing': timing,
                                'image_rgb': img_rgb,
                            })
                        except Exception as e:
                            failed += 1
                            st.warning(f'Error on {img_file.name}: {e}')

                        progress.progress((i + 1) / len(sample))

                    progress.empty()

                    # Batch summary
                    st.success(f'✅ Processed {len(all_results)} images ({failed} failed)')

                    # Aggregate metrics
                    col1, col2, col3, col4 = st.columns(4)
                    col1.metric('Total Detections', total_detections)
                    col2.metric('Avg Detections/Image',
                                f"{total_detections / max(len(all_results), 1):.1f}")
                    col3.metric('Avg Inference',
                                f"{np.mean(timing_totals['inference_ms']):.1f} ms")
                    col4.metric('Avg Total',
                                f"{np.mean(timing_totals['total_ms']):.1f} ms")

                    # Per-class distribution
                    st.subheader('Per-class distribution across batch')
                    if class_totals:
                        sorted_classes = sorted(class_totals.items(), key=lambda x: x[1], reverse=True)
                        import matplotlib.pyplot as plt
                        fig, ax = plt.subplots(figsize=(10, 4))
                        labels = [c[0] for c in sorted_classes]
                        counts = [c[1] for c in sorted_classes]
                        colors = []
                        for lbl in labels:
                            idx = CLASS_NAMES.index(lbl) if lbl in CLASS_NAMES else -1
                            if 0 <= idx < len(CLASS_COLORS):
                                r, g, b = CLASS_COLORS[idx]
                                colors.append((r/255, g/255, b/255))
                            else:
                                colors.append((0.5, 0.5, 0.5))
                        ax.bar(labels, counts, color=colors, edgecolor='white', linewidth=0.5)
                        ax.set_ylabel('Detections')
                        ax.set_title('Class Distribution')
                        ax.grid(axis='y', alpha=0.3)
                        plt.xticks(rotation=45, ha='right')
                        plt.tight_layout()
                        st.pyplot(fig)

                    # Images with no detections
                    no_det_images = [r for r in all_results if r['detections'] == 0]
                    if no_det_images:
                        with st.expander(f'⚠️ Images with NO detections ({len(no_det_images)})', expanded=False):
                            cols = st.columns(min(4, len(no_det_images)))
                            for i, r in enumerate(no_det_images[:16]):
                                cols[i % len(cols)].image(r['image_rgb'], caption=r['file'],
                                                          use_container_width=True)

                    # Per-image results table
                    with st.expander('📋 Per-image results', expanded=False):
                        table_rows = []
                        for r in sorted(all_results, key=lambda x: x['detections'], reverse=True):
                            classes_found = ', '.join(sorted(set(d['label'] for d in r['details'])))
                            table_rows.append({
                                'File': r['file'],
                                'Detections': r['detections'],
                                'Classes': classes_found,
                                'Inference (ms)': f"{r['timing']['inference_ms']:.1f}",
                                'Total (ms)': f"{r['timing']['total_ms']:.1f}",
                            })
                        st.dataframe(table_rows, use_container_width=True, height=400)

                    # Browse individual results
                    with st.expander('🔍 Browse individual batch results', expanded=False):
                        if all_results:
                            file_options = [r['file'] for r in all_results]
                            selected_file = st.selectbox('Select image', file_options)
                            sel_result = next(r for r in all_results if r['file'] == selected_file)

                            dets = sel_result['details']
                            annotated = draw_results(sel_result['image_rgb'], dets,
                                                     show_boxes, show_masks, show_labels, mask_alpha)
                            c1, c2 = st.columns(2)
                            c1.image(sel_result['image_rgb'], caption='Original', use_container_width=True)
                            c2.image(annotated, caption='Annotated', use_container_width=True)

                            if dets:
                                det_rows = []
                                for d in dets:
                                    det_rows.append({
                                        'Class': d['label'],
                                        'Confidence': f"{d['confidence']:.3f}",
                                        'BBox': f"({int(d['bbox'][0])},{int(d['bbox'][1])},{int(d['bbox'][2])},{int(d['bbox'][3])})",
                                    })
                                st.dataframe(det_rows, use_container_width=True)

    # ═══ TAB 3: Benchmark ════════════════════════════════════
    with tab_benchmark:
        st.subheader('⏱️ Performance Benchmark')
        st.caption('Run multiple inference passes on a single image to measure latency statistics.')

        bench_upload = st.file_uploader(
            'Upload test image', type=['png', 'jpg', 'jpeg', 'bmp', 'webp'],
            key='bench_upload'
        )
        num_warmup = st.number_input('Warmup runs', 1, 50, 3)
        num_runs = st.number_input('Benchmark runs', 5, 200, 30)

        if bench_upload and st.button('🏃 Run Benchmark', key='bench_run'):
            pil_img = Image.open(bench_upload).convert('RGB')
            img_rgb = np.array(pil_img)
            st.image(img_rgb, caption=f'{bench_upload.name} ({img_rgb.shape[1]}×{img_rgb.shape[0]})',
                     width=300)

            # Warmup
            with st.spinner(f'Warming up ({num_warmup} runs)...'):
                for _ in range(num_warmup):
                    run_inference(session, img_rgb, conf_thresh, mask_thresh)

            # Benchmark
            timings = []
            progress = st.progress(0)
            for i in range(num_runs):
                _, timing = run_inference(session, img_rgb, conf_thresh, mask_thresh)
                timings.append(timing)
                progress.progress((i + 1) / num_runs)
            progress.empty()

            # Statistics
            import matplotlib.pyplot as plt

            stages = ['preprocess_ms', 'inference_ms', 'postprocess_ms', 'total_ms']
            stage_labels = ['Preprocess', 'Inference', 'Postprocess', 'Total']

            stat_rows = []
            for stage, label in zip(stages, stage_labels):
                values = [t[stage] for t in timings]
                stat_rows.append({
                    'Stage': label,
                    'Mean (ms)': f"{np.mean(values):.2f}",
                    'Median (ms)': f"{np.median(values):.2f}",
                    'Std (ms)': f"{np.std(values):.2f}",
                    'Min (ms)': f"{np.min(values):.2f}",
                    'Max (ms)': f"{np.max(values):.2f}",
                    'P95 (ms)': f"{np.percentile(values, 95):.2f}",
                    'P99 (ms)': f"{np.percentile(values, 99):.2f}",
                })

            st.dataframe(stat_rows, use_container_width=True)

            # Latency distribution plot
            fig, axes = plt.subplots(1, 4, figsize=(16, 4), facecolor='#0e1117')
            stage_colors = ['#60a5fa', '#f97316', '#10b981', '#8b5cf6']
            for ax, stage, label, clr in zip(axes, stages, stage_labels, stage_colors):
                values = [t[stage] for t in timings]
                ax.hist(values, bins=15, color=clr, alpha=0.8, edgecolor='white', linewidth=0.5)
                ax.set_title(label, color='white', fontsize=11)
                ax.set_xlabel('ms', color='#9ca3af', fontsize=9)
                ax.set_facecolor('#1a1f2e')
                ax.tick_params(colors='#9ca3af')
                for spine in ax.spines.values():
                    spine.set_color('#2d3450')

            plt.tight_layout()
            st.pyplot(fig)

            # Latency over time plot
            fig2, ax2 = plt.subplots(figsize=(12, 4), facecolor='#0e1117')
            runs = list(range(1, num_runs + 1))
            for stage, label, clr in zip(stages[:3], stage_labels[:3], stage_colors[:3]):
                values = [t[stage] for t in timings]
                ax2.plot(runs, values, label=label, color=clr, alpha=0.8, linewidth=1.5)
            ax2.set_xlabel('Run #', color='#9ca3af')
            ax2.set_ylabel('Latency (ms)', color='#9ca3af')
            ax2.set_title('Latency over Time', color='white')
            ax2.legend(facecolor='#1a1f2e', edgecolor='#2d3450', labelcolor='white')
            ax2.set_facecolor('#1a1f2e')
            ax2.tick_params(colors='#9ca3af')
            for spine in ax2.spines.values():
                spine.set_color('#2d3450')
            ax2.grid(alpha=0.2)
            plt.tight_layout()
            st.pyplot(fig2)


if __name__ == '__main__':
    main()
