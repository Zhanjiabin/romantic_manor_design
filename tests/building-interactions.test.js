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
  const mobileCss = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.css"), "utf8");
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
  assert.doesNotMatch(html, /data-tool="diamond"/);
  assert.match(html, /data-tool="ring"/);
  assert.doesNotMatch(source, /id: "diamondTool"/);
  assert.match(source, /key === "c" && !event\.ctrlKey[\s\S]*executeCommand\("group"\)/);
  assert.match(source, /\{ id: "group", label: "成组", shortcut: "C"/);
  assert.match(html, /data-command="group"[^>]*title="成组 C"/);
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
  assert.match(source, /depthSortedStampPoints\(points\)/);
  assert.match(source, /function stampFootOffset/);
  assert.match(source, /function stampGroundSize/);
  assert.match(source, /lattice: useIso \? "iso" : "ortho"/);
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
  assert.match(html, /class="snap-step-field"/);
  assert.match(html, /class="snap-step-unit">像素</);
  assert.match(css, /\.snap-step-unit[\s\S]*white-space:\s*nowrap/);
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
  assert.match(source, /function buildingMaterialGroups/);
  assert.match(source, /function openBuildingMaterialLedger/);
  assert.match(source, /function openPieceMaterialLedger/);
  assert.match(html, /id="designMaterialsList"/);
  assert.match(html, /id="btnProjectMaterials"/);
  assert.match(html, /id="btnProjectMaterialsTab"/);
  assert.match(html, /id="projectMaterialsMeta"/);
  assert.match(html, /id="btnDesignMaterials"/);
  assert.match(html, /id="tabMaterials"/);
  assert.match(html, /id="materialsDock"/);
  assert.doesNotMatch(html, /id="btnPieceMaterialsDock"/);
  assert.match(html, /materials-dock\.css/);
  assert.doesNotMatch(html, /id="projectMaterialsList"/);
  assert.doesNotMatch(html, /id="btnMobileMaterials"/);
  assert.match(html, /data-tab="materials"/);
  assert.match(source, /tab !== "layers" && tab !== "materials"/);
  assert.doesNotMatch(mobileCss, /building-rail \.design-materials/);
  assert.match(html, /material-ledger\.js/);
  assert.match(source, /部分统计：\$\{missing\} 件素材未解析/);
  assert.match(source, /function layerRowHeight/);
  assert.match(source, /const maxScroll = Math\.max\(0, items\.length \* rowH - viewH\)/);
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
  const iso = collectStampPoints(
    "tile",
    { x: 0, y: 0 },
    { x: 48, y: 24 },
    { x: 16, y: 8 },
    { lattice: "iso" }
  );
  assert.ok(iso.length >= 4);
  const origin = iso[0];
  const neighbor = iso.find((point) => point.x !== origin.x || point.y !== origin.y);
  assert.ok(neighbor);
  const dx = Math.abs(neighbor.x - origin.x);
  const dy = Math.abs(neighbor.y - origin.y);
  assert.ok(
    Math.abs(dx - 2 * dy) < 0.05 || dy < 1e-6 || dx < 1e-6,
    "iso lattice neighbors follow 2:1 ground axes"
  );
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
  const mobileCss = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.css"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../web/app.css"), "utf8");
  assert.match(html, /id="btnImageTerrain"/);
  assert.match(html, /id="dlgImageTerrain"/);
  assert.match(html, /id="filePlanOverlay"/);
  assert.match(html, /id="fileDeskPaper"/);
  assert.match(html, /id="previewBuildingList"/);
  assert.match(html, /id="previewBuildingInspector"/);
  assert.match(source, /strong\.title = displayName/);
  assert.match(source, /function previewThumbCrop/);
  assert.doesNotMatch(source, /preview-icon-button/);
  assert.match(html, /class="project-strip"/);
  assert.match(html, /class="project-preview"/);
  assert.match(html, /id="terrainTopIo"/);
  assert.match(html, /画布预览/);
  assert.match(html, /id="btnOpenBld"/);
  assert.doesNotMatch(html, /id="btnSaveBld"/);
  assert.doesNotMatch(html, /id="btnOpenDeskPaper"/);
  assert.doesNotMatch(html, /id="btnPlanOverlay"/);
  assert.doesNotMatch(html, /预览导入/);
  assert.doesNotMatch(html, /class="project-card project-card-io"/);
  assert.doesNotMatch(html, /class="project-io"/);
  assert.match(html, /planOverlayKeepFoundation" checked/);
  assert.match(source, /function syncTerrainTopIoPlacement/);
  assert.match(source, /function terrainPhoneChrome/);
  assert.match(source, /preview-row-actions/);
  assert.match(source, /keepFoundation\.checked = true/);
  assert.match(mobileCss, /touch-action:\s*pan-y/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk \.top-actions > \.top-io-cluster/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk #terrainProjectSheet \.project-io-slot[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.is-mobile-workspace #terrainProjectSheet \.preview-row-actions \.btn[\s\S]*min-height:\s*44px/);
  assert.match(html, /id="terrainViewToggles"/);
  assert.match(html, /id="showBuild"/);
  assert.match(html, /id="showGrid"/);
  assert.match(html, /建筑模型/);
  assert.match(html, /地块网格/);
  assert.match(html, /toggle-label-short">建筑</);
  assert.match(html, /toggle-label-short">网格</);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) #desk \.map-host > \.terrain-view-toggles\.is-map-floating[\s\S]*bottom:\s*4px/);
  assert.doesNotMatch(html, /id="showPlanOverlay"/);
  assert.doesNotMatch(html, /overview-view-bar/);
  assert.match(source, /function buildingsVisibleOnMap/);
  assert.match(source, /function syncTerrainViewTogglesPlacement/);
  assert.doesNotMatch(source, /if \(state\.strokeNeedsRebuild\) return;\s*const scene/);
  assert.match(source, /Keep buildings painted during terrain strokes/);
  assert.match(source, /is-map-floating/);
  assert.match(css, /\.rail-block-view/);
  assert.match(css, /\.terrain-view-toggles/);
  assert.match(mobileCss, /terrain-view-toggles\.is-map-floating/);
  assert.match(html, /class="overview-materials"/);
  assert.match(html, /id="btnTerrainMaterials"/);
  assert.doesNotMatch(html, /id="btnPreviewBuildingMaterials"/);
  assert.doesNotMatch(html, /preview-inspector-materials-list/);
  assert.doesNotMatch(html, /id="previewInspectorMaterials"/);
  assert.match(html, /material-ledger\.js/);
  assert.match(html, /class="project-pane-tabs"/);
  assert.match(html, /导入建筑/);
  assert.doesNotMatch(html, /data-project-tab="scene"/);
  assert.doesNotMatch(html, /导入庄园/);
  assert.doesNotMatch(html, /放置设计建筑/);
  assert.match(html, /id="previewKeepFoundation"/);
  assert.match(html, /id="planOverlayKeepFoundation"/);
  assert.doesNotMatch(html, /id="btnMatList"/);
  assert.doesNotMatch(html, /材料与地基/);
  assert.match(html, /id="imageTerrainProjection"/);
  assert.match(html, /id="imageTerrainSkipBg"/);
  assert.match(html, /正面（屏幕横平竖直）/);
  assert.match(html, /铺满当前地图/);
  assert.doesNotMatch(html, /id="imageTerrainWidth"/);
  assert.doesNotMatch(html, /生成到地图中央/);
  assert.match(source, /function renderImageTerrainMapping/);
  assert.match(source, /function clusteredImagePalette/);
  assert.match(source, /function clusteredRgbPalette/);
  assert.match(source, /function listImageTerrainCells/);
  assert.match(source, /function collectImageTerrainCells/);
  assert.match(source, /function smoothImageTerrainIndices/);
  assert.doesNotMatch(source, /function quantizedPixelKey/);
  assert.doesNotMatch(source, /Math\.min\(96,/);
  assert.match(source, /projection\.value = "front"/);
  assert.doesNotMatch(source, /uvFromColRow\(anchor\.col \+ imageX, anchor\.row \+ imageY\)/);
  assert.match(source, /imageSmoothingEnabled = false/);
  assert.match(source, /function imageTerrainBackgroundRgb/);
  assert.match(source, /function applyImageTerrain/);
  assert.match(source, /draft\.sampled\.indices\[index\]/);
  assert.match(source, /value < 0\) return null/);
  assert.match(source, /wireClick\("btnTerrainMaterials"/);
  assert.match(renderer, /const forTerrain = options\.purpose === "terrain"/);
  assert.match(renderer, /includeMaskGrass = forTerrain[\s\S]*false/);
  assert.match(renderer, /const includeFloor = options\.includeFloor/);
  assert.match(renderer, /if \(includeFloor\) ctx\.drawImage\(floor/);
  assert.match(source, /includeMaskGrass: false/);
  assert.match(source, /includeFloor: !!entity\.keepFoundation/);
  assert.doesNotMatch(source, /includeMaskGrass: !!entity\.keepFoundation/);
  assert.match(source, /function drawPlanOverlay/);
  assert.match(source, /function planOverlayHitScreen/);
  assert.match(source, /function resolveManorBase/);
  assert.match(source, /function terrainMaterialLedgerPayload/);
  assert.match(source, /function resolveStampMaterial/);
  assert.match(source, /function terrainStampRows/);
  assert.match(source, /brushByPaperChar\(kind\)/);
  assert.match(source, /画布建筑/);
  assert.doesNotMatch(source, /names\.set\(brush\.char/);
  assert.doesNotMatch(source, /导入建筑 \$\{buildingCount\}/);
  assert.match(source, /function previewBuildingMaterialData/);
  assert.match(source, /BuildingPreview\?\.resolveComponent/);
  assert.match(source, /Math\.floor\(raw \/ 1_000_000\)/);
  assert.match(source, /state\.previewInteraction/);
  assert.match(source, /previewBuildings: \[\]/);
  assert.match(source, /previewBuildings: state\.previewBuildings\.map\(serializePreviewEntity\)/);
  assert.match(source, /function previewResizeHandles/);
  assert.match(source, /function previewOpaqueAt/);
  assert.match(source, /function previewPointInFootprint/);
  assert.match(source, /function beginPreviewInteraction/);
  assert.match(source, /function revealPreviewBuilding/);
  assert.match(source, /function drawPreviewFootprint/);
  assert.match(source, /selectPreviewBuilding\(previewHit\.entity\.id, \{ reveal: false \}\)/);
  assert.match(source, /function drawSceneObjects/);
  assert.match(source, /function openDeskBuildingCode/);
  assert.match(source, /BuildingPreview\.renderPaper/);
  assert.match(source, /setLayer\("terrain"\)/);
  assert.doesNotMatch(source, /setLayer\("build"\)/);
  assert.match(source, /if \(!erase\) return;/);
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
  assert.match(renderer, /options\.purpose === "terrain"/);
  assert.match(source, /purpose: "terrain"/);
  assert.match(source, /pixelSizing: "native"/);
  assert.match(source, /prepared\.bitmap\.width/);
  assert.doesNotMatch(source, /const pixelWidth = width \* TILE_W/);
  const selectionRenderer = source.slice(
    source.indexOf("function drawPreviewSelection()"),
    source.indexOf("function drawPlanOverlay()")
  );
  assert.match(selectionRenderer, /drawPreviewFootprint\(layout, true\)/);
  assert.doesNotMatch(selectionRenderer, /if \(entity\.sourceType !== "image" \|\| entity\.locked\) return/);
  assert.doesNotMatch(selectionRenderer, /#ffe14a|setLineDash|strokeRect\(image/);
  assert.doesNotMatch(renderer, /packFrames|packFrameOwners|frameBorrow/);
  assert.match(renderer, /function opaqueDiamondVertices/);
  assert.match(renderer, /floorQuad,/);
  assert.match(source, /function snapIsoSouth/);
  assert.match(source, /function isoOccupancyQuad/);
  assert.match(source, /function floorFitLinear/);
  assert.match(source, /Do not affine-warp the terrain preview bitmap/);
  assert.match(source, /ctx\.transform\(transform\.a, transform\.b, transform\.c, transform\.d, transform\.e, transform\.f\)/);
  assert.match(source, /i and j have opposite parity/);
  assert.match(source, /function snapStampSouth/);
  assert.match(source, /function previewFloorQuad/);
  assert.match(source, /layout\.quad/);
  assert.match(source, /terrain-v5\|/);
  assert.doesNotMatch(source, /terrain-v4\|/);
  assert.doesNotMatch(source, /ix \* SNAP \+ SNAP \/ 2/);
  assert.match(renderer, /Always reserve the brick-floor rectangle/);
});

test("terrain renderer clones the native water/light/junction passes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  // GWaterLayer: 水动画=水/河水,189800,180100,180201 — two flipping plates.
  assert.match(source, /const WATER_ANIM_SRCS = \["\/tiles\/water\/180100\.jpg", "\/tiles\/water\/180201\.jpg"\]/);
  assert.match(source, /state\.waterFrame \^= 1/);
  assert.match(source, /if \(isWaterTerrain\(kind\)\) return WATER_ANIM_SRCS\[state\.waterFrame & 1\]/);
  assert.match(source, /state\.hasWaterTiles = drawTiles\.some/);
  // Water stamps overlay the world cache; synth keys still flip with the frame.
  // A water *fill* plane still locks the screen cache on wf.
  assert.match(source, /function waterUsesLiveOverlay/);
  assert.match(source, /function drawLiveWaterTiles/);
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
  assert.match(terrainJs, /function blitScaledWorldCache/);
  assert.match(terrainJs, /function cameraScaleLive/);
  assert.match(terrainJs, /function miniShouldPaint/);
  assert.match(terrainJs, /function terrainInteractionBusy/);
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

test("layer list clicks a grouped child without expanding the whole group", () => {
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  const selectLayer = buildingJs.slice(
    buildingJs.indexOf("function selectLayerIndex"),
    buildingJs.indexOf("async function renameLayer")
  );
  assert.match(selectLayer, /setSelection\(\[index\]\)/);
  assert.doesNotMatch(selectLayer, /expandGroup/);
  assert.match(selectLayer, /revealSelection\(\)/);
  const groupHeader = buildingJs.slice(
    buildingJs.indexOf("function appendGroupHeader"),
    buildingJs.indexOf("function appendLayerRow")
  );
  assert.match(groupHeader, /setSelection\(memberIndices\)/);
  assert.match(groupHeader, /点下面的素材可选中单件/);
  // Canvas single-click still takes the whole group; double-click / Alt isolates one member.
  assert.match(buildingJs, /function wantsIsolateGroupMember\(/);
  assert.match(buildingJs, /setSelection\(\[hit\], \{ expandGroup: !isolate \}\)/);
  assert.match(buildingJs, /双击 \/ Alt\+点击/);
  assert.match(buildingJs, /双击选组内单件/);
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
  // Stamp batches sit on the 2:1 ground lattice and skip occupied cells
  // instead of jittering each sprite onto the pixel grid.
  assert.match(buildingJs, /occupied\.cells/);
  assert.match(buildingJs, /function stampFootOffset/);
  assert.doesNotMatch(buildingJs, /gridSnap: tool !== "line"/);
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
  // Mouse drag moves selected records; Space+drag pans like middle-mouse.
  assert.match(
    buildingJs,
    /if \(state\.spacePan\) \{[\s\S]*interaction\.mode = "pan";[\s\S]*shell\.classList\.add\("is-panning"\);/
  );
  assert.doesNotMatch(
    buildingJs,
    /桌面端拖动素材需要长按空格/
  );
  assert.match(
    buildingJs,
    /if \(isolate \|\| !baseSelection\.includes\(hit\)\) \{[\s\S]*setSelection\(\[hit\], \{ expandGroup: !isolate \}\);[\s\S]*beginRecordDrag\(startScene\.x, startScene\.y, movable, transform\)/
  );
  assert.match(buildingJs, /双击选组内单件/);
  assert.match(buildingJs, /Space\+左键 \/ 中键/);
  // Copy / duplicate must follow records[] layer order, not marquee/click order.
  assert.match(buildingJs, /function selectionInLayerOrder\(/);
  assert.match(
    buildingJs,
    /function duplicateSelected\(\) \{[\s\S]*selectionInLayerOrder\(selectedUnlockedIndices\(\)\)/
  );
  assert.match(
    buildingJs,
    /function copySelected\(\) \{[\s\S]*selectionInLayerOrder\(state\.selected\)/
  );
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
  assert.match(buildingJs, /function loadPaperLibraryCacheMap/);
  assert.match(buildingJs, /function paperFingerprint/);
  assert.match(buildingJs, /cached\?\.documentData/);
  assert.doesNotMatch(buildingJs, /服务器存档/);
  assert.doesNotMatch(buildingHtml, /本地图纸库/);
  assert.match(buildingHtml, /id="paperLibraryTitle">图纸库</);
  assert.match(buildingJs, /function syncPaperCardMaterialOverflow/);
  assert.match(buildingJs, /openPaperInspect\(entry, \{ focusMaterials: true \}\)/);
  assert.doesNotMatch(buildingJs, /slice\(0, 6\)/);
  const paperCore = fs.readFileSync(path.join(__dirname, "../web/paper-library-core.js"), "utf8");
  assert.match(paperCore, /const MAX_BATCH_BYTES = 6 \* 1024 \* 1024/);
  assert.match(paperCore, /contentIdFromBase64/);
  assert.match(paperCore, /function fetchPaper/);
  assert.match(paperCore, /function thumbUrl/);
  assert.match(paperCore, /function createLazyLoader/);
  assert.match(buildingJs, /function showPaperLibraryIndex/);
  assert.match(buildingJs, /function hydratePaperEntry/);
  assert.doesNotMatch(buildingJs, /new File\(\[base64ToBytes\(paper\.data\)\]/);
  assert.match(buildingJs, /persistPaperLibrary\(uploads, false\)/);
  assert.doesNotMatch(buildingJs, /persistPaperLibrary\(uploads, true\)/);
  assert.match(buildingJs, /function libraryAcceptsKind/);
  assert.match(buildingJs, /if \(PAPER_LIBRARY_DESK === "building"\) return kind === "desk"/);
  assert.match(buildingJs, /append: true/);
  assert.match(buildingHtml, />导入</);
  assert.match(buildingHtml, /data-paper-kind="desk"/);
  assert.match(buildingHtml, /id="btnPaperLibraryNewGroup"/);
  assert.match(buildingHtml, /id="paperLibraryTitle">图纸库</);
  assert.ok(buildingHtml.indexOf('id="paperLibraryTitle"') < buildingHtml.indexOf('id="btnPaperLibraryClose"'));
  assert.doesNotMatch(buildingHtml, /paper-library-heading/);
  assert.match(buildingHtml, /id="paperInspectGroup"/);
  assert.match(buildingHtml, /paper-inspect-side-foot/);
  assert.match(buildingHtml, /paper-inspect-materials-scroll/);
  assert.doesNotMatch(buildingHtml, /更换文件夹/);
  const buildingCss = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  assert.match(buildingCss, /#paperInspectMaterials \{[\s\S]*overflow-y:\s*auto/);
  assert.match(buildingJs, /function fillInspectMaterialList/);
  assert.match(buildingJs, /function requestPaperInspectDraw/);
  assert.match(buildingJs, /const previewImageCache/);
  assert.match(buildingJs, /inspect-open/);
  assert.match(buildingCss, /\.inspect-mat-row/);
  assert.doesNotMatch(buildingJs, /const cap = 2400/);
  assert.doesNotMatch(buildingJs, /const CHUNK = 80/);
  assert.match(buildingJs, /function currentPaperDownloadName/);
  assert.match(buildingJs, /anchor\.download = currentPaperDownloadName\("txt"\)/);
  assert.doesNotMatch(buildingJs, /anchor\.download = "build\.txt"/);
});

test("paper library kind filter resolves legacy entries and hides filtered cards", () => {
  const { runInNewContext } = require("node:vm");
  const paperCoreSrc = fs.readFileSync(path.join(__dirname, "../web/paper-library-core.js"), "utf8");
  const buildingCss = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  const ctx = { window: {} };
  runInNewContext(paperCoreSrc, ctx);
  const core = ctx.window.PaperLibraryCore;
  assert.equal(core.resolvePaperKind({ kind: "", meta: "269 件素材 · 17 种材料" }), "desk");
  assert.equal(core.resolvePaperKind({ kind: "", meta: "128 格 · 42 个地块" }), "terrain");
  assert.equal(core.kindMatchesFilter("", "desk"), true);
  assert.equal(core.kindMatchesFilter("", "terrain"), false);
  assert.equal(core.kindMatchesFilter("desk", "terrain"), false);
  assert.match(buildingCss, /\.paper-preview-item\[hidden\]/);
});

test("paper library sorts by save date or name", () => {
  const { runInNewContext } = require("node:vm");
  const paperCoreSrc = fs.readFileSync(path.join(__dirname, "../web/paper-library-core.js"), "utf8");
  const buildingHtml = fs.readFileSync(path.join(__dirname, "../web/building.html"), "utf8");
  const terrainHtml = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  const ctx = { window: {} };
  runInNewContext(paperCoreSrc, ctx);
  const core = ctx.window.PaperLibraryCore;
  const entries = [
    { id: "a", name: "alpha.txt", savedAt: 10 },
    { id: "b", name: "charlie.txt", savedAt: 30 },
    { id: "c", name: "bravo.txt", savedAt: 20 },
  ];
  const ids = (sort) => Array.from(core.sortedPaperEntries(entries, sort), (row) => row.id);
  const names = (sort) => Array.from(core.sortedPaperEntries(entries, sort), (row) => row.name);
  assert.deepEqual(ids({ key: "savedAt", dir: "desc" }), ["b", "c", "a"]);
  assert.deepEqual(ids({ key: "savedAt", dir: "asc" }), ["a", "c", "b"]);
  assert.deepEqual(names({ key: "name", dir: "asc" }), ["alpha.txt", "bravo.txt", "charlie.txt"]);
  assert.deepEqual(names({ key: "name", dir: "desc" }), ["charlie.txt", "bravo.txt", "alpha.txt"]);
  assert.equal(core.parseSortValue("").key, "savedAt");
  assert.equal(core.parseSortValue("").dir, "desc");
  for (const html of [buildingHtml, terrainHtml]) {
    assert.match(html, /id="paperLibrarySort"/);
    assert.match(html, /value="savedAt:desc"/);
    assert.match(html, /value="name:asc"/);
  }
});

test("desk switching saves locally first and restores the newer session", () => {
  const buildingJs = fs.readFileSync(path.join(__dirname, "../web/building.js"), "utf8");
  const appJs = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const serverPy = fs.readFileSync(path.join(__dirname, "../server.py"), "utf8");
  assert.match(buildingJs, /function pickNewerBuildingSnap/);
  assert.match(buildingJs, /async function saveBuildingSessionForSwitch/);
  assert.match(buildingJs, /wireDeskSwitchSave\(saveBuildingSessionForSwitch\)/);
  const buildingSwitch = buildingJs.slice(
    buildingJs.indexOf("async function saveBuildingSessionForSwitch"),
    buildingJs.indexOf("async function saveDesignNow")
  );
  assert.match(buildingSwitch, /localStorage\.setItem\(SESSION_KEY/);
  assert.doesNotMatch(buildingSwitch, /await putBuildingSaves/);
  assert.match(appJs, /async function saveDraftForSwitch/);
  assert.match(appJs, /wireDeskSwitchSave\(saveDraftForSwitch\)/);
  const terrainSwitch = appJs.slice(
    appJs.indexOf("async function saveDraftForSwitch"),
    appJs.indexOf("function warmOtherDesk")
  );
  assert.match(terrainSwitch, /saveDraftLocal\(snap\)/);
  assert.match(terrainSwitch, /idbPut\("kv", snap, "draft"\)/);
  assert.doesNotMatch(terrainSwitch, /await putTerrainDraft/);
  assert.match(appJs, /async function restoreDraftLocal/);
  assert.match(appJs, /function pickNewerSnap/);
  assert.match(serverPy, /if path == "\/api\/editor-catalog":[\s\S]*return self\._file\(catalog, guess=True\)/);
  assert.match(serverPy, /if path == "\/api\/kinds":[\s\S]*return self\._file\(kinds, guess=True\)/);
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
  const buildingCss = fs.readFileSync(path.join(__dirname, "../web/building.css"), "utf8");
  const paperCss = fs.readFileSync(path.join(__dirname, "../web/paper-library.css"), "utf8");
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
  assert.match(buildingHtml, /paper-library-tool-actions/);
  assert.match(buildingHtml, /paper-library\.css/);
  assert.match(terrainHtml, /paper-library\.css/);
  assert.match(terrainHtml, /id="btnPaperLibrary"/);
  assert.match(terrainHtml, /data-paper-kind="terrain"/);
  assert.match(terrainHtml, /paper-library-core\.js/);
  assert.match(terrainJs, /function bindTerrainPaperLibrary/);
  assert.match(terrainJs, /function showTerrainPaperLibraryIndex/);
  assert.match(terrainJs, /function hydrateTerrainPaperEntry/);
  assert.doesNotMatch(terrainJs, /base64ToBytes\(paper\.data\)/);
  assert.match(terrainJs, /terrainLibraryAcceptsKind/);
  assert.match(terrainJs, /kind === "desk" \|\| kind === "terrain" \|\| kind === "manor"/);
  assert.match(buildingJs, /function syncMobileBuildingPanels/);
  assert.match(buildingJs, /openBuildingRail\("project"\)/);
  assert.doesNotMatch(buildingJs, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(terrainHtml, /data-mobile-terrain-pane="palette"/);
  assert.match(terrainHtml, /class="terrain-map-actions"/);
  assert.match(terrainHtml, /id="btnMobileMapSize"/);
  assert.match(terrainHtml, /id="btnMobileNewTerrain"/);
  assert.match(terrainHtml, /id="btnMobileChangeTerrain"/);
  const mapActions = terrainHtml.slice(
    terrainHtml.indexOf("terrain-map-actions"),
    terrainHtml.indexOf('id="mapmult"')
  );
  assert.match(mapActions, /id="btnMobileMapSize"/);
  assert.match(mapActions, /id="btnMobileChangeTerrain"/);
  const projectFiles = terrainHtml.slice(
    terrainHtml.indexOf("mobile-canvas-actions"),
    terrainHtml.indexOf("btnPaperLibrary")
  );
  assert.doesNotMatch(projectFiles, /btnMobileMapSize|btnMobileNewTerrain|btnMobileChangeTerrain/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk \.map-toolbar \{[^}]*display:\s*flex/);
  assert.doesNotMatch(mobileCss, /html\.is-tablet-workspace #desk \.map-toolbar \{[^}]*display:\s*none/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk \.workspace[\s\S]*grid-template-columns:\s*186px minmax\(0,\s*1fr\) 196px/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk #terrainLeftSheet \.brush-grid[\s\S]*repeat\(3/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk #terrainLeftSheet \.tool-row[\s\S]*repeat\(3/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk \.map-toolbar[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(mobileCss, /html\.is-tablet-workspace #desk \.desk-switch-rest[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.is-tablet-workspace #terrainMobileDock[\s\S]*display:\s*none/);
  assert.match(terrainJs, /function terrainPhoneChrome/);
  assert.match(terrainJs, /if \(!terrainPhoneChrome\(\)\) return;/);
  assert.match(terrainHtml, /data-mobile-project-tab="files"/);
  assert.match(terrainJs, /function setTerrainMobilePane/);
  assert.match(terrainJs, /function setTerrainProjectTab/);
  assert.doesNotMatch(terrainJs, /setPaintMode\(state\.paintMode === "brush" \? "erase" : "brush"\)/);
  assert.match(mobileCss, /--mobile-hit:\s*44px/);
  assert.match(mobileCss, /html\.is-mobile-workspace/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.paper-preview-grid/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\)\.mobile-landscape \.paper-preview-grid\s*\{[^}]*repeat\(2/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.paper-library-toolbar[\s\S]*display:\s*contents/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.paper-library-bar[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.paper-library-filters[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(mobileCss, /html\.is-tablet-workspace #btnPaperLibraryNewGroup[\s\S]*border:\s*0/);
  assert.doesNotMatch(paperCss, /#btnPaperLibraryNewGroup[\s\S]*border:\s*1px dashed/);
  assert.doesNotMatch(buildingCss, /#btnPaperLibraryNewGroup[\s\S]*border:\s*1px dashed/);
  assert.match(buildingCss, /\.paper-library-bar[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(paperCss, /html:not\(\.is-mobile-workspace\) \.paper-library-tools[\s\S]*display:\s*flex/);
  assert.match(buildingCss, /html:not\(\.is-mobile-workspace\) \.library-open \.top-actions[\s\S]*display:\s*none/);
  assert.match(paperCss, /html:not\(\.is-mobile-workspace\) \.library-open \.top-actions[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app \.topbar[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app \.top-actions[\s\S]*width:\s*fit-content/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app \.top-actions > \.snap-cluster[\s\S]*width:\s*fit-content/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-app \.topbar[\s\S]*flex-direction:\s*row/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-app \.top-actions[\s\S]*justify-content:\s*flex-end/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-app \.top-actions-foot[\s\S]*display:\s*contents/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-app \.snap-cluster[\s\S]*min-width:\s*max-content/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-app \.snap-step-unit[\s\S]*white-space:\s*nowrap/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app\.phase-design \.canvas-toolrail \.tool-hint[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.stage-commandbar \.commandbar-drag-label[\s\S]*display:\s*none/);
  assert.match(paperCss, /html:not\(\.is-mobile-workspace\) \.paper-library-toolbar[\s\S]*display:\s*contents/);
  assert.match(paperCss, /html:not\(\.is-mobile-workspace\) \.paper-library-filters[\s\S]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(mobileCss, /html\.is-tablet-workspace \.building-app \.snap-cluster[\s\S]*flex:\s*1 1 100%/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.paper-inspect-main[\s\S]*height:\s*100%/);
  assert.match(mobileCss, /html\.mobile-landscape\.is-mobile-workspace \.paper-inspect[\s\S]*height:\s*var\(--visual-vh\)/);
  assert.match(mobileCss, /building-app\.library-open/);
  assert.match(mobileCss, /building-app\.inspect-open/);
  assert.match(mobileCss, /app\.library-open/);
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
  assert.match(buildingJs, /function isCoarsePointer/);
  assert.match(buildingJs, /const card = document.createElement\("div"\);/);
  assert.match(buildingJs, /if \(isCoarsePointer\(\)\) return;/);
  assert.doesNotMatch(buildingJs, /inert: \["#canvasZoomInner"/);
  assert.match(buildingJs, /id: "building-tools"[\s\S]*inert: \["\.stage-bar"/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app\.phase-design \.stage-commandbar:not\(\[hidden\]\)[\s\S]*display:\s*flex/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.custom-card/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.layer-row/);
  assert.match(buildingJs, /paperInspectView\.pinch/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.mobile-workspace-only\[hidden\]/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.mobile-sheet-backdrop/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.stage-commandbar[\s\S]*width:\s*max-content/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar[\s\S]*width:\s*fit-content/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar[\s\S]*max-width:\s*min\(calc\(100vw - 24px\), 360px\)/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar \.command-row-primary[\s\S]*display:\s*contents/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar \.tool-group-history[\s\S]*order:\s*20/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar \.tool-group-z[\s\S]*order:\s*21/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.stage-commandbar \.canvas-toolbar[\s\S]*flex-direction:\s*column/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.stage-commandbar \.canvas-toolbar[\s\S]*flex-direction:\s*row/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.stage-commandbar \.canvas-toolbar[\s\S]*flex-direction:\s*row/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.stage-commandbar \.command-row-primary[\s\S]*display:\s*contents/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.stage-commandbar \.command-row[\s\S]*display:\s*flex/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.stage-commandbar \.align-bar[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.mobile-selection-bar \{[^}]*display:\s*none/);
  assert.match(mobileCss, /html\.is-mobile-workspace #materialSide:not\(\[hidden\]\) ~ #buildingProjectPane/);
  assert.match(mobileCss, /html\.is-mobile-workspace #tabAssets \.category-grid \.cat-count[\s\S]*display:\s*none/);
  assert.match(mobileCss, /html\.mobile-portrait \.building-rail\.mobile-sheet[\s\S]*78dvh/);
  assert.match(buildingHtml, /id="btnBuildingSheetPin"/);
  assert.match(buildingHtml, /data-resize="n"/);
  assert.match(buildingHtml, /data-resize="se"/);
  assert.match(buildingJs, /function closeBuildingRailOnPick/);
  assert.match(buildingJs, /function bindBuildingSheetChrome/);
  assert.match(buildingJs, /SHEET_LAYOUT_KEY/);
  assert.match(buildingJs, /state\.sheetPinned && workspaceMode\(\)\.tablet/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.building-rail\.mobile-sheet\.is-sheet-placed/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.building-rail \.sheet-resize\[data-resize="w"\]/);
  assert.match(buildingCss, /\.custom-list \{[^}]*flex-direction:\s*column/);
  assert.match(buildingJs, /mobileFacingLabel/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.building-project-pane \.panel-actions[\s\S]*repeat\(3/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.terrain-map-actions[\s\S]*1fr 1fr 1fr/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.zoom-control/);
  assert.match(buildingHtml, /id="nudgePad"/);
  assert.match(buildingHtml, /data-nudge-x="0" data-nudge-y="-1"/);
  assert.match(buildingHtml, /nudge-step-kicker">步长</);
  assert.match(buildingHtml, /nudge-step-value">1px</);
  assert.match(buildingJs, /function bindNudgePad\(/);
  assert.match(buildingJs, /nudgeSelected\(dx \* nudgePadStep, dy \* nudgePadStep, \{ history: false \}\)/);
  assert.match(buildingJs, /bindNudgeStepControl/);
  assert.match(buildingJs, /nudgePadStep\}px/);
  assert.match(buildingJs, /kicker\.textContent = "步长"/);
  assert.match(mobileJs, /function bindNudgeStepControl\(/);
  assert.match(mobileJs, /blockSystemKeyboard/);
  assert.match(mobileJs, /nudge-step-input-display/);
  assert.match(mobileCss, /\.nudge-step-input-display/);
  assert.match(mobileJs, /function guardBrowserChrome\(/);
  assert.match(mobileJs, /addEventListener\("contextmenu", block, true\)/);
  assert.match(mobileCss, /-webkit-touch-callout:\s*none/);
  assert.match(mobileCss, /\.nudge-step-pop/);
  assert.match(mobileCss, /html\.is-mobile-workspace:not\(\.is-tablet-workspace\) \.stage-commandbar:not\(\.is-placed\):not\(\.is-dragging-hud\)[\s\S]*bottom:\s*0/);
  assert.match(buildingCss, /\.nudge-pad/);
  assert.match(buildingCss, /\.nudge-btn[\s\S]*min-width:\s*44px/);
  assert.match(buildingCss, /\.nudge-btn[\s\S]*min-height:\s*44px/);
  assert.match(buildingCss, /\.nudge-btn\[data-nudge\]::before/);
  assert.match(buildingCss, /\.nudge-left::before \{ transform:\s*rotate\(-90deg\)/);
  assert.match(buildingCss, /\.nudge-right::before \{ transform:\s*rotate\(90deg\)/);
  assert.match(buildingCss, /polygon points='6,2 11,10 1,10'/);
  assert.match(buildingCss, /\.nudge-step-kicker/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.nudge-pad[\s\S]*display:\s*grid/);
  assert.match(mobileCss, /html\.is-tablet-workspace \.nudge-pad/);
  assert.match(buildingCss, /\.nudge-pad[\s\S]*background:\s*transparent/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.nudge-btn[\s\S]*rgba\(255, 255, 255, 0\.36\)/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app\.phase-design \.canvas-toolrail > \.hud-drag-grip[\s\S]*display:\s*flex/);
  assert.match(mobileCss, /html\.is-mobile-workspace \.building-app\.phase-design \.canvas-toolrail \.tool-item \.tool-name[\s\S]*display:\s*block/);
  assert.match(buildingJs, /function buildingFloatingHud/);
  assert.match(buildingJs, /function hudDragEnabled/);
  assert.match(buildingJs, /return !workspaceMode\(\)\.mobile \|\| buildingFloatingHud\(\)/);
  assert.match(buildingJs, /function syncMaterialsDock/);
  assert.match(buildingJs, /bindFloatingHud\(tools, "chrome", toolrail\)/);
  assert.match(buildingJs, /setPointerCapture/);
  assert.match(mobileJs, /function isIPadOS/);
  assert.match(mobileJs, /sheetCoversWorkspace/);
});

test("terrain desk clears preview selection with Escape and exposes a mobile nudge pad", () => {
  const terrainHtml = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  const terrainJs = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../web/app.css"), "utf8");
  const mobileCss = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.css"), "utf8");
  const leftSheet = terrainHtml.slice(
    terrainHtml.indexOf('id="terrainLeftSheet"'),
    terrainHtml.indexOf('id="mapHost"')
  );
  const projectSheet = terrainHtml.slice(
    terrainHtml.indexOf('id="terrainProjectSheet"'),
    terrainHtml.indexOf("id=\"dlgSize\"")
  );
  assert.doesNotMatch(leftSheet, /data-drawer-close/);
  assert.doesNotMatch(leftSheet, /class="icon-x"/);
  assert.match(projectSheet, /data-drawer-close/);
  assert.match(terrainHtml, /id="nudgePad"/);
  assert.match(terrainHtml, /id="btnClearPreview"/);
  assert.match(terrainHtml, /data-nudge-x="0" data-nudge-y="-1"/);
  assert.match(terrainHtml, /nudge-step-kicker">步长</);
  assert.match(terrainHtml, /nudge-step-value">1格</);
  assert.match(terrainJs, /previewNudgeCells\}格/);
  assert.match(terrainJs, /bindNudgeStepControl/);
  assert.match(css, /\.nudge-btn\[data-nudge\]::before/);
  assert.match(css, /\.nudge-left::before \{ transform:\s*rotate\(-90deg\)/);
  assert.match(terrainJs, /function clearPreviewSelection\(/);
  assert.match(terrainJs, /function bindPreviewNudgePad\(/);
  assert.match(terrainJs, /function nudgeSelectedPreview\(/);
  assert.match(terrainJs, /if \(state\.selectedPreviewId \|\| state\.selectedBld >= 0\)/);
  assert.match(terrainJs, /clearPreviewSelection\(\)/);
  assert.match(terrainJs, /nudgeSelectedPreview\(dx \* stepX, dy \* stepY, \{ history: false \}\)/);
  assert.match(css, /\.nudge-btn[\s\S]*min-width:\s*44px/);
  assert.match(css, /\.nudge-btn[\s\S]*min-height:\s*44px/);
  assert.match(mobileCss, /html\.is-mobile-workspace #desk \.nudge-pad\[hidden\]/);
  assert.match(mobileCss, /html\.is-mobile-workspace #terrainLeftSheet > \.drawer-cap \.icon-x[\s\S]*display:\s*none/);
});

function loadMobileWorkspace(env) {
  const { runInNewContext } = require("node:vm");
  const src = fs.readFileSync(path.join(__dirname, "../web/mobile-workspace.js"), "utf8");
  const window = {
    innerWidth: env.innerWidth,
    innerHeight: env.innerHeight,
    navigator: {
      userAgent: env.userAgent || "Mozilla/5.0",
      platform: env.platform || "Win32",
      maxTouchPoints: env.maxTouchPoints || 0,
    },
    matchMedia(query) {
      return {
        matches: Boolean(env.coarse) && (String(query).includes("coarse") || String(query).includes("hover: none")),
        addEventListener() {},
      };
    },
    visualViewport: {
      width: env.innerWidth,
      height: env.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
      addEventListener() {},
    },
    document: {
      documentElement: { style: { setProperty() {} }, classList: { toggle() {} }, dataset: {} },
      addEventListener() {},
      querySelectorAll: () => [],
    },
    addEventListener() {},
    requestAnimationFrame() { return 0; },
    WeakMap,
    Set,
    Map,
  };
  runInNewContext(src, { window, WeakMap, Set, Map });
  return window.MobileWorkspace.modeForViewport();
}

test("iPad and tablet viewports use the tablet workspace, not desktop chrome", () => {
  const phone = loadMobileWorkspace({ innerWidth: 390, innerHeight: 844, coarse: true, maxTouchPoints: 5 });
  assert.equal(phone.mobile, true);
  assert.equal(phone.tablet, false);

  const phoneLandscape = loadMobileWorkspace({ innerWidth: 844, innerHeight: 390, coarse: true, maxTouchPoints: 5 });
  assert.equal(phoneLandscape.mobile, true);
  assert.equal(phoneLandscape.tablet, false);
  assert.equal(phoneLandscape.orientation, "landscape");

  const ipadPortraitCss = loadMobileWorkspace({ innerWidth: 768, innerHeight: 1024, coarse: false, maxTouchPoints: 0 });
  assert.equal(ipadPortraitCss.mobile, true);
  assert.equal(ipadPortraitCss.tablet, true);

  const ipadPortrait = loadMobileWorkspace({
    innerWidth: 834,
    innerHeight: 1194,
    coarse: true,
    maxTouchPoints: 5,
    platform: "iPad",
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
  });
  assert.equal(ipadPortrait.mobile, true);
  assert.equal(ipadPortrait.tablet, true);

  const ipadLandscape = loadMobileWorkspace({
    innerWidth: 1194,
    innerHeight: 834,
    coarse: false,
    maxTouchPoints: 5,
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  });
  assert.equal(ipadLandscape.iPadOS, true);
  assert.equal(ipadLandscape.mobile, true);
  assert.equal(ipadLandscape.tablet, true);

  const ipadPro = loadMobileWorkspace({
    innerWidth: 1366,
    innerHeight: 1024,
    coarse: false,
    maxTouchPoints: 5,
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  });
  assert.equal(ipadPro.tablet, true);
  assert.equal(ipadPro.mobile, true);

  const desktop = loadMobileWorkspace({
    innerWidth: 1440,
    innerHeight: 900,
    coarse: false,
    maxTouchPoints: 0,
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  });
  assert.equal(desktop.mobile, false);
  assert.equal(desktop.tablet, false);
  assert.equal(desktop.iPadOS, false);
});
