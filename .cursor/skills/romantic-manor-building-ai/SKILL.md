---
name: romantic-manor-building-ai
description: Automatically designs Romantic Manor buildings from a theme or reference, selects verified project materials, assembles isometric layers, generates importable building papers, and validates previews. Use when the user asks AI to 拼建筑、自动设计建筑、仿造建筑、按主题出图纸 or generate a Romantic Manor building layout.
---

# 浪漫庄园 AI 自动拼建筑

## Goal

Turn a design brief or reference image into:

1. A reusable JSON layout specification.
2. A validated `V1;` building paper.
3. A visual preview in the building desk.
4. A short material/layer report.

## Workflow

1. Read `.cursor/rules/building-pack-uids-locked.mdc` and
   `.cursor/rules/building-base-frame-locked.mdc`. Their mappings and frame
   placement are invariants.
2. Clarify only missing design choices that materially change the result:
   theme, intended base/frame, approximate footprint, symmetry, density, and
   whether a reference image should be matched.
3. Inspect `/api/editor-catalog` or `data/building_uid_map.json`. Never invent
   a material ID or borrow a missing frame from another pack.
4. Build back-to-front:
   - foundation/floor accents;
   - rear walls and tall rear props;
   - structural middle layer;
   - front trim and small props;
   - optional effects.
5. Align repeated parts on the 2:1 isometric axes. Use screen vectors `(2, 1)`
   and `(2, -1)`; sort overlapping records by their ground contact depth, not
   by the direction the line was drawn.
6. Save the specification under `ai_builds/<name>.json`. Follow
   [REFERENCE.md](REFERENCE.md).
7. Generate the paper:

   ```shell
   python .cursor/skills/romantic-manor-building-ai/scripts/build_paper.py \
     --spec ai_builds/<name>.json \
     --out ai_builds/<name>.txt
   ```

8. Import the paper in `web/building.html`, inspect the export preview, and
   correct gaps, collisions, wrong facing, or depth order. Do not compensate
   by moving or scaling the locked base mask.
9. Run the generator again after every spec change. Finish only when its
   round-trip validation passes.

## Layout rules

- A game-ready layout must preserve a real `mat=0` header from a compatible
  seed paper or provide its verified native `x`, `y`, and `state`.
- Keep authored visible record coordinates in `0..2047` and states in `0..63`.
  The codec can hold uint15 values, but wrapped/off-screen coordinates are not
  valid layout evidence.
- For mapped packs, encode `mat = uid * 1000 + local`.
- An unmapped pack may use local IDs only when it is the single declared
  `localPack`; never mix several unmapped packs.
- Movement changes `x/y` only. It must not silently reorder records.
- Put groups in the JSON spec for editing clarity, but remember that the game
  paper stores only record order.
- Repeated upright props use ground-footprint spacing. Do not space them by
  full image height.
- Preserve deliberate overlap while preventing accidental same-position
  duplicates.

## Verification checklist

- Generator reports a successful decode/encode round trip.
- Every material exists in the declared pack.
- Mixed-theme IDs resolve through the locked UID mapping.
- Rear records precede foreground records.
- The preview has no front grass gap, crossed depth order, or clipped material.
- The exported paper reimports with the same visible record count.

