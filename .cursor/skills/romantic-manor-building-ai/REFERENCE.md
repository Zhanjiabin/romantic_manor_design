# Layout specification

```json
{
  "name": "石阶花园",
  "localPack": null,
  "header": { "x": 280, "y": 180, "state": 12 },
  "sort": "preserve",
  "records": [
    {
      "pack": "bazaar",
      "local": 124,
      "x": 320,
      "y": 210,
      "state": 0,
      "group": "rear-wall",
      "label": "后墙左"
    }
  ]
}
```

## Fields

- `header`: verified native `mat=0` room header. Prefer `seedPaper` instead of
  typing this manually.
- `seedPaper`: repository-relative path to an existing compatible building
  paper. The generator copies its first `mat=0` record.
- `localPack`: the only pack allowed to emit bare local IDs when that pack has
  no locked UID. Omit it for mapped or mixed-theme layouts.
- `sort`:
  - `preserve` keeps the authored back-to-front record order.
  - `depth` sorts records by `depth`, then `y`, then `x`.
- `records[].mat`: optional explicit encoded material ID.
- `records[].pack` and `records[].local`: preferred material reference. The
  generator checks `data/building_uid_map.json`.
- `records[].depth`: optional numeric layer used only by `sort: "depth"`.
- `group` and `label`: authoring metadata; they are not written into `V1;`.

## Coordinate conventions

The specification uses building-paper coordinates, not terrain grid cells.
Screen-space isometric directions are:

- down-right: `(2, 1)`
- up-right: `(2, -1)`

Generate a run with:

```text
x = startX + 2 * unit * index
y = startY + direction * unit * index
```

Use the sprite's ground contact area to choose `unit`; image height includes
upright content and is not footprint depth.

## Locked data

- Pack UID mapping: `data/building_pack_uids.json`
- Material existence: `data/building_uid_map.json`
- Paper codec: `codec/building.py`

Missing locals remain errors. Never shift UID keys, infer a UID from
`formula.tab`, or use another pack's frame.

