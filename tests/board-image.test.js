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

test("paper white maps to dark lamps, not palette white", () => {
  assert.equal(BoardImage.isPaper([245, 245, 245]), true);
  assert.equal(BoardImage.nearestFrame([245, 245, 245], palette, DARK), DARK);
  assert.notEqual(BoardImage.nearestFrame([48, 160, 64], palette, DARK), DARK);
  assert.notEqual(BoardImage.nearestFrame([103, 75, 60], palette, DARK), DARK);
  const brown = BoardImage.nearestFrame([73, 44, 26], palette, DARK);
  const green = BoardImage.nearestFrame([45, 60, 21], palette, DARK);
  const mauve = BoardImage.nearestFrame([210, 172, 209], palette, DARK);
  const rose = BoardImage.nearestFrame([175, 130, 129], palette, DARK);
  assert.equal(brown, 0, "dark brown outline uses dusty-rose lamp, palette has no brown");
  assert.ok(brown !== 1 && brown !== 2 && brown !== 10 && brown !== 30, "brown must not become red, olive, or purple");
  assert.ok(green < 45 && green >= 15 && green <= 24, "dark green beads stay on green lamps");
  assert.equal(mauve, 42, "JPEG pink/mauve beads stay on hot-pink lamps, not purple");
  assert.equal(rose, 42, "muted rose cheeks stay pink, not brown outline");
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
  assert.match(result.message, /关灯/);
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
  const white = result.page.filter((frame) => frame === 49).length;
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
  const result = BoardImage.analyze(image, palette, { cols: 36, rows: 24, dark: DARK });
  assert.equal(result.mode, "photo");
  assert.equal(result.grid, null);
  const lit = result.page.filter((frame) => frame !== DARK);
  assert.ok(lit.length > 80);
  assert.ok(result.page.filter((frame) => frame === DARK).length > 80);
});
