"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/building.html"), "utf8");
const css = fs.readFileSync(path.join(root, "web/building.css"), "utf8");
const js = fs.readFileSync(path.join(root, "web/building.js"), "utf8");

function commandIds() {
  const ids = [];
  const block = js.slice(js.indexOf("const COMMANDS = ["), js.indexOf("const SHORTCUT_NOTES"));
  for (const match of block.matchAll(/id:\s*"([^"]+)"[\s\S]*?shortcut:\s*"([^"]+)"/g)) {
    ids.push({ id: match[1], shortcut: match[2] });
  }
  return ids;
}

test("command bar buttons declare commands that exist in COMMANDS", () => {
  const known = new Set(commandIds().map((row) => row.id));
  const needed = [
    "undo", "redo", "bottom", "down", "up", "top",
    "flip", "lock", "duplicate", "group", "ungroup", "savePreset", "delete",
  ];
  needed.forEach((id) => assert.ok(known.has(id), `missing COMMAND ${id}`));
  for (const match of html.matchAll(/data-command="([^"]+)"/g)) {
    assert.ok(known.has(match[1]), `button data-command=${match[1]} has no COMMANDS entry`);
  }
});

test("keydown routes every command-bar and align shortcut", () => {
  const required = [
    "undo", "redo", "bottom", "down", "up", "top",
    "layerBack", "layerFront",
    "facingPrev", "facingNext", "flip", "lock", "duplicate",
    "group", "ungroup", "savePreset", "delete",
    "alignLeft", "alignCenterX", "alignRight", "alignTop", "alignCenterY", "alignBottom",
    "distributeX", "distributeY",
  ];
  required.forEach((id) => {
    if (id === "undo") {
      assert.ok(
        js.includes('executeCommand(event.shiftKey ? "redo" : "undo")') || js.includes('executeCommand("undo")'),
        "keydown does not execute undo"
      );
      return;
    }
    assert.ok(
      js.includes(`executeCommand("${id}")`) || js.includes(`? "${id}"`) || js.includes(`: "${id}"`),
      `keydown does not execute ${id}`
    );
  });
  assert.match(js, /executeCommand\(event\.shiftKey \? "redo" : "undo"\)/);
  assert.match(js, /executeCommand\(event\.shiftKey \? "distributeX" : "alignCenterX"\)/);
  assert.match(js, /executeCommand\(event\.shiftKey \? "distributeY" : "alignCenterY"\)/);
  assert.match(js, /key === "n".*executeCommand\("paintTool"\)/s);
  assert.match(js, /key === "r".*executeCommand\("flip"\)/s);
  assert.match(js, /key === "q".*executeCommand\("facingPrev"\)/s);
  assert.match(js, /key === "e".*executeCommand\("facingNext"\)/s);
});

test("command bar and tool rail can be dragged to any position", () => {
  assert.match(html, /id="commandHudGrip"/);
  assert.match(html, /id="toolHudGrip"/);
  assert.match(js, /function hudDragEnabled\(/);
  assert.match(js, /setPointerCapture/);
  assert.match(js, /--hud-left/);
  assert.match(js, /dataset\.hudTapAt/);
  assert.match(js, /manor-building-hud-layout-v1/);
  assert.match(js, /function clampHudPosition\(/);
  assert.match(css, /\.hud-drag-grip/);
  assert.match(css, /\.stage-commandbar\.is-placed/);
  assert.match(css, /\.canvas-tool-dock\.is-placed/);
  assert.match(html, /designDock[\s\S]*commandHudGrip/);
});

test("hover tips are wired and not clipped by toolbar overflow", () => {
  assert.match(css, /\.shortcut-tip\s*\{/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /\.shortcut-tip-caret/);
  assert.match(css, /\.shortcut-tip-body/);
  assert.match(css, /\.tool-glyph/);
  assert.match(js, /function applyCommandTooltips\(/);
  assert.match(js, /function wireHoverTips\(/);
  assert.match(js, /applyCommandTooltips\(\);\s*wireHoverTips\(\);/);
  assert.match(js, /element\.removeAttribute\("title"\)/);
  assert.match(js, /dataset\.tipKeys/);
  assert.doesNotMatch(js, /offsetWidth \|\| 120/);
  assert.match(js, /anchorX - tipW \/ 2/);
  assert.match(js, /function clearHoverTip/);
  assert.match(js, /#canvasToolrail \.tool-item"\)\.forEach\(clearHoverTip\)/);
  assert.doesNotMatch(html, /data-tool="[^"]+"[^>]*\stitle=/);
  assert.doesNotMatch(html, /data-marquee-mode="[^"]+"[^>]*\stitle=/);
  assert.match(css, /\.canvas-toolrail \.tool-hint[\s\S]*min-height:\s*32px/);
  assert.match(css, /\.canvas-toolrail \.tool-hint[\s\S]*max-height:\s*32px/);
});

test("empty custom folders persist after creating a group", () => {
  assert.match(js, /function ensureCustomFolder\(/);
  assert.match(js, /customFolders: \[\]/);
  assert.match(js, /folders: customFolders\(\)/);
  assert.match(js, /ensureCustomFolder\(folder\)/);
  assert.match(js, /「\$\{folder\}」里还没有组件/);
});

test("custom component cards composite a sprite thumbnail", () => {
  assert.match(js, /function paintCompositeItems\(/);
  assert.match(js, /function buildCustomThumb\(/);
  assert.match(js, /buildCustomThumb\(item\)/);
  assert.match(css, /\.custom-card-thumb/);
  assert.match(css, /grid-template-columns:\s*64px minmax\(0, 1fr\) auto/);
});

test("组件 category replaces 套件 and the customs rail tab", () => {
  assert.match(js, /CUSTOM_CATEGORY = "组件"/);
  assert.match(js, /CATEGORY_ORDER = \[ALL_CATEGORY, \.\.\.MATERIAL_CATEGORIES, CUSTOM_CATEGORY\]/);
  assert.match(js, /function isCustomCategory\(/);
  assert.match(js, /function syncAssetCategoryView\(/);
  assert.match(js, /state\.category === "套件"/);
  assert.doesNotMatch(html, /data-tab="customs"/);
  assert.match(html, /id="tabCustoms"/);
  assert.match(html, /class="customs-pane"/);
  assert.match(css, /\.rail-tabs[\s\S]{0,120}grid-template-columns:\s*repeat\(2, 1fr\)/);
});

test("category grid and theme picker both have an 全部 filter", () => {
  assert.match(js, /ALL_CATEGORY = "全部"/);
  assert.match(js, /THEME_ALL = "\*"/);
  assert.match(js, /function isAllCategory\(/);
  assert.match(js, /function isAllThemes\(/);
  assert.match(js, /function collectAssetRows\(/);
  assert.match(js, /allOpt\.textContent = "全部"/);
  assert.match(js, /value === THEME_ALL/);
  assert.match(css, /\.category-grid \.cat-all/);
  assert.match(css, /\.category-grid button \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 4\.5ch/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(js, /badge\.className = "cat-count"/);
  assert.doesNotMatch(js, /if \(count > 0\) \{\s*const badge/);
});

test("C groups selected sprites and the diamond brush is gone", () => {
  const group = commandIds().find((row) => row.id === "group");
  assert.equal(group.shortcut, "C");
  assert.doesNotMatch(html, /data-tool="diamond"/);
  assert.doesNotMatch(js, /id: "diamondTool"/);
  assert.match(js, /key === "c" && !event\.ctrlKey[\s\S]*executeCommand\("group"\)/);
  assert.match(html, /data-command="group"[^>]*title="成组 C"/);
});

test("R flips, Q/E change facing, P saves preset", () => {
  const flip = commandIds().find((row) => row.id === "flip");
  const prev = commandIds().find((row) => row.id === "facingPrev");
  const next = commandIds().find((row) => row.id === "facingNext");
  const save = commandIds().find((row) => row.id === "savePreset");
  assert.equal(flip.shortcut, "R");
  assert.equal(prev.shortcut, "Q");
  assert.equal(next.shortcut, "E");
  assert.equal(save.shortcut, "P");
  assert.match(js, /id: "flip".*run: flipSelectedOrBrush/s);
});

test("right click pans on drag and opens a command menu on click", () => {
  assert.match(js, /event\.button === 2/);
  assert.match(js, /interaction\.mode = "right"/);
  assert.match(js, /function openCanvasContextMenu/);
  assert.match(js, /function pickRecordAsBrush/);
  assert.match(js, /粘贴到此处/);
  assert.doesNotMatch(js, /contextmenu[\s\S]{0,200}cancelPick\(/);
  assert.match(js, /addEventListener\("contextmenu", blockBrowserMenu, true\)/);
  assert.match(css, /\.ctx-menu\s*\{/);
});

test("layer order uses WASD plus Z/X cycle like facing", () => {
  const bottom = commandIds().find((row) => row.id === "bottom");
  const down = commandIds().find((row) => row.id === "down");
  const up = commandIds().find((row) => row.id === "up");
  const top = commandIds().find((row) => row.id === "top");
  const back = commandIds().find((row) => row.id === "layerBack");
  const front = commandIds().find((row) => row.id === "layerFront");
  assert.equal(bottom.shortcut, "A");
  assert.equal(down.shortcut, "S");
  assert.equal(up.shortcut, "W");
  assert.equal(top.shortcut, "D");
  assert.equal(back.shortcut, "Z");
  assert.equal(front.shortcut, "X");
  assert.doesNotMatch(js, /event\.code === "BracketLeft"/);
  assert.match(js, /key === "z"/);
  assert.match(js, /key === "x"/);
  assert.match(js, /function stepLayerOrder\(/);
  assert.match(js, /const LAYER_DEPTHS = 4/);
  assert.match(js, /function currentLayerSlot\(/);
  assert.match(js, /function moveSelectedToLayerSlot\(/);
  assert.match(html, /id="layerOrderControl"/);
  assert.match(html, /class="command-row"/);
  assert.equal((html.match(/class="command-row"/g) || []).length, 2);
  assert.match(html, /id="alignBar"/);
  assert.doesNotMatch(html, /id="alignBar" hidden/);
  assert.match(js, /bar\.hidden = false/);
  assert.match(css, /\.stage-commandbar \.canvas-toolbar \{[\s\S]*flex-direction: column/);
  assert.match(css, /\.facing-control strong[\s\S]*width:\s*3\.25ch/);
  assert.match(css, /\.stage-commandbar \.tool-btn[\s\S]*height:\s*24px/);
  assert.match(css, /\.stage-commandbar \.command-row/);
  assert.match(html, /id="btnSelectAll"/);
  assert.doesNotMatch(html, /layer-foot-sep/);
  assert.match(css, /\.layer-footer \{[\s\S]*grid-template-columns: repeat\(3/);
});

test("building desk uses in-app dialogs instead of window.alert", () => {
  const dialog = fs.readFileSync(path.join(root, "web/app-dialog.js"), "utf8");
  const terrainHtml = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const terrainJs = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
  assert.doesNotMatch(js, /\balert\s*\(/);
  assert.doesNotMatch(js, /\bconfirm\s*\(/);
  assert.doesNotMatch(js, /\bprompt\s*\(/);
  assert.doesNotMatch(terrainJs, /\balert\s*\(/);
  assert.doesNotMatch(terrainJs, /\bconfirm\s*\(/);
  assert.doesNotMatch(terrainJs, /\bprompt\s*\(/);
  assert.match(dialog, /function openAppDialog/);
  assert.match(html, /id="dlgApp"/);
  assert.match(html, /id="dlgAppInput"/);
  assert.match(html, /app-dialog\.js/);
  assert.match(terrainHtml, /id="dlgApp"/);
  assert.match(terrainHtml, /app-dialog\.js/);
});

test("arrow keys nudge selected sprites", () => {
  assert.match(js, /function nudgeSelected\(/);
  assert.match(js, /nudgeSelected\(dx, dy\)/);
  assert.match(js, /function bindNudgePad\(/);
  assert.match(html, /id="nudgePad"/);
  const padStart = html.indexOf('id="nudgePad"');
  const padHtml = html.slice(padStart, html.indexOf("</div>", padStart) + 6);
  assert.doesNotMatch(padHtml, /[◀▶▲▼]/);
  assert.match(js, /function isTypingTarget\(/);
  assert.match(js, /function focusDesignCanvas\(/);
  assert.match(js, /focusDesignCanvas\(\);/);
  assert.match(js, /label: "选中素材微移"/);
  assert.match(js, /shortcut: "方向键"/);
});

test("asset card badge sits under the sprite instead of covering it", () => {
  assert.match(js, /label\.className = "asset-card-badge"/);
  assert.match(css, /\.component-card \.asset-card-badge[\s\S]*text-align:\s*center/);
  assert.match(css, /\.component-card img[\s\S]*object-position:\s*center bottom/);
  assert.doesNotMatch(css, /\.component-card span\s*\{[\s\S]*position:\s*absolute/);
});

test("favorite star is an outline overlay without a white plate", () => {
  assert.match(js, /class="favorite-star"/);
  assert.match(css, /\.component-tile \.favorite-toggle[\s\S]*background:\s*transparent/);
  assert.doesNotMatch(css, /\.favorite-toggle[\s\S]{0,180}background:\s*rgba\(255,\s*255,\s*255/);
  assert.match(css, /\.favorite-toggle\.on \.favorite-star[\s\S]*fill:\s*currentColor/);
});

test("building.js has no duplicate bindings in rail accessibility", () => {
  const { execFileSync } = require("node:child_process");
  execFileSync(process.execPath, ["--check", path.join(root, "web/building.js")]);
  const block = js.slice(
    js.indexOf("function syncBuildingRailAccessibility"),
    js.indexOf("function syncMobileBuildingChrome")
  );
  assert.match(block, /const mode = workspaceMode\(\)/);
  assert.match(block, /const sheetMode = state\.phase === "select"/);
  assert.doesNotMatch(block, /const mode = state\.phase === "select"/);
});
