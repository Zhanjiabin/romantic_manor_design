"use strict";

// Optional dependencies: playwright and sharp. All save requests are intercepted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");
const core = require("../web/image-terrain-core.js");

async function chart(cols, rows, step, fill) {
  const x0 = 27, y0 = 43, width = x0 + cols * step + 35, height = y0 + rows * step + 51;
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = y0; y <= y0 + rows * step; y++) for (let x = x0; x <= x0 + cols * step; x++) {
    const cx = Math.floor((x - x0) / step), cy = Math.floor((y - y0) / step);
    const fx = ((x - x0) % step) / step, fy = ((y - y0) % step) / step;
    let rgb = fill(cx, cy);
    if (fx === 0 || fy === 0) rgb = [80, 80, 80];
    else if (fx > 0.3 && fx < 0.7 && fy > 0.4 && fy < 0.6) rgb = [15, 15, 15];
    pixels.set([...rgb, 255], (y * width + x) * 4);
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function main() {
  const output = path.resolve(__dirname, "../_tmp_terrain_qa");
  fs.mkdirSync(output, { recursive: true });
  const a = await chart(31, 23, 20, (x, y) => x < 10 ? [200, 70, 90] : y < 12 ? [240, 240, 240] : [45, 160, 90]);
  const b = await chart(19, 27, 24, (x, y) => (x + y) % 3 === 0 ? [60, 100, 180] : [230, 190, 65]);
  const cases = [
    { name: "wide-chart", buffer: a, grid: [31, 23] },
    { name: "wide-chart-jpeg", buffer: await sharp(a).resize({ width: 487 }).jpeg({ quality: 70 }).toBuffer(), grid: [31, 23] },
    { name: "tall-chart", buffer: b, grid: [19, 27] },
    { name: "tall-chart-half", buffer: await sharp(b).resize({ width: 259 }).png().toBuffer(), grid: [19, 27] },
  ];
  const pixels = Buffer.alloc(240 * 180 * 4);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 240; x++) {
    pixels.set([30 + x / 2, 80 + y / 2, 160, x < 40 || x > 200 || y < 30 || y > 150 ? 0 : 255], (y * 240 + x) * 4);
  }
  cases.push({ name: "transparent-gradient", buffer: await sharp(pixels, { raw: { width: 240, height: 180, channels: 4 } }).png().toBuffer(), grid: null });
  if (process.argv[2]) cases.push({ name: "provided-chart", buffer: fs.readFileSync(process.argv[2]), grid: null, inspect: true });

  const report = [];
  for (const item of cases) {
    const { data, info } = await sharp(item.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const grid = core.detectGrid({ pixels: data, width: info.width, height: info.height });
    await sharp(item.buffer).png().toFile(path.join(output, item.name + "-input.png"));
    if (!item.inspect) assert.deepEqual(grid?.autoSuitable ? [grid.cols, grid.rows] : null, item.grid, `${item.name}: ${JSON.stringify(grid)}`);
    report.push({ name: item.name, grid: grid && [grid.cols, grid.rows], auto: !!grid?.autoSuitable });
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-accelerated-2d-canvas"] });
  try {
    for (const [width, height] of [[1440, 1000], [360, 640], [390, 844], [844, 390], [768, 1024]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      await context.route("**/api/saves/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
      await page.waitForFunction(() => typeof pixelTerrainBrushes === "function" && state.kinds && pixelTerrainBrushes().length > 0);
      await page.waitForFunction(() => !document.documentElement.classList.contains("boot-pending"));
      await page.evaluate(() => { state.mapSize = 3880; });
      for (const item of width === 1440 ? cases : [cases[0]]) {
        await page.locator("#fileImageTerrain").setInputFiles({ name: item.name + ".png", mimeType: "image/png", buffer: item.buffer });
        await page.waitForFunction(name => imageTerrainDraft?.name === name && imageTerrainDraft.sampled, item.name + ".png");
        await page.locator('[data-image-preview-mode="source"]').click();
        const result = await page.evaluate(() => ({
          algorithm: imageTerrainDraft.algorithm,
          grid: imageTerrainDraft.grid && [imageTerrainDraft.grid.cols, imageTerrainDraft.grid.rows],
          count: imageTerrainDraft.sampled.indices.filter(i => i >= 0).length,
          blank: imageTerrainDraft.sampled.indices.filter(i => i < 0).length,
          cleanup: imageTerrainDraft.cleanupChanged,
          status: document.getElementById("imageTerrainStatus").textContent,
        }));
        assert.ok(result.count > 0, item.name);
        if (item.grid) {
          assert.equal(result.algorithm, "grid");
          assert.deepEqual(result.grid, item.grid);
          assert.equal(result.cleanup, 0, "source cells survive light cleanup");
          assert.equal(await page.locator("#imageTerrainSkipBg").isDisabled(), true);
        } else if (!item.inspect) {
          assert.equal(result.algorithm, "enhanced");
          assert.equal(await page.locator("#imageTerrainSkipBg").isDisabled(), false);
          assert.ok(result.blank > result.count / 3, "transparent margin survives");
          await page.locator("#imageTerrainAlgorithm").selectOption("grid");
          assert.match(await page.locator("#imageTerrainStatus").innerText(), /回退/);
        }
        const before = await page.locator("#imageTerrainPreview").evaluate(canvas => canvas.toDataURL());
        const recognition = await page.evaluate(() => JSON.stringify({ indices: imageTerrainDraft.sampled.indices, palette: imageTerrainDraft.palette, mapN: worldExtent() }));
        const stats = await page.locator("#imageTerrainPreview").evaluate(canvas => {
          const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          const colors = new Set();
          for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          return { colors: colors.size };
        });
        assert.ok(stats.colors > 5, "nonblank canvas");
        if (width === 1440) {
          await page.locator("#imageTerrainPreview").screenshot({ path: path.join(output, item.name + "-preview.png") });
          await page.screenshot({ path: path.join(output, item.name + "-dialog.png") });
          if (item.grid || item.inspect) {
            await page.locator("#imageTerrainAlgorithm").selectOption("region");
            assert.equal(await page.evaluate(() => imageTerrainDraft.algorithm), "region");
            await page.locator("#imageTerrainPreview").screenshot({ path: path.join(output, item.name + "-regional.png") });
            await page.locator("#imageTerrainAlgorithm").selectOption("enhanced");
            const afterRecognition = await page.evaluate(() => JSON.stringify({ indices: imageTerrainDraft.sampled.indices, palette: imageTerrainDraft.palette, mapN: worldExtent() }));
            if (afterRecognition !== recognition) fs.writeFileSync(path.join(output, "recognition-diff.json"), JSON.stringify({ before: JSON.parse(recognition), after: JSON.parse(afterRecognition) }));
            assert.ok(afterRecognition === recognition, item.name + ": switching algorithms must reproduce cells");
            const after = await page.locator("#imageTerrainPreview").evaluate(canvas => canvas.toDataURL());
            const firstPixels = await sharp(Buffer.from(before.split(",")[1], "base64")).raw().toBuffer();
            const nextPixels = await sharp(Buffer.from(after.split(",")[1], "base64")).raw().toBuffer();
            const pixelError = firstPixels.reduce((sum, value, i) => sum + Math.abs(value - nextPixels[i]), 0) / firstPixels.length;
            assert.ok(pixelError < 0.5, item.name + ": canvas mean pixel error " + pixelError);
            if (item.grid && item.grid[0] !== item.grid[1]) {
              await page.locator("#imageTerrainFit").selectOption("stretch");
              assert.ok(await page.evaluate(() => imageTerrainDraft.sampled.indices.filter(i => i >= 0).length) > result.count);
              await page.locator("#imageTerrainFit").selectOption("contain");
              assert.equal(await page.evaluate(() => imageTerrainDraft.sampled.indices.filter(i => i >= 0).length), result.count);
              await page.locator("#imageTerrainFit").selectOption("stretch");
              await page.locator("#imageTerrainProjection").selectOption("iso");
              assert.equal(await page.evaluate(() => imageTerrainDraft.algorithm), "grid");
              await page.locator("#imageTerrainProjection").selectOption("front");
            }
          }
          await page.locator('[data-image-preview-mode="terrain"]').click();
          await page.locator('[data-image-preview-mode="source"]').click();
          assert.equal(await page.evaluate(() => imageTerrainDraft.previewMode), "source");
          const original = await page.evaluate(() => JSON.stringify(state.stamps));
          await page.locator("#btnApplyImageTerrain").click();
          assert.ok(await page.evaluate(() => state.stamps.length > 0));
          await page.evaluate(() => undo());
          assert.equal(await page.evaluate(() => JSON.stringify(state.stamps)), original);
        }
        report.push({ width, height, name: item.name, ...result, colors: stats.colors });
      }
      if (width !== 1440) {
        const bounds = await page.locator("#dlgImageTerrain .modal-card").evaluate(card => ({
          left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right,
          client: card.clientWidth, scroll: card.scrollWidth,
        }));
        assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.scroll <= bounds.client + 2, JSON.stringify(bounds));
        await page.screenshot({ path: path.join(output, `dialog-${width}x${height}.png`) });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
