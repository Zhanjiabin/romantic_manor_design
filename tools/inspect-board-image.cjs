"use strict";

// Optional image dependencies: NODE_PATH can point at an installed sharp package.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const BoardImage = require("../web/board-image.js");
const native = require("../data/board_native.json");

async function main() {
  const filename = process.argv[2];
  const output = process.argv[3] || path.join(__dirname, "../_tmp_board_qa");
  fs.mkdirSync(output, { recursive: true });
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { data, width: info.width, height: info.height };
  const sprites = await sharp(path.join(__dirname, "../data/board_highlight.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = BoardImage.paletteFromSprite
    ? BoardImage.paletteFromSprite({ data: sprites.data, width: sprites.info.width, height: sprites.info.height }) : native.palette;
  const start = performance.now();
  const result = BoardImage.analyze(source, palette, JSON.parse(process.argv[4] || "{}"));
  console.log(JSON.stringify({ ...result, page: undefined, source: undefined, milliseconds: performance.now() - start }, null, 2));
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result));
  const w = 36 * 18, h = 24 * 18;
  const lamps = Buffer.alloc(w * h * 4);
  result.page.forEach((frame, index) => {
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) {
      const from = (((Math.floor(frame / 5) * 18 + y) * sprites.info.width) + (frame % 5) * 18 + x) * 4;
      const to = (((Math.floor(index / 36) * 18 + y) * w) + (index % 36) * 18 + x) * 4;
      sprites.data.copy(lamps, to, from, from + 4);
    }
  });
  await sharp(lamps, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(output, "lamps.png"));
  const grid = BoardImage.detectGrid(source);
  console.log("grid", grid);
  if (grid) {
    const cells = BoardImage.sampleGrid(source, grid);
    const rgb = Buffer.from(cells.flatMap(c => c ? c.slice(0, 3) : [50, 55, 60]));
    await sharp(rgb, { raw: { width: grid.cols, height: grid.rows, channels: 3 } })
      .resize(grid.cols * 10, grid.rows * 10, { kernel: "nearest" }).png().toFile(path.join(output, "recovered.png"));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
