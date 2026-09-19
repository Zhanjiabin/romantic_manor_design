# Billboard image regression fixtures

The reference is the user-supplied 54 x 54 bead chart from 2026-09-19.
Its printed legend provides an independent ground truth: B5 9, B23 21,
E9 193, F22 72, G8 300, H2 897, H3 10, H11 55 (1557 occupied cells).
The grid begins at approximately (29, 73) with a 18.90 px pitch.

The `teaching-sign` directory contains the second user-supplied chart, a
68 x 68 fully beaded scene. Its legend reads G3 66, G8 352, G9 317,
G12 139, G14 14, G17 28, H2 786, H7 410, H8 1410, H13 1022, H16 80:
4624 occupied cells, including its pale background and floor. Its grid begins
near (24, 65), with a 15.18 px pitch. Generate it with the additional
`teaching-sign` argument to tools/build-board-image-fixtures.cjs.

Full-size, padded and cropped scene fixtures must match every printed color
count. Reduced/compressed fixtures must keep the grid size, every occupied
cell and at least 99% intersection-over-union of the black outline mask.
Their pale shades can still shift because lossy compression mixes tiny labels
into the fill. This is not a claim of exact recovery from low-resolution images.

Fixtures store gzip-compressed RGBA bytes so Node's built-in test runner needs
no image decoding dependencies. Dimensions are in manifest.json. The JPEG,
resized, cropped and padded cases are generated from the same reference with
tools/build-board-image-fixtures.cjs (optional sharp dependency).

These tests check measured grid geometry and the printed color counts, not a
snapshot of the implementation's output. The original reference remains the
visual authority when adjusting image recovery.

Run the dependency-free algorithm tests with:

```sh
node --test tests/board-image.test.js tests/board-desk.test.js
```

With the local server running, `node tools/verify-board-image.cjs` checks the
upload, preview, apply, undo, settings and invalid-file flows in Chrome across
five viewport sizes. It needs the optional `playwright` and `sharp` packages.
Pass `teaching-sign` to validate the second chart's upload and apply flow.
`BOARD_URL` can override the default local URL. Reports and screenshots go to
the ignored `_tmp_board_browser` directory.

`node tools/inspect-board-image.cjs input.png output-directory` writes the
recovered grid, native lamp preview and diagnostic JSON. The import pipeline
handles axis-aligned regular charts; rotated or perspective-distorted photos
are not deskewed. Output remains constrained to the game's 36 x 24 lamps and
50 fixed colors. Inferred paper removal can be disabled in the dialog.
# Native lamp rendering regression

`native-lamps.rgba.gz` is the RGBA pixel data from `data/board_highlight.png`
(90 x 198). It lets dependency-free tests exercise the real game lamp colors,
including the brown/cream mapping and the final 36 x 24 reduction. Grid recovery
and printed bead counts alone do not establish the quality of the final display.
