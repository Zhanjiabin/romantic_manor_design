"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");

async function main() {
  const output = path.resolve(__dirname, "../_tmp_terrain_qa");
  fs.mkdirSync(output, { recursive: true });
  const pixels = Buffer.alloc(320 * 240 * 3);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
    pixels.set(y < 120 ? [200, 40, 60] : x < 160 ? [50, 170, 220] : [240, 240, 240], (y * 320 + x) * 3);
  }
  const buffer = await sharp(pixels, { raw: { width: 320, height: 240, channels: 3 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
      await context.route("**/api/saves/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
      await page.waitForFunction(() => typeof state !== "undefined" && state.kinds && !document.documentElement.classList.contains("boot-pending"));
      await page.evaluate(() => { state.mapSize = 3880; state.stamps = []; state.grassKeep = new Set();
        document.getElementById("showGrid").checked = false; rebuildStampIndex(); fitCam(); draw(); });
      const snapshot = () => page.evaluate(() => JSON.stringify(snapshotHist()));
      const before = await snapshot();
      const drag = async (a, b) => {
        if (mobile) {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [b] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(a.x, a.y); await page.mouse.down();
          await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
        }
      };
      const mapPoint = point => page.evaluate(p => {
        const r = view.getBoundingClientRect(), s = worldToScreen(p.x, p.y);
        return { x: r.left + s.x * r.width / view.width, y: r.top + s.y * r.height / view.height };
      }, point);
      const cropPoint = point => page.locator("#imageTerrainPreview").evaluate((c, p) => {
        const r = c.getBoundingClientRect(), s = Math.min(r.width / c.width, r.height / c.height);
        return { x: r.left + (r.width - c.width * s) / 2 + p.x * c.width * s,
          y: r.top + (r.height - c.height * s) / 2 + p.y * c.height * s };
      }, point);
      const rect = () => page.evaluate(() => ({ ...state.imageTerrainRegionDraft.rect }));
      await page.locator("#fileImageTerrain").setInputFiles({ name: "halves.png", mimeType: "image/png", buffer });
      await page.waitForFunction(() => imageTerrainDraft?.sampled);
      assert.equal(await page.locator("#imageTerrainFit").inputValue(), "contain");
      await page.locator('[data-image-preview-mode="original"]').click();
      await page.locator("#imageTerrainCropPreset").selectOption("bottom");
      assert.deepEqual(await page.evaluate(() => imageTerrainDraft.cropPending), { x: 0, y: 0.5, w: 1, h: 0.5 });
      await page.locator("#imageTerrainPreview").scrollIntoViewIfNeeded();
      await drag(await cropPoint({ x: 0.5, y: 0.75 }), await cropPoint({ x: 0.5, y: 0.625 }));
      assert.ok(Math.abs(await page.evaluate(() => imageTerrainDraft.cropPending.y) - 0.375) < 0.01, "crop moves without changing its size");
      await page.locator("#imageTerrainCropAspect").selectOption("square");
      assert.equal(await page.evaluate(() => Math.abs(imageTerrainCropRect().w - imageTerrainCropRect().h) < 1), true);
      await page.locator("#imageTerrainPreview").scrollIntoViewIfNeeded();
      const crop = await page.evaluate(() => imageTerrainDraft.cropPending);
      await drag(await cropPoint({ x: crop.x + crop.w, y: crop.y + crop.h }),
        await cropPoint({ x: crop.x + crop.w + 0.1, y: crop.y + crop.h + 0.05 }));
      assert.equal(await page.evaluate(() => Math.abs(imageTerrainCropRect().w - imageTerrainCropRect().h) < 1), true);
      await page.locator("#imageTerrainCropPreset").selectOption("bottom");
      await page.screenshot({ path: path.join(output, `crop-selection-${mobile ? "phone" : "desktop"}.png`) });
      await page.locator("#btnImageTerrainCropApply").click();
      await page.waitForFunction(() => !imageTerrainDraft.cropping && imageTerrainDraft.image.naturalHeight === 120);
      const sampled = await page.evaluate(() => ({ w: imageTerrainDraft.source.width, h: imageTerrainDraft.source.height,
        first: Array.from(imageTerrainDraft.source.pixels.slice(0, 3)) }));
      assert.deepEqual(sampled, { w: 320, h: 120, first: [50, 170, 220] });
      assert.equal(await snapshot(), before, "crop is non-destructive until generation");

      await page.locator("#btnImageTerrainPickRegion").click();
      await page.locator("#imageRegionShape").selectOption("square");
      await drag(await mapPoint({ x: 800, y: 1200 }), await mapPoint({ x: 1800, y: 1650 }));
      const square = await rect();
      assert.ok(Math.abs(square.w - square.h) < 1 && square.w > 950, JSON.stringify(square));
      assert.equal(await page.locator("#dlgImageTerrain").isVisible(), false);
      const center = { x: square.x + square.w / 2, y: square.y + square.h / 2 };
      await drag(await mapPoint(center), await mapPoint({ x: center.x + 200, y: center.y + 200 }));
      const moved = await rect();
      assert.ok(Math.abs(moved.x - square.x - 200) < 12 && Math.abs(moved.w - square.w) < 1);
      await drag(await mapPoint({ x: moved.x + moved.w, y: moved.y + moved.h }),
        await mapPoint({ x: moved.x + moved.w + 200, y: moved.y + moved.h + 100 }));
      const resized = await rect();
      assert.ok(Math.abs(resized.w - resized.h) < 1 && resized.w > moved.w + 150);
      await page.locator("#imageRegionWidth").fill("960");
      await page.locator("#imageRegionWidth").press("Tab");
      assert.equal(Math.round((await rect()).h), 960);
      await page.locator("#imageRegionShape").selectOption("image");
      const proportional = await rect();
      assert.ok(Math.abs(proportional.w / proportional.h - 320 / 120) < 0.01);
      assert.equal(Number(await page.locator("#imageRegionHeight").inputValue()), Math.round(proportional.h));
      if (mobile) {
        const saved = await rect(), cdp = await context.newCDPSession(page);
        const a = await mapPoint({ x: 500, y: 2900 }), b = await mapPoint({ x: 2000, y: 2900 });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a, id: 1 }, { ...b, id: 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x - 15, y: a.y, id: 1 }, { x: b.x + 15, y: b.y, id: 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
        assert.deepEqual(await rect(), saved, "pinch retains the pending selection");
      }
      assert.equal(await snapshot(), before, "placement does not edit the map before generation");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `adjustable-region-${mobile ? "phone" : "desktop"}.png`) });
      await page.locator("#btnImageRegionFinish").click();
      const accepted = await page.evaluate(() => JSON.stringify(state.imageTerrainRegion));
      await page.locator("#btnImageTerrainPickRegion").click();
      assert.ok((await rect()).w > 0, "reopening keeps the accepted selection");
      await page.locator("#imageRegionShape").selectOption("polygon");
      assert.equal(await page.evaluate(() => state.imageTerrainRegionDraft.points.length), 4);
      const vertex = await page.evaluate(() => state.imageTerrainRegionDraft.points[2]);
      await drag(await mapPoint(vertex), await mapPoint({ x: vertex.x + 100, y: vertex.y + 100 }));
      assert.ok(await page.evaluate(x => state.imageTerrainRegionDraft.points[2].x > x + 50, vertex.x));
      await page.locator("#btnImageRegionCancel").click();
      assert.equal(await page.evaluate(() => JSON.stringify(state.imageTerrainRegion)), accepted, "cancel preserves the accepted region");
      assert.equal(await page.locator("#imageTerrainScope").inputValue(), "rectangle");
      assert.equal(await page.locator("#btnApplyImageTerrain").isEnabled(), true);
      assert.equal(await snapshot(), before);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mobile, square: true, movable: true, resizable: true, proportional: true, crop: sampled, passed: true }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
