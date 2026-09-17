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
    assert.equal(kind.templates[0].file, "uv.jpg");
    assert.match(kind.templates[0].url, /\/uv\.jpg\?v=3$/);
    assert.ok(fs.existsSync(path.join(root, "data/cloth/templates", kind.id, kind.templates[0].file)));
  }
  assert.equal(catalog.templateCount, catalog.kinds.length);
});

test("clothes desk exposes a new-design entry on phone chrome", () => {
  assert.match(clothHtml, /id="btnNewDesign"/);
  assert.match(clothHtml, /id="btnClothMobileNew"/);
  assert.doesNotMatch(clothHtml, /id="btnNewDesignRail"/);
  assert.match(clothHtml, /data-cloth-io="new"/);
  assert.match(clothJs, /function startNewDesign/);
  assert.match(clothJs, /btnClothMobileNew/);
  assert.match(clothJs, /action === "new"/);
  const newDesign = clothJs.slice(clothJs.indexOf("async function startNewDesign"), clothJs.indexOf("function importImageFile"));
  assert.match(newDesign, /applyTemplate\(\{ id: BLANK_ID, blank: true \}\)/);
  assert.doesNotMatch(newDesign, /stockTemplate/);
  assert.match(clothJs, /setSaveStatus\("未保存"\)/);
  assert.match(clothCss, /#btnNewDesign/);
  assert.match(clothCss, /:not\(#btnNewDesign\)/);
  assert.match(clothCss, /min-width:\s*44px/);
  assert.match(clothHtml, /id="btnSaveDesign"[^>]*>完成</);
  assert.doesNotMatch(clothHtml, /id="btnSaveDesign"[^>]*>完成设计</);
  assert.match(clothCss, /\.cloth-app \.save-status \{[\s\S]*?display:\s*none/);
  assert.match(clothCss, /#btnSaveDesign \{[\s\S]*?min-height:\s*32px/);
});

test("clothes desk is a mobile workspace with pointer painting and jpg export", () => {
  assert.match(clothHtml, /viewport-fit=cover/);
  assert.doesNotMatch(clothHtml, /maximum-scale|user-scalable=no/);
  assert.match(clothHtml, /mobile-workspace\.css/);
  assert.match(clothHtml, /mobile-workspace\.js/);
  assert.match(clothHtml, /mobile-bottom-dock/);
  assert.match(clothHtml, /id="btnSwitchAccount"/);
  assert.match(clothHtml, /phone-account-btn/);
  assert.match(clothHtml, /data-desk-backup/);
  assert.match(clothHtml, /phone-backup-btn/);
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
  assert.match(clothCss, /@keyframes cloth-select-pulse/);
  assert.match(clothCss, /template-card-name/);
});

test("clicking a clothes board keeps the template list scroll position", () => {
  assert.match(clothJs, /function preserveListScroll/);
  assert.match(clothJs, /function sheetListScroller/);
  assert.match(clothJs, /data-mobile-sheet-scroll/);
  const render = clothJs.slice(clothJs.indexOf("function renderTemplates"), clothJs.indexOf("function renderDesigns"));
  assert.match(render, /preserveListScroll\(sheetListScroller\(grid\)/);
  assert.doesNotMatch(render, /scrollIntoView/);
  assert.match(render, /template\.custom && boardEditOn/);
  assert.match(render, /visibleTemplates\(\)/);
});

test("clothes boards can be filtered by name", () => {
  assert.match(clothHtml, /id="boardSearch"/);
  assert.match(clothJs, /function visibleTemplates/);
  assert.match(clothJs, /function boardSearchBlob/);
  assert.match(clothJs, /boardSearchBlob\(template\)/);
  assert.match(clothCss, /\.board-search/);
});

test("clothes boards hide delete until edit mode, and AI can send the kind UV map", () => {
  assert.match(clothHtml, /id="btnBoardEdit"/);
  assert.match(clothJs, /function setBoardEditOn/);
  assert.match(clothCss, /\.cloth-board-edit/);
  assert.match(clothHtml, /id="clothAiUv"/);
  assert.match(clothHtml, /checked/);
  assert.match(clothJs, /uvMapPngForKind\(state\.kindId\)/);
  assert.match(clothJs, /useUvMap/);
  assert.match(clothJs, /templates\?\.\[0\]/);
});

test("clothes desk uses Meitu-style beauty tools instead of freehand liquify", () => {
  assert.doesNotMatch(clothJs, /id: "lift"/);
  assert.doesNotMatch(clothHtml, /data-sel="lift"/);
  assert.doesNotMatch(clothHtml, /data-liq="pinch"/);
  assert.doesNotMatch(clothJs, /label: "美发"/);
  assert.doesNotMatch(clothJs, /label: "磨皮"/);
  assert.doesNotMatch(clothJs, /label: "皮肤美化"/);
  assert.match(clothJs, /function detectFaceBox/);
  assert.match(clothJs, /function setBeautyFamily/);
  assert.match(clothJs, /function healStamp/);
  assert.match(clothJs, /function cutoutFlood/);
  assert.match(clothJs, /function sculptPush/);
  assert.match(clothJs, /function applyBeautyFromSnap/);
  assert.match(clothHtml, /面部重塑/);
  assert.match(clothHtml, /瘦脸瘦身/);
  assert.match(clothHtml, /身材塑形/);
  assert.match(clothHtml, /消除笔/);
  assert.match(clothHtml, /抠图/);
  assert.match(clothHtml, /一键去底/);
  assert.match(clothHtml, /data-beauty-slider="eyeGap"/);
  assert.match(clothHtml, /data-beauty-slider="slimFace"/);
  assert.match(clothHtml, /data-beauty-slider="waist"/);
  assert.match(clothCss, /\.beauty-families/);
  assert.match(clothCss, /\.beauty-family\.on/);
  assert.match(clothHtml, /id="btnUvGuide"/);
  assert.match(clothHtml, /id="btnBeautyDock"/);
  assert.match(clothHtml, /id="paintGuide"/);
  assert.match(clothHtml, />底图</);
  assert.match(clothHtml, />修图</);
  assert.match(clothCss, /\.canvas-hud-actions/);
  assert.match(clothCss, /\.canvas-hud-btn \{[\s\S]*?height:\s*36px/);
  assert.match(clothJs, /function extractUvOutline/);
  assert.match(clothJs, /255,\s*20,\s*168/);
  assert.match(clothJs, /function setUvGuideOn/);
  assert.match(clothJs, /function refreshUvGuide/);
  assert.match(clothJs, /function uvMapPngForKind/);
  assert.match(clothJs, /if \(uvGuideOn\) \{\s*const guide = guideCanvas\(\);/);
  assert.match(clothJs, /id: "heal"/);
  assert.match(clothJs, /id: "cutout"/);
  assert.match(clothJs, /setTool\("sculpt"\)/);
  assert.match(clothHtml, /cloth\.js\?v=45/);
  assert.match(clothHtml, /cloth\.css\?v=42/);
});

test("clothes desk work list can filter, search, and sort", () => {
  assert.match(clothHtml, /id="designSearch"/);
  assert.match(clothHtml, /id="designKindFilter"/);
  assert.match(clothHtml, /id="designSortBy"/);
  assert.match(clothHtml, /id="designSortDir"/);
  assert.match(clothHtml, /option value="savedAt">设计时间/);
  assert.match(clothHtml, /option value="name">作品名/);
  assert.match(clothJs, /function visibleDesigns/);
  assert.match(clothJs, /function fillDesignKindFilter/);
  assert.match(clothJs, /function persistDesignFilter/);
  assert.match(clothJs, /localeCompare\(String\(b\.name \|\| ""\), "zh"\)/);
  assert.match(clothJs, /designFilter\.sortDir === "asc" \? "desc" : "asc"/);
  assert.doesNotMatch(clothJs, /dirBtn\.textContent = desc \? "逆序"/);
  assert.match(clothJs, /classList\.toggle\("is-asc"/);
  assert.match(clothCss, /\.design-filter/);
  assert.match(clothCss, /#designSortDir/);
  assert.match(clothCss, /\.design-toolbar/);
  assert.match(clothCss, /grid-template-columns:\s*repeat\(2/);
  assert.match(clothCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.design-list \{[\s\S]*?repeat\(3/);
  assert.match(clothCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.template-grid \{[\s\S]*?repeat\(3/);
  assert.match(clothCss, /html\.mobile-portrait \.cloth-app \.mobile-sheet \{[\s\S]*?66dvh/);
  assert.match(clothCss, /data-sheet-mode="works"/);
  assert.match(clothCss, /\.design-card-kind/);
  assert.match(clothJs, /function setClothToolSheetMode/);
  assert.match(clothJs, /function revealClothCanvas/);
  assert.match(clothJs, /await applyTemplate\(template\);/);
  assert.match(clothJs, /revealClothCanvas\(\);/);
  assert.match(clothJs, /renderDesigns\(\);\s*revealClothCanvas\(\);/);
  assert.match(clothCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.cloth-stage \{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(clothHtml, /data-sheet-mode="draw"/);
  assert.match(clothHtml, /cloth-works-block/);
  assert.match(clothHtml, /id="btnDesignEdit"/);
  assert.match(clothJs, /function setDesignEditOn/);
  assert.match(clothJs, /function deleteDesign/);
  assert.match(clothJs, /function renameDesign/);
  assert.match(clothJs, /saveDesignBusy/);
  assert.match(clothJs, /removeIds: \[item\.id\]/);
  assert.match(clothJs, /designs: \{ v: 1, savedAt: now, items: \[item\] \}/);
  assert.doesNotMatch(clothJs, /await fetchClothSaves\(\);\s*const merged = mergeDesigns/);
  assert.match(clothCss, /\.design-card-rename/);
  assert.match(clothCss, /\.design-card-del/);
});

test("clothes desk commits one history step per stroke and exposes redo on the phone dock", () => {
  assert.match(clothJs, /function commitHistory/);
  assert.match(clothJs, /function rememberCurrentHistory/);
  assert.match(clothJs, /historyBusy/);
  assert.match(clothJs, /strokeDirty/);
  assert.doesNotMatch(clothJs, /function pushHistory/);
  assert.match(clothJs, /floodFill\(point\.x, point\.y\);\s*commitHistory\(\);/);
  assert.match(clothJs, /if \(strokeDirty\) commitHistory\(\);/);
  assert.match(clothJs, /await restorePng\(payload\.png\);\s*commitHistory\(\);/);
  assert.match(clothHtml, /id="btnClothMobileRedo"/);
  assert.match(clothHtml, /id="btnRedo"/);
  assert.match(clothJs, /btnClothMobileRedo/);
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
    assert.match(clothJs, /maskPng/);
    assert.match(clothJs, /function stampMask/);
    assert.match(clothHtml, /id="paintMask"/);
    assert.match(clothHtml, /id="clothAiPatch"/);
    assert.match(clothHtml, /id="clothAiUv"/);
    assert.match(clothHtml, /id="btnClearMask"/);
    assert.match(clothCss, /\.cloth-ai-patch/);
  assert.match(clothJs, /function openAiDialog/);
  assert.match(clothJs, /function setAiTab/);
  assert.match(clothHtml, /data-ai-tab="prompt"/);
  assert.match(clothHtml, /data-ai-tab="settings"/);
  assert.match(clothHtml, /data-ai-pane="settings"/);
  assert.match(clothCss, /\.cloth-ai-tabs/);
  assert.match(clothCss, /\.cloth-ai-tab\.on/);
  assert.match(clothJs, /clothAiPromptPick/);
  assert.doesNotMatch(clothJs, /clothAiPromptPick[\s\S]{0,400}generateAiDesign/);
  assert.match(clothJs, /textarea\.value = row\.prompt/);
  assert.doesNotMatch(clothJs, /console\.log\([^)]*apiKey/);
  assert.match(clothCss, /min-height:\s*44px/);
  assert.match(clothCss, /\.cloth-ai-prompt/);
  assert.match(clothCss, /\.cloth-ai-layout/);
});

test("clothes desk try-on preview uses native CMZ meshes and drag rotate", () => {
  const preview = JSON.parse(fs.readFileSync(path.join(root, "data/cloth/preview/manifest.json"), "utf8"));
  const previewJs = fs.readFileSync(path.join(root, "web/cloth-preview.js"), "utf8");
  assert.equal(preview.viewport[0], 220);
  assert.equal(preview.viewport[1], 300);
  for (const id of ["female-short", "female-long", "female-skirt", "male-short", "male-long"]) {
    const row = preview.kinds[id];
    assert.ok(row, id);
    const slots = new Set(row.body.map((part) => part.slot));
    assert.deepEqual([...slots].sort(), ["cloth", "skin"]);
    const cloth = row.body.find((part) => part.slot === "cloth");
    assert.ok(cloth.indices.length >= 3, id);
    assert.ok(fs.existsSync(path.join(root, "data/cloth/preview", row.defaultCloth)), id);
  }
  assert.ok(preview.shared["female-head"].positions.length);
  assert.ok(preview.shared["male-hair"].indices.length);
  assert.match(clothHtml, /id="previewCanvas"/);
  assert.match(clothHtml, /width="520"/);
  assert.match(clothHtml, /height="680"/);
  assert.match(clothHtml, /preview-stage/);
  assert.match(clothHtml, /cloth-preview\.js/);
  assert.match(clothHtml, /id="previewHint"/);
  assert.match(clothHtml, /id="previewClothPick"/);
  assert.match(clothHtml, /id="previewHairPick"/);
  assert.match(clothHtml, /id="previewExprPick"/);
  assert.match(clothHtml, /id="previewFacePick"/);
  assert.match(clothHtml, /id="previewBodyPicks"/);
  assert.match(clothHtml, /id="paintGhost"/);
  assert.match(clothHtml, /id="sizePresets"/);
  assert.match(clothHtml, /cloth-seg/);
  assert.match(clothJs, /ClothTryOn\.open/);
  assert.match(clothJs, /ClothTryOn\?\.close/);
  assert.match(clothJs, /snapshotCurrentSlot/);
  assert.match(clothJs, /applyPreviewSlots/);
  assert.match(clothJs, /slots\.hair/);
  assert.match(clothJs, /当前画布/);
  assert.match(clothJs, /getCoalescedEvents/);
  assert.match(clothJs, /SIZE_MAX/);
  assert.match(previewJs, /pointerdown/);
  assert.match(previewJs, /yaw \+= dx/);
  assert.match(previewJs, /yaw = Math\.PI/);
  assert.match(previewJs, /getContext\("webgl"/);
  assert.match(previewJs, /\/data\/cloth\/preview\//);
  assert.match(previewJs, /setYaw/);
  assert.match(previewJs, /POLYGON_OFFSET_FILL/);
  assert.match(previewJs, /horizRadius/);
  assert.match(previewJs, /viewCamera/);
  assert.match(previewJs, /setSlot/);
  assert.match(previewJs, /slot:face/);
  assert.match(previewJs, /uFill/);
  assert.match(clothCss, /touch-action:\s*none/);
  assert.match(clothCss, /preview-stage/);
  assert.match(clothCss, /preview-body-pick/);
  assert.match(clothCss, /680px/);
  assert.match(clothCss, /is-tablet-workspace/);
  assert.match(clothCss, /\.cloth-ai-layout/);
  assert.match(clothHtml, /cloth-ai-layout/);
  assert.match(clothHtml, /cloth-ai-side/);
});
