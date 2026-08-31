"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SpatialIndex,
  applySelection,
  collectStampPoints,
  constrainShapeEnd,
  createViewportTransform,
  selectFromRect,
  snapMove,
  snapGridPoint,
} = require("../web/building-interactions.js");

test("scene and viewport coordinates round-trip at all required zoom levels", () => {
  [0.5, 1, 1.7, 4].forEach((zoom) => {
    const transform = createViewportTransform({
      canvasRect: { left: 81, top: 43, width: 570 * zoom, height: 550 * zoom },
      bitmapWidth: 570,
      bitmapHeight: 550,
      offsetX: 37,
      offsetY: -18,
    });
    const scene = { x: 123.25, y: 287.75 };
    const client = transform.sceneToClient(scene.x, scene.y);
    const actual = transform.clientToScene(client.x, client.y);
    assert.ok(Math.abs(actual.x - scene.x) < 1e-8);
    assert.ok(Math.abs(actual.y - scene.y) < 1e-8);
  });
});

test("transform snapshot does not change when the viewport later changes", () => {
  const options = {
    canvasRect: { left: 10, top: 20, width: 1140, height: 1100 },
    bitmapWidth: 570,
    bitmapHeight: 550,
    offsetX: 12,
    offsetY: 23,
  };
  const transform = createViewportTransform(options);
  const before = transform.clientToScene(410, 520);
  options.canvasRect.left = 999;
  options.offsetX = 900;
  assert.deepEqual(transform.clientToScene(410, 520), before);
});

test("marquee touch selects intersecting items and contain requires full enclosure", () => {
  const index = new SpatialIndex(64);
  index.insert("inside", { x: 20, y: 20, width: 20, height: 20 });
  index.insert("touching", { x: 90, y: 90, width: 30, height: 30 });
  index.insert("outside", { x: 150, y: 150, width: 20, height: 20 });

  const touch = selectFromRect(index, { x: 0, y: 0 }, { x: 100, y: 100 }, { mode: "touch" });
  assert.equal(touch.mode, "touch");
  assert.deepEqual(touch.matches.map((row) => row.id).sort(), ["inside", "touching"]);

  const contain = selectFromRect(index, { x: 0, y: 0 }, { x: 100, y: 100 }, { mode: "contain" });
  assert.equal(contain.mode, "contain");
  assert.deepEqual(contain.matches.map((row) => row.id), ["inside"]);

  const reverseDefault = selectFromRect(index, { x: 100, y: 100 }, { x: 0, y: 0 });
  assert.equal(reverseDefault.mode, "touch");
  assert.deepEqual(reverseDefault.matches.map((row) => row.id).sort(), ["inside", "touching"]);
});

test("selection operations support replace, add, and toggle without grouping", () => {
  assert.deepEqual(applySelection([1, 2], [3, 4], "replace"), [3, 4]);
  assert.deepEqual(applySelection([1, 2], [2, 3], "add"), [1, 2, 3]);
  assert.deepEqual(applySelection([1, 2], [2, 3], "toggle"), [1, 3]);
});

test("spatial index handles a 600-item paper without full-scan semantics", () => {
  const index = new SpatialIndex(64);
  for (let i = 0; i < 600; i++) {
    index.insert(i, { x: (i % 30) * 32, y: Math.floor(i / 30) * 32, width: 16, height: 16 });
  }
  const matches = index.query({ x: 0, y: 0, width: 80, height: 80 });
  assert.deepEqual(matches.map((row) => row.id).sort((a, b) => a - b), [0, 1, 2, 30, 31, 32, 60, 61, 62]);
});

test("object snap threshold is screen-pixel independent and keeps hysteresis", () => {
  const bounds = { x: 0, y: 0, width: 20, height: 20 };
  const targets = [{ rect: { x: 30, y: 0, width: 20, height: 20 } }];
  const first = snapMove({
    bounds,
    offsetX: 8,
    offsetY: 0,
    threshold: 3,
    objectEnabled: true,
    targets,
  });
  assert.equal(first.x, 10);
  assert.equal(first.guides[0].pos, 30);

  const held = snapMove({
    bounds,
    offsetX: 6,
    offsetY: 0,
    threshold: 3,
    objectEnabled: true,
    targets,
    latch: first.latch,
  });
  assert.equal(held.x, 10, "latched alignment remains until the larger release threshold");

  const edgeOff = snapMove({
    bounds,
    offsetX: 8,
    offsetY: 0,
    threshold: 3,
    objectEnabled: true,
    edgeEnabled: false,
    centerEnabled: true,
    targets,
  });
  assert.equal(edgeOff.x, 8, "edge snapping can be disabled independently");
});

test("iso snap follows 2:1 diamond axes instead of screen x/y", () => {
  const origin = snapGridPoint(0, 0, 4, "iso");
  assert.equal(origin.x, 0);
  assert.equal(origin.y, 0);
  const far = snapGridPoint(2, 1, 8, "iso");
  assert.ok(Math.hypot(far.x, far.y) < 1e-6, "short 2:1 step falls back to origin on a coarse iso grid");
  const along = snapGridPoint(20, 10, 4, "iso");
  assert.ok(Math.abs(along.x / 2 - along.y) < 1e-6, "iso grid points stay on a (2,1) family line");

  const moved = snapMove({
    bounds: { x: 0, y: 0, width: 20, height: 20 },
    offsetX: 8,
    offsetY: 4,
    threshold: 8,
    axis: "iso",
    objectEnabled: true,
    targets: [{ rect: { x: 10, y: 5, width: 20, height: 20 } }],
  });
  assert.ok(Math.abs(moved.x - 10) < 1e-6);
  assert.ok(Math.abs(moved.y - 5) < 1e-6);
  assert.equal(moved.guides[0].type, "iso-u");

  const both = snapGridPoint(3, 0, 4, "both");
  assert.deepEqual(both, { x: 4, y: 0 });
});

test("letterboxed canvas display still maps client points through object-fit contain", () => {
  const transform = createViewportTransform({
    canvasRect: { left: 0, top: 0, width: 1000, height: 550 },
    bitmapWidth: 570,
    bitmapHeight: 550,
    offsetX: 10,
    offsetY: 20,
  });
  assert.ok(Math.abs(transform.display.left - (1000 - 570) / 2) < 1e-8);
  assert.equal(transform.display.height, 550);
  const scene = transform.clientToScene(transform.display.left + 10 * transform.scale, transform.display.top + 20 * transform.scale);
  assert.ok(Math.abs(scene.x) < 1e-8);
  assert.ok(Math.abs(scene.y) < 1e-8);
});

test("fill object-fit maps the whole CSS box as canvas", () => {
  const transform = createViewportTransform({
    canvasRect: { left: 40, top: 10, width: 1920, height: 1080 },
    bitmapWidth: 960,
    bitmapHeight: 540,
    offsetX: 0,
    offsetY: 0,
    objectFit: "fill",
  });
  assert.equal(transform.display.left, 40);
  assert.equal(transform.display.top, 10);
  assert.equal(transform.display.width, 1920);
  assert.equal(transform.display.height, 1080);
  const scene = transform.clientToScene(40, 10);
  assert.ok(Math.abs(scene.x) < 1e-8);
  assert.ok(Math.abs(scene.y) < 1e-8);
  const far = transform.clientToScene(40 + 1920, 10 + 1080);
  assert.ok(Math.abs(far.x - 960) < 1e-6);
  assert.ok(Math.abs(far.y - 540) < 1e-6);
});

test("locked rendering invariants stay explicit in building.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  assert.match(source, /function expandPlaneToShell/);
  assert.match(source, /Never letterbox a smaller rectangle of grass/);
  assert.match(source, /function panGutter/);
  assert.match(source, /shell.style.overflow = "auto"/);
  assert.doesNotMatch(source, /zoom > 1\.01 \? "auto" : "hidden"/);
  assert.match(source, /const VIEW_NUDGE_Y = 20;/);
  assert.match(source, /const dy = Math\.round\(\(planeH - bh\) \/ 2 - top\);/);
  assert.match(source, /width: geometry\.width \|\| 0,/);
  assert.doesNotMatch(source, /packFrames|packFrameOwners|roomHexagon|roomVolumeLayer|floorOpaqueDiamond/);
  assert.match(source, /state\.baseAnchor = null;/);
  assert.match(source, /const origin = paperNativeOrigin\(\);/);
  assert.match(source, /dx: Math\.round\(frameX - origin\.x\)/);
  assert.match(source, /dy: Math\.round\(frameY - origin\.y\)/);
  assert.match(source, /isCanvasRecord/);
  assert.match(source, /x >= 32000 \|\| y >= 32000/);
  assert.doesNotMatch(source, /x >= 0 && y >= 0 && x <= MAX_CONTENT_COORD && y <= MAX_CONTENT_COORD/);
  assert.match(source, /function isSelectableRecord/);
  assert.match(source, /selectAllRecords[\s\S]*isSelectableRecord/);
  assert.doesNotMatch(source, /全选可见素材/);
  assert.match(source, /Number\(record\.x\) > MAX_CONTENT_COORD/);
  assert.match(source, /event\.shiftKey \? "redo" : "undo"/);
  assert.match(source, /const scrollTop = list\.scrollTop;/);
  assert.match(source, /if \(virtual\) list\.scrollTop = scrollTop;/);
  const html = fs.readFileSync(path.join(__dirname, "../web/building.html"), "utf8");
  assert.match(html, /tool-family/);
  assert.match(html, /data-family="brush"/);
  assert.match(html, /class="tool-ico"/);
  assert.match(html, /点刷/);
  assert.match(html, /data-tool="paint"/);
  assert.match(html, /纯笔刷/);
  assert.match(html, /class="select-modes"/);
  assert.doesNotMatch(html, /tool-item-wide/);
  assert.match(html, /data-tool="stamp"/);
  assert.match(html, /data-tool="rect"/);
  assert.match(html, /data-tool="diamond"/);
  assert.match(html, /data-tool="ring"/);
  assert.match(html, /data-marquee-mode="touch"/);
  assert.doesNotMatch(html, /marquee-cluster/);
  assert.doesNotMatch(html, /data-tool="pan"|data-tool="focus"/);
  assert.match(html, /id="customFolderFilterBtn"/);
  assert.match(html, /folder-picker-trigger/);
  assert.match(source, /function toggleFolderPicker/);
  assert.match(source, /function closeFolderPickerIfMoved/);
  assert.match(source, /const UNGROUPED_FOLDER = "__ungrouped__"/);
  assert.match(source, /PLACE_TOOLS = new Set\(\["paint"/);
  assert.match(source, /function isStampLike/);
  assert.match(source, /function armPaintBrush/);
  assert.match(source, /if \(state\.tool === "select"\) setActiveTool\("paint"\)/);
  assert.match(source, /if \(state\.tool === "paint"\)/);
  assert.match(source, /id: "paintTool"/);
  assert.match(source, /if \(!isPlaceTool\(\)\) setActiveTool\("paint"\)/);
  assert.match(source, /if \(state\.tool === "paint"\) clearSelection/);
  assert.doesNotMatch(source, /ASSET_LIST_CAP/);
  assert.doesNotMatch(source, /已显示前/);
  assert.match(source, /function paintAssetWindow/);
  assert.match(source, /function bindAssetListScroll/);
  assert.match(source, /function appendAssetTile/);
  assert.match(source, /function lineStampStep/);
  assert.match(source, /depthSortedStampPoints\(points, tool\)/);
  assert.match(source, /function deleteSelected\(\)[\s\S]*clearSelection\(\);[\s\S]*fillLayers\(\);/);
  assert.match(source, /async function groupSelected\(\)[\s\S]*updateSelectionCaption\(\);[\s\S]*fillLayers\(\);/);
  assert.match(source, /function commitDragPositions\(\)[\s\S]*record\.x = clamped\.x;[\s\S]*record\.y = clamped\.y;[\s\S]*\n\}/);
  assert.match(source, /function buildExportRecords/);
  assert.match(source, /return \[exportHeaderRecord\(\), \.\.\.body\]/);
  assert.match(source, /state: Number\(state\.base\?\.kind\) \|\| 0/);
  assert.match(source, /function pruneCollapsedLayerGroups/);
  const css = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  assert.match(css, /\.component-list \.asset-pad/);
  assert.match(css, /\.select-modes/);
  assert.match(html, /id="snapAxis"/);
  assert.match(html, /id="dlgPaperPreview"/);
  assert.match(html, /id="buildingFolder"[^>]*webkitdirectory/);
  assert.match(html, /id="paperPreviewMaterials"/);
  assert.match(html, /id="btnMergeDesign"/);
  assert.doesNotMatch(html, /id="localPaperPack"/);
  assert.match(source, /axis: "iso"/);
  assert.match(source, /function snapAxis/);
  assert.match(source, /function openCurrentPaperPreview/);
  assert.match(source, /async function openBatchPaperPreview/);
  assert.match(source, /async function importDesign\(file, options = \{\}\)/);
  assert.match(source, /options\.mode === "merge"/);
  assert.match(source, /item\.kind === "group" && item\.groupId === focusGroup/);
  assert.match(source, /function buildingMaterialReport/);
  assert.match(source, /部分统计：\$\{missing\} 件素材未解析/);
  assert.match(source, /const maxScroll = Math\.max\(0, items\.length \* LAYER_ROW_H - viewH\)/);
  const interactions = fs.readFileSync(path.join(__dirname, "../web/building-interactions.js"), "utf8");
  assert.match(interactions, /closerPoint\(seeded, ortho, iso\)/);
  assert.doesNotMatch(interactions, /closerPoint\(raw, ortho, iso\)/);
});

test("stamp lattices fill tiles, lines, circles, and triangles", () => {
  const pitch = { x: 10, y: 10 };
  const tile = collectStampPoints("tile", { x: 0, y: 0 }, { x: 20, y: 20 }, pitch);
  assert.ok(tile.length >= 4);
  const line = collectStampPoints("line", { x: 0, y: 0 }, { x: 40, y: 0 }, pitch);
  assert.equal(line[0].x, 0);
  assert.equal(line[line.length - 1].x, 40);
  const spacedLine = collectStampPoints(
    "line",
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    pitch,
    { lineStep: 25 }
  );
  assert.equal(spacedLine.length, 5, "line brush honors footprint-aware spacing");
  const circle = collectStampPoints("circle", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch);
  const rect = collectStampPoints("tile", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch, { aligned: true });
  assert.ok(circle.length < rect.length);
  const tri = collectStampPoints("triangle", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch, { aligned: true });
  assert.ok(tri.length < rect.length);
  const diamond = collectStampPoints("diamond", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch, { aligned: true });
  assert.ok(diamond.length < rect.length);
  const ring = collectStampPoints("ring", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch);
  assert.ok(ring.length < rect.length);
  const oval = collectStampPoints("ring", { x: 0, y: 0 }, { x: 40, y: 40 }, pitch, { aligned: true });
  assert.ok(oval.length >= 8);
  const cap = collectStampPoints("tile", { x: 0, y: 0 }, { x: 400, y: 400 }, { x: 8, y: 8 }, { cap: 12 });
  assert.equal(cap.length, 12);
});

test("shift constrains lines to 45 degrees and circles/triangles to squares", () => {
  const line = constrainShapeEnd("line", { x: 0, y: 0 }, { x: 10, y: 1 }, true);
  assert.ok(Math.abs(line.y) < 1e-8);
  const circle = constrainShapeEnd("circle", { x: 0, y: 0 }, { x: 10, y: 4 }, true);
  assert.equal(circle.x, 10);
  assert.equal(circle.y, 10);
  const triangle = constrainShapeEnd("triangle", { x: 0, y: 0 }, { x: 10, y: 4 }, true);
  assert.equal(triangle.x, 10);
  assert.equal(triangle.y, 10);
});

test("terrain desk exposes image-to-terrain and planning overlays", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  assert.match(html, /id="btnImageTerrain"/);
  assert.match(html, /id="dlgImageTerrain"/);
  assert.match(html, /id="btnPlanOverlay"/);
  assert.match(html, /id="showPlanFoundation"/);
  assert.match(html, /id="imageTerrainProjection"/);
  assert.match(html, /正面（横平竖直）/);
  assert.match(source, /function renderImageTerrainMapping/);
  assert.match(source, /function clusteredImagePalette/);
  assert.doesNotMatch(source, /function quantizedPixelKey/);
  assert.match(source, /function imageTerrainLogicalPoint/);
  assert.match(source, /uvFromColRow\(anchor\.col \+ imageX, anchor\.row \+ imageY\)/);
  assert.match(source, /function applyImageTerrain/);
  assert.match(source, /function drawPlanOverlay/);
  assert.match(source, /function planOverlayHitScreen/);
  assert.match(source, /function resolveManorBase/);
  assert.match(source, /Math\.floor\(raw \/ 1_000_000\)/);
  assert.match(source, /state\.planOverlayDrag/);
  assert.match(source, /function openDeskBuildingCode/);
  assert.match(source, /nativePixels: true/);
  assert.match(source, /setLayer\("build"\)/);
  assert.match(source, /fetch\("\/api\/parse-building"/);
  assert.doesNotMatch(source, /fetch\("\/api\/parse-manor"/);
  assert.doesNotMatch(html, /planOverlayOpacity/);
  assert.doesNotMatch(html, /planCodePack/);
  assert.match(html, /直接拖动建筑本体即可移动/);
});
