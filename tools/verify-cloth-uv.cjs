// Local browser regression: no provider calls and no writes to user saves.
const { chromium } = require("playwright");
const sharp = require("sharp");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const output = path.join(root, "_tmp_cloth_uv");
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/saves/cloth**", route => route.fulfill({ json: {} }));
    await page.route("**/api/cloth-ai/models", route => route.fulfill({ json: { models: ["gpt-image-2"] } }));
    const reply = await sharp(path.join(root, "data/cloth/templates/female-short/uv.jpg")).png().toBuffer();
    await page.route("**/api/cloth-ai/generate", route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { png: `data:image/png;base64,${reply.toString("base64")}` } });
    });
    await page.goto("http://127.0.0.1:8765/web/cloth.html");
    await page.waitForSelector("html.boot-ready");
    await page.locator("#btnUvGuide").click();
    for (const kind of ["female-short", "female-long", "female-skirt", "male-short", "male-long"]) {
      if (kind === "male-short") await page.locator('[data-gender="male"]').click();
      await page.locator(`[data-kind="${kind}"]`).click();
      await page.waitForFunction(() => document.querySelector("#paintGuide").getContext("2d").getImageData(0, 0, 256, 256).data.some(x => x));
      const url = await page.locator("#paintGuide").evaluate(canvas => canvas.toDataURL());
      const actual = await sharp(Buffer.from(url.split(",")[1], "base64")).raw().toBuffer();
      const coverage = await sharp(path.join(root, `data/cloth/uv-masks/${kind}.png`)).raw().toBuffer();
      let lines = 0;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const p = y * 256 + x;
          const inside = coverage[p * 4 + 3] > 0;
          const edge = inside && (x === 0 || x === 255 || y === 0 || y === 255 ||
            [p - 1, p + 1, p - 256, p + 256].some(n => !coverage[n * 4 + 3]));
          assert.equal(actual[p * 4 + 3], edge ? 255 : 0, `${kind}: unexpected contour at ${x},${y}`);
          if (edge) lines++;
        }
      }
      fs.writeFileSync(path.join(output, `${kind}-guide.png`), Buffer.from(url.split(",")[1], "base64"));
      console.log(`${kind}: ${lines} outline pixels, all on the native UV boundary`);
    }
    await page.locator('[data-gender="female"]').click();
    await page.locator('[data-kind="expression"]').click();
    await page.waitForFunction(() => document.querySelector('#btnUvGuide').hidden);
    assert.equal(await page.locator("#btnUvGuide").isVisible(), false);
    await page.locator('[data-kind="female-short"]').click();
    await page.locator("#btnClothAi").click();
    await page.locator('[data-ai-tab="settings"]').click();
    await page.locator("#clothAiKey").fill("browser-regression-only");
    await page.locator("#clothAiModelCustom").fill("gpt-image-2");
    await page.locator("#clothAiRef").selectOption("stock");
    await page.locator('[data-ai-tab="prompt"]').click();
    await page.locator("#clothAiPrompt").fill("浅蓝学院风，领结和格纹裙，严格沿用底图位置。");
    await page.locator("#btnClothAiGenerate").click();
    await page.waitForFunction(() => document.querySelector("#clothAiStatus").textContent.includes("已画到画布"));
    assert.equal(requests.length, 1);
    const sent = requests[0];
    assert.equal(sent.kind, "female-short");
    assert.equal(sent.useUvMap, true);
    assert(sent.referencePng && sent.uvMapPng && sent.referencePng !== sent.uvMapPng);
    const uvPng = Buffer.from(sent.uvMapPng.split(",")[1], "base64");
    const uv = await sharp(uvPng).raw().toBuffer();
    const guide = await sharp(path.join(output, "female-short-guide.png")).raw().toBuffer();
    for (let p = 0; p < 65536; p++) {
      if (guide[p * 4 + 3]) assert.deepEqual([...uv.subarray(p * 4, p * 4 + 3)], [255, 20, 168]);
    }
    fs.writeFileSync(path.join(output, "sent-uv-map.png"), uvPng);
    await page.locator('[data-close-modal="dlgClothAi"]').click();
    await page.screenshot({ path: path.join(output, "desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "phone.png") });
    assert.deepEqual(errors, []);
    console.log("Browser passed: correct maps per kind, expression guide hidden, reference + UV sent, generation result applied.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
