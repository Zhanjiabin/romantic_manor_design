"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BoardImage = require("../web/board-image.js");
const native = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/board_native.json"), "utf8"));
const palette = native.palette;
const DARK = 50;

function source(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = paint(x, y) || [248, 248, 248];
      const o = (y * width + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

function colorGrid(cols, rows, cell, fill) {
  const width = cols * cell + 1;
  const height = rows * cell + 1;
  return source(width, height, (x, y) => {
    if (x % cell === 0 || y % cell === 0) return [70, 70, 70];
    return fill(Math.floor(x / cell), Math.floor(y / cell));
  });
}

test("background is separate from color matching, including white and dark artwork", () => {
  assert.equal(BoardImage.isPaper([245, 245, 245]), true);
  assert.equal(BoardImage.nearestFrame(null, palette, DARK), DARK);
  assert.equal(BoardImage.nearestFrame([245, 245, 245], palette, DARK), 48);
  assert.notEqual(BoardImage.nearestFrame([20, 20, 20], palette, DARK), DARK);
  assert.notEqual(BoardImage.nearestFrame([48, 160, 64], palette, DARK), DARK);
  assert.notEqual(BoardImage.nearestFrame([103, 75, 60], palette, DARK), DARK);
  const brown = BoardImage.nearestFrame([73, 44, 26], palette, DARK);
  const green = BoardImage.nearestFrame([45, 60, 21], palette, DARK);
  const mauve = BoardImage.nearestFrame([210, 172, 209], palette, DARK);
  const rose = BoardImage.nearestFrame([175, 130, 129], palette, DARK);
  assert.notEqual(brown, DARK);
  assert.notEqual(green, DARK);
  assert.notEqual(mauve, 42, "muted mauve must not be forced to neon magenta");
  assert.notEqual(rose, 42, "muted rose must not be forced to neon magenta");
  const reordered = palette.slice().reverse();
  assert.equal(reordered[BoardImage.nearestFrame([103, 75, 60], reordered)], palette[BoardImage.nearestFrame([103, 75, 60], palette)]);
});

test("color-code grid ignores center labels and keeps fills on", () => {
  const brown = [120, 72, 40];
  const green = [48, 160, 64];
  const pink = [232, 150, 150];
  const image = colorGrid(24, 20, 16, (col, row) => {
    if (col >= 8 && col <= 16 && row >= 3 && row <= 7) return green;
    if (col >= 6 && col <= 18 && row >= 8 && row <= 16) return brown;
    if (col >= 4 && col <= 7 && row >= 10 && row <= 15) return pink;
    return [248, 248, 248];
  });
  // Only put dark glyphs on filled cells (like 画像素 color codes), not on empty paper.
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 24; col += 1) {
      const filled = (col >= 8 && col <= 16 && row >= 3 && row <= 7)
        || (col >= 6 && col <= 18 && row >= 8 && row <= 16)
        || (col >= 4 && col <= 7 && row >= 10 && row <= 15);
      if (!filled) continue;
      const x0 = col * 16 + 6;
      const y0 = row * 16 + 6;
      for (let y = y0; y < y0 + 5; y += 1) {
        for (let x = x0; x < x0 + 5; x += 1) {
          const o = (y * image.width + x) * 4;
          image.data[o] = 20;
          image.data[o + 1] = 20;
          image.data[o + 2] = 20;
        }
      }
    }
  }
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "grid");
  const lit = result.page.filter((frame) => frame !== DARK);
  assert.ok(lit.length > 40, "shape should light some bulbs");
  assert.ok(result.page.filter((frame) => frame === DARK).length > 200);
  assert.equal(result.page.includes(49), false, "paper must not become white LEDs");
});

test("color-code grid is detected, clustered, and fit into 36x24", () => {
  const brown = [120, 72, 40];
  const green = [48, 160, 64];
  const pink = [232, 150, 150];
  const image = colorGrid(24, 20, 16, (col, row) => {
    if (col >= 8 && col <= 16 && row >= 3 && row <= 7) return green;
    if (col >= 6 && col <= 18 && row >= 8 && row <= 16) return brown;
    if (col >= 4 && col <= 7 && row >= 10 && row <= 15) return pink;
    return [248, 248, 248];
  });
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "grid");
  assert.equal(result.page.length, 36 * 24);
  assert.ok(result.grid.cols >= 12);
  assert.ok(result.grid.rows >= 10);
  assert.ok(result.colors.length >= 2);
  const lit = result.page.filter((frame) => frame !== DARK);
  const off = result.page.filter((frame) => frame === DARK);
  assert.ok(lit.length > 40, "shape should light some bulbs");
  assert.ok(off.length > 200, "paper should stay off");
  assert.equal(result.page.includes(49), false, "paper must not become white LEDs");
  assert.deepEqual(result.grid.detected, [24, 20]);
});

test("large color-code cells still detect as a bead grid", () => {
  const brown = [120, 72, 40];
  const image = colorGrid(18, 16, 48, (col, row) => {
    if (col >= 4 && col <= 14 && row >= 3 && row <= 12) return brown;
    return [248, 248, 248];
  });
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "grid");
  assert.ok(result.grid.cols >= 10);
  assert.ok(result.page.filter((frame) => frame !== DARK).length > 20);
  assert.equal(result.page.includes(49), false);
});

test("white bead cells with center glyphs become white lamps, empty paper stays off", () => {
  const image = colorGrid(20, 16, 16, (col, row) => {
    if (col >= 6 && col <= 13 && row >= 4 && row <= 11) return [248, 248, 248];
    return [248, 248, 248];
  });
  for (let row = 4; row <= 11; row += 1) {
    for (let col = 6; col <= 13; col += 1) {
      const x0 = col * 16 + 6;
      const y0 = row * 16 + 6;
      for (let y = y0; y < y0 + 5; y += 1) {
        for (let x = x0; x < x0 + 5; x += 1) {
          const o = (y * image.width + x) * 4;
          image.data[o] = 30;
          image.data[o + 1] = 30;
          image.data[o + 2] = 30;
        }
      }
    }
  }
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "grid");
  const white = result.page.filter((frame) => frame === 48 || frame === 49).length;
  assert.ok(white >= 8, "H2-style white beads should light white lamps");
  assert.ok(result.page.filter((frame) => frame === DARK).length > 200);
});

test("center glyphs on white paper become lamp color", () => {
  const brown = [92, 56, 28];
  const image = colorGrid(20, 16, 16, () => [248, 248, 248]);
  for (let row = 4; row <= 11; row += 1) {
    for (let col = 6; col <= 13; col += 1) {
      for (let y = row * 16 + 4; y < row * 16 + 12; y += 1) {
        for (let x = col * 16 + 4; x < col * 16 + 12; x += 1) {
          const o = (y * image.width + x) * 4;
          image.data[o] = brown[0];
          image.data[o + 1] = brown[1];
          image.data[o + 2] = brown[2];
        }
      }
    }
  }
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "grid");
  assert.ok(result.page.filter((frame) => frame !== DARK).length > 20);
  assert.equal(result.page.includes(49), false);
});

test("plain photos still quantize without inventing a grid", () => {
  const image = source(240, 160, (x, y) => {
    if (x > 40 && x < 200 && y > 30 && y < 130) return [40, 90, 200];
    return [252, 252, 252];
  });
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK, crop: false });
  assert.equal(result.mode, "photo");
  assert.equal(result.grid, null);
  const lit = result.page.filter((frame) => frame !== DARK);
  assert.ok(lit.length > 80);
  assert.ok(result.page.filter((frame) => frame === DARK).length > 80);
});

test("unusual grid dimensions are measured without snapping to common chart sizes", () => {
  for (const [cols, rows, size] of [[31, 27, 12], [87, 73, 8], [12, 9, 70]]) {
    const image = colorGrid(cols, rows, size, (x, y) => x > 2 && y > 2 && x < cols - 3 && y < rows - 3 ? [180, 90, 160] : [248, 248, 248]);
    const grid = BoardImage.detectGrid(image);
    assert.ok(grid, `${cols} x ${rows} must be detected`);
    assert.deepEqual([grid.cols, grid.rows], [cols, rows]);
    assert.ok(Math.abs(grid.stepX - size) < 0.1);
  }
});

test("grid sampling retains red, blue, gray, black and an unlabeled colored border", () => {
  const fills = [[210, 30, 30], [130, 140, 220], [150, 150, 150], [10, 10, 10]];
  const image = colorGrid(24, 20, 16, (x, y) => x === 0 || y === 0 || x === 23 || y === 19 ? fills[0] : fills[Math.floor(x / 6)]);
  const grid = BoardImage.detectGrid(image);
  assert.deepEqual([grid.cols, grid.rows], [24, 20]);
  const cells = BoardImage.sampleGrid(image, grid);
  for (const [x, rgb] of [[3, fills[0]], [8, fills[1]], [14, fills[2]], [20, fills[3]]]) {
    assert.deepEqual(cells[10 * 24 + x], rgb);
  }
});

test("white inside an outline stays visible and external paper is removed", () => {
  const image = colorGrid(20, 16, 16, (x, y) => {
    const edge = x >= 5 && x <= 14 && y >= 3 && y <= 12 && (x === 5 || x === 14 || y === 3 || y === 12);
    return edge ? [20, 20, 20] : [248, 248, 248];
  });
  const grid = BoardImage.detectGrid(image), cells = BoardImage.sampleGrid(image, grid);
  assert.equal(cells[0], null);
  assert.deepEqual(cells[8 * 20 + 10], [248, 248, 248]);
  assert.deepEqual(cells[3 * 20 + 10], [20, 20, 20]);
});

test("transparent native pixel art preserves every pixel and white foreground", () => {
  const image = source(36, 24, (x, y) => x < 18 ? [255, 255, 255] : [0, 0, 0]);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 4; x++) image.data[(y * 36 + x) * 4 + 3] = 0;
  const result = BoardImage.analyze(image, ["#000000", "#ffffff"], { crop: false, sampling: "nearest" });
  assert.equal(result.mode, "photo");
  assert.equal(result.page.length, 864);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 36; x++) assert.equal(result.page[y * 36 + x], x < 4 ? DARK : x < 18 ? 1 : 0);
});

test("raster fitting preserves aspect ratio and supports retaining the background", () => {
  const image = source(20, 40, () => [40, 90, 200]);
  const result = BoardImage.analyze(image, palette);
  for (let y = 0; y < 24; y++) assert.equal(result.page.slice(y * 36, (y + 1) * 36).filter(c => c !== DARK).length, 12);
  const white = source(16, 16, () => [255, 255, 255]);
  assert.ok(BoardImage.analyze(white, palette).page.every(c => c === DARK));
  assert.equal(BoardImage.analyze(white, palette, { background: "keep" }).page.filter(c => c === 49).length, 24 * 24);
});

test("continuous-tone images do not invent a grid", () => {
  const image = source(360, 240, (x, y) => [x * 255 / 360, y * 255 / 240, (x + y) * 255 / 600]);
  assert.equal(BoardImage.analyze(image, palette).mode, "photo");
});

test("invalid data fails explicitly and custom off-frame is respected", () => {
  assert.throws(() => BoardImage.analyze({ width: 10, height: 10, data: [] }, palette), /像素数据/);
  const image = source(20, 40, () => [0, 0, 0]);
  const result = BoardImage.analyze(image, ["#000000", "#ffffff"], { dark: 2 });
  assert.ok(result.page.every(c => c === 0 || c === 2));
  assert.throws(() => BoardImage.analyze(image, palette, { mode: "grid" }), /未识别/);
});

const zlib = require("node:zlib");
const fixtureDir = path.join(__dirname, "fixtures/board-image");
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8"));
const beadColors = [[80, 221, 103], [53, 75, 19], [238, 197, 240], [252, 194, 194], [75, 44, 27], [254, 254, 254], [187, 187, 187], [203, 203, 194]];
const printedCounts = [9, 21, 193, 72, 300, 897, 10, 55];

for (const fixture of fixtures) {
  test(`reference chart recovers printed bead counts: ${fixture.name}`, () => {
    const image = { ...fixture, data: zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, `${fixture.name}.rgba.gz`))) };
    const grid = BoardImage.detectGrid(image);
    assert.ok(grid);
    assert.deepEqual([grid.cols, grid.rows], [54, 54]);
    const cells = BoardImage.sampleGrid(image, grid);
    const counts = beadColors.map(() => 0);
    const classify = rgb => {
      if (!rgb) return -1;
      const differences = beadColors.map(c => c.reduce((sum, value, i) => sum + (value - rgb[i]) ** 2, 0));
      return differences.indexOf(Math.min(...differences));
    };
    cells.forEach(c => { if (c) counts[classify(c)]++; });
    const errors = counts.reduce((sum, value, i) => sum + Math.abs(value - printedCounts[i]), 0);
    assert.ok(errors <= (fixture.name === "half-size" ? 25 : fixture.name === "jpeg-small" ? 15 : 4), `printed legend mismatch: ${counts} (${errors})`);
    assert.equal(classify(cells[2 * 54 + 2]), -1, "empty paper");
    assert.equal(classify(cells[3 * 54 + 33]), 1, "dark green leaf");
    assert.equal(classify(cells[16 * 54 + 30]), 5, "white face");
    assert.equal(classify(cells[26 * 54 + 28]), 3, "pink cheek");
    assert.equal(classify(cells[32 * 54 + 10]), 2, "pale lavender cushion");
    const result = BoardImage.analyze(image, palette);
    assert.ok(result.page.every(c => Number.isInteger(c) && c >= 0 && c <= DARK));
    assert.equal(result.page.length, 864);
    assert.ok(result.page.filter(c => c >= 48 && c <= 49).length > 150, "white body survives downsampling");
    assert.ok(!result.page.includes(42), "no forced neon magenta");
  });
}

const signDir = path.join(fixtureDir, "teaching-sign");
const signFixtures = JSON.parse(fs.readFileSync(path.join(signDir, "manifest.json"), "utf8"));
const signColors = [[242, 205, 168], [72, 43, 25], [236, 190, 144], [235, 209, 147], [135, 94, 66],
  [78, 63, 33], [254, 254, 254], [0, 0, 0], [245, 237, 239], [242, 236, 214], [52, 44, 43]];
const signCounts = [66, 352, 317, 139, 14, 28, 786, 410, 1410, 1022, 80];
const classifySign = rgb => {
  if (!rgb) return -1;
  const differences = signColors.map(c => c.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0));
  return differences.indexOf(Math.min(...differences));
};
const readSign = fixture => ({ ...fixture, data: zlib.gunzipSync(fs.readFileSync(path.join(signDir, `${fixture.name}.rgba.gz`))) });
let signReference;

for (const fixture of signFixtures) {
  test(`68 x 68 fully coded scene preserves background and outlines: ${fixture.name}`, () => {
    const image = readSign(fixture), grid = BoardImage.detectGrid(image);
    assert.ok(grid);
    assert.deepEqual([grid.cols, grid.rows], [68, 68]);
    assert.ok(grid.confidence >= 0.8 && grid.confidence <= 1, "line evidence is unique per lattice position");
    const cells = BoardImage.sampleGrid(image, grid), labels = cells.map(classifySign);
    assert.equal(cells.filter(Boolean).length, 4624, "coded pale background is artwork, not blank paper");
    const counts = signColors.map((_, i) => labels.filter(c => c === i).length);
    if (["reference", "cropped", "padded"].includes(fixture.name)) {
      assert.deepEqual(counts, signCounts, "all 11 colors match the printed legend");
      assert.equal(labels[0], 8, "H8 background");
      assert.equal(labels[67 * 68], 9, "H13 floor");
      assert.equal(labels[12 * 68 + 10], 6, "H2 white drawing board");
      assert.equal(labels[13 * 68 + 27], 7, "H7 blackboard");
    }
    if (!signReference) {
      const reference = readSign(signFixtures.find(f => f.name === "reference"));
      signReference = BoardImage.sampleGrid(reference, BoardImage.detectGrid(reference)).map(classifySign);
    }
    let intersection = 0, union = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === 7 || signReference[i] === 7) union++;
      if (labels[i] === 7 && signReference[i] === 7) intersection++;
    }
    assert.ok(intersection / union >= 0.99, "compressed images retain the positions of black outlines/lettering");
    const result = BoardImage.analyze(image, palette);
    assert.equal(result.sourceLit, 4624);
    assert.deepEqual(result.grid.used, [24, 24]);
    assert.equal(result.page.filter(frame => frame !== DARK).length, 576, "no holes appear in a fully beaded scene");
    assert.ok(result.page.every(frame => frame >= 0 && frame <= DARK && Number.isInteger(frame)));
  });
}

test("close noisy fill shades map consistently while isolated accent colors remain", () => {
  const image = colorGrid(24, 20, 16, (x, y) => x === 12 && y === 10 ? [255, 0, 0]
    : (x + y) % 2 ? [241, 234, 210] : [239, 232, 208]);
  const result = BoardImage.analyze(image, ["#f1ead2", "#efe8d0", "#ff0000"], { cols: 24, rows: 20, background: "keep" });
  const fills = new Set(result.page.filter(c => c !== 2));
  assert.equal(fills.size, 1, "near-identical fills must not make a checkerboard of lamp shades");
  assert.equal(result.page[10 * 24 + 12], 2, "a one-cell red accent is not discarded");
});

test("thin white marks on black and black marks on white survive reduction", () => {
  for (const inverse of [false, true]) {
    const image = colorGrid(48, 48, 8, (x, y) => {
      const mark = x === 24 && y >= 16 && y < 32;
      return mark !== inverse ? [255, 255, 255] : [0, 0, 0];
    });
    const result = BoardImage.analyze(image, ["#000000", "#ffffff"], { background: "keep", cols: 16, rows: 16 });
    assert.ok(result.page.filter(c => c === (inverse ? 0 : 1)).length >= 4);
  }
});

const lampSprite = { width: 90, height: 198,
  data: zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, "native-lamps.rgba.gz"))) };
const lampPalette = BoardImage.paletteFromSprite(lampSprite);

test("real lamp colors keep brown outlines and cream backgrounds in their hue families", () => {
  // The nominal palette is much paler than the actual game sprites. Regressions
  // here used to pass the nominal-palette tests while visibly turning wood red.
  for (const [rgb, expected] of [[[72, 43, 25], 5], [[243, 236, 210], 14],
    [[245, 237, 240], 48], [[254, 254, 254], 49], [[0, 0, 0], 45]]) {
    assert.equal(BoardImage.nearestFrame(rgb, lampPalette), expected, `${rgb}`);
    const reversed = lampPalette.slice().reverse();
    assert.deepEqual(reversed[BoardImage.nearestFrame(rgb, reversed)], lampPalette[expected]);
  }
});

test("final 36 x 24 native-lamp output retains warm floor and does not inflate dark strokes", () => {
  const input = readSign(signFixtures.find(f => f.name === "reference"));
  const result = BoardImage.analyze(input, lampPalette);
  assert.deepEqual(result.grid.used, [24, 24]);
  assert.equal(result.page.includes(0), false, "brown wood must not become muted red lamps");
  assert.ok(result.page.filter(f => f === 14).length > 70, "cream floor must not become peach or white");
  const darkInk = result.page.filter(f => f === 45 || f === 5).length;
  assert.ok(darkInk > 90 && darkInk < 160, `outline footprint ${darkInk}/576, previously 180/576`);
  assert.match(result.message, /已缩小.*细字/);
  const detail = BoardImage.analyze(input, lampPalette, { sampling: "detail" });
  assert.ok(detail.page.filter(f => f === 45 || f === 5).length > darkInk,
    "explicit detail emphasis is separate from the balanced default");
});
