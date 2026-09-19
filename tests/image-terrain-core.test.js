const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../web/image-terrain-core.js");

test("material mapping preserves distinct pastel regions without inventing colors", () => {
  const palette = [
    { rgb: [248, 248, 248], count: 1000 }, { rgb: [68, 36, 20], count: 300 },
    { rgb: [233, 195, 234], count: 250 }, { rgb: [249, 190, 192], count: 120 },
  ];
  const materials = [[226, 239, 250], [133, 99, 48], [188, 189, 195], [237, 192, 130], [37, 105, 12]].map(rgb => ({ rgb }));
  const nearest = core.mapPaletteToMaterials(palette, materials, "nearest");
  const distinct = core.mapPaletteToMaterials(palette, materials, "distinct");
  assert.equal(nearest[2], nearest[3]);
  assert.equal(new Set(distinct).size, 4);
  assert.equal(distinct[0], 0);
  assert.equal(distinct[1], 1);
  assert.ok(distinct.every(i => i >= 0 && i < materials.length));
});

test("near shades can share a material and zero-count colors stay unused", () => {
  const assignments = core.mapPaletteToMaterials([
    { rgb: [245, 245, 245], count: 100 }, { rgb: [240, 241, 242], count: 50 },
    { rgb: [0, 0, 0], count: 0 },
  ], [{ rgb: [226, 239, 250] }, { rgb: [133, 99, 48] }]);
  assert.deepEqual(assignments, [0, 0, -1]);
});

test("source crop excludes screenshot chrome and preserves pixel alpha", () => {
  const source = image(20, 10, [10, 20, 30]);
  setPixel(source, 7, 4, [200, 100, 50]);
  source.pixels[(4 * 20 + 7) * 4 + 3] = 80;
  const result = core.cropSource(source, { x: 0.25, y: 0.2, w: 0.5, h: 0.6 });
  assert.equal(result.width, 10);
  assert.equal(result.height, 6);
  assert.deepEqual([...result.pixels.slice((2 * 10 + 2) * 4, (2 * 10 + 2) * 4 + 4)], [200, 100, 50, 80]);
  assert.equal(core.cropSource(source, null), source);
});

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

function chart(cols, rows, stepX, stepY = stepX, options = {}) {
  const x0 = options.x0 ?? 17, y0 = options.y0 ?? 29;
  const source = image(Math.ceil(x0 + cols * stepX + 24), Math.ceil(y0 + rows * stepY + 37));
  for (let y = Math.floor(y0); y <= Math.ceil(y0 + rows * stepY); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x0 + cols * stepX); x++) {
      const gx = (x - x0) / stepX, gy = (y - y0) / stepY;
      const col = Math.floor(gx), row = Math.floor(gy);
      const edge = Math.abs(gx - Math.round(gx)) * stepX < 0.65
        || Math.abs(gy - Math.round(gy)) * stepY < 0.65;
      let rgb = options.fill?.(col, row) || [240, 240, 240];
      if (edge) rgb = options.line || [80, 80, 80];
      else if (options.labels?.(col, row)) {
        const fx = gx - col, fy = gy - row;
        if (fy > 0.39 && fy < 0.61 && fx > 0.3 && fx < 0.7) {
          rgb = rgb[0] + rgb[1] + rgb[2] > 400 ? [20, 20, 20] : [250, 250, 250];
        }
      }
      setPixel(source, x, y, rgb);
    }
  }
  return source;
}

test("grid dimensions and fractional pitch are measured independently", () => {
  for (const [cols, rows, sx, sy] of [[31, 27, 12, 12], [17, 19, 21, 21], [12, 9, 70, 70], [47, 35, 9.45, 9.45], [24, 16, 20, 14]]) {
    const source = chart(cols, rows, sx, sy, { labels: () => true });
    const grid = core.detectGrid(source);
    assert.ok(grid, `${cols} x ${rows}`);
    assert.deepEqual([grid.cols, grid.rows], [cols, rows]);
    assert.ok(Math.abs(grid.stepX - sx) < 0.15 && Math.abs(grid.stepY - sy) < 0.15);
    assert.equal(grid.autoSuitable, true);
  }
});

test("colored numbered borders are excluded without a fixed border color or grid size", () => {
  for (const color of [[190, 60, 65], [40, 155, 100], [100, 90, 200]]) {
    const cols = 25, rows = 18;
    const source = chart(cols + 2, rows + 2, 18, 18, {
      fill: (x, y) => x === 0 || y === 0 || x === cols + 1 || y === rows + 1 ? color : [250, 250, 250],
      labels: (x, y) => x === 0 || y === 0 || x === cols + 1 || y === rows + 1,
    });
    const grid = core.detectGrid(source);
    assert.deepEqual([grid.cols, grid.rows], [cols, rows]);
    assert.equal(grid.rulers, 2);
    assert.equal(grid.autoSuitable, true);
  }
});

test("unlabeled colored borders are artwork and regular unlabeled textures stay out of auto mode", () => {
  const source = chart(22, 16, 18, 18, {
    fill: (x, y) => x === 0 || y === 0 || x === 21 || y === 15 ? [175, 50, 60] : [210, 220, 230],
  });
  const grid = core.detectGrid(source);
  assert.deepEqual([grid.cols, grid.rows], [22, 16]);
  assert.equal(grid.autoSuitable, false);
  assert.deepEqual(core.sampleGrid(source, grid)[0].rgb, [175, 50, 60]);
});

test("light lines on dark fills and white labels retain the cell fill", () => {
  const source = chart(23, 15, 18, 18, {
    fill: (x) => x < 12 ? [25, 40, 65] : [50, 90, 35],
    line: [200, 210, 230], labels: () => true,
  });
  const grid = core.detectGrid(source);
  assert.deepEqual([grid.cols, grid.rows], [23, 15]);
  assert.equal(grid.autoSuitable, true);
  const samples = core.sampleGrid(source, grid);
  assert.deepEqual(samples[8 * 23 + 4].rgb, [25, 40, 65]);
  assert.deepEqual(samples[8 * 23 + 16].rgb, [50, 90, 35]);
});

test("white artwork survives labels and enclosed regions while external paper is blank", () => {
  for (const labeled of [false, true]) {
    const source = chart(20, 16, 18, 18, {
      fill: (x, y) => x >= 5 && x <= 14 && y >= 3 && y <= 12
        && (x === 5 || x === 14 || y === 3 || y === 12) ? [35, 40, 55] : [250, 250, 250],
      labels: (x, y) => labeled && x > 5 && x < 14 && y > 3 && y < 12 && !(x === 9 && y === 7),
    });
    const grid = core.detectGrid(source), samples = core.sampleGrid(source, grid);
    assert.equal(samples[0].rgb, null);
    assert.deepEqual(samples[7 * 20 + 9].rgb, [250, 250, 250]);
    assert.deepEqual(samples[3 * 20 + 8].rgb, [35, 40, 55]);
    assert.deepEqual(core.sampleGrid(source, grid, 0, { background: "keep" })[0].rgb, [250, 250, 250]);
  }
});

test("gradients, stripes, continuous textures, and pixel blocks do not trigger automatic chart recognition", () => {
  const painters = [
    (x, y) => [x * 255 / 360, y * 255 / 240, (x + y) * 255 / 600],
    x => x % 20 < 3 ? [20, 20, 20] : [230, 230, 230],
    (x, y) => [100 + 50 * Math.sin(x / 11) * Math.sin(y / 17), 120, 140],
    (x, y) => (Math.floor(x / 18) + Math.floor(y / 18)) % 2 ? [20, 60, 120] : [245, 245, 245],
  ];
  for (const paint of painters) {
    const source = image(360, 240);
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) setPixel(source, x, y, paint(x, y));
    assert.ok(!core.detectGrid(source)?.autoSuitable);
  }
});

test("light cleanup protects certain single-cell details and grid cells", () => {
  const cells = Array.from({ length: 49 }, (_, i) => ({ u: i % 7, v: Math.floor(i / 7), confidence: 0.95 }));
  const indices = new Array(49).fill(0);
  indices[24] = 1;
  assert.deepEqual(core.cleanTerrainIndices(cells, indices, "light").indices, indices);
  cells[24].confidence = 0.3;
  assert.equal(core.cleanTerrainIndices(cells, indices, "light").indices[24], 0);
  cells[24].gridCell = true;
  assert.equal(core.cleanTerrainIndices(cells, indices, "light").indices[24], 1);
  assert.equal(core.cleanTerrainIndices(cells, indices, "strong").indices[24], 0);
});

test("transparent holes stay blank at every cleanup strength and zero-alpha pixels never become color", () => {
  const cells = Array.from({ length: 25 }, (_, i) => ({ u: i % 5, v: Math.floor(i / 5) }));
  const indices = new Array(25).fill(0);
  indices[12] = -1;
  for (const strength of ["none", "light", "strong"]) {
    assert.equal(core.cleanTerrainIndices(cells, indices, strength).indices[12], -1);
  }
  const source = image(30, 30, [200, 80, 120]);
  for (let i = 3; i < source.pixels.length; i += 4) source.pixels[i] = 0;
  assert.equal(core.enhancedSample(source, 15, 15, 8, 8, 0).rgb, null);
});
