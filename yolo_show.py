#!/usr/bin/env python3
"""Show images with YOLO-format labels (bbox + segmentation polygons).

Usage examples:
  python3 yolo_show.py                 # interactively browse train images
  python3 yolo_show.py --subset val    # browse val images
  python3 yolo_show.py --start 10      # start at index 10
"""

import os
import argparse
import glob
import cv2
import numpy as np
import yaml


PALETTE = [
    (249, 214, 94),   # 0  A Yellow
    (8, 167, 232),    # 1  B SkyBlue
    (32, 109, 217),   # 2  C DarkBlue
    (31, 161, 91),    # 3  D Green
    (238, 57, 79),    # 4  E Red
    (133, 218, 187),  # 5  F Teal
    (236, 113, 168),  # 6  G Pink
    (199, 120, 185),  # 7  H Purple
    (252, 105, 12),   # 8  I Orange
    (182, 48, 72),    # 9  J DarkRed
    (149, 212, 80),   # 10 K YellowGreen
    (255, 255, 255),  # 11 board
    (80, 220, 255),   # 12 hinge
    (255, 196, 64),   # 13 pin
]


def color_bgr(cid):
    if 0 <= cid < len(PALETTE):
        r, g, b = PALETTE[cid]
        return int(b), int(g), int(r)
    return 255, 255, 255


def load_names(dataset_dir):
    yaml_path = os.path.join(dataset_dir, 'dataset.yaml')
    if not os.path.isfile(yaml_path):
        return {}
    try:
        with open(yaml_path, 'r', encoding='utf-8') as f:
            cfg = yaml.safe_load(f) or {}
        names = cfg.get('names', {})
        if isinstance(names, list):
            return {i: str(v) for i, v in enumerate(names)}
        return {int(k): str(v) for k, v in names.items()}
    except Exception:
        return {}


def list_splits(dataset_dir):
    images_root = os.path.join(dataset_dir, 'images')
    if not os.path.isdir(images_root):
        return []
    splits = [d for d in os.listdir(images_root) if os.path.isdir(os.path.join(images_root, d))]
    preferred = ['train', 'val', 'test']
    return [s for s in preferred if s in splits] + sorted(s for s in splits if s not in preferred)


def find_images(images_dir):
    exts = ('*.jpg', '*.jpeg', '*.png', '*.bmp')
    files = []
    for e in exts:
        files.extend(glob.glob(os.path.join(images_dir, e)))
    return sorted(files)


def load_yolo_labels(label_path):
    annotations = []
    if not os.path.isfile(label_path):
        return annotations

    with open(label_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            try:
                cid = int(float(parts[0]))
                vals = [float(v) for v in parts[1:]]
            except ValueError:
                continue

            if len(vals) == 4:
                annotations.append(("bbox", cid, vals))
            elif len(vals) >= 6 and (len(vals) % 2 == 0):
                annotations.append(("poly", cid, vals))

    return annotations


def _draw_label(img, text, x, y, color):
    y = max(12, y)
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1, cv2.LINE_AA)


def draw_annotations(img, annotations, names):
    h, w = img.shape[:2]
    overlay = img.copy()
    poly_cache = []

    # Fill segmentation polygons first so image stays readable.
    for ann_type, cid, vals in annotations:
        if ann_type != "poly":
            continue
        pts = np.array(vals, dtype=np.float32).reshape(-1, 2)
        pts[:, 0] = np.clip(pts[:, 0] * w, 0, max(0, w - 1))
        pts[:, 1] = np.clip(pts[:, 1] * h, 0, max(0, h - 1))
        pts_i = pts.astype(np.int32)
        col = color_bgr(cid)
        cv2.fillPoly(overlay, [pts_i], col)
        poly_cache.append((cid, pts, pts_i, col))

    cv2.addWeighted(overlay, 0.24, img, 0.76, 0, img)

    # Draw polygon edges + labels.
    for cid, pts, pts_i, col in poly_cache:
        cv2.polylines(img, [pts_i], isClosed=True, color=col, thickness=2)
        label = names.get(cid, str(cid))
        tx = int(np.clip(np.mean(pts[:, 0]), 0, max(0, w - 1)))
        ty = int(np.clip(np.min(pts[:, 1]) - 8, 12, max(12, h - 1)))
        _draw_label(img, label, tx, ty, col)

    # Draw bboxes on top.
    for ann_type, cid, vals in annotations:
        if ann_type != "bbox":
            continue
        cx, cy, bw, bh = vals
        x1 = int((cx - bw / 2.0) * w)
        y1 = int((cy - bh / 2.0) * h)
        x2 = int((cx + bw / 2.0) * w)
        y2 = int((cy + bh / 2.0) * h)
        col = color_bgr(cid)
        cv2.rectangle(img, (x1, y1), (x2, y2), col, 2)
        label = names.get(cid, str(cid))
        _draw_label(img, label, max(x1, 0), max(y1 - 6, 12), col)


def parse_args():
    p = argparse.ArgumentParser(description='Browse YOLO dataset images with labels')
    p.add_argument('--dataset', default='yolo_dataset', help='path to dataset (default: yolo_dataset)')
    p.add_argument('--subset', default='train', help='images subset (train|val|test|all)')
    p.add_argument('--start', type=int, default=0, help='start index')
    p.add_argument('--save-annotated', action='store_true', help='save annotated images when pressing s')
    p.add_argument('--headless', action='store_true', help='run without GUI: save annotated images for first N images')
    p.add_argument('--headless-n', type=int, default=10, help='number of images to save in headless mode')
    return p.parse_args()


def main():
    args = parse_args()
    names = load_names(args.dataset)
    available_splits = list_splits(args.dataset)

    records = []
    if args.subset == 'all':
        if not available_splits:
            print('No split folders found in', os.path.join(args.dataset, 'images'))
            return
        for split in available_splits:
            split_img_dir = os.path.join(args.dataset, 'images', split)
            split_imgs = find_images(split_img_dir)
            records.extend((p, split) for p in split_imgs)
    else:
        if available_splits and args.subset not in available_splits:
            print(f"Subset '{args.subset}' not found. Available: {', '.join(available_splits)}")
            return
        images_dir = os.path.join(args.dataset, 'images', args.subset)
        records = [(p, args.subset) for p in find_images(images_dir)]

    if not records:
        print('No images found for selection')
        return
    print(f'Found {len(records)} images for subset={args.subset}')

    if names:
        print('Loaded class names from dataset.yaml')

    idx = max(0, args.start)
    if not args.headless:
        cv2.namedWindow('YOLO viewer', cv2.WINDOW_NORMAL)
        print('Controls: n/space=next, p=prev, s=save annotated, q=quit')

    headless_saved = 0

    while 0 <= idx < len(records):
        path, split = records[idx]
        img = cv2.imread(path)
        if img is None:
            print('Failed to load', path)
            idx += 1
            continue

        base = os.path.splitext(os.path.basename(path))[0]
        label_path = os.path.join(args.dataset, 'labels', split, base + '.txt')
        annotations = load_yolo_labels(label_path)

        annotated = img.copy()
        draw_annotations(annotated, annotations, names)
        if not annotations:
            cv2.putText(
                annotated,
                'No labels',
                (16, 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 0, 255),
                2,
                cv2.LINE_AA,
            )

        header = f'{base} [{split}]  labels={len(annotations)}'
        cv2.putText(annotated, header, (16, annotated.shape[0] - 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

        if args.headless:
            out_dir = os.path.join(args.dataset, 'annotated')
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, base + '_annotated.jpg')
            cv2.imwrite(out_path, annotated)
            headless_saved += 1
            print('Saved (headless)', out_path)
            idx += 1
            if headless_saved >= args.headless_n:
                break
            continue

        cv2.imshow('YOLO viewer', annotated)

        k = cv2.waitKey(0) & 0xFF
        if k in (ord('q'), 27):
            break
        elif k in (ord('n'), ord(' ')):
            idx += 1
        elif k in (ord('p'),):
            idx = max(0, idx-1)
        elif k in (ord('s'),):
            out_dir = os.path.join(args.dataset, 'annotated')
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, base + '_annotated.jpg')
            cv2.imwrite(out_path, annotated)
            print('Saved', out_path)
            idx += 1
        else:
            idx += 1

    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
