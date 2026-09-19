"use strict";
// Uses real GIF decoding through the local server. Optional browser dependencies: Playwright, Sharp.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const sharp = require("sharp");
const M = require("../web/board-mosaic.js");
const BI = require("../web/board-image.js");

async function main() {
  const out = path.resolve(__dirname, "../_tmp_board_gif");
  fs.mkdirSync(out, { recursive: true });
  execFileSync(process.env.PYTHON || "python", ["-c", `
from pathlib import Path
from PIL import Image, ImageDraw
import sys
out=Path(sys.argv[1])
frames=[]
palette=[0,0,0,255,0,0,0,0,255]+[0,0,0]*253
for x in [10,34,60,82]:
    f=Image.new('P',(108,72),0); f.putpalette(palette)
    d=ImageDraw.Draw(f); d.rectangle((x,30,x+4,34),fill=1); d.rectangle((78,7,82,11),fill=2)
    frames.append(f)
frames[0].save(out/'moving.gif',save_all=True,append_images=frames[1:],duration=[100,200,300,400],loop=0,transparency=0,disposal=2,optimize=True)
frames[0].save(out/'still.png',transparency=0)
many=[]
for i in range(12):
    f=Image.new('P',(108,72),0); f.putpalette(palette)
    ImageDraw.Draw(f).rectangle((i*7,30,i*7+4,34),fill=1); many.append(f)
many[0].save(out/'long.gif',save_all=True,append_images=many[1:],duration=100,loop=0,transparency=0,disposal=2)
`, out]);
  const lamp = await sharp(path.resolve(__dirname, "../data/board_highlight.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = BI.paletteFromSprite({ width: lamp.info.width, height: lamp.info.height, data: lamp.data });
  const red = BI.nearestFrame([255, 0, 0], palette), blue = BI.nearestFrame([0, 0, 255], palette);
  function expectedFrame(index, layout) {
    const page = Array(108 * 72).fill(50), x0 = [10, 34, 60, 82][index];
    for (let y = 30; y <= 34; y++) for (let x = x0; x <= x0 + 4; x++) page[y * 108 + x] = red;
    for (let y = 7; y <= 11; y++) for (let x = 78; x <= 82; x++) page[y * 108 + x] = blue;
    return M.clean(page, layout);
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      let saved = null;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/saves/board", route => {
        if (route.request().method() === "PUT") {
          const doc = route.request().postDataJSON();
          if (doc.designs?.items?.[0]?.pages) saved = doc.designs.items[0];
        }
        return route.fulfill({ json: { designs: { items: [] } } });
      });
      await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.testClipboard = text; } } }));
      await page.goto(process.env.BOARD_URL || "http://127.0.0.1:8765/web/board.html");
      await page.waitForSelector("html.boot-ready");
      const waitResult = () => page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      const picture = () => page.locator("#paintCanvas").evaluate(c => c.toDataURL());
      async function apply() {
        await page.locator("#btnBoardSmartApply").click();
        if (await page.locator("#dlgApp").isVisible()) await page.locator("#dlgAppOk").click();
        await page.waitForFunction(() => document.getElementById("dlgBoardSmart").hidden);
      }
      async function save() {
        await page.locator("#btnSaveDesign").click();
        await page.locator("#boardSaveName").fill("GIF 拼接验证");
        await page.locator("#btnBoardSaveOk").click();
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
      }
      async function pagesPanel(open) {
        if (width < 600 && (await page.locator("#btnBoardMobilePages").getAttribute("aria-expanded") === "true") !== open) await page.locator("#btnBoardMobilePages").click();
      }
      const empty = await picture();
      // Both file inputs must use the mosaic flow, with real server responses.
      if (width < 600) await page.locator("#btnBoardSmart").click();
      await page.locator(width < 600 ? "#fileBoardSmart" : "#fileBoardImage").setInputFiles(path.join(out, "moving.gif"));
      await waitResult();
      assert.equal(await page.locator("#smartMode").isDisabled(), true);
      assert.equal(await page.locator("#smartCrop").isChecked(), false);
      for (const mode of ["four", "nine"]) {
        await page.locator("#boardLayoutPreset").selectOption(mode); await waitResult();
        assert.equal(await page.locator("#boardLayoutMask button.on").count(), mode === "four" ? 4 : 9);
      }
      assert.equal(await page.locator("#smartFrameLabel").innerText(), "1 / 4 帧");
      const first = await page.locator("#smartPreview").evaluate(c => c.toDataURL());
      await page.locator("#btnSmartFrameNext").click();
      assert.notEqual(await page.locator("#smartPreview").evaluate(c => c.toDataURL()), first);
      await page.locator("#btnSmartFramePlay").click();
      await page.waitForFunction(() => document.getElementById("smartFrameLabel").textContent !== "2 / 4 帧");
      await page.locator("#btnSmartFramePlay").click();
      await page.screenshot({ path: path.join(out, `import-${width}.png`) });
      await apply();
      assert.equal(await page.locator("#pageCount").innerText(), "4");
      assert.equal(await page.locator("#boardActiveTile option").count(), 9);
      assert.equal(await page.locator("#pageInterval").inputValue(), "250");
      const imported = await picture();
      await page.locator("#btnUndo").click(); assert.equal(await picture(), empty);
      await page.locator("#btnRedo").click(); assert.equal(await picture(), imported);
      await save();
      assert.deepEqual(saved.pages, Array.from({ length: 4 }, (_, i) => expectedFrame(i, M.preset("nine"))), "all source cells, transparency and moving bounds survive across seams");
      await pagesPanel(true);
      await page.locator("#boardActiveTile").selectOption("2");
      await page.locator('[data-board-page="copy"]').click();
      const clip = await page.evaluate(() => window.testClipboard);
      const alpha = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_`abcdefghijklmnopqrstuvwxyz";
      assert.deepEqual(clip.split(",").map(v => alpha.indexOf(v)), Array.from(M.extract(saved.pages[0], saved.layout, 2)));
      assert.equal(await page.locator("#dlgApp").isVisible(), false, "quick copy has no teaching popup");
      await pagesPanel(false);

      if (width === 1440) {
        const downloadPromise = page.waitForEvent("download");
        await page.locator("#btnFinalize").click();
        await (await downloadPromise).saveAs(path.join(out, "animated-mosaic.zip"));
        await page.locator("#btnPreview").click();
        const one = await page.locator("#boardGameCanvas").evaluate(c => c.toDataURL());
        await page.locator("#btnPreviewNext").click();
        assert.notEqual(await page.locator("#boardGameCanvas").evaluate(c => c.toDataURL()), one);
        await page.locator('[data-close-modal="dlgBoardPreview"]').click();
      }

      // The same GIF can be regenerated as four tiles or a shape with a hole.
      for (const mode of ["four", "custom"]) {
        await page.locator("#btnBoardSmart").click(); await waitResult();
        await page.locator("#boardLayoutPreset").selectOption(mode === "custom" ? "nine" : mode); await waitResult();
        if (mode === "custom") { await page.locator("#boardLayoutMask button").nth(4).click(); await waitResult(); }
        await apply(); await save();
        assert.equal(saved.pages.length, 4);
        if (mode === "four") {
          assert.equal(saved.pages[0].length, 72 * 48);
          assert.ok(saved.pages.every(p => p.includes(red) && p.includes(blue)));
        } else assert.deepEqual(saved.pages, Array.from({ length: 4 }, (_, i) => expectedFrame(i, saved.layout)));
      }
      await page.locator("#btnBoardSmart").click(); await waitResult();
      await page.locator("#fileBoardSmart").setInputFiles(path.join(out, "long.gif")); await waitResult();
      assert.match(await page.locator("#boardSmartStatus").innerText(), /原 GIF 12 帧，取前 10 帧/);
      await page.locator("#fileBoardSmart").setInputFiles({ name: "broken.gif", mimeType: "image/gif", buffer: Buffer.from("broken") });
      await page.waitForFunction(() => !document.getElementById("boardSmartStatus").textContent.includes("正在"));
      assert.equal(await page.locator("#btnBoardSmartApply").isDisabled(), true);
      assert.equal(await page.locator("#boardSmartFrames").isHidden(), true);
      await page.locator("#fileBoardSmart").setInputFiles(path.join(out, "still.png")); await waitResult();
      assert.equal(await page.locator("#smartMode").isDisabled(), false);
      assert.equal(await page.locator("#smartCrop").isChecked(), true);
      assert.equal(await page.locator("#boardSmartFrames").isHidden(), true);
      assert.deepEqual(errors, []);
      console.log(`${width}x${height}: real GIF frames, four/nine/custom mosaics, preview, undo, quick copy, frame limit and failed-file recovery passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
