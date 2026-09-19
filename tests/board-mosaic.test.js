"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../web/board-mosaic.js");
const Image = require("../web/board-image.js");

test("mosaic presets retain native resolution and custom holes", () => {
  for (const [name, cols, rows, count] of [["four", 2, 2, 4], ["nine", 3, 3, 9], ["horizontal", 4, 1, 4], ["vertical", 1, 4, 4], ["cross", 3, 3, 5], ["l", 3, 3, 5], ["heart", 5, 4, 11]]) {
    const layout = M.preset(name);
    assert.equal(layout.cols * M.COLS, cols * 36);
    assert.equal(layout.rows * M.ROWS, rows * 24);
    assert.equal(M.tiles(layout).length, count);
  }
  assert.throws(() => M.normalize({ cols: 0 }), /1–12/);
  assert.throws(() => M.normalize({ cols: 12, rows: 12 }), /64/);
  assert.throws(() => M.normalize({ mask: [false] }), /至少/);
  assert.throws(() => M.normalize({ cols: 2, rows: 2, mask: [true] }), /至少/);
});

test("splitting a complete image and joining tiles is lossless at every seam", () => {
  for (const name of ["four", "nine", "horizontal", "vertical", "l", "heart"]) {
    const layout = M.preset(name), count = layout.cols * 36 * layout.rows * 24;
    const page = M.clean(Uint8Array.from({ length: count }, (_, i) => (i * 7 + Math.floor(i / (layout.cols * 36))) % 50), layout);
    const joined = new Uint8Array(count).fill(50);
    for (const tile of M.tiles(layout)) {
      const chunk = M.extract(page, layout, tile.index);
      assert.equal(chunk.length, 864);
      M.insert(joined, layout, tile.index, chunk);
    }
    assert.deepEqual(joined, page);
  }
});

test("image is sampled once at mosaic resolution, not squeezed separately into every board", () => {
  const layout = M.preset("nine"), width = 108, height = 72;
  const palette = ["#ff0000", "#00ff00", "#0000ff", "#000000"];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = (x + y) % 3, i = (y * width + x) * 4;
    data[i + color] = 255; data[i + 3] = 255;
  }
  const result = Image.analyze({ width, height, data }, palette, { mode: "photo", background: "keep", crop: false, sampling: "nearest", cols: width, rows: height });
  for (const tile of M.tiles(layout)) {
    const chunk = M.extract(result.page, layout, tile.index);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 36; x++) assert.equal(chunk[y * 36 + x], (tile.col * 36 + x + tile.row * 24 + y) % 3);
  }
});

test("layout resizing preserves coordinates and does not wrap rows or fill removed tiles", () => {
  const from = M.preset("four"), to = M.preset("l");
  const page = new Uint8Array(72 * 48).fill(50);
  M.insert(page, from, 0, new Uint8Array(864).fill(2));
  M.insert(page, from, 2, new Uint8Array(864).fill(3));
  const resized = M.remap(page, from, to);
  assert.ok(M.extract(resized, to, 0).every(v => v === 2));
  assert.ok(M.extract(resized, to, 3).every(v => v === 3));
  assert.ok(M.extract(resized, to, 6).every(v => v === 50));
  assert.equal(M.hasCell(to, 36, 0), false);
});

test("both game orientations share continuous horizontal and vertical edges", () => {
  for (const facing of [0, 1]) {
    const view = M.VIEWS[facing], tiles = M.placement(M.preset("nine"), facing);
    for (const tile of tiles) {
      const right = tiles.find(t => t.col === tile.col + 1 && t.row === tile.row);
      const below = tiles.find(t => t.col === tile.col && t.row === tile.row + 1);
      if (right) { assert.equal(tile.dx + view.width, right.dx); assert.equal(tile.dy + view.width * view.slope, right.dy); }
      if (below) { assert.equal(tile.dx, below.dx); assert.equal(tile.dy + view.height, below.dy); }
    }
  }
});
