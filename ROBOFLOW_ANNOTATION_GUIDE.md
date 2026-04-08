# Roboflow Annotation Guide — Board & Hinge (Classes 11 & 12)

## What you're adding

| Class ID | Name | Type | What to draw |
|----------|------|------|--------------|
| 11 | `board` | **Polygon / Smart Polygon** | The full board tray outline |
| 12 | `hinge` | **Bounding Box** | The cylindrical hinge bar at the top edge |

Class names must be **exactly** `board` and `hinge` (lowercase) — these must match the names in `dataset.yaml`.

---

## Step 1 — Add the two new classes in Roboflow

1. Open your project in Roboflow
2. Go to **Settings → Classes**
3. Add class: `board` — set type to **Polygon**
4. Add class: `hinge` — set type to **Bounding Box**

Verify the class list looks like this when done:

```
0  A_Yellow
1  B_SkyBlue
2  C_DarkBlue
3  D_Green
4  E_Red
5  F_Teal
6  G_Pink
7  H_Purple
8  I_Orange
9  J_DarkRed
10 K_YellowGreen
11 board          ← new
12 hinge          ← new
```

---

## Step 2 — Annotate `board` (class 11)

Use **Smart Polygon** (Roboflow's AI-assisted tool) — it works well on the dark board tray.

Draw around the **full outer edge of the board tray** including the raised rim.
Do **not** include the lid or the hinge bar itself.

**Tips:**
- Click the board edge roughly, then let Smart Polygon snap to it
- The polygon should follow the board's non-rectangular octagon/diamond shape
- If the board is partially out of frame, still annotate the visible portion

---

## Step 3 — Annotate `hinge` (class 12)

Use a **Bounding Box**.

Draw a tight rectangle around the **full-width cylindrical bar** at the top edge of the board (the barrel hinge connecting the tray to the lid).

**Tips:**
- The box should span the entire width of the hinge, edge to edge
- Include the full height of the cylinder (it protrudes above the board surface)
- If the hinge is partially hidden by pieces, still draw the full expected bbox
- The lid does **not** need to be annotated — only the hinge bar itself

---

## Step 4 — Which images to annotate

Annotate **every image where the board is visible** (you don't need to annotate images where the board is completely out of frame or fully hidden).

For images where the hinge is hidden by a piece or cut off at the edge:
- Still annotate `board` (the board is still visible)
- Skip `hinge` if it is genuinely not visible

---

## Step 5 — Export updated dataset

1. Click **Generate** → create a new dataset version
2. Export format: **YOLOv8** (segmentation)
3. Download and replace `data/noodles_finetune_dataset/` with the new export
4. Verify `data/noodles_finetune_dataset/dataset.yaml` shows `nc: 13` and all 13 names

Then re-run **notebook 04** to fine-tune on the updated real data.
