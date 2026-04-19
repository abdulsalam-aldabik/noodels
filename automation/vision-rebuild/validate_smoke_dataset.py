"""Validate the smoke YOLO dataset produced by smoke_runner_temp.py.

Checks:
 - Expected file counts per split (images + labels).
 - Each label class id is an integer in [0, 11] (class 12 hinge expected absent per CLAUDE.md).
 - Each polygon coord is a float in [0.0, 1.0].
 - At least one class-11 (board) label exists across the dataset.

Writes validation-report.json + validation-report.md into the dataset dir.
Exits 0 on PASS, 1 on FAIL.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

EXPECTED = {"train": 6, "val": 2}
MAX_CLASS_ID = 13  # class 12 (hinge) expected absent in synthetic; class 13 (pin) added
ALLOWED_SYNTHETIC_CLASS_IDS = set(range(0, 12)) | {13}  # pieces 0-10, board 11, pin 13


def validate(root: Path) -> dict:
    img_root = root / "images"
    lbl_root = root / "labels"
    report = {
        "dataset_dir": str(root),
        "rules": {
            "expected_counts": EXPECTED,
            "allowed_class_ids": sorted(ALLOWED_SYNTHETIC_CLASS_IDS),
            "coord_range": [0.0, 1.0],
            "requires_class_11": True,
            "requires_class_13": True,
        },
        "splits": {},
        "class_histogram": {},
        "errors": [],
        "warnings": [],
    }

    for split, expected_count in EXPECTED.items():
        split_info = {
            "expected": expected_count,
            "images_found": 0,
            "labels_found": 0,
            "label_files": [],
        }
        imgs = sorted((img_root / split).glob("*.png")) if (img_root / split).is_dir() else []
        lbls = sorted((lbl_root / split).glob("*.txt")) if (lbl_root / split).is_dir() else []
        split_info["images_found"] = len(imgs)
        split_info["labels_found"] = len(lbls)

        if len(imgs) != expected_count:
            report["errors"].append(
                f"[{split}] expected {expected_count} images, found {len(imgs)}"
            )
        if len(lbls) != expected_count:
            report["errors"].append(
                f"[{split}] expected {expected_count} labels, found {len(lbls)}"
            )

        img_stems = {p.stem for p in imgs}
        lbl_stems = {p.stem for p in lbls}
        missing_lbl = sorted(img_stems - lbl_stems)
        missing_img = sorted(lbl_stems - img_stems)
        if missing_lbl:
            report["errors"].append(f"[{split}] images without labels: {missing_lbl}")
        if missing_img:
            report["errors"].append(f"[{split}] labels without images: {missing_img}")

        for lbl in lbls:
            file_info = {
                "name": lbl.name,
                "lines": 0,
                "class_counts": {},
                "line_errors": [],
            }
            text = lbl.read_text(encoding="utf-8")
            for lineno, raw in enumerate(text.splitlines(), start=1):
                line = raw.strip()
                if not line:
                    continue
                file_info["lines"] += 1
                toks = line.split()
                if len(toks) < 7:
                    file_info["line_errors"].append(
                        f"line {lineno}: needs >=7 tokens (class + >=3 (x,y) pairs), got {len(toks)}"
                    )
                    continue
                try:
                    cid = int(toks[0])
                except ValueError:
                    file_info["line_errors"].append(
                        f"line {lineno}: class id not integer: {toks[0]!r}"
                    )
                    continue
                if cid not in ALLOWED_SYNTHETIC_CLASS_IDS:
                    file_info["line_errors"].append(
                        f"line {lineno}: class id {cid} not allowed in synthetic set {sorted(ALLOWED_SYNTHETIC_CLASS_IDS)}"
                    )
                file_info["class_counts"][cid] = file_info["class_counts"].get(cid, 0) + 1
                report["class_histogram"][cid] = report["class_histogram"].get(cid, 0) + 1
                # Remaining tokens must be polygon coords (even count), each float in [0,1]
                coords = toks[1:]
                if len(coords) % 2 != 0:
                    file_info["line_errors"].append(
                        f"line {lineno}: odd number of coord tokens ({len(coords)})"
                    )
                for i, t in enumerate(coords):
                    try:
                        v = float(t)
                    except ValueError:
                        file_info["line_errors"].append(
                            f"line {lineno}: coord {i} not float: {t!r}"
                        )
                        continue
                    if not (0.0 <= v <= 1.0):
                        file_info["line_errors"].append(
                            f"line {lineno}: coord {i} = {v} out of [0,1]"
                        )
            if file_info["line_errors"]:
                report["errors"].extend(
                    [f"[{split}/{lbl.name}] {e}" for e in file_info["line_errors"]]
                )
            split_info["label_files"].append(file_info)
        report["splits"][split] = split_info

    if report["class_histogram"].get(11, 0) < 1:
        report["errors"].append("no class-11 (board) labels found in dataset")
    if report["class_histogram"].get(13, 0) < 1:
        report["errors"].append("no class-13 (pin) labels found in dataset")

    report["passed"] = not report["errors"]
    return report


def write_markdown(report: dict, out_path: Path) -> None:
    lines: list[str] = ["# Smoke Dataset Validation Report", ""]
    lines.append(f"- Dataset: `{report['dataset_dir']}`")
    lines.append(f"- Result: **{'PASS' if report['passed'] else 'FAIL'}**")
    lines.append("")
    lines.append("## Class histogram")
    lines.append("")
    lines.append("| Class ID | Count |")
    lines.append("|---:|---:|")
    for cid in sorted(report["class_histogram"]):
        lines.append(f"| {cid} | {report['class_histogram'][cid]} |")
    lines.append("")
    lines.append("## Splits")
    lines.append("")
    lines.append("| Split | Expected | Images | Labels |")
    lines.append("|---|---:|---:|---:|")
    for split, info in report["splits"].items():
        lines.append(
            f"| {split} | {info['expected']} | {info['images_found']} | {info['labels_found']} |"
        )
    lines.append("")
    if report["errors"]:
        lines.append("## Errors")
        lines.append("")
        for e in report["errors"]:
            lines.append(f"- {e}")
        lines.append("")
    if report["warnings"]:
        lines.append("## Warnings")
        lines.append("")
        for w in report["warnings"]:
            lines.append(f"- {w}")
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("debug-output/smoke-yolo-dataset")
    root = root.resolve()
    report = validate(root)
    (root / "validation-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True), encoding="utf-8"
    )
    write_markdown(report, root / "validation-report.md")
    print(f"VALIDATION_RESULT={'PASS' if report['passed'] else 'FAIL'}")
    print(f"VALIDATION_ERRORS={len(report['errors'])}")
    print(f"CLASS_HISTOGRAM={json.dumps(report['class_histogram'])}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
