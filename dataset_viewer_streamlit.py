#!/usr/bin/env python3
"""
Streamlit Dataset Viewer for IQ Noodles YOLO dataset

Run:
  streamlit run dataset_viewer_streamlit.py

This mirrors dataset_viewer.py but uses Streamlit for a web UI.
"""

from pathlib import Path
import random
import yaml
import cv2
import numpy as np
import streamlit as st
import matplotlib.pyplot as plt
from matplotlib import cm


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
]


def color_bgr(cid: int):
    if cid < len(PALETTE):
        r, g, b = PALETTE[cid]
        return (int(b), int(g), int(r))
    return (255, 255, 255)


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
    - stats: {split: {class_id: instance_count}}
    - class_imgs: {class_id: [(img_path, lbl_path, split), ...]}
    - per_image: {img_path: {'split': split, 'total_instances': n, 'class_counts': {cid:count}}}
    """
    stats = {'train': {}, 'val': {}}
    class_imgs = {cid: [] for cid in names}
    per_image = {}

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
                cid = int(parts[0])
                class_counts[cid] = class_counts.get(cid, 0) + 1
                stats[split][cid] = stats[split].get(cid, 0) + 1
                total += 1

            per_image[img_file] = {
                'split': split,
                'total_instances': total,
                'class_counts': class_counts,
                'lbl_path': lbl_file,
            }

            for cid in class_counts.keys():
                if cid in class_imgs:
                    class_imgs[cid].append((img_file, lbl_file, split))

    return stats, class_imgs, per_image


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
        cid = int(parts[0])
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


def plot_balance(stats: dict, names: dict, exclude_ids=None):
    """Plot class balance. Pass an optional iterable of class ids to exclude."""
    if exclude_ids is None:
        exclude_ids = set()
    else:
        exclude_ids = set(exclude_ids)

    all_ids = [c for c in sorted(names.keys()) if c not in exclude_ids]
    labels = [names[c] for c in all_ids]
    train_cnts = [stats['train'].get(c, 0) for c in all_ids]
    val_cnts = [stats['val'].get(c, 0) for c in all_ids]
    colors = [tuple(np.array(color_bgr(c))[::-1]/255.0) for c in all_ids]

    x = np.arange(len(all_ids))
    width = 0.4
    fig, ax = plt.subplots(figsize=(max(8, len(all_ids)*0.35), 4))
    ax.bar(x - width/2, train_cnts, width, label='train', color=colors, alpha=0.9)
    ax.bar(x + width/2, val_cnts, width, label='val', color=colors, alpha=0.42, edgecolor='white', linewidth=0.6)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=38, ha='right', fontsize=9)
    ax.set_ylabel('Label instances')
    ax.set_title('Class balance — train (solid) / val (faded)')
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

    stats, class_imgs, per_image = scan_dataset(dataset_dir, names)

    show_balance = st.sidebar.checkbox('Show balance chart', value=True)
    # default exclude classes that look like metadata (board/hinge)
    default_exclude = [cid for cid, nm in names.items() if any(x in nm.lower() for x in ('board', 'hinge'))]
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
        fig = plot_balance(stats, names, exclude_ids=exclude_ids)
        st.pyplot(fig)

    all_options = ['All'] + [f"{cid}: {names[cid]}" for cid in sorted(names.keys())]
    sel = st.sidebar.selectbox('Select class (id:name)', all_options)
    split = st.sidebar.selectbox('Split', ['all', 'train', 'val'])
    n = st.sidebar.slider('Number of samples', 1, 24, 9)
    if st.sidebar.button('Refresh'):
        stats, class_imgs, per_image = scan_dataset(dataset_dir, names)

    # Determine entries
    entries = []
    if sel == 'All':
        # collect random images from dataset (respect split)
        all_entries = []
        for lst in class_imgs.values():
            all_entries.extend(lst)
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
        return

    # Top-level numeric summary
    with st.expander('Numeric summary', expanded=False):
        total_train_imgs = sum(1 for p in per_image.values() if p['split'] == 'train')
        total_val_imgs = sum(1 for p in per_image.values() if p['split'] == 'val')
        total_instances_train = sum(stats['train'].values())
        total_instances_val = sum(stats['val'].values())
        avg_labels_per_train_img = (total_instances_train / total_train_imgs) if total_train_imgs else 0
        avg_labels_per_val_img = (total_instances_val / total_val_imgs) if total_val_imgs else 0

        st.write('Images: ', f"train={total_train_imgs}", f"val={total_val_imgs}")
        st.write('Label instances: ', f"train={total_instances_train}", f"val={total_instances_val}")
        st.write('Avg labels per image: ', f"train={avg_labels_per_train_img:.2f}", f"val={avg_labels_per_val_img:.2f}")

        # per-class table
        rows = []
        for cid in sorted(names.keys()):
            tr = stats['train'].get(cid, 0)
            va = stats['val'].get(cid, 0)
            rows.append({'id': cid, 'name': names[cid], 'train': tr, 'val': va, 'total': tr + va})
        # display as table
        st.table(rows)

        # CSV download for per-class counts
        import io, csv
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=['id', 'name', 'train', 'val', 'total'])
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
        st.download_button('Download per-class CSV', buf.getvalue(), file_name='per_class_counts.csv')

    # Per-image analysis
    with st.expander('Per-image analysis', expanded=False):
        # histogram of total instances per image
        totals = [v['total_instances'] for v in per_image.values()]
        if totals:
            fig, ax = plt.subplots(figsize=(6, 3))
            ax.hist(totals, bins=range(0, max(totals) + 2), color='tab:blue', alpha=0.8)
            ax.set_xlabel('Instances per image')
            ax.set_ylabel('Number of images')
            ax.set_title('Distribution of object counts per image')
            st.pyplot(fig)

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
