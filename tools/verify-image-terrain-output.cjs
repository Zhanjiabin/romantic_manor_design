"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const output = path.resolve(__dirname, "../_tmp_terrain_qa");
  fs.mkdirSync(output, { recursive: true });
  const width = 400, height = 300, pixels = Buffer.alloc(width * height * 4, 255);
  // Generic screenshot-like fixture: a dark frame, colored panels and a narrow accent.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = x < 80 || x >= 320 || y < 60 || y >= 240 ? [25, 25, 25]
      : x < 180 ? [248, 248, 248] : x < 250 ? [230, 190, 233] : [249, 190, 192];
    pixels.set([...rgb, 255], (y * width + x) * 4);
  }
  const buffer = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
      await context.route("**/api/saves/**", r => r.fulfill({ contentType: "application/json", body: "{}" }));
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
      await page.waitForFunction(() => typeof state !== "undefined" && state.kinds && !document.documentElement.classList.contains("boot-pending"));
      await page.evaluate(() => { state.mapSize = 3880; state.stamps = []; state.grassKeep = new Set(); rebuildStampIndex(); fitCam(); });
      const snapshot = () => page.evaluate(() => JSON.stringify({ scene: snapshotHist(), dirty: state.dirty, water: state.hasWaterTiles, history: state.history }));
      const original = await snapshot();
      await page.locator("#fileImageTerrain").setInputFiles({ name: "framed-panels.png", mimeType: "image/png", buffer });
      await page.locator("#dlgImageTerrain").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => imageTerrainDraft.previewMode), "terrain");
      assert.equal(await snapshot(), original, "real preview is non-mutating");
      assert.equal(await page.evaluate(() => {
        const revision = state.terrainRev, tiles = state.cornerTiles;
        paintImageTerrainPreviewFromMapping();
        return state.terrainRev === revision && state.cornerTiles === tiles;
      }), true, "preview restores render state synchronously");
      await page.locator('[data-image-preview-mode="original"]').click();
      const box = await page.locator("#imageTerrainPreview").boundingBox();
      const size = await page.locator("#imageTerrainPreview").evaluate(c => ({ w: c.width, h: c.height }));
      const scale = Math.min(box.width / size.w, box.height / size.h);
      const x = box.x + (box.width - size.w * scale) / 2, y = box.y + (box.height - size.h * scale) / 2;
      const a = { x: x + size.w * scale * 0.21, y: y + size.h * scale * 0.21 };
      const b = { x: x + size.w * scale * 0.79, y: y + size.h * scale * 0.79 };
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [b] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(a.x, a.y); await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
      }
      await page.locator("#btnImageTerrainCropApply").click();
      await page.waitForFunction(() => !imageTerrainDraft.cropping && imageTerrainDraft.image.naturalWidth < 250);
      assert.equal(await snapshot(), original);
      const cropped = await page.evaluate(() => ({
        w: imageTerrainDraft.source.width, h: imageTerrainDraft.source.height,
        min: Math.min(...imageTerrainDraft.palette.filter(c => c.count).map(c => c.rgb[0])),
        mapped: new Set([...document.querySelectorAll("#imageColorMap select")].map(s => s.value)).size,
      }));
      assert.ok(cropped.w < 250 && cropped.h < 190 && cropped.min > 200, JSON.stringify(cropped));
      assert.equal(cropped.mapped, 3, "pastel panels stay distinct");

      // Compare output pixels at exactly the preview transform, using the live map renderer.
      const expected = await page.locator("#imageTerrainPreview").evaluate(c => c.toDataURL());
      await page.locator("#btnApplyImageTerrain").click();
      const actual = await page.evaluate(() => {
        const b = imageTerrainDraft.sampled.nativeBounds;
        const canvas = document.createElement("canvas"), preview = document.getElementById("imageTerrainPreview");
        canvas.width = preview.width; canvas.height = preview.height;
        const scale = 440 / Math.max(b.maxCx - b.minCx, b.maxCy - b.minCy);
        withDrawTarget(canvas, { x: -b.minCx * scale, y: -b.minCy * scale, k: scale }, () => {
          ctx.fillStyle = planeBackdrop(); ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.save(); clipMap(); drawTerrainCells(); ctx.restore();
        });
        return canvas.toDataURL();
      });
      assert.equal(actual, expected, "real preview equals applied terrain pixel for pixel");
      await page.evaluate(() => undo());
      assert.deepEqual(await page.evaluate(() => snapshotHist()), JSON.parse(original).scene);
      await page.evaluate(() => showDlg("dlgImageTerrain", true));
      await page.locator('[data-image-preview-mode="original"]').click();
      await page.locator("#btnImageTerrainCropReset").click();
      assert.equal(await page.evaluate(() => imageTerrainDraft.source.width), 400);
      assert.equal(await page.evaluate(() => imageTerrainDraft.image === imageTerrainDraft.originalImage), true);
      await page.screenshot({ path: path.join(output, `output-dialog-${mobile ? "phone" : "desktop"}.png`) });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mobile, cropped, previewMatchesOutput: true, passed: true }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
