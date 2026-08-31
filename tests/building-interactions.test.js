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

test("desk coordinates sign-extend 15-bit values the way rc3.exe does", () => {
  const decodeS15 = (value) => {
    value &= 0x7fff;
    return value > 0x3fff ? value - 0x8000 : value;
  };
  assert.equal(decodeS15(0), 0);
  assert.equal(decodeS15(16383), 16383);
  assert.equal(decodeS15(16384), -16384);
  assert.equal(decodeS15(32767), -1);
  assert.equal(decodeS15(32700), -68);
  assert.equal(decodeS15(-1), -1);
});

test("headerless 11x11 native floor origin follows the rc3 TxtInsert chain", () => {
  const maskW = 755;
  const maskH = 627;
  const cx = 61;
  const cy = 440;
  const anchorX = -87;
  const anchorY = -190;
  const nativeHalf = (a, b) => Math.trunc((a - b) / 2);
  // TxtExport/TxtInsert use live layer coords. Maximized 1920×1080 → 1690×1030.
  const maskX = nativeHalf(1690, maskW);
  const maskY = nativeHalf(1030, maskH);
  assert.equal(maskX, 467);
  assert.equal(maskY, 201);
  assert.deepEqual(
    { x: maskX + cx + anchorX, y: maskY + cy + anchorY },
    { x: 441, y: 451 }
  );
  assert.equal(nativeHalf(570, 570), 0);
  assert.equal(nativeHalf(1690, 570), 560);
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
  assert.match(source, /function decodeS15/);
  assert.match(source, /mat=0 is GDesignSubUser/);
  assert.doesNotMatch(source, /Papers with mat=0 explicitly carry their authored ChgBaseMask origin/);
  assert.doesNotMatch(source, /dx: Math\.round\(frameX - origin\.x\)/);
  assert.doesNotMatch(source, /dy: Math\.round\(frameY - origin\.y\)/);
  assert.match(source, /const NATIVE_PAPER_W = 1690;/);
  assert.match(source, /const NATIVE_PAPER_H = 1030;/);
  assert.doesNotMatch(source, /NATIVE_LAYER_CANDIDATES/);
  assert.doesNotMatch(source, /function inferredNativeLayer/);
  assert.doesNotMatch(source, /const NATIVE_PAPER_W = 1691;/);
  assert.match(source, /function nativePaperFloorOrigin/);
  assert.match(source, /maskOrigin\.x \+ Number\(anchor\[0\]\) \+ Number\(frame\.anchorX\)/);
  assert.match(source, /layout\.floorX - nativeFloor\.x/);
  assert.match(source, /layout\.floorY - nativeFloor\.y/);
  assert.doesNotMatch(source, /front\.x - \(layout\.frontX - layout\.maskX\)/);
  assert.doesNotMatch(source, /layout\.frontX - front\.x/);
  assert.match(source, /isCanvasRecord/);
  assert.doesNotMatch(source, /x >= 32000 \|\| y >= 32000/);
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
  // Picking a palette asset stays on the select tool; only the explicit
  // "use as brush" action (pickRecordAsBrush) still switches to paint.
  assert.doesNotMatch(source, /if \(state\.tool === "select"\) setActiveTool\("paint"\)/);
  assert.match(source, /if \(state\.tool === "paint"\)/);
  assert.match(source, /id: "paintTool"/);
  assert.match(source, /if \(!isPlaceTool\(\)\) setActiveTool\("paint"\)/);
  assert.doesNotMatch(source, /if \(state\.tool === "paint"\) clearSelection/);
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
  assert.match(source, /function existingUserReferences/);
  assert.match(source, /return \[\.\.\.existingUserReferences\(\), \.\.\.body\]/);
  assert.doesNotMatch(source, /function exportHeaderRecord/);
  assert.doesNotMatch(source, /state: Number\(state\.base\?\.kind\) \|\| 0/);
  assert.match(source, /function pruneCollapsedLayerGroups/);
  const css = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  assert.match(css, /\.component-list \.asset-pad/);
  assert.match(css, /\.select-modes/);
  assert.match(css, /\.paper-library/);
  assert.match(css, /\.paper-inspect-viewport/);
  assert.match(css, /\.paper-inspect\[hidden\]/);
  assert.match(html, /id="snapAxis"/);
  assert.match(html, /id="dlgPaperPreview"/);
  assert.match(html, /id="paperLibrary"/);
  assert.match(html, /id="paperInspect"/);
  assert.match(html, /id="paperInspectCanvas"/);
  assert.match(html, /id="buildingFolder"[^>]*webkitdirectory/);
  assert.match(html, /id="paperPreviewMaterials"/);
  assert.match(html, /id="btnMergeDesign"/);
  assert.doesNotMatch(html, /id="localPaperPack"/);
  assert.doesNotMatch(html, /id="paperBatchPreview"/);
  assert.match(source, /axis: "iso"/);
  assert.match(source, /function snapAxis/);
  assert.match(source, /function openCurrentPaperPreview/);
  assert.match(source, /async function openBatchPaperPreview/);
  assert.match(source, /function setPaperLibraryOpen/);
  assert.match(source, /function togglePaperLibrary/);
  assert.match(source, /async function openPaperInspect/);
  assert.match(source, /function zoomPaperInspectAt/);
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

test("terrain desk exposes persistent real-building scene previews", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../web/building-preview.js"), "utf8");
  assert.match(html, /id="btnImageTerrain"/);
  assert.match(html, /id="dlgImageTerrain"/);
  assert.match(html, /id="btnPlanOverlay"/);
  assert.match(html, /id="btnOpenDeskPaper"/);
  assert.match(html, /id="previewBuildingList"/);
  assert.match(html, /id="previewBuildingInspector"/);
  assert.doesNotMatch(html, /id="showPlanFoundation"/);
  assert.match(html, /放置建筑图片/);
  assert.doesNotMatch(html, /id="btnMatList"/);
  assert.doesNotMatch(html, /材料与地基/);
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
  assert.match(source, /state\.previewInteraction/);
  assert.match(source, /previewBuildings: \[\]/);
  assert.match(source, /previewBuildings: state\.previewBuildings\.map\(serializePreviewEntity\)/);
  assert.match(source, /function previewResizeHandles/);
  assert.match(source, /function drawSceneObjects/);
  assert.match(source, /function openDeskBuildingCode/);
  assert.match(source, /BuildingPreview\.renderPaper/);
  assert.match(source, /setLayer\("build"\)/);
  assert.match(source, /fetch\("\/api\/parse-building"/);
  assert.match(source, /fetch\("\/api\/parse-building-desk"/);
  assert.doesNotMatch(source, /fetch\("\/api\/parse-manor"/);
  assert.match(html, /planOverlayOpacity/);
  assert.doesNotMatch(html, /planCodePack/);
  assert.match(html, /原生像素比例透明裁切/);
  assert.match(renderer, /const NATIVE_LAYER_W = 1690/);
  assert.match(renderer, /const NATIVE_LAYER_H = 1030/);
  assert.match(renderer, /function floorSnugInMask/);
  assert.match(renderer, /function nativeMaskOriginForLayer/);
  assert.match(renderer, /function nativePaperFloorOrigin/);
  assert.match(renderer, /groundAnchor:/);
  assert.match(renderer, /rawGroundAnchor\.x - bounds\.left/);
  assert.match(renderer, /function prepareImageBitmap/);
  assert.match(renderer, /function removeConnectedBackground/);
  assert.match(renderer, /options\.purpose !== "terrain"/);
  assert.match(source, /purpose: "terrain"/);
  assert.match(source, /pixelSizing: "native"/);
  assert.match(source, /prepared\.bitmap\.width/);
  assert.doesNotMatch(source, /const pixelWidth = width \* TILE_W/);
  const selectionRenderer = source.slice(
    source.indexOf("function drawPreviewSelection()"),
    source.indexOf("function drawPlanOverlay()")
  );
  assert.doesNotMatch(selectionRenderer, /#ffe14a|setLineDash|strokeRect\(image/);
  assert.doesNotMatch(renderer, /packFrames|packFrameOwners|frameBorrow/);
});

test("terrain renderer clones the native water/light/junction passes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  // GWaterLayer: 水动画=水/河水,189800,180100,180201 — two flipping plates.
  assert.match(source, /const WATER_ANIM_SRCS = \["\/tiles\/water\/180100\.jpg", "\/tiles\/water\/180201\.jpg"\]/);
  assert.match(source, /state\.waterFrame \^= 1/);
  assert.match(source, /if \(isWaterTerrain\(kind\)\) return WATER_ANIM_SRCS\[state\.waterFrame & 1\]/);
  assert.match(source, /state\.hasWaterTiles = drawTiles\.some/);
  // Water frame participates in both screen and synth cache keys.
  assert.match(source, /"\|wf" \+\s*\(state\.waterFrame & 1\)/);
  assert.match(source, /key = "wf" \+ \(state\.waterFrame & 1\) \+ ":" \+ key/);
  // ini light= is a permanent layer, no longer an opt-in effect flag.
  assert.match(source, /terrainLight: !\/\[\?&\]terrainLight=0\//);
  assert.match(source, /if \(!state\.terrainLight\) return;/);
  assert.doesNotMatch(source, /terrainEffects/);
  // rc3.exe 0x5DBA5C: 3+/4-way junction cover masks are wired in.
  assert.match(source, /function synthesizeJunctionTile/);
  assert.match(source, /maskWeights\(CORNER_MASK_SLOTS\[corner\]\)/);
  assert.match(source, /const junction = synthesizeJunctionTile\(tile, col, row\)/);
});

test("both desks keep interactive frames off the expensive render paths", () => {
  const terrainJs = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  const mobileJs = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.js"), "utf8");
  const serverPy = fs.readFileSync(path.join(__dirname, "../server.py"), "utf8");
  // Terrain: pan re-blits a world-anchored cache instead of re-rendering.
  assert.match(terrainJs, /const TERRAIN_CACHE_PAD = \d+/);
  assert.match(terrainJs, /function terrainStaticKey/);
  assert.match(terrainJs, /function worldCacheHit/);
  assert.match(terrainJs, /function renderTerrainWorldCache/);
  // The static key must not depend on continuous camera position.
  const staticKey = terrainJs.slice(
    terrainJs.indexOf("function terrainStaticKey"),
    terrainJs.indexOf("function worldCacheHit")
  );
  assert.doesNotMatch(staticKey, /cam\.x|cam\.y/);
  // Synth cache evicts instead of wiping inside pruneSynthCache.
  const prune = terrainJs.slice(
    terrainJs.indexOf("function pruneSynthCache"),
    terrainJs.indexOf("function uvFromColRow")
  );
  assert.match(prune, /cache\.delete\(key\)/);
  assert.doesNotMatch(prune, /new Map\(\)/);
  assert.match(terrainJs, /drawShapePreview\.memoKey/);
  assert.match(terrainJs, /function schedulePreviewBuildingUi/);
  assert.match(terrainJs, /function requestResize/);
  // Building: grass plane is cached, material report is trailed.
  assert.match(buildingJs, /function drawGrassPlane/);
  assert.match(buildingJs, /function scheduleMaterials/);
  assert.doesNotMatch(buildingJs, /if \(!state\.dragging && !state\.marquee\) updateAllMaterials\(\)/);
  // Mobile viewport sync dedupes writes and coalesces to animation frames.
  assert.match(mobileJs, /lastViewportKey/);
  assert.match(mobileJs, /requestAnimationFrame/);
  // Server: static files revalidate via ETag, game assets are immutable,
  // text assets can compress.
  assert.match(serverPy, /If-None-Match/);
  assert.match(serverPy, /max-age=604800, immutable/);
  assert.match(serverPy, /gzip\.compress/);
});

test("building desk selection, line brush, and guide affordances follow the ctrl-first workflow", () => {
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  // Canvas multi-select rides on Ctrl/Cmd only; Shift stays reserved for
  // axis-lock and brush constraints.
  assert.match(
    buildingJs,
    /const operation = event\.ctrlKey \|\| event\.metaKey \? "toggle" : "replace";/
  );
  // Picking a palette asset keeps the select tool armed instead of switching
  // to the continuous paint brush.
  const arm = buildingJs.slice(
    buildingJs.indexOf("function armPaintBrush"),
    buildingJs.indexOf("function stampTemplate")
  );
  assert.doesNotMatch(arm, /setActiveTool\("paint"\)/);
  // Line placements keep their exact positions on the drawn line (no
  // per-point grid snap) and stamp batches select what they placed.
  assert.match(buildingJs, /gridSnap: tool !== "line"/);
  assert.match(buildingJs, /function appendSpriteStamp\([^)]*\{ gridSnap = true \}/);
  const lineStep = buildingJs.slice(
    buildingJs.indexOf("function lineStampStep"),
    buildingJs.indexOf("function depthSortedStampPoints")
  );
  assert.doesNotMatch(lineStep, /1\.08/);
  // Snap guides carry alignment spans and gap distances; Ctrl shows
  // neighbor reference guides for the current selection.
  assert.match(buildingJs, /function decorateSnapGuides/);
  assert.match(buildingJs, /snap-gap-badge/);
  assert.match(buildingJs, /function appendNeighborRefGuides/);
  assert.match(buildingJs, /setRefGuidesActive\(true\)/);
  const css = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  assert.match(css, /\.ref-guide\.is-aligned/);
  assert.match(css, /\.snap-guide\.is-core/);
});

test("building designs and uploaded paper libraries persist explicitly", () => {
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  const buildingHtml = fs.readFileSync(path.join(__dirname, "../web/building.html"), "utf8");
  assert.match(buildingHtml, /id="btnSaveDesign"/);
  assert.match(buildingHtml, /id="paperFileName"/);
  assert.match(buildingJs, /async function saveDesignNow/);
  assert.match(buildingJs, /designName: state\.designName \|\| ""/);
  assert.match(buildingJs, /state\.designName = String\(snap\.designName \|\| ""\)/);
  assert.match(buildingJs, /async function openServerPaperLibrary/);
  assert.match(buildingJs, /const MAX_BATCH_BYTES = 6 \* 1024 \* 1024/);
  assert.doesNotMatch(buildingJs, /const CHUNK = 80/);
  assert.match(buildingJs, /function currentPaperDownloadName/);
  assert.match(buildingJs, /anchor\.download = currentPaperDownloadName\("txt"\)/);
  assert.doesNotMatch(buildingJs, /anchor\.download = "build\.txt"/);
});

test("scene preview entities persist in project v2 but stay out of game exports", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  assert.match(source, /function projectSnapshot[\s\S]*v: 2,[\s\S]*previewBuildings:/);
  assert.match(source, /function snapshotHist[\s\S]*previewBuildings:/);
  assert.match(source, /function storePreviewAsset/);
  assert.match(source, /function loadPreviewAsset/);
  const terrainExport = source.slice(source.indexOf("async function exportTerrain()"), source.indexOf("async function exportBuild()"));
  const buildingExport = source.slice(source.indexOf("async function exportBuild()"));
  assert.doesNotMatch(terrainExport, /previewBuildings/);
  assert.doesNotMatch(buildingExport, /previewBuildings/);
});

test("both desks expose the shared mobile-first workspace", () => {
  const terrainHtml = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  const buildingHtml = fs.readFileSync(path.join(__dirname, "../web/building.html"), "utf8");
  const terrainJs = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  const mobileCss = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.css"), "utf8");
  const mobileJs = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.js"), "utf8");

  for (const html of [terrainHtml, buildingHtml]) {
    assert.match(html, /mobile-workspace\.css/);
    assert.match(html, /mobile-workspace\.js/);
    assert.match(html, /viewport-fit=cover/);
    assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
    assert.match(html, /mobile-bottom-dock/);
  }
  assert.match(terrainHtml, /id="btnMobileTerrainTools"/);
  assert.match(buildingHtml, /id="btnBuildingMobileAssets"/);
  assert.match(buildingHtml, /id="btnBuildingMobileTools"/);
  assert.match(buildingHtml, /id="btnBuildingToolsClose"/);
  assert.match(buildingHtml, /id="buildingMobileAssetsLabel"/);
  assert.match(buildingHtml, /id="buildingRailBackdrop"/);
  assert.match(buildingHtml, /id="buildingProjectPane"/);
  assert.match(buildingHtml, /data-mobile-tool-family="select"/);
  assert.match(buildingHtml, /id="mobileSelectionBar"/);
  assert.match(buildingJs, /function syncMobileBuildingPanels/);
  assert.match(buildingJs, /openBuildingRail\("project"\)/);
  assert.doesNotMatch(buildingJs, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(terrainHtml, /data-mobile-terrain-pane="palette"/);
  assert.match(terrainHtml, /data-mobile-project-tab="files"/);
  assert.match(terrainJs, /function setTerrainMobilePane/);
  assert.match(terrainJs, /function setTerrainProjectTab/);
  assert.doesNotMatch(terrainJs, /setPaintMode\(state\.paintMode === "brush" \? "erase" : "brush"\)/);
  assert.match(mobileCss, /--mobile-hit:\s*44px/);
  assert.match(mobileCss, /html\.is-mobile-workspace/);
  assert.match(mobileCss, /env\(safe-area-inset-bottom/);
  assert.match(mobileJs, /visualViewport/);
  assert.match(mobileJs, /function trapTab/);
  assert.match(mobileJs, /\.inert =/);
  assert.match(mobileJs, /function registerSheet/);
  assert.match(mobileJs, /function openSheet/);
  assert.match(terrainJs, /function onTerrainPointerDown/);
  assert.match(terrainJs, /function beginTerrainPinch/);
  assert.doesNotMatch(terrainJs, /view\.addEventListener\("touchstart"/);
  assert.match(buildingJs, /state\.activePointers/);
  assert.match(buildingJs, /state\.mobilePan/);
  assert.match(buildingJs, /function setMobileToolsOpen/);
  assert.match(buildingJs, /paperInspectView\.pinch/);
});
