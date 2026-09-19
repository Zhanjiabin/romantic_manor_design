"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");

async function fixtures() {
  const width = 3200, height = 2400, pixels = Buffer.alloc(width * height * 3);
  const selection = { left: 1600, top: 1200, width: 624, height: 384 };
  for (let i = 0; i < pixels.length; i += 3) pixels.set([195, 40, 60], i);
  for (let y = 0; y < selection.height; y++) for (let x = 0; x < selection.width; x++) {
    const gx = (x - 12) / 12, gy = (y - 12) / 24;
    let rgb = [40, 160, 80];
    if (gx >= 0 && gx <= 50 && gy >= 0 && gy <= 15) {
      rgb = gx < 25 ? [248, 248, 248] : [230, 180, 80];
      if ((x - 12) % 12 === 0 || (y - 12) % 24 === 0) rgb = [90, 90, 90];
      else if (gx >= 25 && gx % 1 > 0.3 && gx % 1 < 0.7 && gy % 1 > 0.39 && gy % 1 < 0.61) rgb = [20, 20, 20];
    }
    pixels.set(rgb, ((selection.top + y) * width + selection.left + x) * 3);
  }
  const chart = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const rgba = Buffer.alloc(640 * 480 * 4);
  for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
    rgba.set([x % 256, y % 256, (x + y) % 256, x < 220 ? 0 : x < 340 ? 128 : 255], (y * 640 + x) * 4);
  }
  const transparent = await sharp(rgba, { raw: { width: 640, height: 480, channels: 4 } }).png().toBuffer();
  return [
    { name: "chart", buffer: chart, width, height, selection, modes: ["enhanced", "point", "region", "grid"] },
    { name: "transparent", buffer: transparent, width: 640, height: 480,
      selection: { left: 160, top: 240, width: 400, height: 200 }, modes: ["enhanced", "region"] },
  ];
}

async function importImage(page, buffer, name) {
  await page.evaluate(async ({ base64, name }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    await openImageTerrain(new File([bytes], name + ".png", { type: "image/png" }));
  }, { base64: buffer.toString("base64"), name });
}

async function result(page, mode) {
  await page.locator("#imageTerrainAlgorithm").selectOption(mode);
  return page.evaluate(async () => {
    await waitTerrainThumbImages([...state.images.keys()]);
    state.waterFrame = 0;
    paintImageTerrainPreviewFromMapping();
    await waitTerrainThumbImages([...state.images.keys()]);
    paintImageTerrainPreviewFromMapping();
    const digest = async value => {
      const bytes = ArrayBuffer.isView(value) ? value : new TextEncoder().encode(JSON.stringify(value));
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
    };
    const draft = imageTerrainDraft;
    buildImageTerrainRegionGhost();
    const scene = imageTerrainPlannedScene(imageTerrainWriteCells());
    return {
      image: [draft.image.naturalWidth, draft.image.naturalHeight],
      source: [draft.source.width, draft.source.height], pixels: await digest(draft.source.pixels),
      grid: draft.grid || null, frame: imageTerrainSampleFrame(), ratio: imageTerrainRegionRatio(),
      samples: await digest(draft.sampled.cells), indices: await digest(draft.sampled.indices),
      palette: await digest(draft.palette), mapping: [...document.querySelectorAll("#imageColorMap select")].map(s => s.value),
      terrain: await digest({ stamps: scene.stamps, grass: [...scene.grassKeep] }),
      preview: document.getElementById("imageTerrainPreview").toDataURL(),
      ghost: await digest(draft.regionGhost.toDataURL()),
    };
  });
}

async function assertSameResult(actual, expected, message) {
  const { preview: actualPng, ...actualData } = actual;
  const { preview: expectedPng, ...expectedData } = expected;
  assert.deepEqual(actualData, expectedData, message);
  const a = await sharp(Buffer.from(actualPng.split(",")[1], "base64")).raw().toBuffer();
  const b = await sharp(Buffer.from(expectedPng.split(",")[1], "base64")).raw().toBuffer();
  assert.equal(a.length, b.length, message);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  // GPU and CPU canvas readbacks may round a color channel by one level.
  assert.ok(max <= 1, `${message}: preview channel delta ${max}`);
}

async function main() {
  const cases = await fixtures();
  const output = path.resolve(__dirname, "../_tmp_terrain_qa");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-accelerated-2d-canvas"] });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
      await context.route("**/api/saves/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(process.env.TERRAIN_URL || "http://127.0.0.1:8766/");
      await page.waitForFunction(() => typeof state !== "undefined" && state.kinds && !document.documentElement.classList.contains("boot-pending"));
      await page.evaluate(() => {
        state.mapSize = 3880; state.stamps = []; state.grassKeep = new Set();
        document.getElementById("showGrid").checked = false;
        rebuildStampIndex(); fitCam(); draw();
      });
      const originalScene = await page.evaluate(() => JSON.stringify(snapshotHist()));
      for (const fixture of cases) {
        const { name, buffer, width, height, selection, modes } = fixture;
        const crop = { x: selection.left / width, y: selection.top / height, w: selection.width / width, h: selection.height / height };
        const external = await sharp(buffer).extract(selection).png().toBuffer();
        await importImage(page, buffer, name);
        const before = await result(page, "enhanced");
        await page.locator("#imageTerrainPreview").screenshot({ path: path.join(output, `crop-restore-before-${name}.png`) });
        await page.evaluate(crop => applyImageTerrainCrop(crop), crop);
        assert.deepEqual(await page.evaluate(() => [imageTerrainDraft.image.naturalWidth, imageTerrainDraft.image.naturalHeight]),
          [selection.width, selection.height], "crop becomes an independent, native-resolution image");
        assert.equal(await page.evaluate(() => !!imageTerrainDraft.cropPending), false);
        const internalResults = {};
        for (const mode of modes) internalResults[mode] = await result(page, mode);
        await page.locator("#imageTerrainAlgorithm").selectOption("enhanced");
        await page.locator("#imageTerrainPreview").screenshot({ path: path.join(output, `crop-new-image-${name}-${mobile ? "phone" : "desktop"}.png`) });
        await page.locator('[data-image-preview-mode="original"]').click();
        assert.match(await page.locator("#imageTerrainCropStatus").textContent(), new RegExp(`${selection.width}.*${selection.height}`));
        await page.locator("#btnImageTerrainCropReset").click();
        await page.locator("#imageTerrainPreview").screenshot({ path: path.join(output, `crop-restore-after-${name}.png`) });
        await assertSameResult(await result(page, "enhanced"), before, "restore rebuilds exactly the original import");
        await importImage(page, external, name + "-external");
        for (const mode of modes) await assertSameResult(await result(page, mode), internalResults[mode], `${name}/${mode}: internal crop equals external crop through final terrain pixels`);

        // Subsequent crops operate on the new image, while restore retains the first upload.
        await importImage(page, buffer, name);
        await page.evaluate(crop => applyImageTerrainCrop(crop), crop);
        await page.evaluate(() => applyImageTerrainCrop({ x: 0, y: 0.5, w: 1, h: 0.5 }));
        const twice = await result(page, "enhanced");
        const twiceExternal = await sharp(external).extract({ left: 0, top: selection.height / 2, width: selection.width, height: selection.height / 2 }).png().toBuffer();
        await page.evaluate(() => applyImageTerrainCrop(null));
        await assertSameResult(await result(page, "enhanced"), before, "restore after successive crops");
        await importImage(page, twiceExternal, name + "-twice-external");
        await assertSameResult(await result(page, "enhanced"), twice, "successive crops equal successive external crops");

        await page.evaluate(() => {
          state.imageTerrainRegion = { mode: "rectangle", points: [{ x: 500, y: 1000 }, { x: 3000, y: 2400 }] };
          document.getElementById("imageTerrainScope").value = "rectangle";
          imageTerrainDraft.regionShape = "free";
          renderImageTerrainMapping();
        });
        const region = await page.evaluate(() => JSON.stringify(state.imageTerrainRegion));
        await page.evaluate(() => applyImageTerrainCrop({ x: 0, y: 0, w: 0.5, h: 1 }));
        assert.equal(await page.evaluate(() => JSON.stringify(state.imageTerrainRegion)), region, "crop retains the map placement selection");
        assert.equal(await page.locator("#imageTerrainScope").inputValue(), "rectangle");
        assert.equal(await page.evaluate(() => JSON.stringify(snapshotHist())), originalScene, "preview and crop do not write terrain");
        console.log(JSON.stringify({ mobile, fixture: name, modes, externalCropParity: true, restore: true, successiveCrops: true, passed: true }));
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
