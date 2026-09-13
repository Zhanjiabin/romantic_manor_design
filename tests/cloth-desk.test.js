"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const clothHtml = fs.readFileSync(path.join(root, "web/cloth.html"), "utf8");
const clothJs = fs.readFileSync(path.join(root, "web/cloth.js"), "utf8");
const clothCss = fs.readFileSync(path.join(root, "web/cloth.css"), "utf8");
const terrainHtml = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const buildingHtml = fs.readFileSync(path.join(root, "web/building.html"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/cloth_catalog.json"), "utf8"));

test("all three desks switch to the clothes designer", () => {
  for (const html of [terrainHtml, buildingHtml, clothHtml]) {
    assert.match(html, /href="\/web\/cloth\.html"/);
    assert.match(html, /href="\/web\/building\.html"/);
    assert.match(html, /href="\/"/);
    assert.match(html, /衣服<span class="desk-switch-rest">设计桌<\/span>/);
  }
  assert.match(clothHtml, /aria-current="page">衣服/);
});

test("clothes desk keeps native paint sizes and one stock board per kind", () => {
  const byId = Object.fromEntries(catalog.kinds.map((kind) => [kind.id, kind]));
  assert.equal(byId["female-short"].diyType, "cloth");
  assert.equal(byId["female-short"].width, 256);
  assert.equal(byId["hair"].diyType, "fair");
  assert.equal(byId["hair"].width, 512);
  assert.equal(byId["hair"].height, 256);
  assert.equal(byId["expression"].diyType, "biaoqing");
  assert.equal(byId["face"].diyType, "face");
  for (const kind of catalog.kinds) {
    assert.equal(kind.templateCount, 1, kind.id);
    assert.equal(kind.templates.length, 1, kind.id);
    assert.equal(kind.templates[0].name, "默认 UV");
    assert.ok(fs.existsSync(path.join(root, "data/cloth/templates", kind.id, kind.templates[0].file)));
  }
  assert.equal(catalog.templateCount, catalog.kinds.length);
});

test("clothes desk is a mobile workspace with pointer painting and jpg export", () => {
  assert.match(clothHtml, /viewport-fit=cover/);
  assert.doesNotMatch(clothHtml, /maximum-scale|user-scalable=no/);
  assert.match(clothHtml, /mobile-workspace\.css/);
  assert.match(clothHtml, /mobile-workspace\.js/);
  assert.match(clothHtml, /mobile-bottom-dock/);
  assert.match(clothHtml, /id="btnSwitchAccount"/);
  assert.match(clothHtml, /phone-account-btn/);
  assert.match(clothHtml, /id="fileClothImage"/);
  assert.match(clothHtml, /accept="image\/png/);
  assert.match(clothHtml, /id="paintCanvas"/);
  assert.match(clothHtml, /id="btnSaveBoard"/);
  assert.match(clothHtml, /游戏只收 JPG/);
  assert.match(clothHtml, /导出 JPG/);
  assert.doesNotMatch(clothHtml, /templateSearch/);
  assert.doesNotMatch(clothHtml, /btnMood/);
  assert.match(clothJs, /function templateSrc/);
  assert.match(clothJs, /encodeURI/);
  assert.match(clothJs, /pointerCount\(\) >= 2/);
  assert.match(clothJs, /toDataURL\("image\/png"\)/);
  assert.match(clothJs, /toBlob\(\(blob\) => \{/);
  assert.match(clothJs, /"image\/jpeg", 0\.92/);
  assert.match(clothJs, /衣服设计"\}\.jpg/);
  assert.doesNotMatch(clothJs, /function exportPng/);
  assert.match(clothJs, /\/api\/saves\/cloth/);
  assert.doesNotMatch(clothJs, /keepalive/);
  assert.match(clothJs, /const FAIR_SIZE = \[512, 256\]/);
  assert.match(clothJs, /const CLOTH_SIZE = \[256, 256\]/);
  assert.match(clothJs, /BLANK_ID/);
  assert.match(clothJs, /function saveBoard/);
  assert.match(clothJs, /BOARDS_KEY/);
  assert.match(clothJs, /clear: true/);
  assert.match(clothJs, /template-card-cap/);
  assert.match(clothJs, /const PAPER/);
  assert.match(clothJs, /function fillPaper/);
  assert.doesNotMatch(clothJs, /await applyTemplate\(template\);\s*markDirty/);
  assert.match(clothCss, /background:\s*#f4f0ea/);
  assert.doesNotMatch(clothCss, /linear-gradient\(45deg, #d8d8d8/);
  assert.match(clothCss, /scrollbar-gutter:\s*stable/);
  assert.match(clothCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.cloth-app \.brand/);
  assert.match(clothCss, /min-height:\s*44px/);
  assert.match(clothCss, /outline-offset:\s*-2px/);
});

test("clothes desk AI design fills prompt templates without sending them", () => {
  const prompts = JSON.parse(fs.readFileSync(path.join(root, "data/cloth_ai_prompts.json"), "utf8"));
  const kinds = catalog.kinds.map((kind) => kind.id);
  const byKind = {};
  for (const row of prompts.templates) {
    assert.ok(kinds.includes(row.kind), row.id);
    assert.match(row.prompt, /UV|512×256|256×256/);
    byKind[row.kind] = (byKind[row.kind] || 0) + 1;
  }
  for (const kind of kinds) {
    assert.ok(byKind[kind] >= 2, kind);
  }
  assert.match(clothHtml, /id="dlgClothAi"/);
  assert.match(clothHtml, /id="clothAiPrompt"/);
  assert.match(clothHtml, /id="btnClothAiGenerate"/);
  assert.match(clothHtml, /id="btnClothMobileAi"/);
  assert.match(clothHtml, /viewport-fit=cover/);
  assert.match(clothJs, /\/api\/cloth-ai\/models/);
  assert.match(clothJs, /\/api\/cloth-ai\/generate/);
  assert.match(clothJs, /function openAiDialog/);
  assert.match(clothJs, /clothAiPromptPick/);
  assert.doesNotMatch(clothJs, /clothAiPromptPick[\s\S]{0,400}generateAiDesign/);
  assert.match(clothJs, /textarea\.value = row\.prompt/);
  assert.doesNotMatch(clothJs, /console\.log\([^)]*apiKey/);
  assert.match(clothCss, /min-height:\s*44px/);
  assert.match(clothCss, /\.cloth-ai-prompt/);
});
