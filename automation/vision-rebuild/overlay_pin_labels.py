"""Render class-13 pin polygon labels on top of smoke-dataset images so we can eyeball-verify placement."""
import glob
import os
import sys

from PIL import Image, ImageDraw


def _read_label_file(path):
    """Yield (class_id, [(x,y), ...]) polygons from a YOLO-seg label file."""
    with open(path, "r") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 7:
                continue
            cid = int(parts[0])
            coords = list(map(float, parts[1:]))
            pts = list(zip(coords[0::2], coords[1::2]))
            yield cid, pts


def overlay(img_path, label_path, out_path):
    img = Image.open(img_path).convert("RGBA")
    W, H = img.size
    overlay_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay_img, "RGBA")
    pin_count = 0
    for cid, pts in _read_label_file(label_path):
        if cid != 13:
            continue
        pin_count += 1
        px = [(int(x * W), int(y * H)) for x, y in pts]
        if len(px) < 3:
            continue
        draw.polygon(px, outline=(0, 255, 0, 255), fill=(0, 255, 0, 80))
    print(f"{os.path.basename(img_path)}: {pin_count} pins")
    Image.alpha_composite(img, overlay_img).convert("RGB").save(out_path)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join("debug-output", "smoke-yolo-dataset")
    out_dir = os.path.join(root, "pin-overlays")
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for split in ("train", "val"):
        imgs = sorted(glob.glob(os.path.join(root, "images", split, "*.png")))
        for img_path in imgs:
            stem = os.path.splitext(os.path.basename(img_path))[0]
            label_path = os.path.join(root, "labels", split, stem + ".txt")
            if not os.path.exists(label_path):
                continue
            out_path = os.path.join(out_dir, f"{split}_{stem}_overlay.png")
            overlay(img_path, label_path, out_path)
            count += 1
    print(f"Wrote {count} overlays to {out_dir}")


if __name__ == "__main__":
    main()
