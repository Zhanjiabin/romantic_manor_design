"use strict";
// Browser regression checks. Save requests are intercepted to protect user drafts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");

async function main() {
  const output = path.resolve(__dirname, "../_tmp_terrain_qa");
  fs.mkdirSync(output, { recursive: true });
  const pixels = Buffer.alloc(120 * 120 * 3);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    pixels.set(x < 60 ? [240, 240, 240] : [110, 75, 35], (y * 120 + x) * 3);
  }
  const buffer = await sharp(pixels, { raw: { width: 120, height: 120, channels: 3 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
      await context.route("**/api/saves/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
      await page.waitForFunction(() => typeof pixelTerrainBrushes === "function" && state.kinds && pixelTerrainBrushes().length);
      await page.waitForFunction(() => !document.documentElement.classList.contains("boot-pending"));
      await page.evaluate(() => {
        state.mapSize = 3880;
        const brush = pixelTerrainBrushes().find(brush => brushPaletteType(brush) === "土地");
        const pos = logicalToNative(8, 2);
        state.stamps = [{ kind: paperKindOfBrush(brush), x: pos.cx, y: pos.cy }];
        state.grassKeep = new Set(["9,2"]);
        state.history = []; state.future = [];
        rebuildStampIndex(); fitCam(); draw();
        document.getElementById("showGrid").checked = false;
      });
      const snapshot = () => page.evaluate(() => JSON.stringify({ stamps: state.stamps, grassKeep: [...state.grassKeep] }));
      const original = await snapshot();
      const open = async name => {
        await page.locator("#fileImageTerrain").setInputFiles({ name, mimeType: "image/png", buffer });
        await page.waitForFunction(name => imageTerrainDraft?.name === name && imageTerrainDraft.sampled, name);
        await page.locator("#imageTerrainFit").selectOption("stretch");
      };
      const screen = point => page.evaluate(point => {
        const rect = view.getBoundingClientRect(), pos = worldToScreen(point.x, point.y);
        return { x: rect.left + pos.x * rect.width / view.width, y: rect.top + pos.y * rect.height / view.height };
      }, point);
      const tap = async point => {
        const p = await screen(point);
        if (mobile) await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
      };
      await open("rectangle.png");
      assert.equal(await page.locator("#imageTerrainScope").inputValue(), "full");
      assert.equal(await page.locator("#btnImageTerrainPickRegion").isEnabled(), true);
      await page.locator("#btnImageTerrainPickRegion").click();
      await page.locator("#imageRegionShape").selectOption("free");
      assert.equal(await page.locator("#imageTerrainScope").inputValue(), "rectangle");
      assert.equal(await page.locator("#btnApplyImageTerrain").isDisabled(), true);
      assert.equal(await page.locator("#imageRegionToolbar").isVisible(), true);
      const a = await screen({ x: 400, y: 1000 }), b = await screen({ x: 1700, y: 2200 });
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
      assert.equal(await page.locator("#dlgImageTerrain").isVisible(), false, "rectangle remains adjustable until confirmed");
      await page.locator("#btnImageRegionFinish").click();
      await page.locator("#dlgImageTerrain").waitFor({ state: "visible" });
      assert.match(await page.locator("#imageTerrainStatus").innerText(), /矩形选区/);
      assert.equal(await page.evaluate(() => state.dragging), false);
      const rectStats = await page.evaluate(() => {
        const cells = imageTerrainDraft.sampled.cells;
        return { count: cells.length, allInside: cells.every(c => c.cx >= 399 && c.cx <= 1701 && c.cy >= 999 && c.cy <= 2201), colors: new Set(imageTerrainDraft.sampled.indices).size };
      });
      assert.ok(rectStats.count > 500 && rectStats.allInside && rectStats.colors >= 2, JSON.stringify(rectStats));
      // The enlarged preview uses the same native coordinate frame as its editor.
      assert.equal(await page.evaluate(() => {
        const c = imageTerrainDraft.sampled.cells.find(c => c.cx > 800 && c.cy > 1400);
        const canvas = document.getElementById("imageTerrainPreview"), r = canvas.getBoundingClientRect();
        const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
        const w = canvas.width * scale, h = canvas.height * scale, b = imageTerrainDraft.sampled.nativeBounds;
        const index = imageTerrainPreviewCellIndex({ clientX: r.left + (r.width - w) / 2 + (c.cx - b.minCx) / (b.maxCx - b.minCx) * w,
          clientY: r.top + (r.height - h) / 2 + (c.cy - b.minCy) / (b.maxCy - b.minCy) * h });
        return imageTerrainDraft.sampled.cells[index] === c;
      }), true);
      await page.locator("#btnApplyImageTerrain").click();
      const first = await snapshot();
      const firstState = JSON.parse(first), originalState = JSON.parse(original);
      assert.ok(firstState.stamps.length > originalState.stamps.length);
      assert.deepEqual(firstState.stamps[0], originalState.stamps[0]);
      assert.ok(firstState.grassKeep.includes("9,2"));

      await open("polygon.png");
      await page.locator("#imageTerrainScope").selectOption("polygon");
      await page.locator("#btnImageTerrainPickRegion").click();
      for (const point of [{ x: 2300, y: 1000 }, { x: 3500, y: 1000 }, { x: 3500, y: 1700 },
        { x: 2900, y: 1700 }, { x: 2900, y: 2500 }, { x: 2300, y: 2500 }]) await tap(point);
      assert.equal(await page.locator("#btnImageRegionFinish").isEnabled(), true);
      await page.screenshot({ path: path.join(output, `region-selection-${mobile ? "phone" : "desktop"}.png`) });
      await page.locator("#btnImageRegionFinish").click();
      const polygonStats = await page.evaluate(() => ({ count: imageTerrainDraft.sampled.cells.length,
        cutout: imageTerrainDraft.sampled.cells.some(c => c.cx > 2901 && c.cy > 1701),
        negative: imageTerrainDraft.sampled.cells.some(c => c.cx < 2299 || c.cy < 999) }));
      assert.ok(polygonStats.count > 500 && !polygonStats.cutout && !polygonStats.negative, JSON.stringify(polygonStats));
      await page.locator("#btnApplyImageTerrain").click();
      const second = await snapshot(), secondState = JSON.parse(second);
      assert.deepEqual(secondState.stamps.slice(0, firstState.stamps.length), firstState.stamps, "first image survives second region import");
      assert.deepEqual(secondState.grassKeep, firstState.grassKeep);
      await page.evaluate(() => undo()); assert.equal(await snapshot(), first);
      await page.evaluate(() => redo()); assert.equal(await snapshot(), second);
      // A solid snow interior must stay solid when zoomed out, including chunk edges.
      const camera = await page.evaluate(() => ({ ...state.cam }));
      for (const zoom of [0.1, 0.24, 0.51, 0.9, 1, 1.5]) {
        const holes = await page.evaluate(zoom => {
          lookAt(810, 1550, zoom); drawNow();
          const a = worldToScreen(720, 1450), b = worldToScreen(900, 1650);
          const pixels = ctx.getImageData(Math.ceil(a.x), Math.ceil(a.y), Math.floor(b.x - a.x), Math.floor(b.y - a.y)).data;
          let holes = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 130) holes++;
          return holes;
        }, zoom);
        assert.equal(holes, 0, `solid terrain has no grass pinholes at zoom ${zoom}`);
      }
      await page.evaluate(camera => { state.cam = camera; drawNow(); }, camera);
      await page.screenshot({ path: path.join(output, `region-result-${mobile ? "phone" : "desktop"}.png`) });

      // Cancellation and invalid empty selections must never mutate the map.
      await open("cancel.png");
      await page.locator("#imageTerrainScope").selectOption("rectangle");
      await page.locator("#btnImageTerrainPickRegion").click();
      await tap({ x: 1000, y: 1600 });
      assert.equal(await page.locator("#imageRegionToolbar").isVisible(), true);
      await page.locator("#btnImageRegionCancel").click();
      assert.equal(await page.locator("#btnApplyImageTerrain").isDisabled(), true);
      assert.equal(await snapshot(), second);
      assert.equal(await page.evaluate(() => state.dragging), false);
      if (!mobile) {
        // Overlap an existing image. Transparent/skipped pixels differ only with replace enabled.
        await page.locator("#imageTerrainScope").selectOption("rectangle");
        await page.locator("#btnImageTerrainPickRegion").click();
        await page.locator("#imageRegionShape").selectOption("free");
        await page.mouse.move(a.x, a.y); await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up();
        await page.locator("#btnImageRegionFinish").click();
        await page.locator("#imageTerrainFit").selectOption("contain");
        const sampledKeys = await page.evaluate(() => ({
          all: imageTerrainDraft.sampled.cells.map(c => cellKey(c.u, c.v)),
          blank: imageTerrainDraft.sampled.cells.filter((c, i) => imageTerrainDraft.sampled.indices[i] < 0).map(c => cellKey(c.u, c.v)),
        }));
        assert.ok(sampledKeys.blank.length > 0);
        const before = await page.evaluate(() => state.stamps.map(s => ({ ...s, key: cellKey(...Object.values(nativePointToLogical(s.x, s.y))) })));
        await page.locator("#imageTerrainReplace").uncheck();
        await page.locator("#btnApplyImageTerrain").click();
        const blankSet = new Set(sampledKeys.blank);
        const kept = await page.evaluate(() => state.stamps.map(s => ({ ...s, key: cellKey(...Object.values(nativePointToLogical(s.x, s.y))) })));
        assert.deepEqual(kept.filter(s => blankSet.has(s.key)), before.filter(s => blankSet.has(s.key)));
        await page.evaluate(() => undo()); assert.equal(await snapshot(), second);
        await page.evaluate(() => {
          state.imageTerrainRegion = { mode: "rectangle", points: [{ x: 400, y: 1000 }, { x: 1700, y: 2200 }] };
          document.getElementById("imageTerrainReplace").checked = true;
          applyImageTerrain();
        });
        const replaced = await page.evaluate(() => state.stamps.map(s => ({ ...s, key: cellKey(...Object.values(nativePointToLogical(s.x, s.y))) })));
        assert.equal(replaced.filter(s => blankSet.has(s.key)).length, 0);
        const allSet = new Set(sampledKeys.all);
        assert.deepEqual(replaced.filter(s => !allSet.has(s.key)), before.filter(s => !allSet.has(s.key)));
        await page.evaluate(() => undo()); assert.equal(await snapshot(), second);
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mobile, rectangle: rectStats, polygon: polygonStats, firstStamps: firstState.stamps.length, secondStamps: secondState.stamps.length, passed: true }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
