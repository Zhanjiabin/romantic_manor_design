"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");
const sharp = require("sharp");
const M = require("../web/board-mosaic.js");

async function main() {
  const out = path.resolve(__dirname, "../_tmp_board_mosaic"); fs.mkdirSync(out, { recursive: true });
  const fixtures = path.resolve(__dirname, "../tests/fixtures/board-image/teaching-sign");
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, "manifest.json"))).find(row => row.name === "reference");
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(fixtures, "reference.rgba.gz")));
  const png = await sharp(raw, { raw: { width: fixture.width, height: fixture.height, channels: 4 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [width, height] of [[1440, 1000], [390, 844], [844, 390], [768, 1024]]) {
      const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      let saved = null;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/saves/board", route => {
        if (route.request().method() === "PUT") {
          const body = route.request().postDataJSON();
          if (body.designs?.items?.[0]?.pages) saved = body.designs.items[0];
        }
        return route.fulfill({ json: { designs: { items: saved ? [saved] : [] } } });
      });
      await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.testClipboard = text; } } }));
      await page.goto(process.env.BOARD_URL || "http://127.0.0.1:8765/web/board.html");
      await page.waitForSelector("html.boot-ready");
      await page.locator("#btnBoardSmart").click();
      await page.locator("#fileBoardSmart").setInputFiles({ name: "teaching-sign.png", mimeType: "image/png", buffer: png });
      await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      for (const mode of width === 1440 ? ["four", "horizontal", "vertical", "l", "cross", "heart", "nine"] : ["nine"]) {
        await page.locator("#boardLayoutPreset").selectOption(mode);
        await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), M.tiles(M.preset(mode)).length);
      }
      await page.screenshot({ path: path.join(out, `import-${width}x${height}.png`) });
      await page.locator("#btnBoardSmartApply").click();
      await page.waitForFunction(() => document.getElementById("dlgBoardSmart").hidden);
      assert.equal(await page.locator("#boardActiveTile option").count(), 9);
      assert.equal(await page.locator("#pageCount").innerText(), "1", "nine pieces are not nine animation pages");
      await page.locator("#btnUndo").click();
      assert.equal(await page.locator("#boardActiveTile option").count(), 1);
      await page.locator("#btnRedo").click();
      assert.equal(await page.locator("#boardActiveTile option").count(), 9);
      const before = await page.locator("#paintCanvas").evaluate(c => c.toDataURL());
      const zoom = await page.locator("#boardZoomLabel").innerText();
      await page.locator("#btnBoardZoomIn").click();
      assert.notEqual(await page.locator("#boardZoomLabel").innerText(), zoom);
      assert.equal(await page.locator("#paintCanvas").evaluate(c => c.toDataURL()), before);
      await page.locator("#btnBoardZoomFit").click();
      const boardBox = await page.locator("#paintBoard").boundingBox();
      await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
      await page.mouse.wheel(0, -100);
      await page.waitForFunction(old => document.getElementById("boardZoomLabel").textContent !== old, zoom);
      assert.equal(await page.locator("#paintCanvas").evaluate(c => c.toDataURL()), before, "wheel changes camera only");
      await page.locator("#btnBoardZoomFit").click();
      await page.screenshot({ path: path.join(out, `editor-${width}x${height}.png`) });
      await page.locator("#btnPreview").click();
      await page.waitForSelector("#boardGameCanvas");
      const actual = await page.locator("#boardGameCanvas").evaluate(c => ({ width: c.width, rect: c.getBoundingClientRect().width }));
      assert.equal(actual.rect, actual.width, "1:1 preview uses native pixel size");
      assert.equal(await page.locator("#boardPlacementTable tr").count(), 10);
      await page.screenshot({ path: path.join(out, `game-right-up-${width}x${height}.png`) });
      const first = await page.locator("#boardGameCanvas").evaluate(c => c.toDataURL());
      if (width === 1440) {
        const play = await page.locator("#btnPreviewPlay").boundingBox();
        assert.ok(play.y + play.height < height, "preview playback remains visible on desktop");
      }
      await page.locator("#boardPreviewFacing").selectOption("1");
      assert.notEqual(await page.locator("#boardGameCanvas").evaluate(c => c.toDataURL()), first);
      await page.screenshot({ path: path.join(out, `game-right-down-${width}x${height}.png`) });
      await page.locator('[data-close-modal="dlgBoardPreview"]').click();

      if (width === 1440) {
        await page.locator("#boardActiveTile").selectOption("4");
        await page.locator("#paintBoard").focus();
        await page.keyboard.press("Control+c");
        const clip = await page.evaluate(() => window.testClipboard);
        assert.equal(clip.split(",").length, 864, "copy exports a native-sized tile");
        await page.locator("#btnSaveDesign").click();
        await page.locator("#boardSaveName").fill("九宫格回归测试");
        await page.locator("#btnBoardSaveOk").click();
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
        assert.equal(saved.pages[0].length, 108 * 72);
        assert.equal(saved.layout.mask.filter(Boolean).length, 9);
        fs.writeFileSync(path.join(out, "saved-project.json"), JSON.stringify(saved));
        const downloadPromise = page.waitForEvent("download");
        await page.locator("#btnFinalize").click();
        const download = await downloadPromise;
        await download.saveAs(path.join(out, "mosaic.zip"));
        assert.equal(download.suggestedFilename(), "九宫格回归测试.zip");
        const jpgPromise = page.waitForEvent("download");
        await page.locator("#btnExportPng").click();
        const jpg = await jpgPromise;
        const jpgMeta = await sharp(await jpg.path()).metadata();
        assert.equal(jpgMeta.width, 108 * 18, "full mosaic image export retains detailed lamps");
        assert.equal(jpgMeta.height, 72 * 18);

        // A stroke can cross a native 36-cell boundary without wrapping or gaps.
        const b = await page.locator("#paintCanvas").boundingBox();
        await page.locator('#paletteGrid [data-frame="42"]').click();
        await page.mouse.move(b.x + b.width * 34.5 / 108, b.y + b.height * 10.5 / 72);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * 38.5 / 108, b.y + b.height * 10.5 / 72, { steps: 8 });
        await page.mouse.up();
        await page.locator("#btnSaveDesign").click();
        await page.locator("#btnBoardSaveOk").click();
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
        for (let x = 34; x <= 38; x++) assert.equal(saved.pages[0][10 * 108 + x], 42);
        await page.locator("#btnBoardZoomIn").click();
        const strokeZoom = await page.locator("#boardZoomLabel").innerText();
        await page.locator("#btnUndo").click();
        assert.equal(await page.locator("#boardZoomLabel").innerText(), strokeZoom, "undoing a stroke preserves zoom");
        assert.equal(await page.locator("#paintCanvas").evaluate(c => c.toDataURL()), before);

        await page.locator("#btnBoardLayout").click();
        await page.locator("#boardLayoutMask button").nth(4).click();
        await page.locator("#boardLayoutPreset").selectOption("custom");
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), 8, "custom mode preserves holes");
        await page.locator("#btnBoardSmartApply").click();
        if (await page.locator("#dlgApp").isVisible()) await page.locator("#dlgAppOk").click();
        assert.equal(await page.locator("#boardActiveTile option").count(), 8);
        await page.locator("#fileBoardImage").setInputFiles(path.join(out, "saved-project.json"));
        await page.waitForFunction(() => document.querySelectorAll("#boardActiveTile option").length === 9);
        assert.equal(await page.locator("#paintCanvas").evaluate(c => c.toDataURL()), before);
        await page.reload();
        await page.waitForSelector("html.boot-ready");
        await page.locator(".design-card").first().click();
        assert.equal(await page.locator("#boardActiveTile option").count(), 9);

        // Sparse custom layouts can exceed 64 positions without exceeding 64 boards.
        await page.locator("#btnBoardLayout").click();
        await page.locator("#boardLayoutCols").fill("8");
        await page.locator("#boardLayoutCols").press("Tab");
        await page.locator("#boardLayoutRows").fill("8");
        await page.locator("#boardLayoutRows").press("Tab");
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), 64);
        await page.locator("#boardLayoutCols").fill("12");
        await page.locator("#boardLayoutCols").press("Tab");
        await page.locator("#boardLayoutRows").fill("12");
        await page.locator("#boardLayoutRows").press("Tab");
        await page.locator("#boardLayoutPreset").selectOption("custom");
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), 64);
        await page.locator("#boardLayoutMask button").last().click();
        assert.match(await page.locator("#boardLayoutInfo").innerText(), /最多拼接 64/);
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), 64);
        await page.locator('[data-close-modal="dlgBoardSmart"]').click();

        // Importing fewer native frames preserves other tiles' animation frames.
        const animated = { layout: M.preset("four"), pages: [Array(72 * 48).fill(12), Array(72 * 48).fill(15)] };
        await page.locator("#fileBoardImage").setInputFiles({ name: "animation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(animated)) });
        await page.waitForFunction(() => document.getElementById("pageCount").textContent === "2");
        await page.route("**/api/board/import-ani", route => route.fulfill({ json: { pages: [Array(864).fill(42)] } }));
        await page.locator("#boardActiveTile").selectOption("1");
        await page.locator("#fileBoardImage").setInputFiles({ name: "one-frame.ale", mimeType: "application/octet-stream", buffer: Buffer.from("ALE fixture response") });
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent === "未保存");
        await page.locator("#btnSaveDesign").click();
        await page.locator("#btnBoardSaveOk").click();
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
        assert.equal(saved.pages.length, 2);
        assert.ok(M.extract(saved.pages[0], saved.layout, 1).every(v => v === 42));
        assert.ok(M.extract(saved.pages[1], saved.layout, 1).every(v => v === 50));
        assert.ok(M.extract(saved.pages[1], saved.layout, 0).every(v => v === 15));
        const single = { pages: [Array(864).fill(12), Array(864).fill(15)] };
        await page.locator("#fileBoardImage").setInputFiles({ name: "single.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(single)) });
        await page.waitForFunction(() => document.querySelectorAll("#boardActiveTile option").length === 1);
        await page.locator("#btnNextPage").click();
        await page.locator("#fileBoardImage").setInputFiles({ name: "one-frame.ale", mimeType: "application/octet-stream", buffer: Buffer.from("ALE fixture response") });
        await page.waitForFunction(() => document.getElementById("pageCount").textContent === "1");
        assert.equal(await page.locator("#designerLabel").innerText(), "第 1/1 页");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`${width}x${height}: mosaic import, separate animation pages, undo/redo, zoom and game orientations passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
