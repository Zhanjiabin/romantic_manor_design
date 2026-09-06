const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../web/image-terrain-core.js");

function image(width, height, rgb = [245, 245, 245]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
    pixels[offset + 3] = 255;
  }
  return { width, height, pixels };
}

function setPixel(source, x, y, rgb) {
  const offset = (y * source.width + x) * 4;
  source.pixels[offset] = rgb[0];
  source.pixels[offset + 1] = rgb[1];
  source.pixels[offset + 2] = rgb[2];
  source.pixels[offset + 3] = 255;
}

test("enhanced sampling ignores a thin label through a cell", () => {
  const source = image(21, 21, [238, 232, 220]);
  for (let i = 3; i < 18; i++) {
    setPixel(source, 10, i, [35, 35, 35]);
    setPixel(source, i, 10, [35, 35, 35]);
  }
  const point = core.pixelRgb(source, 10, 10);
  const enhanced = core.enhancedSample(source, 10, 10, 9, 9);
  assert.deepEqual(point, [35, 35, 35]);
  assert.ok(enhanced.rgb[0] > 220);
  assert.ok(enhanced.confidence > 0.6);
});

test("grid detection finds a periodic chart and grid sampling avoids lines and center text", () => {
  const source = image(180, 180, [252, 252, 252]);
  const start = 18;
  const step = 12;
  const cells = 12;
  for (let i = 0; i <= cells; i++) {
    const at = start + i * step;
    for (let p = start; p <= start + cells * step; p++) {
      setPixel(source, at, p, [90, 90, 90]);
      setPixel(source, p, at, [90, 90, 90]);
    }
  }
  for (let row = 3; row <= 8; row++) {
    for (let col = 2; col <= 9; col++) {
      for (let y = start + row * step + 1; y < start + (row + 1) * step; y++) {
        for (let x = start + col * step + 1; x < start + (col + 1) * step; x++) {
          setPixel(source, x, y, [103, 72, 48]);
        }
      }
      setPixel(source, start + col * step + 6, start + row * step + 6, [250, 250, 250]);
    }
  }
  for (let x = start + step + 4; x <= start + step + 8; x++) {
    setPixel(source, x, start + step + 6, [30, 30, 30]);
  }
  for (let y = start + step + 4; y <= start + step + 8; y++) {
    setPixel(source, start + step + 6, y, [30, 30, 30]);
  }
  const grid = core.detectGrid(source, { minPeriod: 9, maxPeriod: 16, minConfidence: 0.08 });
  assert.ok(grid);
  assert.ok(Math.abs(grid.stepX - step) < 1);
  assert.ok(Math.abs(grid.stepY - step) < 1);
  assert.equal(grid.cols, 12);
  assert.equal(grid.rows, 12);
  const sampled = core.gridSample(source, grid, 0.45, 0.5);
  assert.ok(sampled.rgb[0] < 140);
  assert.ok(sampled.confidence > 0.5);
  const blank = core.gridSample(source, grid, 0.04, 0.04);
  assert.equal(blank.rgb, null);
  assert.equal(blank.blank, true);
  const labeledWhite = core.gridSample(source, grid, 1.5 / 12, 1.5 / 12);
  assert.ok(labeledWhite.rgb[0] > 230);
  assert.equal(labeledWhite.labeled, true);
});

test("grid mode can safely fall back when no periodic chart exists", () => {
  const source = image(120, 90, [80, 150, 210]);
  assert.equal(core.detectGrid(source), null);
});

test("regional sampling respects transparent source pixels", () => {
  const source = image(20, 20, [120, 80, 40]);
  for (let offset = 3; offset < source.pixels.length; offset += 4) source.pixels[offset] = 0;
  const sampled = core.enhancedSample(source, 10, 10, 6, 6, 16);
  assert.equal(sampled.rgb, null);
  assert.equal(sampled.confidence, 0);
});

test("cleanup removes isolated noise but preserves supported runs", () => {
  const cells = [];
  for (let u = 0; u < 5; u++) {
    for (let v = 0; v < 5; v++) cells.push({ u, v });
  }
  const indexOf = (u, v) => cells.findIndex((cell) => cell.u === u && cell.v === v);
  const isolated = new Array(cells.length).fill(0);
  isolated[indexOf(2, 2)] = 1;
  const cleaned = core.cleanTerrainIndices(cells, isolated, "light");
  assert.equal(cleaned.indices[indexOf(2, 2)], 0);
  assert.equal(cleaned.changed, 1);

  const run = new Array(cells.length).fill(0);
  run[indexOf(1, 2)] = 1;
  run[indexOf(2, 2)] = 1;
  run[indexOf(3, 2)] = 1;
  const kept = core.cleanTerrainIndices(cells, run, "light");
  assert.equal(kept.indices[indexOf(2, 2)], 1);
});

test("split detail keeps similar browns as separate plots", () => {
  const fur = { rgb: [176, 122, 72], count: 80 };
  const outline = { rgb: [72, 44, 26], count: 24 };
  const wood = { rgb: [128, 78, 42], count: 40 };
  const hat = { rgb: [236, 196, 64], count: 18 };
  const merged = core.clusterPalette([fur, outline, wood, hat], 3, core.detailPreset("merge"));
  const split = core.clusterPalette([fur, outline, wood, hat], 4, core.detailPreset("split"));
  const luma = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const mergedSpread = Math.max(...merged.map((row) => luma(row.rgb))) - Math.min(...merged.map((row) => luma(row.rgb)));
  const splitLumas = split.map((row) => luma(row.rgb)).sort((a, b) => a - b);
  assert.ok(split.length >= 4);
  assert.ok(splitLumas[0] < 55);
  assert.ok(splitLumas[splitLumas.length - 1] > 140);
  assert.ok(splitLumas[splitLumas.length - 1] - splitLumas[0] >= mergedSpread);
});

test("light cleanup dissolves two-cell specks but keeps a three-cell run and background holes", () => {
  const cells = [];
  for (let u = 0; u < 7; u++) {
    for (let v = 0; v < 7; v++) cells.push({ u, v });
  }
  const indexOf = (u, v) => cells.findIndex((cell) => cell.u === u && cell.v === v);
  const speck = new Array(cells.length).fill(0);
  speck[indexOf(2, 2)] = 1;
  speck[indexOf(3, 2)] = 1;
  const cleaned = core.cleanTerrainIndices(cells, speck, "light");
  assert.equal(cleaned.indices[indexOf(2, 2)], 0);
  assert.equal(cleaned.indices[indexOf(3, 2)], 0);
  assert.equal(cleaned.changed, 2);

  const run = new Array(cells.length).fill(0);
  run[indexOf(2, 3)] = 1;
  run[indexOf(3, 3)] = 1;
  run[indexOf(4, 3)] = 1;
  assert.equal(core.cleanTerrainIndices(cells, run, "light").changed, 0);

  const hole = new Array(cells.length).fill(0);
  hole[indexOf(3, 3)] = -1;
  hole[indexOf(4, 3)] = -1;
  const kept = core.cleanTerrainIndices(cells, hole, "light");
  assert.equal(kept.indices[indexOf(3, 3)], -1);
  assert.equal(kept.indices[indexOf(4, 3)], -1);
});

test("low-confidence specks follow the surrounding majority but high-confidence details stay", () => {
  const cells = [];
  for (let u = 0; u < 7; u++) {
    for (let v = 0; v < 7; v++) cells.push({ u, v, confidence: 0.9 });
  }
  const indexOf = (u, v) => cells.findIndex((cell) => cell.u === u && cell.v === v);
  const noisy = new Array(cells.length).fill(0);
  noisy[indexOf(3, 3)] = 1;
  cells[indexOf(3, 3)].confidence = 0.2;
  noisy[indexOf(4, 3)] = 1;
  cells[indexOf(4, 3)].confidence = 0.2;
  const cleaned = core.cleanTerrainIndices(cells, noisy, "light");
  assert.equal(cleaned.indices[indexOf(3, 3)], 0);
  assert.equal(cleaned.indices[indexOf(4, 3)], 0);

  const kept = new Array(cells.length).fill(0);
  kept[indexOf(3, 3)] = 1;
  cells[indexOf(3, 3)].confidence = 0.9;
  kept[indexOf(4, 3)] = 1;
  cells[indexOf(4, 3)].confidence = 0.9;
  kept[indexOf(5, 3)] = 1;
  cells[indexOf(5, 3)].confidence = 0.9;
  assert.equal(core.cleanTerrainIndices(cells, kept, "light").indices[indexOf(4, 3)], 1);
});

test("no-cleanup mode is an exact copy", () => {
  const cells = [{ u: 0, v: 0 }, { u: 1, v: 0 }];
  const original = [1, -1];
  const result = core.cleanTerrainIndices(cells, original, "none");
  assert.deepEqual(result.indices, original);
  assert.notEqual(result.indices, original);
  assert.equal(result.changed, 0);
});
