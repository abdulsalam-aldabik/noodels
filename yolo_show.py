#!/usr/bin/env python3
"""Show images with YOLO-format labels.

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


def find_images(images_dir):
    exts = ('*.jpg','*.jpeg','*.png','*.bmp')
    files = []
    for e in exts:
        files.extend(glob.glob(os.path.join(images_dir, e)))
    return sorted(files)


def load_yolo_labels(label_path, img_w, img_h):
    boxes = []
    if not os.path.isfile(label_path):
        return boxes
    with open(label_path, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            cls = int(float(parts[0]))
            x = float(parts[1]); y = float(parts[2])
            w = float(parts[3]); h = float(parts[4])
            x1 = int((x - w/2) * img_w)
            y1 = int((y - h/2) * img_h)
            x2 = int((x + w/2) * img_w)
            y2 = int((y + h/2) * img_h)
            boxes.append((cls, x1, y1, x2, y2))
    return boxes


def draw_boxes(img, boxes, colors):
    for cls, x1, y1, x2, y2 in boxes:
        col = tuple(int(c) for c in colors[cls % len(colors)])
        cv2.rectangle(img, (x1, y1), (x2, y2), col, 2)
        text = str(cls)
        cv2.putText(img, text, (max(x1,0), max(y1-6,12)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2, cv2.LINE_AA)


def parse_args():
    p = argparse.ArgumentParser(description='Browse YOLO dataset images with labels')
    p.add_argument('--dataset', default='yolo_dataset', help='path to dataset (default: yolo_dataset)')
    p.add_argument('--subset', default='train', choices=['train','val'], help='images subset (train|val)')
    p.add_argument('--start', type=int, default=0, help='start index')
    p.add_argument('--save-annotated', action='store_true', help='save annotated images when pressing s')
    p.add_argument('--headless', action='store_true', help='run without GUI: save annotated images for first N images')
    p.add_argument('--headless-n', type=int, default=10, help='number of images to save in headless mode')
    return p.parse_args()


def main():
    args = parse_args()
    images_dir = os.path.join(args.dataset, 'images', args.subset)
    labels_dir = os.path.join(args.dataset, 'labels', args.subset)

    imgs = find_images(images_dir)
    if not imgs:
        print('No images found in', images_dir)
        return
    print(f'Found {len(imgs)} images in {images_dir}')

    rng = np.random.RandomState(42)
    colors = (rng.randint(0, 255, size=(20, 3))).tolist()

    idx = max(0, args.start)
    cv2.namedWindow('YOLO viewer', cv2.WINDOW_NORMAL)

    print('Controls: n/space=next, p=prev, s=save annotated, q=quit')

    headless_saved = 0

    while 0 <= idx < len(imgs):
        path = imgs[idx]
        img = cv2.imread(path)
        if img is None:
            print('Failed to load', path)
            idx += 1
            continue

        h, w = img.shape[:2]
        base = os.path.splitext(os.path.basename(path))[0]
        label_path = os.path.join(labels_dir, base + '.txt')
        boxes = load_yolo_labels(label_path, w, h)

        annotated = img.copy()
        draw_boxes(annotated, boxes, colors)

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
