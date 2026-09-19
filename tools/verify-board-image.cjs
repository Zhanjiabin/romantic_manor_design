"use strict";

// Run against a local server; optional dependencies are playwright and sharp.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");
const { chromium } = require("playwright");

async function main() {
  const profile = process.argv[2] || "reference";
  if (!["reference", "teaching-sign"].includes(profile)) throw new Error("Unknown fixture profile");
  const fixtureDir = path.join(__dirname, "../tests/fixtures/board-image", profile === "reference" ? "" : profile);
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8")).find(f => f.name === "reference");
  const gridSize = profile === "reference" ? 54 : 68;
  const output = path.resolve(__dirname, profile === "reference" ? "../_tmp_board_browser" : "../_tmp_board_sign_browser");
  fs.mkdirSync(output, { recursive: true });
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, "reference.rgba.gz")));
  const buffer = await sharp(raw, { raw: { width: fixture.width, height: fixture.height, channels: 4 } }).png().toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = [];
  try {
    for (const [width, height] of [[1440, 1000], [360, 640], [390, 844], [844, 390], [768, 1024]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/saves/board", route => route.fulfill({ json: { designs: { items: [] } } }));
      await page.goto(process.env.BOARD_URL || "http://127.0.0.1:8765/web/board.html");
      await page.waitForFunction(() => window.BoardImage && document.querySelectorAll("#paletteGrid button").length > 0);
      const before = await page.locator("#paintCanvas").evaluate(canvas => canvas.toDataURL());
      const trigger = page.locator("#btnBoardSmart").first();
      await trigger.click();
      await page.locator("#fileBoardSmart").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer });
      await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      assert.ok((await page.locator("#boardSmartStatus").innerText()).includes(`${gridSize}×${gridSize}`));
      const preview = await page.locator("#smartPreview").evaluate(canvas => {
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let whites = 0, colors = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 235) whites++;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) colors++;
        }
        return { whites, colors, url: canvas.toDataURL() };
      });
      assert.ok(preview.whites > 10000 && preview.colors > 5000, "preview contains white artwork and colors");
      const overflow = await page.locator("#dlgBoardSmart .modal-card").evaluate(card => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: innerWidth, scroll: card.scrollWidth, width: card.clientWidth };
      });
      assert.ok(overflow.left >= 0 && overflow.right <= width + 1 && overflow.scroll <= overflow.width + 2, JSON.stringify(overflow));
      const canvasBounds = await page.locator("#smartPreview").boundingBox();
      const applyBounds = await page.locator("#btnBoardSmartApply").boundingBox();
      assert.ok(canvasBounds.y + canvasBounds.height <= height && applyBounds.y + applyBounds.height <= height, "preview and apply fit viewport");
      await page.screenshot({ path: path.join(output, `dialog-${width}x${height}.png`) });
      await page.locator("#btnBoardSmartApply").click();
      await page.waitForFunction(() => document.getElementById("dlgBoardSmart").hidden);
      assert.equal(await page.locator("#paintCanvas").evaluate(canvas => canvas.toDataURL()), preview.url, "commit equals preview");
      const undo = "#btnUndo";
      await page.locator(undo).click();
      assert.equal(await page.locator("#paintCanvas").evaluate(canvas => canvas.toDataURL()), before, "undo restores previous page");
      await trigger.click();
      await page.locator("#smartSampling").selectOption("nearest");
      await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      const nearest = await page.locator("#smartPreview").evaluate(canvas => canvas.toDataURL());
      assert.notEqual(nearest, preview.url, "sampling option recomputes result");
      await page.locator("#smartBackground").check();
      await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      const kept = await page.locator("#smartPreview").evaluate(canvas => canvas.toDataURL());
      if (profile === "reference") assert.notEqual(kept, nearest);
      else assert.equal(kept, nearest, "fully coded scene already preserves its pale background");
      await page.locator("#smartMode").selectOption("photo");
      await page.waitForFunction(() => !document.getElementById("btnBoardSmartApply").disabled);
      assert.ok((await page.locator("#boardSmartStatus").innerText()).includes(`图片 ${fixture.width}×${fixture.height}`));
      await page.locator("#fileBoardSmart").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
      await page.waitForFunction(() => !document.getElementById("boardSmartStatus").textContent.includes("正在"));
      assert.equal(await page.locator("#btnBoardSmartApply").isDisabled(), true, "failed upload cannot apply stale page");
      assert.equal(await page.locator("#smartPreview").isHidden(), true);
      assert.deepEqual(errors, []);
      report.push({ width, height, whites: preview.whites, colors: preview.colors, result: "passed" });
      console.log(`${width}x${height}: passed`);
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
