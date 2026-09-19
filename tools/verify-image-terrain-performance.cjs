"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const { chromium } = require("playwright");

async function main() {
  const width = 256, pixels = Buffer.alloc(width * width * 3);
  const colors = [[245, 245, 245], [75, 40, 20], [235, 185, 235], [255, 190, 190], [55, 180, 80]];
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const index = Math.floor(x / 48) + Math.floor(y / 40);
    pixels.set(colors[index % colors.length], (y * width + x) * 3);
  }
  const buffer = process.argv[2] ? fs.readFileSync(process.argv[2])
    : await sharp(pixels, { raw: { width, height: width, channels: 3 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/api/saves/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
    await page.waitForFunction(() => typeof state !== "undefined" && state.kinds && !document.documentElement.classList.contains("boot-pending"));
    await page.evaluate(() => {
      state.mapSize = 3880; state.stamps = []; state.grassKeep = new Set();
      rebuildStampIndex(); fitCam();
      window.importStats = { paints: 0, paintMs: 0 };
      const paint = paintImageTerrainRealPreview;
      paintImageTerrainRealPreview = (...args) => {
        const start = performance.now();
        try { return paint(...args); }
        finally { importStats.paints++; importStats.paintMs += performance.now() - start; }
      };
    });
    const start = performance.now();
    await page.locator("#fileImageTerrain").setInputFiles({ name: "performance.png", mimeType: "image/png", buffer });
    await page.waitForFunction(() => imageTerrainDraft?.sampled && !document.getElementById("dlgImageTerrain").hidden);
    const importMs = Math.round(performance.now() - start);
    await page.waitForFunction(() => [...state.images.values()].every(image => image.complete) && !imageTerrainPreviewFrame);
    const result = await page.evaluate(async () => {
      paintImageTerrainPreviewFromMapping();
      const preview = document.getElementById("imageTerrainPreview");
      const original = preview.toDataURL(), firstPaints = importStats.paints;
      const terrainPixels = () => {
        const canvas = imageTerrainDraft.previewCache.canvas;
        return { pixels: canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data,
          cells: JSON.stringify(imageTerrainWriteCells().map(cell => [cell.u, cell.v, cell.brush])) };
      };
      // Browser canvas backends can round light blending by one channel level.
      const sameTerrain = (a, b) => a.cells === b.cells && a.pixels.length === b.pixels.length &&
        a.pixels.every((value, i) => Math.abs(value - b.pixels[i]) <= 1);
      const originalTerrain = terrainPixels();
      window.perfImages = { original };
      const start = performance.now();
      for (let i = 0; i < 5; i++) paintImageTerrainPreviewFromMapping();
      const cachedMs = (performance.now() - start) / 5;
      setImageTerrainPreviewMode("source"); setImageTerrainPreviewMode("terrain");
      const cached = preview.toDataURL() === original && importStats.paints === firstPaints;

      const mapping = document.querySelector("#imageColorMap select");
      const value = mapping.value;
      mapping.value = "-1"; paintImageTerrainPreviewFromMapping();
      const mappingChanged = !sameTerrain(terrainPixels(), originalTerrain);
      mapping.value = value; paintImageTerrainPreviewFromMapping();
      const mappingRestored = sameTerrain(terrainPixels(), originalTerrain);
      perfImages.restored = preview.toDataURL();

      pushImageTerrainEditHistory();
      imageTerrainDraft.editTool = "erase";
      const touched = new Set(), beforeStroke = importStats.paints;
      let editedCount = 0;
      for (let i = 0; i < imageTerrainDraft.sampled.indices.length && editedCount < 50; i++) {
        if (imageTerrainDraft.sampled.indices[i] < 0) continue;
        editImageTerrainPreviewAt(i, touched); editedCount++;
      }
      const deferredStroke = importStats.paints === beforeStroke;
      await new Promise(requestAnimationFrame);
      const coalescedStroke = importStats.paints === beforeStroke + 1;
      const edited = !sameTerrain(terrainPixels(), originalTerrain);
      undoImageTerrainEdit();
      const undoRestored = sameTerrain(terrainPixels(), originalTerrain);
      perfImages.undone = preview.toDataURL();

      const sprite = [...state.tileSprites.values()][0];
      const immutable = readSpriteRGBA(sprite);
      const immutableCached = immutable === readSpriteRGBA(sprite);
      const mutable = copySprite(sprite), before = readSpriteRGBA(mutable);
      mutable.getContext("2d").clearRect(0, 0, mutable.width, mutable.height);
      const after = readSpriteRGBA(mutable);
      const mutableFresh = before.some(value => value !== 0) && after.every(value => value === 0);
      return { firstPaints, cachedMs, cached, mappingChanged, mappingRestored,
        deferredStroke, coalescedStroke, edited, undoRestored, immutableCached, mutableFresh };
    });
    console.log(JSON.stringify({ importMs, ...result }));
    if (!result.mappingRestored || !result.undoRestored) {
      fs.mkdirSync("_tmp_terrain_qa", { recursive: true });
      const images = await page.evaluate(() => perfImages);
      for (const [name, image] of Object.entries(images)) fs.writeFileSync(`_tmp_terrain_qa/perf-${name}.png`, Buffer.from(image.split(",")[1], "base64"));
    }
    for (const [key, value] of Object.entries(result)) if (typeof value === "boolean") assert.equal(value, true, key);
    assert.deepEqual(errors, []);
    console.log("Performance and cache checks passed.");
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
