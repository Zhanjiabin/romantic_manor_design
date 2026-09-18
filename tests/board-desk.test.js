"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const boardHtml = fs.readFileSync(path.join(root, "web/board.html"), "utf8");
const boardJs = fs.readFileSync(path.join(root, "web/board.js"), "utf8");
const boardCss = fs.readFileSync(path.join(root, "web/board.css"), "utf8");
const terrainHtml = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const buildingHtml = fs.readFileSync(path.join(root, "web/building.html"), "utf8");
const clothHtml = fs.readFileSync(path.join(root, "web/cloth.html"), "utf8");
const clothJs = fs.readFileSync(path.join(root, "web/cloth.js"), "utf8");
const buildingJs = fs.readFileSync(path.join(root, "web/building.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
const native = JSON.parse(fs.readFileSync(path.join(root, "data/board_native.json"), "utf8"));
const prompts = JSON.parse(fs.readFileSync(path.join(root, "data/board_ai_prompts.json"), "utf8"));

test("native HD billboard is 36x24 with 10 pages and a 5x10 palette", () => {
  assert.equal(native.kind, "billboard-hd");
  assert.equal(native.cols, 36);
  assert.equal(native.rows, 24);
  assert.equal(native.maxPages, 10);
  assert.equal(native.toolCols, 5);
  assert.equal(native.toolRows, 10);
  assert.equal(native.darkFrame, 50);
  assert.equal(native.defaultIntervalMs, 1000);
  assert.deepEqual(native.designSize, [646, 432]);
  assert.deepEqual(native.composeSize, [648, 432]);
  assert.equal(native.cellPx, 18);
  assert.equal(native.lightSrc, "svr/light/img/highlight.png#5,11");
  assert.deepEqual(native.aiSize, [720, 480]);
  assert.equal(native.palette.length, 50);
  assert.match(boardJs, /const COLS = 36/);
  assert.match(boardJs, /const ROWS = 24/);
  assert.match(boardJs, /const MAX_PAGES = 10/);
  assert.match(boardJs, /const DARK = 50/);
});

test("all four desks can switch to the billboard designer", () => {
  for (const html of [terrainHtml, buildingHtml, clothHtml, boardHtml]) {
    assert.match(html, /href="\/web\/board\.html"/);
    assert.match(html, /href="\/web\/cloth\.html"/);
    assert.match(html, /href="\/web\/building\.html"/);
    assert.match(html, /href="\/"/);
    assert.match(html, /广告<span class="desk-switch-rest">设计桌<\/span>/);
  }
  assert.match(boardHtml, /aria-current="page">广告/);
});

test("billboard desk is isolated from the other three designers' scripts", () => {
  assert.doesNotMatch(boardHtml, /cloth\.js/);
  assert.doesNotMatch(boardHtml, /building\.js/);
  assert.doesNotMatch(boardHtml, /app\.js\?/);
  assert.match(boardHtml, /board\.js\?v=/);
  assert.match(boardHtml, /board\.css\?v=/);
  assert.match(boardHtml, /board-image\.js\?v=/);
  assert.doesNotMatch(clothJs, /\/api\/board-ai/);
  assert.doesNotMatch(clothJs, /billboard-hd/);
  assert.doesNotMatch(clothJs, /BoardImage/);
  assert.doesNotMatch(buildingJs, /\/api\/board-ai/);
  assert.doesNotMatch(buildingJs, /billboard-hd/);
  assert.doesNotMatch(appJs, /\/api\/board-ai/);
  assert.doesNotMatch(appJs, /billboard-hd/);
  assert.doesNotMatch(clothJs, /\/api\/board\/export-ani/);
  assert.doesNotMatch(buildingJs, /\/api\/board\/export-ani/);
  assert.doesNotMatch(appJs, /\/api\/board\/export-ani/);
});

test("billboard smart generate analyzes local PNG/JPG color charts", () => {
  assert.match(boardHtml, /id="dlgBoardSmart"/);
  assert.match(boardHtml, /id="btnBoardSmart"/);
  assert.match(boardHtml, /id="btnBoardSmartHud"/);
  assert.match(boardHtml, /id="btnBoardSmartRail"/);
  assert.match(boardHtml, /id="btnBoardMobileSmart"/);
  assert.match(boardHtml, /id="fileBoardSmart"/);
  assert.match(boardHtml, /白底空格会关灯/);
  assert.match(boardJs, /function openSmartDialog/);
  assert.match(boardJs, /function analyzeImage/);
  assert.match(boardJs, /BoardImage\.analyze/);
  assert.match(boardJs, /btnBoardSmartApply/);
  assert.match(boardCss, /\.board-smart-card/);
  assert.match(boardCss, /#smartPreview\[hidden\]/);
  assert.ok(fs.existsSync(path.join(root, "web/board-image.js")));
});

test("billboard desk is a mobile workspace with pointer painting and jpg export", () => {
  assert.match(boardHtml, /viewport-fit=cover/);
  assert.doesNotMatch(boardHtml, /maximum-scale|user-scalable=no/);
  assert.match(boardHtml, /mobile-workspace\.css/);
  assert.match(boardHtml, /mobile-workspace\.js/);
  assert.match(boardHtml, /mobile-bottom-dock/);
  assert.match(boardHtml, /id="btnSwitchAccount"/);
  assert.match(boardHtml, /phone-account-btn/);
  assert.match(boardHtml, /data-desk-backup/);
  assert.match(boardHtml, /id="fileBoardImage"/);
  assert.match(boardJs, /setPointerCapture/);
  assert.match(boardJs, /pointerCount\(\) >= 2/);
  assert.match(boardJs, /beginGesture/);
  assert.match(boardJs, /image\/jpeg/);
  assert.match(boardCss, /\.palette-grid/);
  assert.match(boardCss, /grid-template-columns:\s*248px minmax\(0, 1fr\) 180px/);
  assert.match(boardCss, /\.palette-grid \{[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(boardCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.palette-swatch \{[\s\S]*min-height:\s*44px/);
  assert.match(boardCss, /--visual-vh/);
});

test("billboard desk copies clothes AI dialog habits without clothes UV tools", () => {
  assert.match(boardHtml, /id="dlgBoardAi"/);
  assert.match(boardHtml, /id="btnBoardAiGenerate"/);
  assert.match(boardHtml, /api\.openroutex\.top/);
  assert.match(boardJs, /\/api\/board-ai\/generate/);
  assert.match(boardJs, /setGenerateBusy/);
  assert.match(boardJs, /button\.textContent = "生成中"/);
  assert.match(boardJs, /sanitizeAiPrompt/);
  assert.doesNotMatch(boardHtml, /btnBeautyDock/);
  assert.doesNotMatch(boardHtml, /btnUvGuide/);
  assert.doesNotMatch(boardJs, /female-short/);
  assert.equal(prompts.templates.length >= 3, true);
  assert.ok(prompts.templates.every((row) => row.kind === "billboard-hd"));
  assert.match(boardHtml, /data-ai-ref="template"/);
  assert.match(boardHtml, /data-ai-ref="upload"/);
  assert.match(boardHtml, /id="fileBoardAiRef"/);
  assert.match(boardHtml, /选择 PNG 或 JPG/);
  assert.match(boardHtml, /拼豆\/色号表会按格子收灯/);
  assert.match(boardJs, /function aiReferencePng/);
  assert.match(boardJs, /function localBeadFromUpload/);
  assert.match(boardJs, /function pageFromGeneratedImage/);
  assert.match(boardJs, /色号表不走 AI 生图/);
  assert.match(boardJs, /function setAiRefMode/);
  assert.ok(prompts.templates.some((row) => row.id === "builtin:billboard-hd:beads"));
  assert.match(prompts.templates.find((row) => row.id === "builtin:billboard-hd:beads").prompt, /白格/);
  assert.match(prompts.templates.find((row) => row.id === "builtin:billboard-hd:default").prompt, /不要改画成太阳小山/);
  assert.match(boardJs, /board_ai_refs\.json/);
  assert.match(boardCss, /\.board-ai-ref-mode/);
  assert.match(boardCss, /\.board-ai-ref-hint/);
  assert.match(boardCss, /\.board-ai-prompt \{[\s\S]*max-height:\s*132px/);
  assert.match(boardHtml, /class="board-ai-ref-label"/);
  assert.match(boardCss, /\.board-ai-ref-grid\[hidden\]/);
  const refs = JSON.parse(fs.readFileSync(path.join(root, "data/board_ai_refs.json"), "utf8"));
  assert.ok(refs.templates.length >= 5);
  refs.templates.forEach((row) => {
    assert.ok(fs.existsSync(path.join(root, "data/board/refs", row.file)));
  });
});

test("billboard pages match native add/copy/paste/delete/fill", () => {
  assert.match(boardJs, /function bindUi/);
  assert.match(boardJs, /bindUi\(\);/);
  assert.match(boardJs, /function deletePage/);
  assert.match(boardJs, /function copyPage/);
  assert.match(boardJs, /function pastePage/);
  assert.match(boardJs, /function fillPage/);
  assert.match(boardHtml, /data-board-page="add"/);
  assert.match(boardHtml, /id="btnFinalize"/);
  assert.match(boardHtml, /data-board-page="fill"/);
  assert.match(boardHtml, /id="pageInterval"/);
  assert.match(boardJs, /analyzeImage/);
  assert.match(boardJs, /quantizeImage/);
  assert.match(boardJs, /\/api\/board\/export-ani/);
  assert.match(boardJs, /\/api\/board\/import-ani/);
  assert.match(boardHtml, /accept="\.ale/);
});

test("billboard finalize writes native AEX ale for in-game import", () => {
  assert.match(boardJs, /exportFinalize/);
  assert.match(boardJs, /\.ale/);
  assert.match(native.palette[0], /^#bb9393$/i);
  assert.equal(native.darkColor, "#757575");
});

test("billboard desk copies native clipboard text and preview controls", () => {
  assert.match(boardHtml, /id="btnBoardCopy"/);
  assert.match(boardHtml, /id="btnBoardCopy"[^>]*>复制</);
  assert.doesNotMatch(boardHtml, /复制到游戏/);
  assert.match(boardHtml, /复制全部页/);
  assert.match(boardHtml, /id="btnBoardMobileCopy"/);
  assert.match(boardJs, /encodePageClip/);
  assert.match(boardJs, /encodeAllClip/);
  assert.match(boardJs, /clipboard\.writeText/);
  assert.match(boardJs, /execCommand\("copy"\)/);
  assert.match(boardJs, /copyAllPages/);
  assert.match(boardJs, /function teachGamePaste/);
  assert.match(boardHtml, /data-board-page="copy-all"/);
  assert.match(boardHtml, /全部粘贴/);
  assert.match(boardJs, /btnPreviewPlay/);
  assert.match(boardJs, /function previewPrev/);
  assert.match(boardJs, /function togglePreviewPlay/);
  assert.match(boardHtml, /id="previewInterval"/);
  assert.match(boardHtml, /id="btnPreviewPrev"/);
  assert.match(boardHtml, /id="btnPreviewNext"/);
});

test("billboard desk blits native highlight.png 18x18 bulbs", () => {
  assert.match(boardJs, /board_highlight\.png/);
  assert.match(boardJs, /drawImage\(highlight/);
  assert.match(boardJs, /SHEET_COLS = 5/);
  assert.match(boardJs, /SHEET_ROWS = 11/);
  assert.match(boardJs, /imageSmoothingEnabled = false/);
  assert.doesNotMatch(boardJs, /createRadialGradient/);
  assert.match(boardCss, /image-rendering:\s*pixelated/);
  assert.ok(fs.existsSync(path.join(root, "data/board_highlight.png")));
});
