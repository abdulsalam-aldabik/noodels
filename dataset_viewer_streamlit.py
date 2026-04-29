#!/usr/bin/env python3
"""
Streamlit Dataset Viewer for IQ Noodles YOLO dataset

Run:
  streamlit run dataset_viewer_streamlit.py

This mirrors dataset_viewer.py but uses Streamlit for a web UI.
"""

from pathlib import Path
import random
from collections import Counter
import io
import csv
import yaml
import cv2
import numpy as np
import streamlit as st
import matplotlib.pyplot as plt


# Defaults
PROJECT_ROOT = Path(__file__).parent
DEFAULT_DATASET = PROJECT_ROOT / 'yolo_dataset'


PALETTE = [
    (249, 214,  94),  # 0  A Yellow
    (  8, 167, 232),  # 1  B SkyBlue
    ( 32, 109, 217),  # 2  C DarkBlue
    ( 31, 161,  91),  # 3  D Green
    (238,  57,  79),  # 4  E Red
    (133, 218, 187),  # 5  F Teal
    (236, 113, 168),  # 6  G Pink
    (199, 120, 185),  # 7  H Purple
    (252, 105,  12),  # 8  I Orange
    (182,  48,  72),  # 9  J DarkRed
    (149, 212,  80),  # 10 K YellowGreen
    (255, 255, 255),  # 11 board  — white
    ( 80, 220, 255),  # 12 hinge  — cyan
    (255, 196,  64),  # 13 pin    — amber
]


def color_bgr(cid: int):
    if cid < len(PALETTE):
        r, g, b = PALETTE[cid]
        return (int(b), int(g), int(r))
    return (255, 255, 255)


def parse_class_id(token: str):
    """Parse class id from YOLO row token, supporting int-like and float-like ids."""
    try:
        return int(token)
    except Exception:
        try:
            return int(float(token))
        except Exception:
            return None


def load_config(dataset_dir: Path) -> dict:
    yaml_path = dataset_dir / 'dataset.yaml'
    if not yaml_path.exists():
        st.error(f"dataset.yaml not found at {yaml_path}")
        return {}
    with open(yaml_path) as f:
        cfg = yaml.safe_load(f)
    names = cfg.get('names', {})
    if isinstance(names, list):
        return {i: n for i, n in enumerate(names)}
    return {int(k): v for k, v in names.items()}


def scan_dataset(dataset_dir: Path, names: dict):
    """Scan dataset and return:
    - stats_instances: {split: {class_id: instance_count}}
    - stats_images: {split: {class_id: image_count_with_class}}
    - class_imgs: {class_id: [(img_path, lbl_path, split), ...]}
    - per_image: {img_path: {'split': split, 'total_instances': n, 'class_counts': {cid:count}}}
    - invalid_rows: number of label rows whose class token could not be parsed
    """
    stats_instances = {'train': {}, 'val': {}}
    stats_images = {'train': {}, 'val': {}}
    class_imgs = {cid: [] for cid in names}
    per_image = {}
    invalid_rows = 0

    for split in ['train', 'val']:
        lbl_dir = dataset_dir / 'labels' / split
        img_dir = dataset_dir / 'images' / split
        if not lbl_dir.exists():
            continue

        for lbl_file in sorted(lbl_dir.glob('*.txt')):
            img_file = None
            for ext in ('.png', '.jpg', '.jpeg'):
                c = img_dir / (lbl_file.stem + ext)
                if c.exists():
                    img_file = c
                    break
            if img_file is None:
                continue

            with open(lbl_file) as f:
                lines = [l.strip() for l in f if l.strip()]

            class_counts = {}
            total = 0
            for line in lines:
                parts = line.split()
                if not parts:
                    continue
                cid = parse_class_id(parts[0])
                if cid is None:
                    invalid_rows += 1
                    continue
                class_counts[cid] = class_counts.get(cid, 0) + 1
                stats_instances[split][cid] = stats_instances[split].get(cid, 0) + 1
                total += 1

            per_image[img_file] = {
                'split': split,
                'total_instances': total,
                'class_counts': class_counts,
                'lbl_path': lbl_file,
            }

            for cid in class_counts.keys():
                stats_images[split][cid] = stats_images[split].get(cid, 0) + 1
                if cid in class_imgs:
                    class_imgs[cid].append((img_file, lbl_file, split))

    return stats_instances, stats_images, class_imgs, per_image, invalid_rows


def annotate_image_cv2(img_bgr: np.ndarray, lbl_path: Path, names: dict) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    overlay = img_bgr.copy()

    if not lbl_path.exists():
        return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    with open(lbl_path) as f:
        lines = [l.strip() for l in f if l.strip()]

    for line in lines:
        parts = line.split()
        if not parts:
            continue
        cid = parse_class_id(parts[0])
        if cid is None:
            continue
        vals = list(map(float, parts[1:]))
        color = color_bgr(cid)
        label = names.get(cid, str(cid))

        if len(vals) == 4:
            cx, cy, bw, bh = vals
            x1 = int((cx - bw/2) * w)
            y1 = int((cy - bh/2) * h)
            x2 = int((cx + bw/2) * w)
            y2 = int((cy + bh/2) * h)
            cv2.rectangle(img_bgr, (x1, y1), (x2, y2), color, 2)
            cv2.putText(img_bgr, label, (x1, max(y1 - 6, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(img_bgr, label, (x1, max(y1 - 6, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

        elif len(vals) >= 6:
            pts = np.array(vals).reshape(-1, 2)
            pts[:, 0] *= w
            pts[:, 1] *= h
            pts_i = pts.astype(np.int32)
            cv2.fillPoly(overlay, [pts_i], color)
            cv2.polylines(img_bgr, [pts_i], isClosed=True, color=color, thickness=1)
            tx = int(pts[:, 0].mean())
            ty = int(max(pts[:, 1].min() - 6, 12))
            cv2.putText(img_bgr, label, (tx, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(img_bgr, label, (tx, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    # alpha blend polygon overlay
    alpha = 0.22
    cv2.addWeighted(overlay, alpha, img_bgr, 1 - alpha, 0, img_bgr)
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def plot_balance(stats_instances: dict, stats_images: dict, names: dict,
                 metric='instances', exclude_ids=None, normalize=False):
    """Plot class balance with configurable metric and optional normalization."""
    if exclude_ids is None:
        exclude_ids = set()
    else:
        exclude_ids = set(exclude_ids)

    src = stats_instances if metric == 'instances' else stats_images
    all_ids = [c for c in sorted(names.keys()) if c not in exclude_ids]
    labels = [names[c] for c in all_ids]
    train_cnts = [src['train'].get(c, 0) for c in all_ids]
    val_cnts = [src['val'].get(c, 0) for c in all_ids]

    if normalize:
        tr_total = max(1, sum(train_cnts))
        va_total = max(1, sum(val_cnts))
        train_cnts = [100.0 * x / tr_total for x in train_cnts]
        val_cnts = [100.0 * x / va_total for x in val_cnts]

    colors = [tuple(np.array(color_bgr(c))[::-1]/255.0) for c in all_ids]

    x = np.arange(len(all_ids))
    width = 0.4
    fig, ax = plt.subplots(figsize=(max(8, len(all_ids)*0.35), 4))
    ax.bar(x - width/2, train_cnts, width, label='train', color=colors, alpha=0.9)
    ax.bar(x + width/2, val_cnts, width, label='val', color=colors, alpha=0.42, edgecolor='white', linewidth=0.6)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=38, ha='right', fontsize=9)
    ylabel = 'Label instances' if metric == 'instances' else 'Images containing class'
    if normalize:
        ylabel += ' (%)'
    ax.set_ylabel(ylabel)
    ax.set_title(f"Class balance — {metric} (train solid / val faded)")
    ax.legend()
    ax.grid(axis='y', alpha=0.25)
    plt.tight_layout()
    return fig


def main():
    st.set_page_config(page_title='IQ Noodles Dataset Viewer', layout='wide')
    st.title('IQ Noodles — Dataset Viewer (Streamlit)')

    dataset_dir = Path(st.sidebar.text_input('Dataset root', str(DEFAULT_DATASET)))
    if not dataset_dir.exists():
        st.sidebar.error('Dataset path does not exist')
        return

    names = load_config(dataset_dir)
    if not names:
        return

    stats_instances, stats_images, class_imgs, per_image, invalid_rows = scan_dataset(dataset_dir, names)

    show_balance = st.sidebar.checkbox('Show balance chart', value=True)
    metric_label = st.sidebar.radio('Balance metric', ['Label instances', 'Images containing class'], index=0)
    balance_metric = 'instances' if metric_label == 'Label instances' else 'images'
    normalize_balance = st.sidebar.checkbox('Normalize balance chart to %', value=False)

    # keep board visible by default; hide mostly-metadata classes initially
    default_exclude = [cid for cid, nm in names.items() if any(x in nm.lower() for x in ('hinge', 'pin'))]
    exclude_options = [f"{cid}: {names[cid]}" for cid in sorted(names.keys())]
    exclude_selected = st.sidebar.multiselect('Exclude classes from balance chart', options=exclude_options,
                                              default=[f"{cid}: {names[cid]}" for cid in default_exclude])
    # parse selected into ids
    exclude_ids = set()
    for s in exclude_selected:
        try:
            exclude_ids.add(int(s.split(':', 1)[0]))
        except Exception:
            pass

    if show_balance:
        fig = plot_balance(
            stats_instances,
            stats_images,
            names,
            metric=balance_metric,
            exclude_ids=exclude_ids,
            normalize=normalize_balance,
        )
        st.pyplot(fig)

    all_options = ['All'] + [f"{cid}: {names[cid]}" for cid in sorted(names.keys())]
    sel = st.sidebar.selectbox('Select class (id:name)', all_options)
    split = st.sidebar.selectbox('Split', ['all', 'train', 'val'])
    n = st.sidebar.slider('Number of samples', 1, 24, 9)
    if st.sidebar.button('Refresh'):
        stats_instances, stats_images, class_imgs, per_image, invalid_rows = scan_dataset(dataset_dir, names)

    board_ids = [cid for cid, nm in names.items() if 'board' in nm.lower()]
    hinge_ids = [cid for cid, nm in names.items() if 'hinge' in nm.lower()]
    pin_ids = [cid for cid, nm in names.items() if 'pin' in nm.lower()]
    piece_ids = [
        cid for cid, nm in names.items()
        if all(k not in nm.lower() for k in ('board', 'hinge', 'pin'))
    ]

    def _sum_classes(stats_src, split_name, ids):
        return sum(stats_src[split_name].get(cid, 0) for cid in ids)

    board_train = _sum_classes(stats_instances, 'train', board_ids)
    board_val = _sum_classes(stats_instances, 'val', board_ids)
    board_total = board_train + board_val

    if invalid_rows:
        st.warning(f"Skipped {invalid_rows} label rows with invalid class ids while scanning labels.")
    if board_ids and board_total == 0:
        st.warning('Board labels are currently parsed as zero. Check class ids in label files vs dataset.yaml.')
    else:
        st.caption(f"Board labels detected: train={board_train}, val={board_val}")

    train_infos = [v for v in per_image.values() if v['split'] == 'train']
    val_infos = [v for v in per_image.values() if v['split'] == 'val']

    def _piece_instance_count(info):
        return sum(info['class_counts'].get(cid, 0) for cid in piece_ids)

    def _piece_unique_count(info):
        return sum(1 for cid in piece_ids if info['class_counts'].get(cid, 0) > 0)

    train_piece_instances = [_piece_instance_count(v) for v in train_infos]
    val_piece_instances = [_piece_instance_count(v) for v in val_infos]
    all_piece_instances = train_piece_instances + val_piece_instances

    train_piece_unique = [_piece_unique_count(v) for v in train_infos]
    val_piece_unique = [_piece_unique_count(v) for v in val_infos]
    all_piece_unique = train_piece_unique + val_piece_unique

    total_images = len(per_image)
    total_train_imgs = len(train_infos)
    total_val_imgs = len(val_infos)

    total_instances_train = sum(stats_instances['train'].values())
    total_instances_val = sum(stats_instances['val'].values())
    total_instances_all = total_instances_train + total_instances_val

    avg_labels_per_img = (total_instances_all / total_images) if total_images else 0
    avg_piece_instances_per_img = (sum(all_piece_instances) / total_images) if total_images else 0

    c1, c2, c3, c4 = st.columns(4)
    c1.metric('Total images', total_images)
    c2.metric('Train / Val', f"{total_train_imgs} / {total_val_imgs}")
    c3.metric('Avg labels / image', f"{avg_labels_per_img:.2f}")
    c4.metric('Avg piece instances / image', f"{avg_piece_instances_per_img:.2f}")

    # Determine entries
    entries = []
    if sel == 'All':
        # collect random unique images from dataset (respect split)
        all_entries = [(img_path, info['lbl_path'], info['split']) for img_path, info in per_image.items()]
        if split != 'all':
            all_entries = [e for e in all_entries if e[2] == split]
        entries = random.sample(all_entries, min(n, len(all_entries))) if all_entries else []
    else:
        cid = int(sel.split(':', 1)[0])
        entries = class_imgs.get(cid, [])
        if split != 'all':
            entries = [e for e in entries if e[2] == split]
        entries = random.sample(entries, min(n, len(entries))) if entries else []

    if not entries:
        st.info('No images found for selection')

    # Top-level numeric summary
    with st.expander('Dataset summary', expanded=False):
        avg_labels_per_train_img = (total_instances_train / total_train_imgs) if total_train_imgs else 0
        avg_labels_per_val_img = (total_instances_val / total_val_imgs) if total_val_imgs else 0
        avg_piece_per_train_img = (sum(train_piece_instances) / total_train_imgs) if total_train_imgs else 0
        avg_piece_per_val_img = (sum(val_piece_instances) / total_val_imgs) if total_val_imgs else 0
        avg_unique_piece_per_train_img = (sum(train_piece_unique) / total_train_imgs) if total_train_imgs else 0
        avg_unique_piece_per_val_img = (sum(val_piece_unique) / total_val_imgs) if total_val_imgs else 0

        board_imgs_train = _sum_classes(stats_images, 'train', board_ids)
        board_imgs_val = _sum_classes(stats_images, 'val', board_ids)
        hinge_imgs_train = _sum_classes(stats_images, 'train', hinge_ids)
        hinge_imgs_val = _sum_classes(stats_images, 'val', hinge_ids)
        pin_imgs_train = _sum_classes(stats_images, 'train', pin_ids)
        pin_imgs_val = _sum_classes(stats_images, 'val', pin_ids)

        st.write('Images: ', f"train={total_train_imgs}", f"val={total_val_imgs}")
        st.write('Label instances: ', f"train={total_instances_train}", f"val={total_instances_val}")
        st.write('Avg labels per image: ', f"train={avg_labels_per_train_img:.2f}", f"val={avg_labels_per_val_img:.2f}")
        st.write('Avg piece instances per image: ', f"train={avg_piece_per_train_img:.2f}", f"val={avg_piece_per_val_img:.2f}")
        st.write('Avg unique piece classes per image: ',
                 f"train={avg_unique_piece_per_train_img:.2f}", f"val={avg_unique_piece_per_val_img:.2f}")
        st.write('Images containing board / hinge / pin: ',
                 f"train={board_imgs_train}/{hinge_imgs_train}/{pin_imgs_train}",
                 f"val={board_imgs_val}/{hinge_imgs_val}/{pin_imgs_val}")

        # per-class table (instances + image presence)
        rows = []
        for cid in sorted(names.keys()):
            tr_i = stats_instances['train'].get(cid, 0)
            va_i = stats_instances['val'].get(cid, 0)
            tr_img = stats_images['train'].get(cid, 0)
            va_img = stats_images['val'].get(cid, 0)
            rows.append({
                'id': cid,
                'name': names[cid],
                'train_instances': tr_i,
                'val_instances': va_i,
                'total_instances': tr_i + va_i,
                'train_images': tr_img,
                'val_images': va_img,
                'total_images': tr_img + va_img,
            })
        # display as table
        st.dataframe(rows, use_container_width=True, hide_index=True)

        # CSV download for per-class counts
        buf = io.StringIO()
        writer = csv.DictWriter(
            buf,
            fieldnames=[
                'id', 'name', 'train_instances', 'val_instances', 'total_instances',
                'train_images', 'val_images', 'total_images'
            ],
        )
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
        st.download_button('Download class summary CSV', buf.getvalue(), file_name='class_summary.csv')

    # Per-image analysis
    with st.expander('Per-image analysis', expanded=False):
        # histogram of total labels per image
        totals = [v['total_instances'] for v in per_image.values()]
        if totals:
            fig, ax = plt.subplots(figsize=(6, 3))
            ax.hist(totals, bins=range(0, max(totals) + 2), color='tab:blue', alpha=0.8)
            ax.set_xlabel('Instances per image')
            ax.set_ylabel('Number of images')
            ax.set_title('Distribution of object counts per image')
            st.pyplot(fig)

        # histogram of piece instances per image (what users typically mean by "how many pieces")
        if all_piece_instances:
            fig2, ax2 = plt.subplots(figsize=(7, 3.4))
            bins = np.arange(0, max(all_piece_instances) + 2)
            ax2.hist(train_piece_instances, bins=bins, alpha=0.75, label='train', color='tab:blue')
            ax2.hist(val_piece_instances, bins=bins, alpha=0.6, label='val', color='tab:orange')
            ax2.set_xlabel('Piece instances per image (classes A-K)')
            ax2.set_ylabel('Number of images')
            ax2.set_title('How many pieces each image has')
            ax2.legend()
            st.pyplot(fig2)

        # frequency table: images grouped by piece count
        dist_train = Counter(train_piece_instances)
        dist_val = Counter(val_piece_instances)
        dist_keys = sorted(set(dist_train.keys()) | set(dist_val.keys()))
        dist_rows = []
        for k in dist_keys:
            tr = dist_train.get(k, 0)
            va = dist_val.get(k, 0)
            dist_rows.append({
                'pieces_in_image': k,
                'train_images': tr,
                'val_images': va,
                'total_images': tr + va,
            })
        if dist_rows:
            st.dataframe(dist_rows, use_container_width=True, hide_index=True)
            buf_dist = io.StringIO()
            writer_dist = csv.DictWriter(buf_dist, fieldnames=['pieces_in_image', 'train_images', 'val_images', 'total_images'])
            writer_dist.writeheader()
            for r in dist_rows:
                writer_dist.writerow(r)
            st.download_button('Download piece-count distribution CSV', buf_dist.getvalue(), file_name='piece_count_distribution.csv')

        # top images by instance count
        top_k = sorted(per_image.items(), key=lambda x: x[1]['total_instances'], reverse=True)[:10]
        trows = []
        for p, info in top_k:
            trows.append({'image': p.name, 'split': info['split'], 'instances': info['total_instances']})
        st.table(trows)
        # CSV export per-image
        buf2 = io.StringIO()
        writer2 = csv.DictWriter(buf2, fieldnames=['image', 'split', 'instances'])
        writer2.writeheader()
        for r in trows:
            writer2.writerow(r)
        st.download_button('Download top-images CSV', buf2.getvalue(), file_name='top_images.csv')

    # If a single class is selected, offer a full file list + label preview
    if sel != 'All':
        cid = int(sel.split(':', 1)[0])
        all_files = class_imgs.get(cid, [])
        with st.expander(f"All files for class {cid}: {names[cid]} ({len(all_files)})", expanded=False):
            if not all_files:
                st.write('No files for this class')
            else:
                options = [f"{p[0].name} [{p[2]}]" for p in all_files]
                sel_file = st.selectbox('Select file to preview', options)
                if sel_file:
                    idx = options.index(sel_file)
                    img_path, lbl_path, split = all_files[idx]
                    img = cv2.imread(str(img_path))
                    if img is None:
                        st.write('Failed to read image')
                    else:
                        annotated = annotate_image_cv2(img.copy(), lbl_path, names)
                        st.image(annotated, caption=f"{img_path.name} [{split}]")
                    try:
                        with open(lbl_path) as f:
                            txt = ''.join(f.readlines())
                        st.code(txt, language='text')
                    except Exception as e:
                        st.write('Failed to read label file:', e)

    if entries:
        cols = min(4, len(entries))
        rows = (len(entries) + cols - 1) // cols
        idx = 0
        for r in range(rows):
            cols_widgets = st.columns(cols)
            for c in range(cols):
                if idx >= len(entries):
                    break
                img_path, lbl_path, split = entries[idx]
                img = cv2.imread(str(img_path))
                if img is None:
                    cols_widgets[c].text('Failed to read image')
                else:
                    annotated = annotate_image_cv2(img.copy(), lbl_path, names)
                    # Calculate a reasonable width per column (page ~900px wide)
                    display_width = max(120, int(900 / cols))
                    cols_widgets[c].image(annotated, caption=f"{img_path.name} [{split}]", width=display_width)
                idx += 1


if __name__ == '__main__':
    main()
