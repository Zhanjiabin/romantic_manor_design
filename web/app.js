/* rc3.exe / GTile::MakeTileImport (0x521050):
   贴图按 64px 横步长、16px 交错行切成 65×33 菱形变体；不是矩形壁纸。
   主画面从这些变体组成连续的等距地表，热点为 (-32,-16)。 */
const SNAP = 32;
const WORLD = 4096;
const TILE_W = 64;
const TILE_H = 32;
const TILE_DW = 65;
const TILE_DH = 33;
const ISO_Y = 1;
const NATIVE_K = 1;
const DESK_K = 1;
const TERRAIN_SOURCE_SCALE = 1;
const GRASS_DECORATION_PERMILLE = 6;
const TERRAIN_LIGHT_SRC = "/tiles/maptexture/990000.jpg";
const SAND_LIGHT_SRC = "/tiles/maptexture/990200.jpg";
// dxsj_s.cmap → tile/01shamo.ini. Same kind codes as 00changgui, different plates.
const SAND_TILESET = {
  "土/沙地": "maptexture/170200.jpg",
  "草/绿草": "maptexture/110201.jpg",
  "草/青草": "maptexture/110200.jpg",
  "矿区/金": "maptexture/150000.jpg",
  "地/石板地": "maptexture/100001.gif",
  "地/灰砖地2": "maptexture/160000.jpg",
  "地/灰砖地1": "maptexture/100002.gif",
  "地/石子地": "maptexture/100003.gif",
  "地/砖地": "maptexture/100200.jpg",
  "土/干土": "maptexture/130000.jpg",
  "土/土": "maptexture/120000.jpg",
  "土/干地": "maptexture/130200.jpg",
  "土/海沙": "maptexture/170000.jpg",
  "土/湿土": "maptexture/120001.jpg",
  "水/河水": "water/189901.jpg",
  "花/绿花丛": "maptexture/h031.jpg",
  "花/青花丛": "maptexture/h032.jpg",
  "花/绿野花": "maptexture/h041.jpg",
  "花/青野花": "maptexture/h042.jpg",
  "雪/雪地": "maptexture/s01.jpg",
  "地/山石地": "maptexture/d04.jpg",
  "室内/绿草": "maptexture/110201.jpg",
  "室内/青草": "maptexture/110200.jpg",
  "室内/石板地": "maptexture/100001.gif",
  "室内/灰砖地2": "maptexture/160000.jpg",
  "室内/灰砖地1": "maptexture/100002.gif",
  "室内/山石地": "maptexture/d04.jpg",
};
const TERRAIN_BASE_DARKEN = 0.12;
const TERRAIN_LIGHT_GAIN = 0.28;
const KIND_ORDER = ["草地", "土地", "砖地", "水面", "花丛", "雪地", "矿场"];
// dxsj.cmap: MapBtn 'comm/tocity.ale' at pixel (385,339) on an 800 map.
const PORTAL_SRC = "/data/manor_exit_sign.png?v=52";
const PORTAL_ANCHOR = { x: -65, y: -108 };
const PORTAL_DEFAULT = { x: 385, y: 339, map: 800 };
const ISO_SPAN = buildIsoSpan();
const LINK_PATTERNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 9, 3, 6, 12];
// rc3.exe 0x5DB9D0 for this client build.
const LINK_CELLS = [37, 30, 34, 25, 18, 28, 8, 32, 35, 20, 1, 29, 6, 13, 4, 5, 11, 10];
// rc3.exe 0x5DBA5C — top/right/bottom/left cover masks for 3+/4-way junctions.
const CORNER_MASK_SLOTS = [13, 12, 10, 6];
const MASK_SRC = "/tiles/mask/989802.jpg";
// GBkTile::CreateWaterLayer(kind, mask, img1, img2) ← 水动画=水/河水,189800,180100,180201
const WATER_MASK_SRC = "/tiles/water/189800.jpg";

function buildIsoSpan() {
  const widths = new Uint16Array(TILE_DH);
  let v = 1;
  let i = 0;
  let j = TILE_DH - 1;
  while (v < 0x45) {
    widths[i] = v;
    widths[j] = v;
    v += 4;
    i += 1;
    j -= 1;
  }
  const srcx = new Uint16Array(TILE_DH);
  const pack = new Uint16Array(TILE_DH);
  for (let r = 0; r < TILE_DH; r++) srcx[r] = 32 - (widths[r] >> 1);
  pack[0] = 0;
  for (let r = 0; r < TILE_DH - 1; r++) pack[r + 1] = pack[r] + widths[r];
  return { widths, srcx, pack };
}

const state = {
  kinds: null,
  layer: "terrain",
  tool: "free",
  paintMode: "brush",
  shapeMode: "fill",
  shapeDrag: null,
  shapeShift: false,
  grassKeep: new Set(),
  brushSize: 1,
  brush: null,
  selectedBase: null,
  mapSize: 800,
  mapflag: 0,
  stamps: [],
  terrainSource: null,
  buildings: [],
  bldKind: "manor",
  buildingSource: null,
  planOverlay: null,
  cam: { x: 0, y: 0, k: 1 },
  uiScale: 1,
  images: new Map(),
  tileSprites: new Map(),
  tileAtlases: new Map(),
  tilePixels: new Map(),
  keyedSprites: new Map(),
  linkSprites: new Map(),
  maskSlots: new Map(),
  synthCache: new Map(),
  dragging: false,
  lastPaint: null,
  panning: false,
  panFrom: null,
  buildingDrag: null,
  planOverlayDrag: null,
  miniDrag: false,
  selectedBld: -1,
  history: [],
  future: [],
  unknown: new Set(),
  fillDefault: true,
  // Link ALEs are transition source assets, not finished overlays. Keep the
  // experimental compositor opt-in until the native four-edge mask pass is cloned.
  terrainEffects: /[?&]terrainEffects=1/.test(location.search),
  stampAt: new Map(),
  stampByCell: new Map(),
  cornerTiles: new Map(),
  portal: { x: 385, y: 339, held: false, grabX: 0, grabY: 0 },
  terrainRev: 0,
  drawTiles: [],
  paintPreview: new Map(),
  strokeNeedsRebuild: false,
};

let view = document.getElementById("view");
let ctx = view.getContext("2d");
let imageTerrainDraft = null;
let planOverlayDraft = null;

async function boot() {
  document.documentElement.classList.add("boot-pending");
  const kinds = await (await fetch("/api/kinds")).json();
  state.kinds = kinds;
  fillListKind(kinds.brushes || []);
  fillBases(kinds.bases || []);
  fillSizes(visibleMapSizes(kinds.mapSizes || []));
  resize();
  {
    const names = new Set([
      "wlink014",
      "clink012",
      "clink014",
      "slink014",
      "980005",
      "980006",
      "980201",
      "980202",
      "980203",
      "980204",
      "slink01",
    ]);
    for (const L of kinds.links || []) if (L.ale) names.add(L.ale);
    names.forEach((n) => {
      preload("/ale-atlas/" + n + ".png");
      preload("/ale/" + n + ".png");
    });
    preload(MASK_SRC);
    preload(WATER_MASK_SRC);
  }
  preloadAllTiles();
  preload(TERRAIN_LIGHT_SRC);
  preload(PORTAL_SRC);
  initPortalPos();
  bind();
  const restored = /[?&]sample=1/.test(location.search) ? false : await restoreDraft();
  requestAnimationFrame(() => {
    resize();
    playCam();
    draw();
  });
  if (/[?&]sample=1/.test(location.search)) {
    try {
      const doc = await (await fetch("/api/sample-terrain")).json();
      applyTerrain(doc, true);
    } catch (err) {
      console.warn(err);
      playCam();
      draw();
    }
  } else if (restored) {
    fitTerrainContent();
    draw();
  }
  await consumePendingBuildingImport();
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
  });
}

async function consumePendingBuildingImport() {
  if (!/[?&]importBuilding=1/.test(location.search)) return;
  let payload = null;
  try {
    payload = JSON.parse(sessionStorage.getItem("manor-pending-building-import") || "null");
  } catch {
    payload = null;
  }
  sessionStorage.removeItem("manor-pending-building-import");
  history.replaceState({}, "", location.pathname);
  if (!payload?.base64) return;
  try {
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], payload.name || "建筑.txt", { type: "text/plain" });
    await importFile(file, "build");
  } catch (err) {
    await appAlert(err.message || String(err), { title: "导入失败" });
  }
}

function visibleMapSizes(sizes) {
  return (sizes || [])
    .filter((s) => Number(s.size) < 4160)
    .map((s) => {
      if (Number(s.size) !== 3880) return s;
      return {
        ...s,
        level: "110级以上庄园",
        desc: "地形面积3880*3880, 适用于声望110级以上的庄园",
      };
    })
    .sort((a, b) => b.size - a.size);
}

function fillSizes(sizes) {
  const sel = document.getElementById("mapSize");
  sel.innerHTML = "";
  for (const s of sizes) {
    const o = document.createElement("option");
    o.value = s.size;
    o.textContent = s.size + " · " + (s.level || "");
    o.dataset.desc = s.desc || "";
    o.dataset.price = s.basePrice || 0;
    sel.appendChild(o);
  }
  const prefer = [...sel.options].find((o) => +o.value === 800) || sel.options[0];
  if (prefer) {
    prefer.selected = true;
    state.mapSize = +prefer.value;
  }
  sel.onchange = () => {
    state.mapSize = +sel.value;
    playCam();
    draw();
  };
  fillSizeList(sizes);
}

function fillSizeList(sizes) {
  const box = document.getElementById("sizeList");
  if (!box) return;
  box.innerHTML = "";
  sizes.forEach((s) => {
    const row = document.createElement("div");
    row.className = "row" + (s.size === state.mapSize ? " on" : "");
    row.textContent = s.size + "×" + s.size + "  " + (s.level || "");
    row.onclick = () => {
      box.querySelectorAll(".row").forEach((el) => el.classList.remove("on"));
      row.classList.add("on");
      const sel = document.getElementById("mapSize");
      sel.value = String(s.size);
      const desc = document.getElementById("sizeDesc");
      if (desc) desc.textContent = s.desc || "";
    };
    box.appendChild(row);
  });
  const cur = sizes.find((s) => s.size === state.mapSize) || sizes[0];
  const desc = document.getElementById("sizeDesc");
  if (desc && cur) desc.textContent = cur.desc || "";
}

function basicBrushes(brushes) {
  return (brushes || []).filter((b) => (b.stampSize || 1) === 1);
}

function uniqueBrushes(brushes) {
  const byCode = new Map();
  for (const b of basicBrushes(brushes)) {
    if (!byCode.has(b.code)) byCode.set(b.code, []);
    byCode.get(b.code).push(b);
  }
  return [...byCode.values()].map((arr) => {
    const base = arr.find((x) => x.stampSize === 1) || arr[0];
    return { ...base, sizes: arr };
  });
}

function iconFrame(icon) {
  const m = /[?&]f=(\d+)/.exec(icon || "");
  return m ? +m[1] : 0;
}

function iconSrc(icon) {
  const f = iconFrame(icon);
  return "/data/terrain_frames/f" + String(f).padStart(3, "0") + ".png?v=53";
}

function baseImageSrc(base) {
  if (!base?.baseImage) return "";
  const path = base.baseImage
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/bdesign/imgs/${path}.png?f=0`;
}

function initPortalPos() {
  const n = worldExtent();
  const scale = n / PORTAL_DEFAULT.map;
  state.portal.x = PORTAL_DEFAULT.x * scale;
  state.portal.y = PORTAL_DEFAULT.y * scale;
  state.portal.held = false;
}

function clampPortal(wx, wy) {
  const n = worldExtent();
  return {
    x: Math.max(0, Math.min(n, wx)),
    y: Math.max(0, Math.min(n, wy)),
  };
}

function uniqueTerrainTiles() {
  const out = [];
  const seen = new Set();
  for (const t of state.kinds.tiles || []) {
    const k = (t.code || "") + "|" + (t.texture || "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function tileAsBrush(t) {
  return {
    name: (t.code || "").split("/")[1] || t.code,
    code: t.code,
    type: t.type,
    texture: t.texture,
    stampSize: 1,
    char: t.char,
    price: "",
  };
}

function brushPaletteType(b) {
  const tile = (state.kinds.tiles || []).find((t) => t.code === b.code);
  const raw = b.type || (tile && tile.type) || "";
  if (raw === "耕地" || raw === "沙地" || raw === "海沙") return "土地";
  if (raw === "建筑地") return "砖地";
  return raw;
}

function paletteForType(type) {
  return basicBrushes(state.kinds.brushes || []).filter((b) => brushPaletteType(b) === type);
}

function preloadAllTiles() {
  for (const t of uniqueTerrainTiles()) {
    if (t.texture) preload("/tiles/" + t.texture);
  }
  for (const tex of Object.values(SAND_TILESET)) preload("/tiles/" + tex);
  preload(SAND_LIGHT_SRC);
}

function brushDisplayName(b) {
  return String(b.name || b.code || "")
    .replace(/^中型|^大型/g, "")
    .replace(/地形$/, "")
    .trim() || b.code;
}

function sortBrushesFlat(brushes) {
  return basicBrushes(brushes)
    .slice()
    .sort((a, b) => {
      const ta = brushPaletteType(a);
      const tb = brushPaletteType(b);
      const ia = KIND_ORDER.indexOf(ta);
      const ib = KIND_ORDER.indexOf(tb);
      const oa = ia < 0 ? 99 : ia;
      const ob = ib < 0 ? 99 : ib;
      if (oa !== ob) return oa - ob;
      return brushDisplayName(a).localeCompare(brushDisplayName(b), "zh");
    });
}

function fillListKind(brushes) {
  fillMapMult(sortBrushesFlat(brushes));
}

function setPaintMode(mode) {
  state.paintMode = mode === "erase" || mode === "pan" ? mode : "brush";
  document.querySelectorAll("#modeRow .tool").forEach((el) => {
    el.classList.toggle("on", el.dataset.mode === state.paintMode);
  });
  setLayer("terrain");
}

function setTool(tool) {
  const allowed = new Set(["free", "fill", "line", "rect", "ellipse", "triangle", "diamond", "heart", "star"]);
  state.tool = allowed.has(tool) ? tool : "free";
  state.shapeDrag = null;
  document.querySelectorAll("#toolRow .tool").forEach((el) => {
    el.classList.toggle("on", el.dataset.tool === state.tool);
  });
  setLayer("terrain");
  draw();
}

function isShapeTool(tool) {
  return ["line", "rect", "ellipse", "triangle", "diamond", "heart", "star"].includes(tool || state.tool);
}

function wantsErase(e) {
  return state.paintMode === "erase" || !!(e && e.shiftKey);
}

function fillMapMult(rows) {
  const box = document.getElementById("mapmult");
  if (!box) return;
  box.innerHTML = "";
  const list = basicBrushes(rows);
  list.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "row" + (i === 0 ? " on" : "");
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.style.imageRendering = "pixelated";
    if (b.icon) {
      img.src = iconSrc(b.icon);
      preload(img.src);
    } else if (b.texture) img.src = "/tiles/" + b.texture;
    const display = brushDisplayName(b);
    row.title = display;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = display;
    row.append(img, name);
    row.onclick = () => {
      box.querySelectorAll(".row").forEach((el) => el.classList.remove("on"));
      row.classList.add("on");
      useBrush(b);
      setPaintMode("brush");
      setLayer("terrain");
      closeDrawers();
    };
    box.appendChild(row);
    if (i === 0) useBrush(b);
    if (b.texture) preload("/tiles/" + b.texture);
  });
}

function fillBases(bases) {
  const box = document.getElementById("bases");
  if (!box) return;
  box.innerHTML = "";
  for (const b of bases.filter((x) => x.kind <= 4)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    const img = document.createElement("img");
    const preview = baseImageSrc(b);
    if (preview) img.src = preview;
    img.alt = b.name;
    const lab = document.createElement("div");
    lab.textContent = b.name;
    const sm = document.createElement("small");
    sm.textContent = b.footprint.join("×") + "  编号 " + b.no;
    btn.append(img, lab, sm);
    btn.onclick = () => {
      box.querySelectorAll(".swatch").forEach((el) => el.classList.remove("on"));
      btn.classList.add("on");
      document.getElementById("itemId").value = b.no;
      state.selectedBase = b;
      setLayer("build");
    };
    box.appendChild(btn);
    if (preview) preload(preview);
  }
}

function preload(src) {
  if (state.images.has(src)) return state.images.get(src);
  const im = new Image();
  im.src = src;
  im.onload = () => {
    if (state.strokeNeedsRebuild) {
      draw();
      return;
    }
    state.terrainRev = (state.terrainRev || 0) + 1;
    draw();
  };
  state.images.set(src, im);
  return im;
}

function scaleDesk() {
  state.uiScale = 1;
}

function resize() {
  const stage = document.querySelector(".map-stage") || document.getElementById("mapHost");
  const w = Math.max(280, Math.floor(stage?.clientWidth || window.innerWidth));
  const h = Math.max(180, Math.floor(stage?.clientHeight || window.innerHeight));
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
    terrainScreenKey = "";
    gridScreenKey = "";
    gridPixels = null;
  }
  syncMiniCanvas();
  scaleDesk();
  draw();
}

function worldExtent() {
  return Math.max(1, state.mapSize || 800);
}

function lookAt(wx, wy, k) {
  state.cam.k = k;
  state.cam.x = 0;
  state.cam.y = 0;
  const p = worldToScreen(wx, wy);
  state.cam.x = view.width / 2 - p.x;
  state.cam.y = view.height / 2 - p.y;
}

function centerOnMap(k) {
  const n = worldExtent();
  lookAt(n / 2, n / 2, k);
}

function playCam() {
  lookAt(state.portal.x, state.portal.y, DESK_K);
  state.cam.y = 0;
}

function fitCam() {
  const n = worldExtent();
  const k = Math.min((view.width - 8) / n, (view.height - 8) / (n * ISO_Y));
  centerOnMap(Math.max(0.08, k));
}

function zoomNative() {
  lookAt(state.portal.x, state.portal.y, NATIVE_K);
}

function worldToScreen(x, y) {
  const k = state.cam.k;
  return { x: state.cam.x + x * k, y: state.cam.y + y * k * ISO_Y };
}

function screenToWorld(sx, sy) {
  const k = state.cam.k || 1;
  return { x: (sx - state.cam.x) / k, y: (sy - state.cam.y) / (k * ISO_Y) };
}

function cellCenter(s) {
  return worldToScreen(s.x + SNAP / 2, s.y + SNAP / 2);
}

function snap(v) {
  return Math.round(v / SNAP) * SNAP;
}

function tileByChar(ch) {
  return (state.kinds.tiles || []).find((t) => t.char === ch);
}

function brushByPaperChar(ch) {
  const idx = decKind(ch);
  if (idx < 0) return null;
  return (state.kinds.brushes || []).find((b) => b.mapdataIndex === idx) || null;
}

function grassChar() {
  return "0";
}

function sandChar() {
  return "C";
}

function isSandBase() {
  return !!state.mapflag;
}

function baseChar() {
  return isSandBase() ? sandChar() : grassChar();
}

function isSandKind(kind) {
  if (!kind) return false;
  if (kind === sandChar()) return true;
  const type = tileByChar(kind)?.type || "";
  const code = terrainCode(kind);
  return type === "沙地" || code === "土/沙地";
}

function terrainLightSrc() {
  return isSandBase() ? SAND_LIGHT_SRC : TERRAIN_LIGHT_SRC;
}

function deskChrome() {
  // Outside the map: muted warm gray, not sand/grass, not a bright flash.
  return "#4a4844";
}

function planeBackdrop() {
  // 170200 sand averages ~#f2c671. A darker fill (#c4a05a) shows through
  // 1px iso seams as repeating dark V-waves.
  return isSandBase() ? "#f2c671" : "#2a5a30";
}

function useBrush(b) {
  state.brush = b;
  state.brushSize = b.stampSize || 1;
}

function cellKey(x, y) {
  return x + "," + y;
}

function stampSizeOf(kind) {
  const b = brushByPaperChar(kind);
  return (b && b.stampSize) || 1;
}

function truncDiv(value, divisor) {
  return value < 0 ? -Math.floor(-value / divisor) : Math.floor(value / divisor);
}

function nativePointToLogical(x, y) {
  const u = truncDiv(x + 2 * y + 32, 64);
  const d = 2 * y + 32 - x;
  const v = truncDiv(d, 64) - (d < 0 ? 1 : 0);
  return { u, v };
}

function logicalToNative(u, v) {
  const d = u - v;
  const col = truncDiv(d, 2) - (d < 0 ? 1 : 0);
  const row = u + v;
  return {
    col,
    row,
    cx: 64 * col + (row & 1 ? 32 : 0),
    cy: 16 * row,
  };
}

function cornerTile(u, v) {
  const key = cellKey(u, v);
  let tile = state.cornerTiles.get(key);
  if (!tile) {
    tile = { u, v, corners: [baseChar(), baseChar(), baseChar(), baseChar()] };
    state.cornerTiles.set(key, tile);
  }
  return tile;
}

function writeCorners(u, v, kind, mask) {
  const tile = cornerTile(u, v);
  if (mask & 1) tile.corners[0] = kind;
  if (mask & 2) tile.corners[1] = kind;
  if (mask & 4) tile.corners[2] = kind;
  if (mask & 8) tile.corners[3] = kind;
}

function brushRadius(brush) {
  return (Math.max(1, (brush && brush.stampSize) || 1) - 1) >> 1;
}

function replayStampFootprint(u, v, terrain, radius) {
  writeCorners(u - radius - 1, v - radius - 1, terrain, 0x4);
  writeCorners(u + radius + 1, v + radius + 1, terrain, 0x1);
  writeCorners(u + radius + 1, v - radius - 1, terrain, 0x8);
  writeCorners(u - radius - 1, v + radius + 1, terrain, 0x2);
  for (let offset = -radius; offset <= radius; offset++) {
    const vv = v + offset;
    writeCorners(u - radius - 1, vv, terrain, 0x6);
    writeCorners(u + offset, v - radius - 1, terrain, 0xc);
    for (let uu = u - radius; uu <= u + radius; uu++) {
      writeCorners(uu, vv, terrain, 0xf);
    }
    writeCorners(u + radius + 1, vv, terrain, 0x9);
    writeCorners(u + offset, v + radius + 1, terrain, 0x3);
  }
}

function replayNativeStamp(stamp) {
  const brush = brushByPaperChar(stamp.kind);
  if (!brush) return;
  const terrain = brush.char || grassChar();
  const { u, v } = nativePointToLogical(stamp.x, stamp.y);
  replayStampFootprint(u, v, terrain, brushRadius(brush));
}

function applyGrassKeep() {
  const fill = baseChar();
  if (!state.grassKeep || !state.grassKeep.size) return;
  for (const key of state.grassKeep) {
    const comma = String(key).indexOf(",");
    if (comma < 0) continue;
    const u = +key.slice(0, comma);
    const v = +key.slice(comma + 1);
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    replayStampFootprint(u, v, fill, 0);
  }
}

function fillEnclosedGrassTiles() {
  // Freehand stamps can leave grass diamonds inside a plot. Anything that cannot
  // walk to the map exterior through grass-only tiles is an enclosed hole.
  const grass = grassChar();
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const isPureGrass = (tile) => tile && tile.corners.every((kind) => kind === grass);
  const voteEarth = (tile) => {
    const votes = new Map();
    for (const [du, dv] of dirs) {
      const n = state.cornerTiles.get(cellKey(tile.u + du, tile.v + dv));
      if (!n || isPureGrass(n)) continue;
      for (const [kind, count] of rankedKinds(n)) {
        if (kind === grass) continue;
        if (isWaterTerrain(kind) || isSnowTerrain(kind)) continue;
        votes.set(kind, (votes.get(kind) || 0) + count);
      }
    }
    for (const [kind, count] of rankedKinds(tile)) {
      if (kind === grass) continue;
      if (isWaterTerrain(kind) || isSnowTerrain(kind)) continue;
      votes.set(kind, (votes.get(kind) || 0) + count * 2);
    }
    let best = null;
    let bestN = 0;
    for (const [kind, n] of votes) {
      if (n > bestN) {
        best = kind;
        bestN = n;
      }
    }
    return best;
  };
  for (let pass = 0; pass < 10; pass++) {
    const exterior = new Set();
    const queue = [];
    for (const tile of state.cornerTiles.values()) {
      if (!isPureGrass(tile)) continue;
      let open = false;
      for (const [du, dv] of dirs) {
        if (!state.cornerTiles.has(cellKey(tile.u + du, tile.v + dv))) {
          open = true;
          break;
        }
      }
      if (!open) continue;
      const key = cellKey(tile.u, tile.v);
      exterior.add(key);
      queue.push(tile);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const tile = queue[qi];
      for (const [du, dv] of dirs) {
        const nu = tile.u + du;
        const nv = tile.v + dv;
        const key = cellKey(nu, nv);
        if (exterior.has(key)) continue;
        const n = state.cornerTiles.get(key);
        if (!isPureGrass(n)) continue;
        exterior.add(key);
        queue.push(n);
      }
    }
    let changed = 0;
    for (const tile of state.cornerTiles.values()) {
      if (!isPureGrass(tile)) continue;
      const key = cellKey(tile.u, tile.v);
      if (state.grassKeep && state.grassKeep.has(key)) continue;
      if (exterior.has(key)) continue;
      const best = voteEarth(tile);
      if (!best) continue;
      tile.corners = [best, best, best, best];
      changed++;
    }
    if (!changed) break;
  }
}

function rebuildStampIndex() {
  state.stampAt = new Map();
  state.cornerTiles = new Map();
  state.stampByCell = new Map();
  if (!state.stamps.length) {
    state.drawTiles = [];
    state.paintPreview = new Map();
    state.strokeNeedsRebuild = false;
    state.terrainRev = (state.terrainRev || 0) + 1;
    return;
  }

  for (const stamp of state.stamps) {
    replayNativeStamp(stamp);
    const { u, v } = nativePointToLogical(stamp.x, stamp.y);
    state.stampByCell.set(cellKey(u, v), stamp);
  }
  applyGrassKeep();

  const fill = baseChar();
  const drawTiles = [];
  for (const tile of state.cornerTiles.values()) {
    if (
      tile.corners[0] === fill &&
      tile.corners[1] === fill &&
      tile.corners[2] === fill &&
      tile.corners[3] === fill
    ) {
      continue;
    }
    const position = logicalToNative(tile.u, tile.v);
    const counts = new Map();
    for (const kind of tile.corners) counts.set(kind, (counts.get(kind) || 0) + 1);
    const kind = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    state.stampAt.set(cellKey(position.col, position.row), {
      kind,
      x: position.cx - TILE_W / 2,
      y: position.cy - TILE_H / 2,
    });
    drawTiles.push(tile);
  }
  drawTiles.sort((a, b) => {
    const pa = logicalToNative(a.u, a.v);
    const pb = logicalToNative(b.u, b.v);
    return tileDrawRank(a) - tileDrawRank(b) || pa.row - pb.row || pa.col - pb.col;
  });
  state.drawTiles = drawTiles;
  pruneSynthCache();
  state.paintPreview = new Map();
  state.strokeNeedsRebuild = false;
  state.terrainRev = (state.terrainRev || 0) + 1;
}

function pruneSynthCache(limit = 3600) {
  if (state.synthCache.size <= limit) return;
  state.synthCache = new Map();
}

function uvFromColRow(col, row) {
  for (let d2 = 2 * col - 2; d2 <= 2 * col + 2; d2++) {
    if (((row + d2) & 1) !== 0) continue;
    const u = (row + d2) >> 1;
    const v = (row - d2) >> 1;
    const check = logicalToNative(u, v);
    if (check.col === col && check.row === row) return { u, v };
  }
  return null;
}

function fitTerrainContent() {
  if (!state.stamps.length) {
    playCam();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stamp of state.stamps) {
    const radius = Math.floor(stampSizeOf(stamp.kind) / 2) * SNAP + SNAP / 2;
    minX = Math.min(minX, stamp.x - radius);
    minY = Math.min(minY, stamp.y - radius);
    maxX = Math.max(maxX, stamp.x + radius);
    maxY = Math.max(maxY, stamp.y + radius);
  }
  const width = Math.max(SNAP, maxX - minX);
  const height = Math.max(SNAP, (maxY - minY) * ISO_Y);
  const k = Math.min((view.width - 32) / width, (view.height - 32) / height);
  lookAt((minX + maxX) / 2, (minY + maxY) / 2, Math.max(0.08, Math.min(DESK_K, k)));
}

function mapRect() {
  const n = worldExtent();
  const a = worldToScreen(0, 0);
  const b = worldToScreen(n, n);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function clipMap() {
  const r = mapRect();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
}

function tileDrawSize() {
  const k = state.cam.k;
  return { tw: TILE_DW * k, th: TILE_DH * k };
}

function groupOf(kind) {
  const extra = kind && kind.charAt(0) === "@" ? kind.slice(1) : "";
  const tile = extra
    ? (state.kinds.tiles || []).find((x) => x.code === extra)
    : tileByChar(kind);
  const b = brushByPaperChar(kind);
  const typ = (tile && tile.type) || (b && b.type) || "";
  const code = extra || (tile && tile.code) || (b && b.code) || "" + typ;
  if (typ.includes("雪地") || code.includes("雪/")) return "snow";
  if (typ.includes("花") || code.includes("花")) return "flower";
  if (code.includes("水")) return "water";
  if (code.includes("砖") || code.includes("建筑地") || code.includes("石板") || code.includes("石子") || code.includes("洞窟") || code.includes("山石")) return "stone";
  if (code.includes("土地") || code.includes("沙") || code.includes("土/") || code.includes("耕地")) return "dirt";
  return "grass";
}

const GROUP_COLOR = {
  grass: "#2d6a32",
  water: "#2a6ec8",
  stone: "#d0ccc0",
  dirt: "#c4a05a",
  snow: "#e8f0f8",
  flower: "#4a9a38",
};
const GROUP_RIM = { water: "#3d7a38", stone: "#8a7a58", dirt: "#2d6a32", grass: "#245828", snow: "#a8c0d0", flower: "#2d6a32" };

function cellSize() {
  return SNAP * state.cam.k;
}

function isOverview() {
  return cellSize() < 14;
}

function mixedFlags(s) {
  const g = groupOf(s.kind);
  const other = (dx, dy) => {
    const nk = neighborKind(s.x, s.y, dx, dy);
    const ch = nk || (state.fillDefault ? baseChar() : s.kind);
    return groupOf(ch);
  };
  return {
    xp: other(SNAP, 0) !== g,
    xm: other(-SNAP, 0) !== g,
    yp: other(0, SNAP) !== g,
    ym: other(0, -SNAP) !== g,
  };
}

function anyMixed(flags) {
  return flags.xp || flags.xm || flags.yp || flags.ym;
}

function neighborKind(x, y, dx, dy) {
  const hit = state.stampAt.get(cellKey(x + dx, y + dy));
  if (hit) return hit.kind;
  return state.fillDefault ? baseChar() : null;
}

function cellsInView() {
  const pts = [
    screenToWorld(0, 0),
    screenToWorld(view.width, 0),
    screenToWorld(view.width, view.height),
    screenToWorld(0, view.height),
  ];
  let x0 = pts[0].x, x1 = pts[0].x, y0 = pts[0].y, y1 = pts[0].y;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const n = worldExtent();
  x0 = Math.max(0, snap(x0 - SNAP));
  y0 = Math.max(0, snap(y0 - SNAP));
  x1 = Math.min(n, snap(x1 + SNAP));
  y1 = Math.min(n, snap(y1 + SNAP));
  return { x0, y0, x1, y1 };
}

function tileDrawRank(tile) {
  const kinds = [...new Set(tile.corners)];
  if (isSandBase()) {
    // Grass-base never draws 0xF grass (it is the fill plane), so paved/water
    // rims sit on top. Sand-base must draw grass islands first or those same
    // diamonds cover 980204 / 980202 / slink01.
    const implicit = baseChar();
    const overlays = kinds.filter((kind) => kind !== implicit && !isGrassFamily(kind));
    if (!overlays.length) return 0;
    if (overlays.some(isWaterTerrain)) return 4;
    if (overlays.some(isSnowTerrain)) return 3;
    return 2;
  }
  if (kinds.length > 1) {
    const grass = grassChar();
    const hasGrass = kinds.some((kind) => kind === grass || isGrassFamily(kind));
    const hasPaved = kinds.some(isPavedTerrain);
    const hasSoil = kinds.some((kind) => isEarthTerrain(kind) && !isPavedTerrain(kind));
    if (kinds.every(isPavedTerrain) || (hasGrass && hasPaved && !hasSoil)) return 0;
    return 2;
  }
  if (kinds.length === 1 && kinds[0] === baseChar()) return 1;
  return 0;
}

let drawQueued = false;
const terrainScreenCache = document.createElement("canvas");
const gridScreenCache = document.createElement("canvas");
const miniStampCache = document.createElement("canvas");
const miniSrcCanvas = document.createElement("canvas");
let terrainScreenKey = "";
let gridScreenKey = "";
let miniStampKey = "";
let gridPixels = null;
let lastStatsAt = 0;

function camDrawKey() {
  return (
    (state.terrainRev || 0) +
    "|" +
    (state.mapflag || 0) +
    "|" +
    view.width +
    "x" +
    view.height +
    "|" +
    state.cam.k +
    "|" +
    Math.round(state.cam.x * 100) / 100 +
    "|" +
    Math.round(state.cam.y * 100) / 100
  );
}

function ensureBuf(canvas, w, h) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function draw() {
  drawQueued = true;
  if (draw.raf) return;
  draw.raf = requestAnimationFrame(drawNow);
}

function drawNow() {
  draw.raf = 0;
  drawQueued = false;
  try {
    paintFrame();
  } catch (err) {
    console.warn("draw failed", err);
    ctx.fillStyle = deskChrome();
    ctx.fillRect(0, 0, view.width, view.height);
  }
}

function paintFrame() {
  if (view.width < 8 || view.height < 8) return;
  const tKey = camDrawKey();
  const fillSrc = terrainTexturePath(baseChar());
  const fillIm = fillSrc ? state.images.get(fillSrc) : null;
  const terrainReady = !!(fillIm && fillIm.complete && fillIm.naturalWidth);
  const canUseCache = terrainReady && tKey === terrainScreenKey && terrainScreenCache.width === view.width;
  if (!canUseCache) {
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = deskChrome();
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.save();
    clipMap();
    ctx.fillStyle = planeBackdrop();
    ctx.fillRect(0, 0, view.width, view.height);
    drawTerrainCells();
    ctx.restore();
    if (terrainReady) {
      ensureBuf(terrainScreenCache, view.width, view.height);
      const tctx = terrainScreenCache.getContext("2d");
      tctx.clearRect(0, 0, view.width, view.height);
      tctx.drawImage(view, 0, 0);
      terrainScreenKey = tKey;
    } else {
      terrainScreenKey = "";
    }
  } else {
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(terrainScreenCache, 0, 0);
  }
  drawPaintPreview();
  ctx.save();
  clipMap();
  drawPortal();
  ctx.restore();
  if (document.getElementById("showGrid")?.checked) {
    if (tKey !== gridScreenKey || gridScreenCache.width !== view.width) {
      ensureBuf(gridScreenCache, view.width, view.height);
      const gctx = gridScreenCache.getContext("2d");
      gctx.clearRect(0, 0, view.width, view.height);
      paintGrid(gctx);
      gridScreenKey = tKey;
    }
    ctx.save();
    clipMap();
    ctx.drawImage(gridScreenCache, 0, 0);
    ctx.restore();
  }
  drawPlanOverlay();
  if (document.getElementById("showBuild")?.checked && !state.strokeNeedsRebuild) {
    const order = state.buildings
      .map((b, i) => ({ b, i }))
      .sort((a, c) => a.b.x + a.b.y - (c.b.x + c.b.y));
    for (const { b, i } of order) drawBuilding(b, i === state.selectedBld);
  }
  drawShapePreview();
  const stroking = !!state.strokeNeedsRebuild;
  if (!stroking) {
    const now = performance.now();
    if (now - lastStatsAt > 120) {
      lastStatsAt = now;
      updateStats();
    }
    drawMini();
  }
}

function drawPaintPreview() {
  const preview = state.paintPreview;
  if (!preview || !preview.size) return;
  const k = state.cam.k;
  const tw = TILE_DW * k;
  const th = TILE_DH * k;
  ctx.save();
  clipMap();
  ctx.imageSmoothingEnabled = false;
  for (const p of preview.values()) {
    const pos = logicalToNative(p.u, p.v);
    const sprite = terrainVariant(p.kind, pos.col, pos.row);
    if (!sprite) continue;
    ctx.drawImage(
      sprite,
      state.cam.x + (pos.cx - TILE_W / 2) * k,
      state.cam.y + (pos.cy - TILE_H / 2) * k,
      tw,
      th
    );
  }
  ctx.restore();
}

function diamondPath(s) {
  const cc = cellCenter(s);
  const k = state.cam.k;
  const hw = (TILE_W * k) / 2;
  const hh = (TILE_H * k) / 2;
  ctx.moveTo(cc.x, cc.y - hh);
  ctx.lineTo(cc.x + hw, cc.y);
  ctx.lineTo(cc.x, cc.y + hh);
  ctx.lineTo(cc.x - hw, cc.y);
  ctx.closePath();
}

function terrainHash(x, y, salt) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

function imageSalt(im) {
  const src = im.currentSrc || im.src || "";
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function variantHasYellow(sprite) {
  const g = sprite.getContext("2d", { willReadFrequently: true });
  const d = g.getImageData(0, 0, sprite.width, sprite.height).data;
  let yellow = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const green = d[i + 1];
    const b = d[i + 2];
    if (d[i + 3] && r > 120 && green > 100 && b < 100 && r > b + 35) yellow++;
  }
  return yellow >= 1;
}

function terrainAtlas(im) {
  const key = im.currentSrc || im.src;
  if (state.tileAtlases.has(key)) return state.tileAtlases.get(key);
  const cols = Math.max(1, Math.ceil(im.naturalWidth / TILE_W));
  const all = [];
  const byKey = new Map();
  let maxRow = 0;
  for (let index = 0; ; index++) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const sx = col * TILE_W + (row & 1 ? TILE_W / 2 : 0);
    const sy = row * (TILE_H / 2);
    if (sy + TILE_DH > im.naturalHeight) break;
    if (sx + TILE_DW > im.naturalWidth) continue;
    const variant = { sx, sy, sprite: isoTileSprite(im, sx, sy), col, row };
    all.push(variant);
    byKey.set(col + "," + row, variant);
    if (row > maxRow) maxRow = row;
  }
  if (!all.length) all.push({ sx: 0, sy: 0, sprite: isoTileSprite(im, 0, 0), col: 0, row: 0 });
  const plain = [];
  const decorated = [];
  for (const v of all) (variantHasYellow(v.sprite) ? decorated : plain).push(v);
  const atlas = {
    all,
    plain: plain.length ? plain : all,
    decorated,
    salt: imageSalt(im),
    cols,
    rowCount: maxRow + 1,
    byKey,
  };
  state.tileAtlases.set(key, atlas);
  return atlas;
}

function chooseTerrainVariant(atlas, col, row, sparseDecorations) {
  let pool = atlas.all;
  if (sparseDecorations && atlas.decorated.length) {
    const roll = nativeLinkRandom(1000, col, row);
    pool = roll % 1000 < GRASS_DECORATION_PERMILLE ? atlas.decorated : atlas.plain;
  }
  if (!pool.length) pool = atlas.all;
  if (pool.length === 1) return pool[0];
  const random = nativeLinkRandom(pool.length, col, row);
  const count = random % 64 <= 50 ? Math.max(1, Math.floor(pool.length / 2)) : pool.length;
  return pool[random % count];
}

function chooseCoherentVariant(atlas, col, row) {
  // Neighboring iso cells sample neighboring 64×16 slices so dune ridges continue.
  // Hash-picking (chooseTerrainVariant) is for noisy grass, not 170200's waves.
  const cols = atlas.cols || 1;
  const rows = atlas.rowCount || 1;
  let c = col % cols;
  if (c < 0) c += cols;
  let r = row % rows;
  if (r < 0) r += rows;
  if (atlas.byKey) {
    for (let i = 0; i < cols; i++) {
      const hit = atlas.byKey.get(((c - i + cols) % cols) + "," + r);
      if (hit) return hit;
    }
  }
  return atlas.all[0];
}

function terrainTextureScale() {
  return Math.max(0.125, state.cam.k * TERRAIN_SOURCE_SCALE);
}

function drawTerrainPlane(im, sparseDecorations) {
  if (!im || !im.complete || !im.naturalWidth) return false;
  const atlas = terrainAtlas(im);
  const k = terrainTextureScale();
  const rowStep = (TILE_H / 2) * k;
  const colStep = TILE_W * k;
  const tw = TILE_DW * k;
  const th = TILE_DH * k;
  if (rowStep < 1 || colStep < 1) return false;
  const anchorX = state.cam.x;
  const anchorY = state.cam.y;
  const row0 = Math.floor((0 - anchorY) / rowStep) - 2;
  const row1 = Math.ceil((view.height - anchorY) / rowStep) + 2;
  ctx.imageSmoothingEnabled = false;
  for (let row = row0; row <= row1; row++) {
    const cy = anchorY + row * rowStep;
    const offset = (row & 1) * (colStep / 2);
    const col0 = Math.floor((0 - anchorX - offset) / colStep) - 2;
    const col1 = Math.ceil((view.width - anchorX - offset) / colStep) + 2;
    const coherent = isSandBase() && !sparseDecorations;
    for (let col = col0; col <= col1; col++) {
      const cx = anchorX + col * colStep + offset;
      const variant = coherent
        ? chooseCoherentVariant(atlas, col, row)
        : chooseTerrainVariant(atlas, col, row, sparseDecorations);
      const ox = cx - (TILE_W / 2) * k;
      const oy = cy - (TILE_H / 2) * k;
      let dx, dy, dw, dh;
      if (coherent) {
        dx = Math.round(ox);
        dy = Math.round(oy);
        dw = Math.max(1, Math.round(ox + tw) - dx);
        dh = Math.max(1, Math.round(oy + th) - dy);
      } else {
        dx = Math.floor(ox);
        dy = Math.floor(oy);
        dw = Math.max(1, Math.ceil(tw));
        dh = Math.max(1, Math.ceil(th));
      }
      ctx.drawImage(variant.sprite, dx, dy, dw, dh);
    }
  }
  return true;
}

function drawTerrainLight() {
  if (!state.terrainEffects) return;
  const lightSrc = terrainLightSrc();
  preload(lightSrc);
  const im = state.images.get(lightSrc);
  if (!im || !im.complete || !im.naturalWidth) return;
  const k = terrainTextureScale();
  const width = im.naturalWidth * k;
  const height = im.naturalHeight * k;
  if (width < 1 || height < 1) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0,0,0," + TERRAIN_BASE_DARKEN + ")";
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = TERRAIN_LIGHT_GAIN;
  ctx.imageSmoothingEnabled = false;
  const x0 = Math.floor(-state.cam.x / width) - 1;
  const y0 = Math.floor(-state.cam.y / height) - 1;
  const x1 = Math.ceil((view.width - state.cam.x) / width) + 1;
  const y1 = Math.ceil((view.height - state.cam.y) / height) + 1;
  for (let row = y0; row <= y1; row++) {
    for (let col = x0; col <= x1; col++) {
      ctx.drawImage(
        im,
        Math.round(state.cam.x + col * width),
        Math.round(state.cam.y + row * height),
        Math.round(width),
        Math.round(height)
      );
    }
  }
  ctx.restore();
}

let terrainLayerCanvas = null;

function acquireTerrainLayer(w, h) {
  if (!terrainLayerCanvas) terrainLayerCanvas = document.createElement("canvas");
  if (terrainLayerCanvas.width !== w || terrainLayerCanvas.height !== h) {
    terrainLayerCanvas.width = w;
    terrainLayerCanvas.height = h;
  } else {
    terrainLayerCanvas.getContext("2d").clearRect(0, 0, w, h);
  }
  return terrainLayerCanvas;
}

function drawTerrainCells() {
  const fill = baseChar();
  const fillSrc = terrainTexturePath(fill);
  if (fillSrc) preload(fillSrc);
  if (state.fillDefault) {
    const fillIm = fillSrc ? state.images.get(fillSrc) : null;
    if (!drawTerrainPlane(fillIm, fill === grassChar())) {
      const r = mapRect();
      ctx.fillStyle = isSandBase() ? GROUP_COLOR.dirt : GROUP_COLOR.grass;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  const tiles = state.drawTiles && state.drawTiles.length ? state.drawTiles : state.cornerTiles.values();
  const k = state.cam.k;
  const pad = TILE_DW + TILE_DH;
  const vx0 = (0 - state.cam.x) / k - pad;
  const vy0 = (0 - state.cam.y) / k - pad;
  const vx1 = (view.width - state.cam.x) / k + pad;
  const vy1 = (view.height - state.cam.y) / k + pad;
  const jobs = [];
  for (const tile of tiles) {
    if (
      tile.corners[0] === fill &&
      tile.corners[1] === fill &&
      tile.corners[2] === fill &&
      tile.corners[3] === fill
    ) {
      continue;
    }
    const pos = nativeTilePosition(tile);
    if (pos.x + TILE_DW < vx0 || pos.y + TILE_DH < vy0 || pos.x > vx1 || pos.y > vy1) continue;
    const blit = nativeTerrainBlit(tile);
    if (!blit) continue;
    jobs.push(blit);
  }
  if (jobs.length) {
    ctx.imageSmoothingEnabled = false;
    const tw = TILE_DW * k;
    const th = TILE_DH * k;
    for (const job of jobs) {
      ctx.drawImage(job.sprite, state.cam.x + job.x * k, state.cam.y + job.y * k, tw, th);
    }
  }

  drawTerrainLight();
}

function terrainTexturePath(kind) {
  const tile = tileByChar(kind);
  if (!tile) return null;
  const tex = (isSandBase() && tile.code && SAND_TILESET[tile.code]) || tile.texture;
  return tex ? "/tiles/" + tex : null;
}

function terrainCode(kind) {
  return tileByChar(kind)?.code || "";
}

function nativeTilePosition(tile) {
  const position = logicalToNative(tile.u, tile.v);
  return {
    ...position,
    x: position.cx - TILE_W / 2,
    y: position.cy - TILE_H / 2,
  };
}

function terrainVariant(kind, col, row) {
  const src = terrainTexturePath(kind);
  if (!src) return null;
  preload(src);
  const image = state.images.get(src);
  if (!image?.complete || !image.naturalWidth) return null;
  const atlas = terrainAtlas(image);
  const coherent = isSandBase() && (kind === sandChar() || isSandKind(kind));
  return (
    coherent
      ? chooseCoherentVariant(atlas, col, row)
      : chooseTerrainVariant(atlas, col, row, kind === grassChar())
  ).sprite;
}

function isEarthTerrain(kind) {
  const code = terrainCode(kind);
  const type = tileByChar(kind)?.type || "";
  return (
    code.startsWith("土/") ||
    code.startsWith("地/") ||
    type === "耕地" ||
    type === "沙地" ||
    type === "土地" ||
    type === "砖地" ||
    type === "建筑地"
  );
}

function isPavedTerrain(kind) {
  // 砖地 / 建筑地 / 石板… — yewai.ini has no ALE between these; the desk
  // screenshot is a flat fade, not clink012's raised curb or 989802's blob.
  const code = terrainCode(kind);
  const type = tileByChar(kind)?.type || "";
  return code.startsWith("地/") || type === "砖地" || type === "建筑地";
}

function isGrassFamily(kind) {
  // 00changgui.ini: 花/绿花丛 etc. are type 草地 — grass variants, no linkall.
  const code = terrainCode(kind);
  const type = tileByChar(kind)?.type || "";
  return (
    kind === grassChar() ||
    code.startsWith("草/") ||
    code.startsWith("花/") ||
    type === "草地" ||
    type === "花丛"
  );
}

function isWaterTerrain(kind) {
  const code = terrainCode(kind);
  const type = tileByChar(kind)?.type || "";
  return code.startsWith("水/") || type === "水" || type === "水面";
}

function isSnowTerrain(kind) {
  const code = terrainCode(kind);
  const type = tileByChar(kind)?.type || "";
  return code.startsWith("雪/") || type === "雪地";
}

function isGroundTerrain(kind) {
  return isEarthTerrain(kind);
}

function isFillTerrain(kind) {
  return isEarthTerrain(kind) || isWaterTerrain(kind) || isSnowTerrain(kind) || isGrassFamily(kind);
}

function farmlandPebbleLink() {
  const grassCode = terrainCode(grassChar());
  const links = state.kinds.links || [];
  return (
    links.find((link) => link.ale === "clink014" && (link.to || []).includes(grassCode) && (link.from || []).includes("土/湿土")) ||
    links.find((link) => link.ale === "clink014" && (link.to || []).includes(grassCode)) ||
    null
  );
}

function catalogLinkFor(a, b) {
  const codeA = terrainCode(a);
  const codeB = terrainCode(b);
  if (!codeA || !codeB) return null;
  for (const link of state.kinds.links || []) {
    if ((link.from || []).includes(codeA) && (link.to || []).includes(codeB)) {
      return { link, fromKind: a, toKind: b, mode: "pebble" };
    }
    if ((link.from || []).includes(codeB) && (link.to || []).includes(codeA)) {
      return { link, fromKind: b, toKind: a, mode: "pebble" };
    }
  }
  return null;
}

function aleNamedLink(ale, fromKind, toKind) {
  const link =
    (state.kinds.links || []).find((entry) => entry.ale === ale) || { ale, from: [], to: [], file: "mask/" + ale + ".ale" };
  return { link, fromKind, toKind, mode: "pebble" };
}

function sandBaseSoftLink(fromKind, toKind) {
  return { link: null, fromKind, toKind, mode: "soft" };
}

function linkForSandBasePair(a, b) {
  // dxsj_s.cmap / 01shamo.ini — not the grass-base clink014 pebble set.
  // 980005's JPEG is dune-colored (no wlink014 green key), so copying it as a
  // shore overlay just redraws sand. Game desk water on dunes is the same
  // 989802 foggy lip as dirt/grass patches — a blue stain, not a pebble ring.
  if (isWaterTerrain(a) && isSandKind(b)) return sandBaseSoftLink(a, b);
  if (isWaterTerrain(b) && isSandKind(a)) return sandBaseSoftLink(b, a);
  if (isWaterTerrain(a) && isGrassFamily(b)) {
    return aleNamedLink(terrainCode(b).includes("青") ? "980201" : "980202", a, b);
  }
  if (isWaterTerrain(b) && isGrassFamily(a)) {
    return aleNamedLink(terrainCode(a).includes("青") ? "980201" : "980202", b, a);
  }
  if (isSandKind(a) && terrainCode(b) === "地/砖地") return aleNamedLink("980006", b, a);
  if (isSandKind(b) && terrainCode(a) === "地/砖地") return aleNamedLink("980006", a, b);
  if (isPavedTerrain(a) && isGrassFamily(b)) {
    // 01shamo lists 980204, but that JPEG has ~1% green chroma (olive plate).
    // Treating it like clink012 paints mottled sand crumbs; pure-alpha occupancy
    // loses the sunken lip. Use clink012 — same paved↔grass chroma the grass
    // desk already gets right (green→brick, tan curb copied, near-black skipped).
    return aleNamedLink("clink012", a, b);
  }
  if (isPavedTerrain(b) && isGrassFamily(a)) {
    return aleNamedLink("clink012", b, a);
  }
  if (isSnowTerrain(a) && !isSnowTerrain(b)) return aleNamedLink("slink01", a, b);
  if (isSnowTerrain(b) && !isSnowTerrain(a)) return aleNamedLink("slink01", b, a);
  if (isFillTerrain(a) && isFillTerrain(b)) {
    let fromKind = a;
    let toKind = b;
    if (isWaterTerrain(b) && !isWaterTerrain(a)) {
      fromKind = b;
      toKind = a;
    } else if (isSnowTerrain(b) && !isSnowTerrain(a) && !isWaterTerrain(a)) {
      fromKind = b;
      toKind = a;
    } else if (isSandKind(b) && !isSandKind(a)) {
      fromKind = a;
      toKind = b;
    } else if (isSandKind(a) && !isSandKind(b)) {
      fromKind = b;
      toKind = a;
    }
    return sandBaseSoftLink(fromKind, toKind);
  }
  return null;
}

function linkForTerrainPair(a, b) {
  if (!a || !b || a === b) return null;
  if (isSandBase()) return linkForSandBasePair(a, b);
  // Native linkall wins: wlink014 water↔grass, clink013 snow↔grass, slink* shores.
  const exact = catalogLinkFor(a, b);
  // clink014 is the farmland pebble ring (convex). Brick/石板 vs grass is
  // clink012 — a thin sunken lip. Never let the soil fallback paint pebbles
  // on paved ground.
  if (exact && !(isPavedTerrain(exact.fromKind) && exact.link?.ale === "clink014")) {
    return exact;
  }
  if (isPavedTerrain(a) && isGrassFamily(b)) return aleNamedLink("clink012", a, b);
  if (isPavedTerrain(b) && isGrassFamily(a)) return aleNamedLink("clink012", b, a);
  const earthLink = farmlandPebbleLink();
  // Flowers are 草地 with no linkall; dirt still gets the farmland pebble ring.
  if (earthLink && isEarthTerrain(a) && !isPavedTerrain(a) && isGrassFamily(b)) {
    return { link: earthLink, fromKind: a, toKind: b, mode: "pebble" };
  }
  if (earthLink && isEarthTerrain(b) && !isPavedTerrain(b) && isGrassFamily(a)) {
    return { link: earthLink, fromKind: b, toKind: a, mode: "pebble" };
  }
  if (isWaterTerrain(a) && isGrassFamily(b)) return aleNamedLink("wlink014", a, b);
  if (isWaterTerrain(b) && isGrassFamily(a)) return aleNamedLink("wlink014", b, a);
  if (isSnowTerrain(a) && isGrassFamily(b)) return aleNamedLink("clink013", a, b);
  if (isSnowTerrain(b) && isGrassFamily(a)) return aleNamedLink("clink013", b, a);
  // Paved↔paved has no linkall (clink012 is vs grass). 989802's organic cell
  // reads as a raised blob on two similar greys; the game is a flat fade.
  if (isPavedTerrain(a) && isPavedTerrain(b)) {
    return { link: null, fromKind: a, toKind: b, mode: "flat" };
  }
  // No ALE: 989802, same polarity as dirt↔sand (flower↔grass, snow↔dirt, water↔dirt).
  if (isFillTerrain(a) && isFillTerrain(b)) {
    let fromKind = a;
    let toKind = b;
    if (isWaterTerrain(b) && !isWaterTerrain(a)) {
      fromKind = b;
      toKind = a;
    } else if (isSnowTerrain(b) && !isSnowTerrain(a) && !isWaterTerrain(a)) {
      fromKind = b;
      toKind = a;
    }
    return { link: null, fromKind, toKind, mode: "soft" };
  }
  return null;
}

function nativeLinkRandom(count, col, row) {
  let seed = (count + col + row) >>> 0;
  for (let index = 0; index < ((row & 15) + 2); index++) {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
  }
  return (seed >>> 16) & 0x7fff;
}

function linkSlot(pattern, col, row) {
  const candidates = [];
  for (let index = 0; index < LINK_PATTERNS.length; index++) {
    if (LINK_PATTERNS[index] === pattern) candidates.push(index);
  }
  if (!candidates.length) return -1;
  if (candidates.length === 1) return candidates[0];
  const random = nativeLinkRandom(candidates.length, col, row);
  const count = random % 64 <= 50 ? Math.max(1, Math.floor(candidates.length / 2)) : candidates.length;
  return candidates[random % count];
}

function paddedAtlas(image) {
  const source = image.currentSrc || image.src || image.__padKey || "atlas";
  const key = source + "#pad32";
  if (state.linkSprites.has(key)) return state.linkSprites.get(key);
  const pad = 32;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth + pad * 2;
  canvas.height = image.naturalHeight + pad * 2;
  canvas.getContext("2d").drawImage(image, pad, pad);
  state.linkSprites.set(key, canvas);
  return canvas;
}

function cropAtlasDiamond(image, slot, keepAlpha) {
  const source = (image.currentSrc || image.src || "") + (keepAlpha ? "#a" : "#o");
  const key = `${source}#slot${slot}`;
  const cache = keepAlpha ? state.linkSprites : state.maskSlots;
  if (cache.has(key)) return cache.get(key);
  const cell = LINK_CELLS[slot];
  const row = Math.floor(cell / 3);
  const sx = 64 * (cell % 3) - (row & 1 ? 32 : 0);
  const sy = 16 * row;
  const pad = 32;
  const atlas = paddedAtlas(image);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  const g = canvas.getContext("2d");
  const out = g.createImageData(TILE_DW, TILE_DH);
  const ag = atlas.getContext("2d", { willReadFrequently: true });
  const src = ag.getImageData(0, 0, atlas.width, atlas.height).data;
  const w = atlas.width;
  const h = atlas.height;
  const ox0 = sx + pad;
  const oy0 = sy + pad;
  for (let y = 0; y < TILE_DH; y++) {
    const len = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    const ty = oy0 + y;
    if (ty < 0 || ty >= h) continue;
    for (let p = 0; p < len; p++) {
      const tx = ox0 + ox + p;
      if (tx < 0 || tx >= w) continue;
      const si = (ty * w + tx) * 4;
      const di = (y * TILE_DW + ox + p) * 4;
      out.data[di] = src[si];
      out.data[di + 1] = src[si + 1];
      out.data[di + 2] = src[si + 2];
      out.data[di + 3] = keepAlpha ? src[si + 3] : 255;
    }
  }
  g.putImageData(out, 0, 0);
  cache.set(key, canvas);
  return canvas;
}

function linkTileSprite(image, slot) {
  return cropAtlasDiamond(image, slot, true);
}

function atlasMaskWeights(src, slot) {
  const key = src + "#w#" + slot;
  if (state.maskSlots.has(key)) return state.maskSlots.get(key);
  preload(src);
  const image = state.images.get(src);
  if (!image?.complete || !image.naturalWidth) return null;
  const tile = cropAtlasDiamond(image, slot, false);
  const data = tile.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data;
  const weights = new Uint8Array(TILE_DW * TILE_DH);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Native converts mask bytes then >>= 3 → 0..31. JPEG is near-grayscale.
    weights[p] = data[i] >> 3;
  }
  state.maskSlots.set(key, weights);
  return weights;
}

function maskWeights(slot) {
  return atlasMaskWeights(MASK_SRC, slot);
}

function waterMaskWeights(slot) {
  return atlasMaskWeights(WATER_MASK_SRC, slot);
}

function readSpriteRGBA(sprite) {
  if (!sprite) return null;
  return sprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data;
}

function blendRgb565Style(aSprite, bSprite, weights) {
  // Native: copy B, then for each pixel if m>=30 take A else (A*m + B*(32-m))>>5.
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  const g = canvas.getContext("2d");
  const out = g.createImageData(TILE_DW, TILE_DH);
  const a = readSpriteRGBA(aSprite);
  const b = readSpriteRGBA(bSprite);
  if (!a || !b || !weights) {
    if (bSprite) g.drawImage(bSprite, 0, 0);
    else if (aSprite) g.drawImage(aSprite, 0, 0);
    return canvas;
  }
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const idx = y * TILE_DW + ox + p;
      const i = idx * 4;
      const m = weights[idx] | 0;
      // Native 0x51fb95: cmp 0x1e / jle blend, else copy A.
      if (m > 30) {
        out.data[i] = a[i];
        out.data[i + 1] = a[i + 1];
        out.data[i + 2] = a[i + 2];
      } else {
        const n = 32 - m;
        out.data[i] = (a[i] * m + b[i] * n) >> 5;
        out.data[i + 1] = (a[i + 1] * m + b[i + 1] * n) >> 5;
        out.data[i + 2] = (a[i + 2] * m + b[i + 2] * n) >> 5;
      }
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

function patternForKind(tile, kind) {
  let pattern = 0;
  tile.corners.forEach((corner, index) => {
    if (corner === kind) pattern |= 1 << index;
  });
  return pattern;
}

function isLinkGrassPixel(r, g, b, a) {
  return a >= 40 && g > r + 25 && g > b + 25;
}

function isoInSpan(x, y) {
  if (y < 0 || y >= TILE_DH) return false;
  const ox = ISO_SPAN.srcx[y];
  return x >= ox && x < ox + ISO_SPAN.widths[y];
}

function isoIdx(x, y) {
  return y * TILE_DW + x;
}

function solidKindCovers(tile, localX, localY, fillKind) {
  // Transparent ALE pixels that still sit inside a neighboring solid 0xF
  // diamond of fillKind stay fill, not the outside terrain.
  if (!fillKind) return false;
  const pos = nativeTilePosition(tile);
  const worldX = pos.x + localX;
  const worldY = pos.y + localY;
  const dirs = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [du, dv] of dirs) {
    const n = state.cornerTiles.get(cellKey(tile.u + du, tile.v + dv));
    if (!n) continue;
    if (n.corners[0] !== fillKind) continue;
    if (n.corners.some((c) => c !== fillKind)) continue;
    const np = nativeTilePosition(n);
    if (isoInSpan(worldX - np.x, worldY - np.y)) return true;
  }
  return false;
}

function paintLinkFarmland(dest, fromSprite, toSprite, aleSprite, cornerFrom, pattern, tile, fillKind, keepSprite) {
  // Native chroma (clink012 / clink014 / wlink014):
  //   green        -> fromKind fill
  //   opaque other -> shore / pebbles / beige curb copied from the ALE
  //   transparent  -> toKind, unless a neighboring 0xF fill diamond covers us
  // clink012's near-black outer GIF stroke is skipped so paving reads as a
  // recess (grass covers the drop-shadow pedestal), not a floating slab.
  void pattern;
  const g = dest.getContext("2d");
  const from = readSpriteRGBA(fromSprite);
  const to = readSpriteRGBA(toSprite);
  const keep = keepSprite ? readSpriteRGBA(keepSprite) : null;
  const ale = aleSprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data;
  const out = g.createImageData(TILE_DW, TILE_DH);
  if (!from || !to) {
    if (fromSprite) g.drawImage(fromSprite, 0, 0);
    else if (toSprite) g.drawImage(toSprite, 0, 0);
    return;
  }
  const cornerXY = [
    [32, 0],
    [64, 16],
    [32, 32],
    [0, 16],
  ];
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const i = isoIdx(x, y) * 4;
      const a = ale[i + 3];
      if (a < 40) {
        const src =
          tile &&
          fillKind &&
          !isWaterTerrain(fillKind) &&
          !isSnowTerrain(fillKind) &&
          !isPavedTerrain(fillKind) &&
          solidKindCovers(tile, x, y, fillKind)
            ? from
            : keep || to;
        out.data[i] = src[i];
        out.data[i + 1] = src[i + 1];
        out.data[i + 2] = src[i + 2];
        out.data[i + 3] = 255;
        continue;
      }
      if (isLinkGrassPixel(ale[i], ale[i + 1], ale[i + 2], a)) {
        let src = from;
        if (cornerFrom) {
          let best = -1;
          let bestD = 1e9;
          for (let c = 0; c < 4; c++) {
            if (!cornerFrom[c]) continue;
            const dx = x - cornerXY[c][0];
            const dy = y - cornerXY[c][1];
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = c;
            }
          }
          if (best >= 0) src = cornerFrom[best];
        }
        out.data[i] = src[i];
        out.data[i + 1] = src[i + 1];
        out.data[i + 2] = src[i + 2];
        out.data[i + 3] = 255;
        continue;
      }
      if (isPavedTerrain(fillKind) && Math.max(ale[i], ale[i + 1], ale[i + 2]) < 55) {
        const src = keep || to;
        out.data[i] = src[i];
        out.data[i + 1] = src[i + 1];
        out.data[i + 2] = src[i + 2];
        out.data[i + 3] = 255;
        continue;
      }
      out.data[i] = ale[i];
      out.data[i + 1] = ale[i + 1];
      out.data[i + 2] = ale[i + 2];
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function paintDesertJpegOccupancy(dest, fillSprite, keepSprite, aleSprite, tile, fillKind) {
  // 01shamo 980204/980202 are JPEG occupancy plates (almost no green chroma).
  // Native desk look for paved-in-grass: fill shape from alpha, grass outside.
  // Do NOT copy ALE RGB — JPEG edge darkening and mottled tan read as crumbs
  // / a scalloped black rim (the debris the editor has been painting).
  const g = dest.getContext("2d");
  const fill = readSpriteRGBA(fillSprite);
  const grass = readSpriteRGBA(keepSprite);
  const ale = aleSprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data;
  const out = g.createImageData(TILE_DW, TILE_DH);
  if (!fill || !grass) {
    if (fillSprite) g.drawImage(fillSprite, 0, 0);
    else if (keepSprite) g.drawImage(keepSprite, 0, 0);
    return;
  }
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const i = isoIdx(x, y) * 4;
      const a = ale[i + 3];
      const occupied = a >= 40 && Math.max(ale[i], ale[i + 1], ale[i + 2]) >= 40;
      const covered = tile && fillKind && solidKindCovers(tile, x, y, fillKind);
      const src = occupied || covered ? fill : grass;
      out.data[i] = src[i];
      out.data[i + 1] = src[i + 1];
      out.data[i + 2] = src[i + 2];
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function paintLinkPavedGrassOnSand(dest, fromSprite, toSprite, aleSprite, keepSprite, tile, fillKind) {
  paintDesertJpegOccupancy(dest, fromSprite, keepSprite || toSprite, aleSprite, tile, fillKind);
}

function isSnowChromaPixel(r, g, b, a) {
  // clink013's fill key is the same saturated green as clink014.
  // Semi-transparent leftovers are the GIF grass-blade cutout, not snow.
  return a >= 160 && g > r + 25 && g > b + 25;
}

function snowAleUsesGreenChroma(ale) {
  // clink013 ≈ 89% green key. slink01 (01shamo snow↔sand/grass) is a
  // white-blue plate with soft alpha and ~0% green — chroma mode paints
  // nothing and leaves a hard 0xF snow diamond.
  let green = 0;
  let opaque = 0;
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const i = isoIdx(ox + p, y) * 4;
      if (ale[i + 3] < 40) continue;
      opaque++;
      if (isSnowChromaPixel(ale[i], ale[i + 1], ale[i + 2], ale[i + 3])) green++;
    }
  }
  return opaque > 0 && green * 5 >= opaque;
}

function paintLinkSnow(dest, fromSprite, toSprite, aleSprite, keepSprite) {
  // Grass-base clink013: opaque green → snow texture, else outside (grass tufts).
  // Sand-base slink01: white-blue plate with alpha ramp — soft-blend snow into
  // sand/grass. Treating slink01 as chroma erases the fill and kills diffusion.
  const g = dest.getContext("2d");
  const from = readSpriteRGBA(fromSprite);
  const to = readSpriteRGBA(keepSprite || toSprite);
  const ale = aleSprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data;
  const out = g.createImageData(TILE_DW, TILE_DH);
  if (!from || !to) {
    if (fromSprite) g.drawImage(fromSprite, 0, 0);
    else if (toSprite) g.drawImage(toSprite, 0, 0);
    return;
  }
  const chroma = snowAleUsesGreenChroma(ale);
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const i = isoIdx(x, y) * 4;
      if (chroma) {
        const src = isSnowChromaPixel(ale[i], ale[i + 1], ale[i + 2], ale[i + 3]) ? from : to;
        out.data[i] = src[i];
        out.data[i + 1] = src[i + 1];
        out.data[i + 2] = src[i + 2];
      } else {
        const a = ale[i + 3];
        if (a < 24) {
          out.data[i] = to[i];
          out.data[i + 1] = to[i + 1];
          out.data[i + 2] = to[i + 2];
        } else if (a >= 220) {
          out.data[i] = from[i];
          out.data[i + 1] = from[i + 1];
          out.data[i + 2] = from[i + 2];
        } else {
          // Soft diffusion: lerp snow texture with outside by ALE alpha.
          const t = a;
          const n = 255 - t;
          out.data[i] = ((from[i] * t + to[i] * n) / 255) | 0;
          out.data[i + 1] = ((from[i + 1] * t + to[i + 1] * n) / 255) | 0;
          out.data[i + 2] = ((from[i + 2] * t + to[i + 2] * n) / 255) | 0;
        }
      }
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function paintLinkWaterOnSand(dest, fromSprite, toSprite, aleSprite, weights) {
  // dxsj_s / 980005: the JPEG plate is dune-colored, so copying RGB as a
  // "shore overlay" (wlink014 logic) just redraws sand and leaves 189800's
  // hard diamond. Native is a foggy blue lip into the dunes.
  const g = dest.getContext("2d");
  const water = readSpriteRGBA(fromSprite);
  const sand = readSpriteRGBA(toSprite);
  const ale = aleSprite
    ? aleSprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data
    : null;
  const out = g.createImageData(TILE_DW, TILE_DH);
  if (!water || !sand) {
    if (fromSprite) g.drawImage(fromSprite, 0, 0);
    else if (toSprite) g.drawImage(toSprite, 0, 0);
    return;
  }
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const idx = y * TILE_DW + x;
      const i = idx * 4;
      let m = weights ? weights[idx] | 0 : 31;
      if (ale && ale[i + 3] < 40) m = 31;
      if (m >= 31) {
        out.data[i] = sand[i];
        out.data[i + 1] = sand[i + 1];
        out.data[i + 2] = sand[i + 2];
      } else if (m <= 0) {
        out.data[i] = water[i];
        out.data[i + 1] = water[i + 1];
        out.data[i + 2] = water[i + 2];
      } else {
        const n = 32 - m;
        out.data[i] = (sand[i] * m + water[i] * n) >> 5;
        out.data[i + 1] = (sand[i + 1] * m + water[i + 1] * n) >> 5;
        out.data[i + 2] = (sand[i + 2] * m + water[i + 2] * n) >> 5;
      }
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function paintLinkWater(dest, fromSprite, toSprite, aleSprite, weights, keepSprite, copyAleShore) {
  // Occupancy is 189800, hard cut (blend against snow/sand is the foggy shore).
  // Opaque non-green ALE is the shore: wlink sand, slink02 ice, slink015 dirt.
  // 01shamo 980201/980202 are olive JPEG plates (0.2% pass isLinkGrassPixel).
  // Copying non-green as shore pastes that plate as a dark rocky ring — use
  // paintLinkWaterOnDesertGrass instead.
  if (copyAleShore == null) copyAleShore = true;
  const g = dest.getContext("2d");
  const from = readSpriteRGBA(fromSprite);
  const outside = readSpriteRGBA(keepSprite || toSprite);
  const ale = aleSprite
    ? aleSprite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_DW, TILE_DH).data
    : null;
  const out = g.createImageData(TILE_DW, TILE_DH);
  if (!from || !outside) {
    if (fromSprite) g.drawImage(fromSprite, 0, 0);
    else if (toSprite) g.drawImage(toSprite, 0, 0);
    return;
  }
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const idx = y * TILE_DW + x;
      const i = idx * 4;
      if (copyAleShore && ale) {
        const a = ale[i + 3];
        if (a >= 40 && !isLinkGrassPixel(ale[i], ale[i + 1], ale[i + 2], a)) {
          out.data[i] = ale[i];
          out.data[i + 1] = ale[i + 1];
          out.data[i + 2] = ale[i + 2];
          out.data[i + 3] = 255;
          continue;
        }
      }
      const src = weights && weights[idx] <= 24 ? from : outside;
      out.data[i] = src[i];
      out.data[i + 1] = src[i + 1];
      out.data[i + 2] = src[i + 2];
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function paintLinkWaterOnDesertGrass(dest, fromSprite, toSprite, aleSprite, weights, keepSprite, tile, fillKind) {
  void weights;
  if (!aleSprite) {
    const g = dest.getContext("2d");
    if (fromSprite) g.drawImage(fromSprite, 0, 0);
    else if (toSprite) g.drawImage(toSprite, 0, 0);
    return;
  }
  paintDesertJpegOccupancy(dest, fromSprite, keepSprite || toSprite, aleSprite, tile, fillKind);
}

function paintHardMask(dest, fillSprite, keepSprite, weights) {
  const g = dest.getContext("2d");
  const fill = readSpriteRGBA(fillSprite);
  const keep = readSpriteRGBA(keepSprite);
  if (!fill || !keep || !weights) return;
  const out = g.createImageData(TILE_DW, TILE_DH);
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const idx = y * TILE_DW + x;
      const i = idx * 4;
      const src = weights[idx] > 24 ? keep : fill;
      out.data[i] = src[i];
      out.data[i + 1] = src[i + 1];
      out.data[i + 2] = src[i + 2];
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

function copySprite(sprite) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  canvas.getContext("2d").drawImage(sprite, 0, 0);
  return canvas;
}

function fillDrawRank(kind) {
  if (isWaterTerrain(kind)) return 3;
  if (isSnowTerrain(kind)) return 2;
  if (isEarthTerrain(kind)) return 1;
  return 0;
}

function loadLinkSprite(ale, slot) {
  if (!ale || slot < 0) return null;
  const url = `/ale-atlas/${ale}.png`;
  preload(url);
  const image = state.images.get(url);
  if (!image?.complete || !image.naturalWidth) return null;
  return linkTileSprite(image, slot);
}

function stampFillOnto(canvas, tile, kind, other, col, row) {
  const pattern = patternForKind(tile, kind);
  if (!pattern) return;
  const fromSprite = terrainVariant(kind, col, row);
  const toSprite = terrainVariant(other, col, row);
  if (!fromSprite || !toSprite) return;
  const relation = linkForTerrainPair(kind, other);
  const slot = linkSlot(pattern, col, row);

  if (isWaterTerrain(kind)) {
    preload(WATER_MASK_SRC);
    const weights = slot >= 0 ? waterMaskWeights(slot) : null;
    const ale =
      relation?.link?.ale ||
      (isGrassFamily(other) ? (isSandBase() ? "980202" : "wlink014") : isSnowTerrain(other) ? "slink02" : null);
    const aleSprite = loadLinkSprite(ale, slot);
    if (isSandBase() && isSandKind(other)) {
      paintLinkWaterOnSand(canvas, fromSprite, toSprite, aleSprite, weights);
    } else if (isSandBase() && isGrassFamily(other)) {
      paintLinkWaterOnDesertGrass(canvas, fromSprite, toSprite, aleSprite, weights, canvas, tile, kind);
    } else {
      paintLinkWater(canvas, fromSprite, toSprite, aleSprite, weights, canvas);
    }
    return;
  }

  if (isSnowTerrain(kind) && relation?.link?.ale && slot >= 0) {
    const aleSprite = loadLinkSprite(relation.link.ale, slot);
    if (aleSprite) {
      paintLinkSnow(canvas, fromSprite, toSprite, aleSprite, canvas);
      return;
    }
  }

  if (isSnowTerrain(kind) || isWaterTerrain(kind)) {
    preload(MASK_SRC);
    const weights = slot >= 0 ? maskWeights(slot) : null;
    if (weights) paintHardMask(canvas, fromSprite, canvas, weights);
    return;
  }

  if (relation?.mode === "soft") {
    if (pattern === 0xf) {
      canvas.getContext("2d").drawImage(fromSprite, 0, 0);
      return;
    }
    preload(MASK_SRC);
    const weights = slot >= 0 ? maskWeights(slot) : null;
    if (weights) {
      const blended = blendRgb565Style(toSprite, fromSprite, weights);
      if (blended) canvas.getContext("2d").drawImage(blended, 0, 0);
    }
    return;
  }

  if (relation?.mode === "pebble" && relation.link?.ale && slot >= 0) {
    const aleSprite = loadLinkSprite(relation.link.ale, slot);
    if (aleSprite) {
      paintLinkFarmland(canvas, fromSprite, toSprite, aleSprite, null, pattern, tile, kind, canvas);
    }
  }
}

function layerUnderKind(kind, fills, implicit, hasImplicit, baseKind) {
  if (isWaterTerrain(kind) && fills.some(isSnowTerrain)) return fills.find(isSnowTerrain);
  // Sand-base grass is a fill, not the plane. Paved/water/snow stamped into
  // that grass must link against grass (980204 / 980202 / slink01), not sand.
  if (isSandBase() && !isGrassFamily(kind)) {
    const grass = fills.find(isGrassFamily);
    if (grass) return grass;
  }
  if (hasImplicit) return implicit;
  return fills.find((entry) => entry !== kind) || baseKind;
}

function synthesizeLayeredTile(tile, col, row) {
  const implicit = baseChar();
  const kinds = [...new Set(tile.corners)];
  const fills = kinds
    .filter((kind) => kind !== implicit)
    .sort((a, b) => fillDrawRank(a) - fillDrawRank(b) || String(a).localeCompare(String(b)));
  if (!fills.length) return terrainVariant(implicit, col, row);
  const hasImplicit = kinds.includes(implicit);
  const baseKind = hasImplicit ? implicit : fills[0];
  const base = terrainVariant(baseKind, col, row);
  if (!base) return null;
  const canvas = copySprite(base);
  for (let i = hasImplicit ? 0 : 1; i < fills.length; i++) {
    const kind = fills[i];
    stampFillOnto(canvas, tile, kind, layerUnderKind(kind, fills, implicit, hasImplicit, baseKind), col, row);
  }
  return canvas;
}

function softBlendLinkTile(tile, relation, col, row) {
  // Ground↔ground uses imported 989802 weights (0x521390: byte >> 3).
  // Measured vs LINK_PATTERNS: every cell is dark on the patterned (fromKind)
  // corners and bright on the opposite corners. Native 0x51faf0 copies B, then
  // replaces with A when m > 30. High m is therefore toKind, not fromKind —
  // inverting the mask paints a hollow ring (dirt frame, sand center).
  const fromSprite = terrainVariant(relation.fromKind, col, row);
  const toSprite = terrainVariant(relation.toKind, col, row);
  const pattern = patternForKind(tile, relation.fromKind);
  if (!pattern) return toSprite || fromSprite;
  if (pattern === 0xf) return fromSprite || toSprite;
  if (!fromSprite || !toSprite) return fromSprite || toSprite;
  const slot = linkSlot(pattern, col, row);
  if (slot < 0) return fromSprite;
  preload(MASK_SRC);
  const weights = maskWeights(slot);
  if (!weights) return null;
  return blendRgb565Style(toSprite, fromSprite, weights);
}

function softBlendDistanceTile(tile, col, row) {
  const cornerXY = [
    [32, 0],
    [64, 16],
    [32, 32],
    [0, 16],
  ];
  const implicit = baseChar();
  const sprites = tile.corners.map((kind) => {
    if (kind === implicit) return null;
    return readSpriteRGBA(terrainVariant(kind, col, row));
  });
  if (sprites.every((s) => !s)) return null;
  const fallback = sprites.find((s) => s) || readSpriteRGBA(terrainVariant(dominantTerrainKind(tile), col, row));
  if (!fallback) return null;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  const g = canvas.getContext("2d");
  const out = g.createImageData(TILE_DW, TILE_DH);
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const i = (y * TILE_DW + x) * 4;
      let best = -1;
      let bestD = 1e9;
      let second = -1;
      let secondD = 1e9;
      for (let c = 0; c < 4; c++) {
        if (!sprites[c]) continue;
        const dx = x - cornerXY[c][0];
        const dy = y - cornerXY[c][1];
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          second = best;
          secondD = bestD;
          best = c;
          bestD = d;
        } else if (d < secondD) {
          second = c;
          secondD = d;
        }
      }
      if (best < 0) {
        out.data[i] = fallback[i];
        out.data[i + 1] = fallback[i + 1];
        out.data[i + 2] = fallback[i + 2];
        out.data[i + 3] = 255;
        continue;
      }
      const a = sprites[best];
      if (second < 0 || tile.corners[best] === tile.corners[second] || !sprites[second]) {
        out.data[i] = a[i];
        out.data[i + 1] = a[i + 1];
        out.data[i + 2] = a[i + 2];
      } else {
        const b = sprites[second];
        const denom = bestD + secondD || 1;
        const m = Math.max(0, Math.min(32, Math.round((32 * secondD) / denom)));
        const n = 32 - m;
        out.data[i] = (a[i] * m + b[i] * n) >> 5;
        out.data[i + 1] = (a[i + 1] * m + b[i + 1] * n) >> 5;
        out.data[i + 2] = (a[i + 2] * m + b[i + 2] * n) >> 5;
      }
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

function synthesizedLinkTile(tile, relation, col, row) {
  if (relation.mode === "flat") {
    return softBlendDistanceTile(tile, col, row);
  }
  if (relation.mode === "soft") {
    return softBlendLinkTile(tile, relation, col, row);
  }
  const implicit = baseChar();
  let pattern = patternForKind(tile, relation.fromKind);
  let cornerFrom = null;
  if (tile.corners.includes(implicit)) {
    pattern = 0;
    const sprites = [];
    let mixedInside = false;
    tile.corners.forEach((kind, index) => {
      if (kind === implicit) {
        sprites[index] = null;
        return;
      }
      pattern |= 1 << index;
      sprites[index] = readSpriteRGBA(terrainVariant(kind, col, row));
      if (kind !== relation.fromKind) mixedInside = true;
    });
    if (mixedInside) cornerFrom = sprites;
  }
  const fromSprite = terrainVariant(relation.fromKind, col, row);
  const toSprite = terrainVariant(relation.toKind, col, row);
  const waterLink = isWaterTerrain(relation.fromKind);
  const snowLink = isSnowTerrain(relation.fromKind);
  const fallback = waterLink || snowLink ? toSprite || fromSprite : fromSprite || toSprite;
  if (!pattern) return fallback;
  if (pattern === 0xf && !cornerFrom) return fromSprite || toSprite;
  const slot = linkSlot(pattern, col, row);
  if (slot < 0) return fallback;
  if (!relation.link?.ale) return fallback;
  const url = `/ale-atlas/${relation.link.ale}.png`;
  preload(url);
  const image = state.images.get(url);
  // Missing ALE: farmland keeps fill so plots don't flash grass holes.
  // Water must not: a raw 0xF water diamond is the unmasked shard past the shore.
  if (!fromSprite || !toSprite || !image?.complete || !image.naturalWidth) {
    return fallback;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  if (waterLink) {
    preload(WATER_MASK_SRC);
    const weights = waterMaskWeights(slot);
    if (!weights) return fallback;
    const aleSprite = linkTileSprite(image, slot);
    if (isSandBase() && isSandKind(relation.toKind)) {
      paintLinkWaterOnSand(canvas, fromSprite, toSprite, aleSprite, weights);
    } else if (isSandBase() && isGrassFamily(relation.toKind)) {
      paintLinkWaterOnDesertGrass(canvas, fromSprite, toSprite, aleSprite, weights, null, tile, relation.fromKind);
    } else {
      paintLinkWater(canvas, fromSprite, toSprite, aleSprite, weights);
    }
    return canvas;
  }
  if (isSnowTerrain(relation.fromKind)) {
    paintLinkSnow(canvas, fromSprite, toSprite, linkTileSprite(image, slot));
    return canvas;
  }
  const aleSprite = linkTileSprite(image, slot);
  paintLinkFarmland(canvas, fromSprite, toSprite, aleSprite, cornerFrom, pattern, tile, relation.fromKind);
  return canvas;
}

function pickPairRoles(a, b) {
  const relation = linkForTerrainPair(a, b);
  if (relation) return { a, b, relation };
  const reverse = linkForTerrainPair(b, a);
  if (reverse) return { a: b, b: a, relation: reverse };
  return { a, b, relation: null };
}

function rankedKinds(tile) {
  const counts = new Map();
  for (const kind of tile.corners) counts.set(kind, (counts.get(kind) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function linkRelationForTile(tile) {
  const kinds = [...new Set(tile.corners)];
  if (kinds.length <= 1) return null;
  const implicit = baseChar();
  if (kinds.includes(implicit)) {
    const fromKind = rankedKinds(tile).find((entry) => entry[0] !== implicit)[0];
    const relation = linkForTerrainPair(fromKind, implicit);
    return relation ? { ...relation, fromKind, toKind: implicit } : null;
  }
  if (kinds.length === 2) return pickPairRoles(kinds[0], kinds[1]).relation;
  const ranked = rankedKinds(tile);
  return linkForTerrainPair(ranked[0][0], ranked[1][0]);
}

function synthesizeTwoWay(tile, col, row) {
  const kinds = [...new Set(tile.corners)];
  const implicit = baseChar();
  const fills = kinds.filter((kind) => kind !== implicit);
  const snowy = fills.some(isSnowTerrain);
  const watery = fills.some(isWaterTerrain);
  const waterOnlyOnSand =
    isSandBase() && watery && !snowy && fills.every((kind) => isWaterTerrain(kind) || isSandKind(kind));
  if ((watery || snowy) && !waterOnlyOnSand) {
    return synthesizeLayeredTile(tile, col, row);
  }
  const relation = linkRelationForTile(tile);
  if (!relation) {
    const ranked = rankedKinds(tile);
    return terrainVariant(ranked[0][0], col, row);
  }
  return synthesizedLinkTile(tile, relation, col, row);
}

const NEIGHBOR_EDGE_BITS = [
  { du: 0, dv: -1, bits: 0x3 },
  { du: 0, dv: 1, bits: 0xc },
  { du: -1, dv: 0, bits: 0x9 },
  { du: 1, dv: 0, bits: 0x6 },
  { du: -1, dv: -1, bits: 0x1 },
  { du: 1, dv: 1, bits: 0x4 },
  { du: 1, dv: -1, bits: 0x2 },
  { du: -1, dv: 1, bits: 0x8 },
];

function isSolidKind(tile, kind) {
  return tile && tile.corners.every((c) => c === kind);
}

function displayCorners(tile) {
  // Stamp replay already mixed most seams (0x4C2C40 writes edge bits onto
  // neighbors). When a later 0xF wipe leaves two solid grounds abutting,
  // restore those edge bits for drawing only. If every corner would flip,
  // this cell is a stamp interior — keep it solid so the center does not
  // become a hollow hole.
  const implicit = baseChar();
  const self = tile.corners[0];
  // Grass-base: grass is the implicit plane — never invent mixed edges with it.
  // Sand-base: grass is a stamped fill. Paved/dirt/water abutting solid grass
  // must regain edge bits or 980204 / soft fringes never appear (dark crescent).
  if (
    !isSolidKind(tile, self) ||
    self === implicit ||
    !isFillTerrain(self) ||
    (isGrassFamily(self) && !isSandBase())
  ) {
    return tile.corners;
  }
  const corners = tile.corners.slice();
  for (const { du, dv, bits } of NEIGHBOR_EDGE_BITS) {
    const n = state.cornerTiles.get(cellKey(tile.u + du, tile.v + dv));
    if (!n) continue;
    const nk = n.corners[0];
    if (nk === self || nk === implicit) continue;
    if (isGrassFamily(nk) && !isSandBase()) continue;
    if (!isFillTerrain(nk) || !isSolidKind(n, nk)) continue;
    for (let c = 0; c < 4; c++) {
      if (bits & (1 << c)) corners[c] = nk;
    }
  }
  const selfBits = patternForKind({ corners }, self);
  if (!selfBits || selfBits === 0xf) return tile.corners;
  return corners;
}

function clipSolidFillAgainstShores(tile, sprite, fillKind) {
  // 0xF water diamonds overlap mixed shore cells. Those tips are the
  // unmasked blue shards past the sand ring. Native draws the wlink cell
  // on top; we drop 0xF pixels that already sit inside a non-solid neighbor.
  //
  // Sand-base: grass/paved/dirt are real drawn fills (not the implicit plane).
  // Their solid diamonds cover 989802 / 980204 mixed cells the same way —
  // grass soft fringe dies, paved recess collapses to a dark crescent.
  if (
    !sprite ||
    !isSolidKind(tile, fillKind) ||
    !(
      isWaterTerrain(fillKind) ||
      isSnowTerrain(fillKind) ||
      (isSandBase() &&
        (isGrassFamily(fillKind) ||
          isPavedTerrain(fillKind) ||
          (isEarthTerrain(fillKind) && !isSandKind(fillKind))))
    )
  ) {
    return sprite;
  }
  const src = readSpriteRGBA(sprite);
  if (!src) return sprite;
  const pos = nativeTilePosition(tile);
  const others = [];
  for (const { du, dv } of NEIGHBOR_EDGE_BITS) {
    const n = state.cornerTiles.get(cellKey(tile.u + du, tile.v + dv));
    if (n && n.corners.every((kind) => kind === fillKind)) continue;
    others.push(
      n
        ? nativeTilePosition(n)
        : nativeTilePosition({ u: tile.u + du, v: tile.v + dv })
    );
  }
  if (!others.length) return sprite;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_DW;
  canvas.height = TILE_DH;
  const g = canvas.getContext("2d");
  const out = g.createImageData(TILE_DW, TILE_DH);
  for (let y = 0; y < TILE_DH; y++) {
    const width = ISO_SPAN.widths[y];
    const ox = ISO_SPAN.srcx[y];
    for (let p = 0; p < width; p++) {
      const x = ox + p;
      const i = isoIdx(x, y) * 4;
      const wx = pos.x + x;
      const wy = pos.y + y;
      let hide = false;
      for (let n = 0; n < others.length; n++) {
        if (isoInSpan(wx - others[n].x, wy - others[n].y)) {
          hide = true;
          break;
        }
      }
      if (hide) continue;
      out.data[i] = src[i];
      out.data[i + 1] = src[i + 1];
      out.data[i + 2] = src[i + 2];
      out.data[i + 3] = src[i + 3];
    }
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

function compositeOntoSand(innerSprite, tile, col, row) {
  // Dirt-on-grass: 989802 occupancy of the fill, A=grass plane, B=fill.
  // Grass-on-sand is the same with A=sand plane, B=the grass-base composite.
  const sandSprite = terrainVariant(sandChar(), col, row);
  if (!innerSprite) return sandSprite;
  if (!sandSprite) return innerSprite;
  let pattern = 0;
  tile.corners.forEach((kind, index) => {
    if (kind !== sandChar()) pattern |= 1 << index;
  });
  if (!pattern) return sandSprite;
  if (pattern === 0xf) return innerSprite;
  const slot = linkSlot(pattern, col, row);
  if (slot < 0) return innerSprite;
  preload(MASK_SRC);
  const weights = maskWeights(slot);
  if (!weights) return innerSprite;
  return blendRgb565Style(sandSprite, innerSprite, weights);
}

function synthesizeOnSandPlane(tile, col, row) {
  // Grass-base: implicit grass plane + 2-way overlays (wlink014 / clink012).
  // Sand-base: implicit sand plane. If a cell also has grass, rewrite sand
  // corners to that grass and run the same overlay synthesis, then sit the
  // result on sand with 989802. Never 3-way-link water/paved against sand
  // while grass is in the cell.
  const kinds = [...new Set(tile.corners)];
  if (kinds.length === 1) {
    const sprite = terrainVariant(kinds[0], col, row);
    return clipSolidFillAgainstShores(tile, sprite, kinds[0]);
  }
  const sand = sandChar();
  const grassKind = tile.corners.find(isGrassFamily);
  if (grassKind && kinds.includes(sand)) {
    const inner = {
      u: tile.u,
      v: tile.v,
      corners: tile.corners.map((kind) => (kind === sand ? grassKind : kind)),
    };
    const innerKinds = [...new Set(inner.corners)];
    const innerSprite =
      innerKinds.length === 1
        ? terrainVariant(innerKinds[0], col, row)
        : synthesizeTwoWay(inner, col, row);
    return compositeOntoSand(innerSprite, tile, col, row);
  }
  return synthesizeTwoWay(tile, col, row);
}

function synthesizeTerrainTile(tile, col, row) {
  const corners = displayCorners(tile);
  const view = corners === tile.corners ? tile : { u: tile.u, v: tile.v, corners };
  if (isSandBase()) return synthesizeOnSandPlane(view, col, row);
  const kinds = [...new Set(corners)];
  if (kinds.length === 1) {
    const sprite = terrainVariant(kinds[0], col, row);
    return clipSolidFillAgainstShores(tile, sprite, kinds[0]);
  }
  return synthesizeTwoWay(view, col, row);
}

function groundMaskReady() {
  preload(MASK_SRC);
  const mask = state.images.get(MASK_SRC);
  return !!(mask && mask.complete && mask.naturalWidth);
}

function waterMaskReady() {
  preload(WATER_MASK_SRC);
  const mask = state.images.get(WATER_MASK_SRC);
  return !!(mask && mask.complete && mask.naturalWidth);
}

function synthesisReady(tile) {
  const corners = displayCorners(tile);
  const kinds = [...new Set(corners)];
  if (kinds.length <= 1) return true;
  if (isSandBase()) {
    const sand = sandChar();
    const grassKind = corners.find(isGrassFamily);
    if (grassKind && kinds.includes(sand)) {
      if (!groundMaskReady() || !terrainVariant(sand, 0, 0) || !terrainVariant(grassKind, 0, 0)) return false;
      const innerCorners = corners.map((kind) => (kind === sand ? grassKind : kind));
      if ([...new Set(innerCorners)].length <= 1) return true;
      return synthesisReady({ u: tile.u, v: tile.v, corners: innerCorners });
    }
  }
  const implicit = baseChar();
  const fills = kinds.filter((kind) => kind !== implicit);
  const snowy = fills.some(isSnowTerrain);
  const watery = fills.some(isWaterTerrain);
  const waterOnlyOnSand =
    isSandBase() && watery && !snowy && fills.every((kind) => isWaterTerrain(kind) || isSandKind(kind));
  if ((watery || snowy) && !waterOnlyOnSand) {
    const ranked = fills
      .slice()
      .sort((a, b) => fillDrawRank(a) - fillDrawRank(b) || String(a).localeCompare(String(b)));
    const hasImplicit = kinds.includes(implicit);
    const baseKind = hasImplicit ? implicit : ranked[0];
    if (!terrainVariant(baseKind, 0, 0)) return false;
    for (let i = hasImplicit ? 0 : 1; i < ranked.length; i++) {
      const kind = ranked[i];
      if (!terrainVariant(kind, 0, 0)) return false;
      const other = layerUnderKind(kind, ranked, implicit, hasImplicit, baseKind);
      const relation = linkForTerrainPair(kind, other);
      if (!relation) continue;
      if (relation.mode === "soft" && !groundMaskReady()) return false;
      if (isWaterTerrain(kind) && !waterMaskReady()) return false;
      if (relation.link?.ale) {
        const url = `/ale-atlas/${relation.link.ale}.png`;
        preload(url);
        const image = state.images.get(url);
        if (!(image && image.complete && image.naturalWidth)) return false;
      }
    }
    return true;
  }
  const relation = linkRelationForTile({ u: tile.u, v: tile.v, corners });
  if (!relation) return true;
  if (relation.mode === "soft" || relation.mode === "flat") {
    return (relation.mode === "flat" || groundMaskReady()) && kinds.every((kind) => !!terrainVariant(kind, 0, 0));
  }
  if (isWaterTerrain(relation.fromKind) && !waterMaskReady()) return false;
  if (!relation.link?.ale) return true;
  const url = `/ale-atlas/${relation.link.ale}.png`;
  preload(url);
  const image = state.images.get(url);
  return !!(image && image.complete && image.naturalWidth);
}

function dominantTerrainKind(tile) {
  const ranked = rankedKinds(tile);
  const implicit = baseChar();
  return (ranked.find((entry) => entry[0] !== implicit) || ranked[0])[0];
}

function nativeTerrainBlit(tile) {
  const kinds = [...new Set(tile.corners)];
  const position = nativeTilePosition(tile);
  let sprite = cachedTerrainSprite(tile);
  // While ALE/mask is loading, still paint the dominant texture so large plots
  // never flash grass holes.
  if (!sprite) {
    sprite = terrainVariant(dominantTerrainKind(tile), position.col, position.row);
  }
  if (!sprite) return null;
  return { sprite, x: position.x, y: position.y };
}

function cachedTerrainSprite(tile) {
  const position = logicalToNative(tile.u, tile.v);
  const corners = displayCorners(tile);
  let key = (state.mapflag || 0) + ":" + corners.join("") + "@" + position.col + "," + position.row;
  const self = tile.corners[0];
  if (
    isSolidKind(tile, self) &&
    (isWaterTerrain(self) ||
      isSnowTerrain(self) ||
      (isSandBase() &&
        (isGrassFamily(self) ||
          isPavedTerrain(self) ||
          (isEarthTerrain(self) && !isSandKind(self)))))
  ) {
    for (const { du, dv } of NEIGHBOR_EDGE_BITS) {
      const n = state.cornerTiles.get(cellKey(tile.u + du, tile.v + dv));
      key += n && n.corners.every((kind) => kind === self) ? "w" : "s";
    }
  }
  if (state.synthCache.has(key)) return state.synthCache.get(key);
  const sprite = synthesizeTerrainTile(tile, position.col, position.row);
  if (sprite && synthesisReady(tile)) state.synthCache.set(key, sprite);
  return sprite;
}

function tileTexPath(kind) {
  if (kind && kind.charAt(0) === "@") {
    const code = kind.slice(1);
    const t = (state.kinds.tiles || []).find((x) => x.code === code);
    const tex = (isSandBase() && t?.code && SAND_TILESET[t.code]) || t?.texture;
    return tex ? "/tiles/" + tex : null;
  }
  return terrainTexturePath(kind);
}

function drawCellTexture(s) {
  const cc = cellCenter(s);
  const k = state.cam.k;
  const { tw, th } = tileDrawSize();
  const src = tileTexPath(s.kind);
  if (src) preload(src);
  const im = src ? state.images.get(src) : null;
  if (im && im.complete && im.naturalWidth) {
    ctx.imageSmoothingEnabled = false;
    const spr = isoTileSprite(im, 0, 0);
    ctx.drawImage(
      spr,
      Math.round(cc.x - 32 * k),
      Math.round(cc.y - 16 * k),
      Math.round(tw),
      Math.round(th)
    );
    return;
  }
  fillDiamond(cc.x, cc.y, TILE_W * k, TILE_H * k, GROUP_COLOR[groupOf(s.kind)] || "#888");
  const tile = brushByPaperChar(s.kind) || tileByChar(s.kind);
  if (!tile) state.unknown.add(s.kind);
}

function otherKindAt(s) {
  const g = groupOf(s.kind);
  const dirs = [
    [SNAP, 0],
    [-SNAP, 0],
    [0, SNAP],
    [0, -SNAP],
  ];
  for (const [dx, dy] of dirs) {
    const nk = neighborKind(s.x, s.y, dx, dy);
    const ch = nk || (state.fillDefault ? baseChar() : s.kind);
    if (groupOf(ch) !== g) return ch;
  }
  return null;
}

function drawCellLink(s) {
  const g = groupOf(s.kind);
  if (g === "grass") return;
  const flags = mixedFlags(s);
  if (!anyMixed(flags)) return;
  const other = otherKindAt(s);
  if (!other) return;
  const src = linkMaskFor(s.kind, other);
  preload(src);
  const im = state.images.get(src);
  if (!im || !im.complete || !im.naturalWidth) return;
  const cc = cellCenter(s);
  const { tw } = tileDrawSize();
  const ow = tw * 1.08;
  const oh = ow * (im.naturalHeight / im.naturalWidth);
  ctx.save();
  ctx.beginPath();
  const pad = Math.max(ow, oh);
  if (flags.xp) ctx.rect(cc.x, cc.y - pad, pad, pad * 2);
  if (flags.xm) ctx.rect(cc.x - pad, cc.y - pad, pad, pad * 2);
  if (flags.yp) ctx.rect(cc.x - pad, cc.y - pad, pad * 2, pad);
  if (flags.ym) ctx.rect(cc.x - pad, cc.y, pad * 2, pad);
  ctx.clip();
  ctx.drawImage(im, cc.x - ow / 2, cc.y - oh / 2, ow, oh);
  ctx.restore();
}

function tilePixels(im) {
  const key = im.src;
  if (state.tilePixels.has(key)) return state.tilePixels.get(key);
  const w = im.naturalWidth;
  const h = im.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.drawImage(im, 0, 0);
  const pix = { w, h, data: g.getImageData(0, 0, w, h).data };
  state.tilePixels.set(key, pix);
  return pix;
}

function isoTileSprite(im, sx = 0, sy = 0) {
  const key = (im.currentSrc || im.src) + "#" + sx + "," + sy;
  if (state.tileSprites.has(key)) return state.tileSprites.get(key);
  const pix = tilePixels(im);
  const c = document.createElement("canvas");
  c.width = TILE_DW;
  c.height = TILE_DH;
  const g = c.getContext("2d");
  const out = g.createImageData(TILE_DW, TILE_DH);
  const src = pix.data;
  const dst = out.data;
  const w = pix.w;
  const h = pix.h;
  for (let row = 0; row < TILE_DH; row++) {
    const len = ISO_SPAN.widths[row];
    const ox = ISO_SPAN.srcx[row];
    const ty = sy + row;
    if (ty < 0 || ty >= h) continue;
    for (let p = 0; p < len; p++) {
      const tx = sx + ox + p;
      if (tx < 0 || tx >= w) continue;
      const si = (ty * w + tx) * 4;
      const di = (row * TILE_DW + ox + p) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3] === 0 ? 0 : 255;
    }
  }
  g.putImageData(out, 0, 0);
  state.tileSprites.set(key, c);
  return c;
}

function keyedSprite(im) {
  const key = im.src;
  if (state.keyedSprites.has(key)) return state.keyedSprites.get(key);
  const w = im.naturalWidth;
  const h = im.naturalHeight;
  if (!w) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i];
    const green = d.data[i + 1];
    const b = d.data[i + 2];
    if (r + green + b < 28) d.data[i + 3] = 0;
    if (r < 48 && green < 48 && b > 80) d.data[i + 3] = 0;
  }
  g.putImageData(d, 0, 0);
  state.keyedSprites.set(key, c);
  return c;
}

function fillDiamond(cx, cy, tw, th, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - th / 2);
  ctx.lineTo(cx + tw / 2, cy);
  ctx.lineTo(cx, cy + th / 2);
  ctx.lineTo(cx - tw / 2, cy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawStamp(s) {
  drawCellTexture(s);
  drawCellLink(s);
}

function codeOf(kind) {
  if (kind && kind.charAt(0) === "@") return kind.slice(1);
  const b = brushByPaperChar(kind);
  return (b && b.code) || "";
}

function linkMaskFor(kind, otherKind) {
  const a = codeOf(kind);
  const b = codeOf(otherKind);
  const links = (state.kinds && state.kinds.links) || [];
  for (const L of links) {
    const from = L.from || [];
    const to = L.to || [];
    if ((from.includes(a) && to.includes(b)) || (from.includes(b) && to.includes(a))) {
      return "/ale/" + L.ale + ".png";
    }
  }
  const g = groupOf(kind);
  const o = groupOf(otherKind);
  if (g === "water" || o === "water") {
    if (g === "stone" || o === "stone") return "/ale/slink014.png";
    return "/ale/wlink014.png";
  }
  if (g === "stone" || o === "stone") return "/ale/clink014.png";
  return "/ale/clink014.png";
}

function drawEdgeStrokes(cx, cy, tw, th, g, flags) {
  if (g === "grass" || !anyMixed(flags)) return;
  const N = { x: cx, y: cy - th / 2 };
  const E = { x: cx + tw / 2, y: cy };
  const S = { x: cx, y: cy + th / 2 };
  const W = { x: cx - tw / 2, y: cy };
  ctx.strokeStyle = GROUP_RIM[g] || "#c8b070";
  ctx.lineWidth = Math.max(2, tw * 0.07);
  ctx.lineCap = "round";
  ctx.beginPath();
  if (flags.xp) {
    ctx.moveTo(N.x, N.y);
    ctx.lineTo(E.x, E.y);
    ctx.lineTo(S.x, S.y);
  }
  if (flags.xm) {
    ctx.moveTo(N.x, N.y);
    ctx.lineTo(W.x, W.y);
    ctx.lineTo(S.x, S.y);
  }
  if (flags.yp) {
    ctx.moveTo(W.x, W.y);
    ctx.lineTo(N.x, N.y);
    ctx.lineTo(E.x, E.y);
  }
  if (flags.ym) {
    ctx.moveTo(W.x, W.y);
    ctx.lineTo(S.x, S.y);
    ctx.lineTo(E.x, E.y);
  }
  ctx.stroke();
}

function planOverlayDisplayRect(overlay = state.planOverlay) {
  if (!overlay?.image) return null;
  const k = state.cam.k;
  const center = worldToScreen(overlay.x, overlay.y);
  const halfWidth = Math.max(1, overlay.footprint[0]) * TILE_W * k / 2;
  const halfHeight = Math.max(1, overlay.footprint[1]) * TILE_H * k / 2;
  const naturalWidth = Math.max(1, overlay.image.naturalWidth || overlay.image.width || 1);
  const naturalHeight = Math.max(1, overlay.image.naturalHeight || overlay.image.height || 1);
  const width = overlay.nativePixels ? naturalWidth * k : halfWidth * 2;
  const height = overlay.nativePixels
    ? naturalHeight * k
    : width * (naturalHeight / naturalWidth);
  return {
    center,
    halfWidth,
    halfHeight,
    image: {
      x: center.x - width / 2,
      y: center.y + halfHeight - height,
      width,
      height,
    },
  };
}

function planOverlayHitScreen(x, y) {
  const layout = planOverlayDisplayRect();
  if (!layout || !document.getElementById("showPlanOverlay")?.checked) return false;
  const r = layout.image;
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function drawPlanOverlay() {
  const overlay = state.planOverlay;
  if (!overlay?.image || !document.getElementById("showPlanOverlay")?.checked) return;
  const k = state.cam.k;
  const layout = planOverlayDisplayRect(overlay);
  const { center, halfWidth, halfHeight } = layout;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - halfHeight);
  ctx.lineTo(center.x + halfWidth, center.y);
  ctx.lineTo(center.x, center.y + halfHeight);
  ctx.lineTo(center.x - halfWidth, center.y);
  ctx.closePath();
  const showFoundation = document.getElementById("showPlanFoundation")?.checked;
  if (showFoundation) {
    ctx.fillStyle = "rgba(242, 226, 151, 0.24)";
    ctx.fill();
  }
  ctx.drawImage(
    overlay.image,
    layout.image.x,
    layout.image.y,
    layout.image.width,
    layout.image.height
  );
  if (showFoundation) {
    ctx.strokeStyle = "rgba(255, 226, 85, 0.9)";
    ctx.lineWidth = Math.max(1, k);
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function resolveManorBase(item) {
  const raw = Math.max(0, Math.round(Number(item) || 0));
  const bases = state.kinds?.bases || [];
  const direct = bases.find((base) => Number(base.no) === raw);
  if (direct) {
    return { base: direct, baseNo: Number(direct.no), instanceId: 0 };
  }
  const baseNo = raw >= 1_000_000 ? Math.floor(raw / 1_000_000) : raw;
  return {
    base: bases.find((base) => Number(base.no) === baseNo) || null,
    baseNo,
    instanceId: raw >= 1_000_000 ? raw % 1_000_000 : 0,
  };
}

function drawBuilding(b, sel) {
  const [fw, fh] = footprintOf(b);
  const origin = worldToScreen(b.x, b.y);
  const cs = cellSize();
  const p = { x: origin.x + cs / 2, y: origin.y + cs / 2 };
  if (isOverview()) {
    ctx.fillStyle = sel ? "#c9a227" : "#6a5a40";
    ctx.fillRect(origin.x, origin.y, Math.max(2, cs * fw), Math.max(2, cs * fh));
    return;
  }
  const resolved = resolveManorBase(b.item);
  const base = resolved.base;
  const src = baseImageSrc(base);
  if (src) preload(src);
  const im = src ? state.images.get(src) : null;
  const k = state.cam.k;
  if (im?.complete && im.naturalWidth) {
    const spriteWidth = im.naturalWidth * k;
    const spriteHeight = im.naturalHeight * k;
    ctx.drawImage(
      im,
      Math.round(p.x - spriteWidth / 2),
      Math.round(p.y - spriteHeight / 2),
      Math.round(spriteWidth),
      Math.round(spriteHeight)
    );
  } else {
    const hw = (fw * TILE_W * k) / 2;
    const hh = (fh * TILE_H * k) / 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - hh);
    ctx.lineTo(p.x + hw, p.y);
    ctx.lineTo(p.x, p.y + hh);
    ctx.lineTo(p.x - hw, p.y);
    ctx.closePath();
    ctx.fillStyle = sel ? "rgba(201,162,39,0.32)" : "rgba(48,42,32,0.20)";
    ctx.fill();
    ctx.strokeStyle = sel ? "#c9a227" : "rgba(220,205,155,0.55)";
    ctx.lineWidth = sel ? 2 : 1;
    ctx.stroke();
  }
  if (sel) {
    const hw = (fw * TILE_W * k) / 2;
    const hh = (fh * TILE_H * k) / 2;
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - hh);
    ctx.lineTo(p.x + hw, p.y);
    ctx.lineTo(p.x, p.y + hh);
    ctx.lineTo(p.x - hw, p.y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = "#f3ead8";
  ctx.font = "11px Microsoft YaHei";
  const label = base ? base.name : `未知户型 ${resolved.baseNo || "?"}`;
  ctx.fillText(`${label} ${b.item || b.mat || ""}`, p.x - 24, p.y);
}

function drawMapBound() {
  const n = state.mapSize;
  const pts = [worldToScreen(0, 0), worldToScreen(n, 0), worldToScreen(n, n), worldToScreen(0, n)];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = "#244a28";
  ctx.fill();
  ctx.strokeStyle = "#c9a227";
  ctx.stroke();
}

function strokeDiamond(cx, cy, tw, th) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - th / 2);
  ctx.lineTo(cx + tw / 2, cy);
  ctx.lineTo(cx, cy + th / 2);
  ctx.lineTo(cx - tw / 2, cy);
  ctx.closePath();
  ctx.stroke();
}

function portalRect(wx, wy, im) {
  const p = worldToScreen(wx, wy);
  const k = state.cam.k;
  return {
    x: p.x + PORTAL_ANCHOR.x * k,
    y: p.y + PORTAL_ANCHOR.y * k,
    w: im.naturalWidth * k,
    h: im.naturalHeight * k,
  };
}

function drawPortalAt(wx, wy) {
  preload(PORTAL_SRC);
  const im = state.images.get(PORTAL_SRC);
  if (!im || !im.complete || !im.naturalWidth) return;
  const r = portalRect(wx, wy, im);
  ctx.imageSmoothingEnabled = state.cam.k !== 1;
  ctx.drawImage(im, r.x, r.y, r.w, r.h);
}

function drawPortal() {
  drawPortalAt(state.portal.x, state.portal.y);
  if (state.portal.held) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, view.height - 28, 292, 18);
    ctx.fillStyle = "#ffe14a";
    ctx.font = "12px SimSun";
    ctx.textAlign = "left";
    ctx.fillText("已拾取出口：右键在地面放下", 12, view.height - 15);
  }
}

function portalHitScreen(sx, sy) {
  if (state.portal.held) return false;
  const im = state.images.get(PORTAL_SRC);
  if (!im || !im.complete || !im.naturalWidth) {
    const w = screenToWorld(sx, sy);
    return Math.abs(w.x - state.portal.x) < 40 && Math.abs(w.y - state.portal.y) < 40;
  }
  const r = portalRect(state.portal.x, state.portal.y, im);
  return sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h;
}

function placePortalAt(wx, wy) {
  const p = clampPortal(wx, wy);
  state.portal.x = p.x;
  state.portal.y = p.y;
  state.portal.held = false;
  draw();
}

function plotGridDot(data, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 248;
  data[i + 3] = 255;
}

function drawDottedSeg(data, w, h, x0, y0, x1, y1) {
  // 1px dots, never 8-adjacent on the same edge — isometric 2:1 lines
  // otherwise clump into 2px grains wherever Bresenham takes a double step.
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let lastX = -99;
  let lastY = -99;
  for (;;) {
    if (Math.abs(x - lastX) > 1 || Math.abs(y - lastY) > 1) {
      plotGridDot(data, w, h, x, y);
      lastX = x;
      lastY = y;
    }
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function paintGrid(gctx) {
  const k = state.cam.k;
  if (k < 0.08) return;
  const w = gctx.canvas.width;
  const h = gctx.canvas.height;
  if (!gridPixels || gridPixels.width !== w || gridPixels.height !== h) {
    gridPixels = gctx.createImageData(w, h);
  } else {
    gridPixels.data.fill(0);
  }
  const data = gridPixels.data;
  const stepX = 32 * k;
  const stepY = 16 * k;
  if (stepX < 0.5 || stepY < 0.5) return;
  const originX = state.cam.x;
  const originY = state.cam.y;
  const vertex = (i, j) => [Math.round(originX + i * stepX), Math.round(originY + j * stepY)];
  const row0 = Math.floor(-originY / stepY) - 2;
  const row1 = Math.ceil((h - originY) / stepY) + 2;
  for (let row = row0; row <= row1; row++) {
    const odd = row & 1;
    const col0 = Math.floor((-originX / stepX - odd) / 2) - 2;
    const col1 = Math.ceil((w - originX) / stepX / 2) + 2;
    for (let col = col0; col <= col1; col++) {
      const i = odd ? 2 * col + 1 : 2 * col;
      const [x0, y0] = vertex(i, row - 1);
      const [xR, yR] = vertex(i + 1, row);
      const [xL, yL] = vertex(i - 1, row);
      drawDottedSeg(data, w, h, x0, y0, xR, yR);
      drawDottedSeg(data, w, h, x0, y0, xL, yL);
    }
  }
  gctx.putImageData(gridPixels, 0, 0);
}

function footprintOf(b) {
  if (b.footprint) return b.footprint;
  const base = resolveManorBase(b.item).base;
  return base ? base.footprint : [3, 3];
}

function updateStats() {
  const prices = new Map();
  for (const b of state.kinds.brushes || []) {
    if (b.char && b.stampSize === 1) prices.set(b.char, b.price);
  }
  let mat = 0;
  for (const s of state.stamps) mat += prices.get(s.kind) || 0;
  const sizeRow = (state.kinds.mapSizes || []).find((s) => s.size === state.mapSize);
  const base = sizeRow ? sizeRow.basePrice : 0;
  const cost = document.getElementById("cost");
  if (cost) cost.textContent = "基础 " + base + " · 材料 " + mat;
  const stats = document.getElementById("stats");
  if (stats)
    stats.textContent =
      "地形图章 " + state.stamps.length + "；建筑 " + state.buildings.length + "（" + state.bldKind + "）";
  const bm = document.getElementById("basemoney");
  const mm = document.getElementById("matemoney");
  if (bm) bm.textContent = String(base);
  if (mm) mm.textContent = String(mat);
  const ul = document.getElementById("unknown");
  if (ul) {
    ul.innerHTML = "";
    for (const ch of state.unknown) {
      const li = document.createElement("li");
      li.textContent = ch;
      ul.appendChild(li);
    }
  }
  refreshMatCount();
}

function refreshMatCount() {
  const box = document.getElementById("matCount");
  if (!box || !state.kinds) return;
  const names = new Map();
  for (const b of state.kinds.brushes || []) {
    if (b.char && b.stampSize === 1) names.set(b.char, brushDisplayName(b));
  }
  const cnt = new Map();
  for (const s of state.stamps) cnt.set(s.kind, (cnt.get(s.kind) || 0) + 1);
  const lines = [];
  for (const [ch, n] of cnt) lines.push((names.get(ch) || ch) + " × " + n);
  if (state.buildings.length) lines.push("建筑 " + state.buildings.length);
  box.textContent = lines.join("\n") || "（空）";
}

function syncMiniCanvas() {
  const mini = document.getElementById("mini");
  if (!mini) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(1, Math.round(mini.clientWidth || 280));
  const cssH = Math.max(1, Math.round(mini.clientHeight || 236));
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (mini.width !== bw || mini.height !== bh) {
    mini.width = bw;
    mini.height = bh;
    miniStampKey = "";
  }
}

function miniLayout() {
  const mini = document.getElementById("mini");
  const w = mini.width;
  const h = mini.height;
  const n = Math.max(1, worldExtent());
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  const k = Math.min((w - pad) / n, (h - pad) / Math.max(0.001, n * ISO_Y));
  const mw = n * k;
  const mh = n * k * ISO_Y;
  const ox = (w - mw) / 2;
  const oy = (h - mh) / 2;
  return { w, h, n, k, ox, oy, mw, mh };
}

function miniToWorld(mx, my) {
  const { k, ox, oy } = miniLayout();
  return {
    x: (mx - ox) / Math.max(0.0001, k),
    y: (my - oy) / Math.max(0.0001, k * ISO_Y),
  };
}

function panCamToWorld(wx, wy) {
  const p = worldToScreen(wx, wy);
  state.cam.x += view.width / 2 - p.x;
  state.cam.y += view.height / 2 - p.y;
  draw();
}

function miniWorldToCanvas(wx, wy, layout) {
  return {
    x: layout.ox + wx * layout.k,
    y: layout.oy + wy * layout.k * ISO_Y,
  };
}

function miniSourceScale(n) {
  const maxSide = 960;
  const raw = Math.min(1, maxSide / Math.max(1, n));
  return Math.max(1 / 32, Math.round(raw * 32) / 32);
}

function drawMiniTerrain(layout) {
  const { w, h, n, ox, oy, mw, mh } = layout;
  ensureBuf(miniStampCache, w, h);
  const sctx = miniStampCache.getContext("2d");
  sctx.fillStyle = isSandBase() ? "#7a5a28" : "#1a2a18";
  sctx.fillRect(0, 0, w, h);
  const srcK = miniSourceScale(n);
  const srcW = Math.max(1, Math.ceil(n * srcK));
  const srcH = Math.max(1, Math.ceil(n * srcK * ISO_Y));
  ensureBuf(miniSrcCanvas, srcW, srcH);
  withDrawTarget(miniSrcCanvas, { x: 0, y: 0, k: srcK }, () => {
    ctx.fillStyle = planeBackdrop();
    ctx.fillRect(0, 0, srcW, srcH);
    ctx.save();
    clipMap();
    drawTerrainCells();
    ctx.restore();
  });
  sctx.save();
  sctx.beginPath();
  sctx.rect(ox, oy, mw, mh);
  sctx.clip();
  sctx.imageSmoothingEnabled = true;
  if (sctx.imageSmoothingQuality) sctx.imageSmoothingQuality = "high";
  sctx.drawImage(miniSrcCanvas, 0, 0, n * srcK, n * srcK * ISO_Y, ox, oy, mw, mh);
  sctx.restore();
  sctx.strokeStyle = "rgba(201,234,236,0.85)";
  sctx.lineWidth = 1;
  sctx.strokeRect(ox + 0.5, oy + 0.5, mw - 1, mh - 1);
}

function drawMini() {
  const mini = document.getElementById("mini");
  if (!mini) return;
  syncMiniCanvas();
  const mctx = mini.getContext("2d");
  const layout = miniLayout();
  const { w, h, n, k } = layout;
  const stampKey = (state.terrainRev || 0) + "|" + w + "x" + h + "|" + n + "|" + k.toFixed(6);
  if (stampKey !== miniStampKey) {
    drawMiniTerrain(layout);
    miniStampKey = stampKey;
  }
  mctx.drawImage(miniStampCache, 0, 0);
  const pp = miniWorldToCanvas(state.portal.x, state.portal.y, layout);
  mctx.fillStyle = "#ffcc33";
  mctx.beginPath();
  mctx.arc(pp.x, pp.y, Math.max(2.5, layout.w * 0.012), 0, Math.PI * 2);
  mctx.fill();
  const c0 = screenToWorld(0, 0);
  const c1 = screenToWorld(view.width, 0);
  const c2 = screenToWorld(view.width, view.height);
  const c3 = screenToWorld(0, view.height);
  const qs = [c0, c1, c2, c3].map((p) => miniWorldToCanvas(p.x, p.y, layout));
  mctx.save();
  mctx.beginPath();
  mctx.rect(layout.ox, layout.oy, layout.mw, layout.mh);
  mctx.clip();
  mctx.beginPath();
  mctx.moveTo(qs[0].x, qs[0].y);
  for (let i = 1; i < 4; i++) mctx.lineTo(qs[i].x, qs[i].y);
  mctx.closePath();
  mctx.strokeStyle = "#ffe14a";
  mctx.lineWidth = Math.max(1.25, layout.w * 0.006);
  mctx.stroke();
  mctx.restore();
}

function snapshotHist() {
  return {
    stamps: state.stamps.map((s) => ({ ...s })),
    buildings: state.buildings.map((b) => ({ ...b })),
    grassKeep: [...(state.grassKeep || [])],
    mapflag: state.mapflag || 0,
  };
}

function applySnapshot(h) {
  state.stamps = h.stamps;
  state.buildings = h.buildings;
  state.grassKeep = new Set(h.grassKeep || []);
  if (h.mapflag != null) state.mapflag = h.mapflag;
  syncChgTerrButton();
  rebuildStampIndex();
  markDirty();
  draw();
}

function pushHist() {
  state.history.push(snapshotHist());
  state.future = [];
  if (state.history.length > 24) state.history.shift();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshotHist());
  if (state.future.length > 24) state.future.shift();
  applySnapshot(state.history.pop());
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshotHist());
  if (state.history.length > 24) state.history.shift();
  applySnapshot(state.future.pop());
}

function setLayer(name) {
  state.layer = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.layer === name));
  const tp = document.getElementById("terrainPanel");
  const bp = document.getElementById("buildPanel");
  if (tp) tp.hidden = name !== "terrain";
  if (bp) bp.hidden = name !== "build";
}

function cellsForBrush(cx, cy, size) {
  const half = Math.floor(size / 2);
  const out = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      out.push({ x: cx + dx * SNAP, y: cy + dy * SNAP });
    }
  }
  return out;
}

function paperKindOfBrush(brush) {
  if (!brush) return null;
  if (brush.mapdataIndex != null) return encKind(brush.mapdataIndex);
  if (brush.char) return brush.char;
  if (brush.code) return "@" + brush.code;
  return null;
}

function tileKindOfBrush(brush) {
  if (!brush) return null;
  if (brush.char) return brush.char;
  return paperKindOfBrush(brush);
}

function brushPaintsBase(brush) {
  // Paper kind "C" is 石砖 (mapdata 12). Sand's *tile* char is also "C".
  // Only the tile char means "paint the implicit base / erase".
  if (!brush) return false;
  return tileKindOfBrush(brush) === baseChar();
}

function cellTerrainKind(u, v) {
  const tile = state.cornerTiles.get(cellKey(u, v));
  if (!tile) return baseChar();
  const counts = new Map();
  for (const kind of tile.corners) counts.set(kind, (counts.get(kind) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function logicalInMap(u, v) {
  const pos = logicalToNative(u, v);
  const n = worldExtent();
  return pos.cx >= 0 && pos.cy >= 0 && pos.cx <= n && pos.cy <= n;
}

function normalizeShapeBox(u0, v0, u1, v1, square) {
  let left = Math.min(u0, u1);
  let right = Math.max(u0, u1);
  let top = Math.min(v0, v1);
  let bottom = Math.max(v0, v1);
  if (square) {
    const side = Math.max(right - left, bottom - top);
    if (u1 >= u0) right = left + side;
    else left = right - side;
    if (v1 >= v0) bottom = top + side;
    else top = bottom - side;
  }
  return { left, right, top, bottom };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function bresenhamLine(u0, v0, u1, v1) {
  const cells = [];
  let x0 = u0 | 0;
  let y0 = v0 | 0;
  const x1 = u1 | 0;
  const y1 = v1 | 0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cells.push({ u: x0, v: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return cells;
}

function heartPoly(cu, cv, rx, ry) {
  // Parametric heart → UV polygon (tip toward +v / "down" on iso rows looks like ♥).
  const pts = [];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([cu + (hx / 17) * rx, cv - (hy / 17) * ry]);
  }
  return pts;
}

function shapeInside(tool, u, v, box) {
  const { left, right, top, bottom } = box;
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const cu = (left + right) / 2;
  const cv = (top + bottom) / 2;
  const rx = Math.max(0.6, w / 2);
  const ry = Math.max(0.6, h / 2);
  const x = (u - cu) / rx;
  const y = (v - cv) / ry;

  if (tool === "rect") return u >= left && u <= right && v >= top && v <= bottom;
  if (tool === "ellipse") return x * x + y * y <= 1.05;
  if (tool === "diamond") return Math.abs(x) + Math.abs(y) <= 1.05;
  if (tool === "triangle") {
    const poly = [
      [cu, top],
      [right, bottom],
      [left, bottom],
    ];
    return pointInPoly(u + 0.5, v + 0.5, poly);
  }
  if (tool === "heart") {
    return pointInPoly(u + 0.5, v + 0.5, heartPoly(cu, cv, rx, ry));
  }
  if (tool === "star") {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? 1 : 0.42;
      pts.push([cu + Math.cos(ang) * rad * rx, cv + Math.sin(ang) * rad * ry]);
    }
    return pointInPoly(u + 0.5, v + 0.5, pts);
  }
  return false;
}

function collectShapeCells(tool, u0, v0, u1, v1, opts) {
  if (tool === "line") {
    return bresenhamLine(u0, v0, u1, v1).filter((c) => logicalInMap(c.u, c.v));
  }
  const box = normalizeShapeBox(u0, v0, u1, v1, !!(opts && opts.square));
  const filled = [];
  for (let u = box.left; u <= box.right; u++) {
    for (let v = box.top; v <= box.bottom; v++) {
      if (!logicalInMap(u, v)) continue;
      if (shapeInside(tool, u, v, box)) filled.push({ u, v });
    }
  }
  if (!opts || opts.mode !== "outline" || tool === "line") return filled;
  const keySet = new Set(filled.map((c) => cellKey(c.u, c.v)));
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  return filled.filter((c) => {
    for (const [du, dv] of dirs) {
      if (!keySet.has(cellKey(c.u + du, c.v + dv))) return true;
    }
    return false;
  });
}

function currentShapeMode() {
  const el = document.querySelector('input[name="shapeMode"]:checked');
  return el && el.value === "outline" ? "outline" : "fill";
}

function markGrassKeep(cells, keep) {
  if (!state.grassKeep) state.grassKeep = new Set();
  for (const c of cells) {
    const key = cellKey(c.u, c.v);
    if (keep) state.grassKeep.add(key);
    else state.grassKeep.delete(key);
  }
}

function upsertStampCell(u, v, stamp) {
  if (!state.stampByCell) state.stampByCell = new Map();
  const key = cellKey(u, v);
  const prev = state.stampByCell.get(key);
  if (!stamp) {
    if (!prev) return;
    state.stampByCell.delete(key);
    const idx = state.stamps.indexOf(prev);
    if (idx >= 0) {
      const last = state.stamps.pop();
      if (idx < state.stamps.length) state.stamps[idx] = last;
    }
    return;
  }
  if (prev) {
    prev.kind = stamp.kind;
    prev.x = stamp.x;
    prev.y = stamp.y;
    return;
  }
  const next = { kind: stamp.kind, x: stamp.x, y: stamp.y };
  state.stamps.push(next);
  state.stampByCell.set(key, next);
}

function queuePaintPreview(u, v, kind) {
  if (!state.paintPreview) state.paintPreview = new Map();
  state.paintPreview.set(cellKey(u, v), { u, v, kind });
  state.strokeNeedsRebuild = true;
}

function commitPaintStroke() {
  if (!state.strokeNeedsRebuild) return;
  state.paintPreview = new Map();
  state.strokeNeedsRebuild = false;
  rebuildStampIndex();
}

function paintCells(cells, erase) {
  if (!cells || !cells.length) return;
  const kind = paperKindOfBrush(state.brush);
  if (!erase && !kind) return;
  pushHist();
  const keys = new Set(cells.map((c) => cellKey(c.u, c.v)));
  state.stamps = state.stamps.filter((s) => {
    const p = nativePointToLogical(s.x, s.y);
    return !keys.has(cellKey(p.u, p.v));
  });
  const toBase = erase || brushPaintsBase(state.brush);
  if (!toBase) {
    for (const c of cells) {
      const pos = logicalToNative(c.u, c.v);
      state.stamps.push({ kind, x: pos.cx, y: pos.cy });
    }
  }
  markGrassKeep(cells, toBase);
  rebuildStampIndex();
  markDirty();
  draw();
}

function drawShapePreview() {
  if (!state.shapeDrag || !isShapeTool(state.tool)) return;
  const d = state.shapeDrag;
  const cells = collectShapeCells(state.tool, d.u0, d.v0, d.u1, d.v1, {
    mode: currentShapeMode(),
    square: state.shapeShift,
  });
  if (!cells.length) return;
  ctx.save();
  clipMap();
  ctx.beginPath();
  for (const c of cells) {
    const pos = logicalToNative(c.u, c.v);
    const s = { x: pos.cx - TILE_W / 2, y: pos.cy - TILE_H / 2 };
    diamondPath(s);
  }
  ctx.fillStyle = "rgba(56, 120, 220, 0.28)";
  ctx.strokeStyle = "rgba(40, 90, 200, 0.9)";
  ctx.lineWidth = 1.25;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function floodFillAt(wx, wy) {
  const erase = state.paintMode === "erase";
  const brush = state.brush;
  const fillKind = paperKindOfBrush(brush);
  if (!erase && !fillKind) return;
  const start = nativePointToLogical(wx, wy);
  if (!logicalInMap(start.u, start.v)) return;
  const target = cellTerrainKind(start.u, start.v);
  const paintKind = tileKindOfBrush(brush) || fillKind;
  if (erase) {
    if (target === baseChar()) return;
  } else if (target === paintKind) {
    return;
  }

  const queue = [[start.u, start.v]];
  const seen = new Set();
  const cells = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const limit = 12000;
  while (queue.length && cells.length < limit) {
    const [cu, cv] = queue.shift();
    const key = cellKey(cu, cv);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!logicalInMap(cu, cv)) continue;
    if (cellTerrainKind(cu, cv) !== target) continue;
    cells.push({ u: cu, v: cv });
    for (const [du, dv] of dirs) queue.push([cu + du, cv + dv]);
  }
  if (!cells.length) return;
  paintCells(cells, erase);
}

function paintAt(wx, wy, erase) {
  if (state.layer === "build") {
    const x = snap(wx);
    const y = snap(wy);
    if (x < 0 || y < 0 || x > worldExtent() || y > worldExtent()) return;
    const hit = hitBuilding(wx, wy);
    if (erase) {
      if (hit >= 0) {
        if (!state.strokeSaved) pushHist();
        state.strokeSaved = true;
        state.buildings.splice(hit, 1);
        state.selectedBld = -1;
        draw();
      }
      return;
    }
    if (hit >= 0) {
      state.selectedBld = hit;
      const b = state.buildings[hit];
      document.getElementById("itemId").value = b.item || 0;
      document.getElementById("itemDir").value = b.dir || 0;
      draw();
      return;
    }
    if (!state.strokeSaved) pushHist();
    state.strokeSaved = true;
    const item = +document.getElementById("itemId").value || 0;
    const dir = +document.getElementById("itemDir").value || 0;
    const fp = state.selectedBase ? state.selectedBase.footprint : [3, 3];
    state.buildings.push({ mode: "manor", x, y, item, dir, footprint: fp });
    rememberItem(item);
    markDirty();
    draw();
    return;
  }
  const brush = state.brush;
  if (!brush) return;
  const kind = paperKindOfBrush(brush);
  if (!kind) return;
  const logical = nativePointToLogical(wx, wy);
  const pos = logicalToNative(logical.u, logical.v);
  const x = pos.cx;
  const y = pos.cy;
  if (x < 0 || y < 0 || x > worldExtent() || y > worldExtent()) return;
  if (!state.strokeSaved) pushHist();
  state.strokeSaved = true;
  const toBase = erase || brushPaintsBase(brush);
  upsertStampCell(logical.u, logical.v, toBase ? null : { kind, x, y });
  markGrassKeep([{ u: logical.u, v: logical.v }], toBase);
  queuePaintPreview(logical.u, logical.v, toBase ? baseChar() : tileKindOfBrush(brush) || kind);
  markDirty();
  draw();
}

function stampCovers(s, x, y) {
  const b = brushByPaperChar(s.kind);
  const radius = brushRadius(b);
  const source = nativePointToLogical(s.x, s.y);
  const target = nativePointToLogical(x, y);
  const du = target.u - source.u;
  const dv = target.v - source.v;
  return Math.abs(du) <= radius && Math.abs(dv) <= radius;
}

function hitBuilding(wx, wy) {
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const b = state.buildings[i];
    const [fw, fh] = footprintOf(b);
    if (Math.abs(wx - b.x) < fw * SNAP && Math.abs(wy - b.y) < fh * SNAP) return i;
  }
  return -1;
}

function rememberItem(item) {
  const box = document.getElementById("recentItems");
  if (!box) return;
  if ([...box.querySelectorAll("button")].some((b) => b.dataset.item == item)) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn";
  btn.dataset.item = item;
  btn.textContent = "物品 " + item;
  btn.onclick = () => {
    document.getElementById("itemId").value = item;
  };
  box.prepend(btn);
}

function showDlg(id, on) {
  const el = document.getElementById(id);
  if (el) el.hidden = !on;
}

function markDirty() {
  state.dirty = true;
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = "未保存";
}

function setSaveStatus(text) {
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = text;
}

function projectSnapshot(name) {
  return {
    v: 1,
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    name: name || "自动保存",
    savedAt: Date.now(),
    desc: document.getElementById("desc")?.value || "",
    mapSize: state.mapSize,
    mapflag: state.mapflag,
    stamps: state.stamps.map((s) => ({ ...s })),
    buildings: state.buildings.map((b) => ({ ...b })),
    grassKeep: [...(state.grassKeep || [])],
    portal: { x: state.portal.x, y: state.portal.y },
    bldKind: state.bldKind || "manor",
  };
}

function applyProject(doc, opts) {
  const quiet = !!(opts && opts.quiet);
  const fit = !(opts && opts.skipFit);
  state.stamps = (doc.stamps || []).map((s) => ({ ...s }));
  state.buildings = (doc.buildings || []).map((b) => ({ ...b }));
  state.grassKeep = new Set(doc.grassKeep || []);
  state.mapSize = doc.mapSize || doc.size || state.mapSize;
  state.mapflag = doc.mapflag || 0;
  state.bldKind = doc.bldKind || "manor";
  state.terrainSource = doc.terrainSource || null;
  state.buildingSource = doc.buildingSource || null;
  syncChgTerrButton();
  if (doc.portal) {
    state.portal.x = doc.portal.x;
    state.portal.y = doc.portal.y;
  }
  const desc = document.getElementById("desc");
  if (desc && doc.desc != null) desc.value = doc.desc;
  ensureSize(state.mapSize);
  rebuildStampIndex();
  if (fit) fitTerrainContent();
  draw();
  if (!quiet) setSaveStatus("已恢复");
}

function openSaveDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("manor-desk", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("versions")) db.createObjectStore("versions", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value, key) {
  const db = await openSaveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    const req = key != null ? os.put(value, key) : os.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openSaveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(store) {
  const db = await openSaveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const db = await openSaveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function formatSaveTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return d.getMonth() + 1 + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

const TERRAIN_DRAFT_LS = "manor-terrain-draft-v1";

function draftHasWork(snap) {
  return !!(
    snap &&
    ((snap.stamps && snap.stamps.length) ||
      (snap.buildings && snap.buildings.length) ||
      (snap.grassKeep && snap.grassKeep.length) ||
      snap.mapflag)
  );
}

function saveDraftLocal(snap) {
  try {
    localStorage.setItem(TERRAIN_DRAFT_LS, JSON.stringify(snap || projectSnapshot("自动保存")));
  } catch (err) {
    console.warn(err);
  }
}

function loadDraftLocal() {
  try {
    const raw = localStorage.getItem(TERRAIN_DRAFT_LS);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveDraft() {
  const snap = projectSnapshot("自动保存");
  saveDraftLocal(snap);
  try {
    await idbPut("kv", snap, "draft");
    state.dirty = false;
    setSaveStatus("已自动保存 " + formatSaveTime(snap.savedAt));
  } catch (err) {
    setSaveStatus("已本地暂存 " + formatSaveTime(snap.savedAt));
    console.warn(err);
  }
}

function wireDeskSwitchSave(saveFn) {
  document.querySelectorAll(".desk-switch-inline a[href]").forEach((link) => {
    if (link.classList.contains("on") || link.getAttribute("aria-current") === "page") return;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      Promise.resolve(saveFn())
        .catch(() => {})
        .finally(() => {
          window.location.assign(href);
        });
    });
  });
}

async function saveNamedVersion(name) {
  const snap = projectSnapshot(name || "快照");
  saveDraftLocal(snap);
  await idbPut("versions", snap);
  await idbPut("kv", snap, "draft");
  const all = (await idbGetAll("versions")).sort((a, b) => b.savedAt - a.savedAt);
  for (const extra of all.slice(30)) await idbDelete("versions", extra.id);
  state.dirty = false;
  setSaveStatus("已保存 " + snap.name);
  return snap;
}

function mapHasWork() {
  return !!(
    (state.stamps && state.stamps.length) ||
    (state.buildings && state.buildings.length) ||
    (state.grassKeep && state.grassKeep.size) ||
    state.mapflag
  );
}

async function startNewTerrain() {
  try {
    if (mapHasWork() || state.dirty) {
      const label = (document.getElementById("desc")?.value || "").trim();
      await saveNamedVersion(label ? "换新前 · " + label : "换新前 " + formatSaveTime(Date.now()));
    }
  } catch (err) {
    console.warn(err);
    setSaveStatus("保存旧图失败，未换新");
    return;
  }
  state.stamps = [];
  state.buildings = [];
  state.grassKeep = new Set();
  state.mapflag = 0;
  state.terrainSource = null;
  state.buildingSource = null;
  state.selectedBld = -1;
  state.history = [];
  state.future = [];
  state.unknown = new Set();
  state.synthCache = new Map();
  const desc = document.getElementById("desc");
  if (desc) desc.value = "";
  initPortalPos();
  syncChgTerrButton();
  rebuildStampIndex();
  playCam();
  await saveDraft();
  setSaveStatus("新图（草地）");
  draw();
}

async function restoreDraft() {
  try {
    let snap = null;
    try {
      snap = await idbGet("kv", "draft");
    } catch (err) {
      console.warn(err);
    }
    if (!draftHasWork(snap)) {
      const local = loadDraftLocal();
      if (draftHasWork(local)) snap = local;
    }
    if (!draftHasWork(snap)) {
      setSaveStatus("新图");
      return false;
    }
    applyProject(snap, { quiet: true });
    state.dirty = false;
    setSaveStatus("已恢复 " + formatSaveTime(snap.savedAt));
    return true;
  } catch (err) {
    console.warn(err);
    return false;
  }
}

async function refreshHistoryList() {
  const box = document.getElementById("histList");
  if (!box) return;
  const all = (await idbGetAll("versions")).sort((a, b) => b.savedAt - a.savedAt);
  box.innerHTML = "";
  if (!all.length) {
    box.textContent = "还没有手动保存的历史版本。点上方按钮即可留下一版。";
    return;
  }
  for (const snap of all) {
    const row = document.createElement("div");
    row.className = "hist-item";
    const name = document.createElement("div");
    name.className = "hist-name";
    name.textContent = snap.name || "快照";
    const time = document.createElement("div");
    time.className = "hist-time";
    time.textContent = formatSaveTime(snap.savedAt) + " · 地形 " + (snap.stamps || []).length + " · 建筑 " + (snap.buildings || []).length;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn";
    open.textContent = "恢复";
    open.onclick = () => {
      applyProject(snap, { quiet: true });
      state.dirty = false;
      setSaveStatus("已恢复 " + (snap.name || "快照"));
      showDlg("dlgHistory", false);
    };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn";
    del.textContent = "删除";
    del.onclick = async () => {
      await idbDelete("versions", snap.id);
      refreshHistoryList();
    };
    row.append(name, open, del, time);
    box.appendChild(row);
  }
}

function closeDrawers() {
  document.querySelector(".rail-left")?.classList.remove("open");
  document.querySelector(".rail-right")?.classList.remove("open");
  const mask = document.getElementById("drawerMask");
  if (mask) mask.hidden = true;
  document.body.classList.remove("drawer-open");
}

function toggleDrawer(side) {
  const left = document.querySelector(".rail-left");
  const right = document.querySelector(".rail-right");
  const mask = document.getElementById("drawerMask");
  const target = side === "right" ? right : left;
  const other = side === "right" ? left : right;
  const willOpen = target && !target.classList.contains("open");
  left?.classList.remove("open");
  right?.classList.remove("open");
  if (willOpen) target.classList.add("open");
  if (mask) mask.hidden = !willOpen;
  other?.classList.remove("open");
  document.body.classList.toggle("drawer-open", !!willOpen);
}

function wireClick(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
}

function stampTerrainChar(stamp) {
  if (!stamp) return "";
  const brush = brushByPaperChar(stamp.kind);
  if (brush && brush.char) return brush.char;
  return stamp.kind;
}

function syncChgTerrButton() {
  const btn = document.getElementById("btnChgTerr");
  if (!btn) return;
  btn.classList.toggle("on", isSandBase());
  btn.title = isSandBase() ? "当前底板：沙地（再点切回草地）" : "当前底板：草地（再点换成沙地）";
}

function paperCharForTile(tileChar, stampSize) {
  // Stamps store mapdata paper chars (encKind), not tile chars.
  // Sand tile char "C" collides with paper "C" = 石砖 (mapdata 12).
  const size = stampSize || 1;
  const brushes = state.kinds.brushes || [];
  const match =
    brushes.find((b) => b.char === tileChar && (b.stampSize || 1) === size) ||
    brushes.find((b) => b.char === tileChar && (b.stampSize || 1) === 1) ||
    brushes.find((b) => b.char === tileChar);
  return match ? paperKindOfBrush(match) : null;
}

function adoptBaseTerrain(sand) {
  const next = sand ? 1 : 0;
  const wasSand = isSandBase();
  const willSand = !!next;
  if (wasSand === willSand) {
    syncChgTerrButton();
    return;
  }
  pushHist();
  const grass = grassChar();
  const sandC = sandChar();
  // Sand-base: sand is the plane, grass stamps are the overlay.
  // Grass-base: grass is the plane, sand stamps are the overlay.
  // Flipping swaps those roles — keep brush size, write paper chars not tile chars.
  for (const s of state.stamps) {
    const brush = brushByPaperChar(s.kind);
    const ch = stampTerrainChar(s);
    const size = (brush && brush.stampSize) || 1;
    if (ch === grass) {
      const paper = paperCharForTile(sandC, size);
      if (paper) s.kind = paper;
    } else if (ch === sandC || isSandKind(ch)) {
      const paper = paperCharForTile(grass, size);
      if (paper) s.kind = paper;
    }
  }
  // grassKeep marks intentional grass holes inside dirt on grass-base. When
  // moving to sand-base those cells become real grass stamps on the sand plane.
  if (!wasSand && willSand) {
    const grassPaper = paperCharForTile(grass, 1) || grass;
    const seen = new Set(
      state.stamps
        .filter((s) => stampTerrainChar(s) === grass)
        .map((s) => {
          const p = nativePointToLogical(s.x, s.y);
          return cellKey(p.u, p.v);
        })
    );
    for (const key of state.grassKeep || []) {
      if (seen.has(key)) continue;
      const comma = String(key).indexOf(",");
      if (comma < 0) continue;
      const u = +key.slice(0, comma);
      const v = +key.slice(comma + 1);
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      const pos = logicalToNative(u, v);
      state.stamps.push({ kind: grassPaper, x: pos.cx, y: pos.cy });
    }
  }
  state.grassKeep = new Set();
  state.mapflag = next;
  state.synthCache = new Map();
  terrainScreenKey = "";
  miniStampKey = "";
  syncChgTerrButton();
  rebuildStampIndex();
  markDirty();
  draw();
}

function bind() {
  window.addEventListener("resize", () => {
    resize();
  });
  wireClick("btnUndo", undo);
  wireClick("btnRedo", redo);
  const saveLocal = async () => {
    const name = document.getElementById("snapName")?.value || "手动保存";
    await saveNamedVersion(name);
  };
  const openHistory = async () => {
    await refreshHistoryList();
    showDlg("dlgHistory", true);
  };
  wireClick("btnSaveLocal", saveLocal);
  wireClick("btnSaveMobile", saveLocal);
  wireClick("btnHistory", openHistory);
  wireClick("btnSnapNow", async () => {
    const name = document.getElementById("snapName")?.value || "快照";
    await saveNamedVersion(name);
    refreshHistoryList();
  });
  document.getElementById("btnDrawerLeft")?.addEventListener("click", () => toggleDrawer("left"));
  document.getElementById("btnDrawerRight")?.addEventListener("click", () => toggleDrawer("right"));
  document.getElementById("drawerMask")?.addEventListener("click", closeDrawers);
  document.querySelectorAll("[data-drawer-close]").forEach((b) => {
    b.onclick = closeDrawers;
  });
  window.matchMedia("(min-width: 1101px)").addEventListener("change", (ev) => {
    if (ev.matches) closeDrawers();
  });
  const openTerr = () => document.getElementById("fileTerr").click();
  const openBld = () => document.getElementById("fileBld").click();
  wireClick("btnOpenTerr", openTerr);
  wireClick("btnOpenBld", openBld);
  document.getElementById("fileTerr").onchange = (e) => {
    if (e.target.files[0]) importFile(e.target.files[0], "terrain");
    e.target.value = "";
  };
  document.getElementById("fileBld").onchange = (e) => {
    if (e.target.files[0]) importFile(e.target.files[0], "build");
    e.target.value = "";
  };
  wireClick("btnSaveTerr", exportTerrain);
  wireClick("btnSavePng", exportTerrainPng);
  wireClick("btnSaveBld", exportBuild);
  wireClick("btnImageTerrain", () => document.getElementById("fileImageTerrain").click());
  document.getElementById("fileImageTerrain").onchange = async (event) => {
    if (event.target.files[0]) {
      try {
        await openImageTerrain(event.target.files[0]);
      } catch (error) {
        await appAlert(error.message || String(error), { title: "图片导入失败" });
      }
    }
    event.target.value = "";
  };
  document.getElementById("imageTerrainWidth").onchange = renderImageTerrainMapping;
  document.getElementById("imageTerrainHeight").onchange = renderImageTerrainMapping;
  document.getElementById("imageTerrainColors").onchange = renderImageTerrainMapping;
  document.getElementById("imageTerrainFit").onchange = renderImageTerrainMapping;
  document.getElementById("imageTerrainAlpha").onchange = renderImageTerrainMapping;
  wireClick("btnApplyImageTerrain", applyImageTerrain);
  wireClick("btnPlanOverlay", () => document.getElementById("filePlanOverlay").click());
  document.getElementById("filePlanOverlay").onchange = async (event) => {
    if (event.target.files[0]) {
      try {
        await openPlanOverlay(event.target.files[0]);
      } catch (error) {
        await appAlert(error.message || String(error), { title: "规划图导入失败" });
      }
    }
    event.target.value = "";
  };
  wireClick("btnApplyPlanOverlay", applyPlanOverlay);
  wireClick("btnRemovePlanOverlay", removePlanOverlay);
  document.getElementById("showGrid").onchange = draw;
  document.getElementById("showBuild").onchange = draw;
  document.getElementById("showPlanOverlay").onchange = draw;
  document.getElementById("showPlanFoundation").onchange = draw;
  document.querySelectorAll("#modeRow .tool").forEach((btn) => {
    btn.onclick = () => setPaintMode(btn.dataset.mode || "brush");
  });
  document.querySelectorAll("#toolRow .tool").forEach((btn) => {
    btn.onclick = () => setTool(btn.dataset.tool || "free");
  });
  document.querySelectorAll('input[name="shapeMode"]').forEach((el) => {
    el.onchange = () => {
      state.shapeMode = currentShapeMode();
      draw();
    };
  });
  document.getElementById("btnFit").onclick = () => {
    fitCam();
    draw();
  };
  document.getElementById("btnZoom1").onclick = () => {
    zoomNative();
    draw();
  };
  document.getElementById("btnChgMap").onclick = () => {
    fillSizeList(visibleMapSizes(state.kinds.mapSizes || []));
    showDlg("dlgSize", true);
  };
  document.getElementById("btnSizeOk").onclick = () => {
    const sel = document.getElementById("mapSize");
    state.mapSize = +sel.value;
    const desc = document.getElementById("desc");
    const opt = sel.selectedOptions[0];
    if (desc && opt && !desc.value) desc.value = opt.dataset.desc || "";
    showDlg("dlgSize", false);
    initPortalPos();
    state.stamps = [];
    state.grassKeep = new Set();
    state.terrainSource = null;
    rebuildStampIndex();
    playCam();
    markDirty();
    draw();
  };
  document.getElementById("btnChgTerr").onclick = () => {
    adoptBaseTerrain(!isSandBase());
  };
  document.getElementById("btnNewTerr").onclick = () => {
    startNewTerrain();
  };
  syncChgTerrButton();
  document.getElementById("btnMatList").onclick = () => {
    refreshMatCount();
    showDlg("dlgMat", true);
  };
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => showDlg(b.dataset.close, false);
  });

  view.addEventListener("contextmenu", (e) => e.preventDefault());
  const mapHost = document.getElementById("mapHost");
  if (mapHost) mapHost.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  view.addEventListener("wheel", onWheel, { passive: false });
  view.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });
  window.addEventListener("touchcancel", onTouchEnd, { passive: false });
  window.addEventListener("keydown", onKey);
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", () => resize());
  }
  setInterval(() => {
    if (state.dirty) saveDraft();
  }, 20000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      saveDraftLocal();
      if (state.dirty) saveDraft();
    }
  });
  window.addEventListener("pagehide", () => {
    saveDraftLocal();
    if (state.dirty) saveDraft();
  });
  wireDeskSwitchSave(async () => {
    saveDraftLocal();
    await saveDraft();
  });

  const stage = mapHost || view.parentElement;
  stage.addEventListener("dragover", (e) => e.preventDefault());
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  const mini = document.getElementById("mini");
  if (mini) {
    mini.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.miniDrag = true;
      const r = mini.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (mini.width / r.width);
      const my = (e.clientY - r.top) * (mini.height / r.height);
      const w = miniToWorld(mx, my);
      panCamToWorld(w.x, w.y);
    });
    window.addEventListener("mousemove", (e) => {
      if (!state.miniDrag) return;
      const r = mini.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (mini.width / r.width);
      const my = (e.clientY - r.top) * (mini.height / r.height);
      const w = miniToWorld(mx, my);
      panCamToWorld(w.x, w.y);
    });
    mini.addEventListener("touchstart", (e) => {
      e.preventDefault();
      state.miniDrag = true;
      const t = e.touches[0];
      const r = mini.getBoundingClientRect();
      const mx = (t.clientX - r.left) * (mini.width / r.width);
      const my = (t.clientY - r.top) * (mini.height / r.height);
      panCamToWorld(miniToWorld(mx, my).x, miniToWorld(mx, my).y);
    }, { passive: false });
    mini.addEventListener("touchmove", (e) => {
      if (!state.miniDrag) return;
      e.preventDefault();
      const t = e.touches[0];
      const r = mini.getBoundingClientRect();
      const mx = (t.clientX - r.left) * (mini.width / r.width);
      const my = (t.clientY - r.top) * (mini.height / r.height);
      panCamToWorld(miniToWorld(mx, my).x, miniToWorld(mx, my).y);
    }, { passive: false });
    mini.addEventListener("touchend", () => {
      state.miniDrag = false;
    });
    window.addEventListener("mouseup", () => {
      state.miniDrag = false;
    });
  }
}

function localXY(e) {
  const r = view.getBoundingClientRect();
  const sx = view.width / Math.max(1, r.width);
  const sy = view.height / Math.max(1, r.height);
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

function onTouchStart(e) {
  e.preventDefault();
  state.touching = true;
  if (e.touches.length >= 2) {
    state.dragging = false;
    state.panning = false;
    state.shapeDrag = null;
    const a = e.touches[0];
    const b = e.touches[1];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    const xy = localXY(mid);
    const w = screenToWorld(xy.x, xy.y);
    state.pinch = { dist, k: state.cam.k, wx: w.x, wy: w.y };
    return;
  }
  const t = e.touches[0];
  onDown({ clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false });
}

function onTouchMove(e) {
  e.preventDefault();
  if (state.pinch && e.touches.length >= 2) {
    const a = e.touches[0];
    const b = e.touches[1];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    state.cam.k = Math.min(8, Math.max(0.08, state.pinch.k * (dist / state.pinch.dist)));
    const xy = localXY(mid);
    const after = worldToScreen(state.pinch.wx, state.pinch.wy);
    state.cam.x += xy.x - after.x;
    state.cam.y += xy.y - after.y;
    draw();
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    onMove({ clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false });
  }
}

function onTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length >= 2) return;
  if (state.pinch && e.touches.length === 1) {
    state.pinch = null;
    return;
  }
  state.pinch = null;
  const t = e.changedTouches[0];
  onUp(t ? { clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false } : {});
  setTimeout(() => {
    state.touching = false;
  }, 350);
}

function onDown(e) {
  if (e instanceof MouseEvent && state.touching) return;
  const { x, y } = localXY(e);
  const w = screenToWorld(x, y);
  if (e.button === 2) {
    e.preventDefault();
    if (state.portal.held) {
      placePortalAt(w.x - state.portal.grabX, w.y - state.portal.grabY);
      return;
    }
    state.panning = true;
    state.panFrom = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y };
    return;
  }
  if (e.button === 1) {
    state.panning = true;
    state.panFrom = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y };
    return;
  }
  if (e.button === 0) {
    if (state.portal.held) return;
    if (state.layer === "build" && planOverlayHitScreen(x, y)) {
      state.planOverlayDrag = {
        grabX: w.x - state.planOverlay.x,
        grabY: w.y - state.planOverlay.y,
      };
      return;
    }
    if (state.paintMode === "pan") {
      state.panning = true;
      state.panFrom = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y };
      return;
    }
    if (state.layer === "build" && !wantsErase(e)) {
      const hit = hitBuilding(w.x, w.y);
      if (hit >= 0) {
        const building = state.buildings[hit];
        state.selectedBld = hit;
        state.buildingDrag = {
          index: hit,
          grabX: w.x - building.x,
          grabY: w.y - building.y,
          saved: false,
        };
        document.getElementById("itemId").value = building.item || 0;
        document.getElementById("itemDir").value = building.dir || 0;
        draw();
        return;
      }
    }
    if (portalHitScreen(x, y)) {
      state.portal.held = true;
      state.portal.grabX = w.x - state.portal.x;
      state.portal.grabY = w.y - state.portal.y;
      draw();
      return;
    }
    const erase = wantsErase(e);
    if (state.layer === "terrain" && state.tool === "fill") {
      floodFillAt(w.x, w.y);
      return;
    }
    if (state.layer === "terrain" && isShapeTool(state.tool)) {
      const logical = nativePointToLogical(w.x, w.y);
      state.shapeDrag = {
        u0: logical.u,
        v0: logical.v,
        u1: logical.u,
        v1: logical.v,
      };
      state.shapeShift = e.shiftKey;
      state.dragging = true;
      state.strokeSaved = false;
      draw();
      return;
    }
    state.dragging = true;
    state.strokeSaved = false;
    paintAt(w.x, w.y, erase);
    state.lastPaint = nativePointToLogical(w.x, w.y);
  }
}

function onMove(e) {
  if (e instanceof MouseEvent && state.touching) return;
  const { x, y } = localXY(e);
  const w = screenToWorld(x, y);
  const coord = document.getElementById("coord");
  if (coord) coord.textContent = Math.round(w.x) + ", " + Math.round(w.y);
  if (state.planOverlayDrag && state.planOverlay) {
    state.planOverlay.x = Math.max(0, Math.min(worldExtent(), snap(w.x - state.planOverlayDrag.grabX)));
    state.planOverlay.y = Math.max(0, Math.min(worldExtent(), snap(w.y - state.planOverlayDrag.grabY)));
    draw();
    return;
  }
  if (state.buildingDrag) {
    const building = state.buildings[state.buildingDrag.index];
    if (!building) {
      state.buildingDrag = null;
      return;
    }
    if (!state.buildingDrag.saved) {
      pushHist();
      state.buildingDrag.saved = true;
    }
    building.x = Math.max(0, Math.min(worldExtent(), snap(w.x - state.buildingDrag.grabX)));
    building.y = Math.max(0, Math.min(worldExtent(), snap(w.y - state.buildingDrag.grabY)));
    draw();
    return;
  }
  if (state.portal.held) {
    const p = clampPortal(w.x - state.portal.grabX, w.y - state.portal.grabY);
    state.portal.x = p.x;
    state.portal.y = p.y;
    draw();
    return;
  }
  if (state.panning && state.panFrom) {
    const r = view.getBoundingClientRect();
    const sx = view.width / Math.max(1, r.width);
    const sy = view.height / Math.max(1, r.height);
    state.cam.x = state.panFrom.cx + (e.clientX - state.panFrom.x) * sx;
    state.cam.y = state.panFrom.cy + (e.clientY - state.panFrom.y) * sy;
    draw();
    return;
  }
  if (!state.dragging || state.layer !== "terrain") return;
  if (state.tool === "fill") return;
  if (isShapeTool(state.tool) && state.shapeDrag) {
    const logical = nativePointToLogical(w.x, w.y);
    state.shapeDrag.u1 = logical.u;
    state.shapeDrag.v1 = logical.v;
    state.shapeShift = e.shiftKey;
    draw();
    return;
  }
  const logical = nativePointToLogical(w.x, w.y);
  if (state.lastPaint && logical.u === state.lastPaint.u && logical.v === state.lastPaint.v) return;
  paintAt(w.x, w.y, wantsErase(e));
  state.lastPaint = logical;
}

function onUp(e) {
  if (state.buildingDrag?.saved) markDirty();
  state.buildingDrag = null;
  state.planOverlayDrag = null;
  if (state.dragging && state.layer === "terrain" && isShapeTool(state.tool) && state.shapeDrag) {
    const d = state.shapeDrag;
    const cells = collectShapeCells(state.tool, d.u0, d.v0, d.u1, d.v1, {
      mode: currentShapeMode(),
      square: !!(e && e.shiftKey) || state.shapeShift,
    });
    state.shapeDrag = null;
    state.dragging = false;
    state.panning = false;
    state.lastPaint = null;
    state.strokeSaved = false;
    paintCells(cells, wantsErase(e));
    return;
  }
  state.shapeDrag = null;
  state.dragging = false;
  state.panning = false;
  state.lastPaint = null;
  state.strokeSaved = false;
  if (state.strokeNeedsRebuild) {
    commitPaintStroke();
    draw();
  }
}

function onWheel(e) {
  e.preventDefault();
  const { x, y } = localXY(e);
  const before = screenToWorld(x, y);
  const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.cam.k = Math.min(8, Math.max(0.08, state.cam.k * k));
  const after = worldToScreen(before.x, before.y);
  state.cam.x += x - after.x;
  state.cam.y += y - after.y;
  draw();
}

function onKey(e) {
  if (typeof isAppDialogOpen === "function" && isAppDialogOpen()) return;
  if (e.target && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    redo();
    return;
  }
  if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    undo();
    return;
  }
  if ((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Escape") {
    if (state.shapeDrag) {
      state.shapeDrag = null;
      state.dragging = false;
      draw();
    }
    return;
  }
  if (e.key === "Delete" && state.selectedBld >= 0) {
    pushHist();
    state.buildings.splice(state.selectedBld, 1);
    state.selectedBld = -1;
    draw();
    return;
  }
  if ((e.key === "q" || e.key === "e") && state.selectedBld >= 0) {
    const b = state.buildings[state.selectedBld];
    if (b) {
      b.dir = ((b.dir || 0) + (e.key === "e" ? 1 : 3)) % 4;
      document.getElementById("itemDir").value = b.dir;
      draw();
      return;
    }
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      setPaintMode("brush");
      return;
    }
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      setPaintMode("erase");
      return;
    }
    const map = {
      g: "fill",
      l: "line",
      r: "rect",
      o: "ellipse",
      f: "free",
    };
    const t = map[e.key.toLowerCase()];
    if (t) {
      e.preventDefault();
      setTool(t);
    }
  }
}

async function applyTerrain(doc, quiet) {
  pushHist();
  state.stamps = doc.stamps || [];
  state.grassKeep = new Set();
  state.mapSize = doc.size;
  state.mapflag = doc.mapflag;
  state.terrainSource = doc._source || null;
  ensureSize(doc.size);
  syncChgTerrButton();
  state.unknown = new Set();
  for (const s of state.stamps) {
    if (!brushByPaperChar(s.kind) && !tileByChar(s.kind)) state.unknown.add(s.kind);
    const b = brushByPaperChar(s.kind);
    const t = b || tileByChar(s.kind);
    if (t && t.texture) preload("/tiles/" + t.texture);
  }
  rebuildStampIndex();
  fitTerrainContent();
  markDirty();
  saveDraft();
  draw();
  if (quiet) return;
  const unk = state.unknown.size ? "；未对照种类 " + [...state.unknown].join(" ") : "";
  await appAlert(
    "已导入 " +
      state.stamps.length +
      " 笔地形，面积 " +
      doc.size +
      unk +
      "。已按原版四角地形网格重放笔刷并合成过渡。",
    { title: "导入完成" }
  );
}

let buildingPreviewCatalogPromise = null;

function ensureBuildingPreviewCatalog() {
  if (!buildingPreviewCatalogPromise) {
    buildingPreviewCatalogPromise = Promise.all([
      fetch("/api/editor-catalog").then((response) => response.json()),
      fetch("/data/building_pack_uids.json").then((response) => response.json()),
    ]).then(([catalog, packUids]) => ({
      catalog,
      packUids: packUids.mapping || {},
      packs: new Map((catalog.building?.packs || []).map((pack) => [pack.key, pack])),
    }));
  }
  return buildingPreviewCatalogPromise;
}

function deskPreviewComponent(mat, previewCatalog, localPackKey = "") {
  const value = Number(mat) || 0;
  const local = value < 1000 ? value : value % 1000;
  const packKey =
    value < 1000
      ? localPackKey
      : previewCatalog.packUids[String(Math.floor(value / 1000))];
  const pack = previewCatalog.packs.get(packKey);
  if (!pack) return null;
  const component = (pack.components || []).find(
    (row) => row.kind === "sprite" && Number(row.id) === local
  );
  return component ? { component, pack } : null;
}

function deskPreviewSpriteUrl(component, pack, frame) {
  if (!component?.file || !pack) return "";
  const path = component.file.split("/").map(encodeURIComponent).join("/");
  const frameCount = Math.max(1, Number(component.asset?.frames) || 1);
  const face = Math.max(0, Number(frame) || 0) % frameCount;
  return `/bdesign/ale/${pack.kind === "item" ? "item" : "res"}/${encodeURIComponent(pack.key)}/${path}.png?f=${face}`;
}

function loadStandaloneImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function openDeskBuildingCode(doc, fileName) {
  const previewCatalog = await ensureBuildingPreviewCatalog();
  const unresolved = [];
  const rows = (doc.records || [])
    .filter((record) => Number(record.mat) && Number(record.x) < 32000 && Number(record.y) < 32000)
    .map((record) => {
      const solved = deskPreviewComponent(record.mat, previewCatalog);
      if (!solved) unresolved.push(Number(record.mat) || 0);
      return { record, solved };
    });
  const rendered = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      image: row.solved
        ? await loadStandaloneImage(
            deskPreviewSpriteUrl(
              row.solved.component,
              row.solved.pack,
              row.record.state ?? row.record.flip ?? 0
            )
          )
        : null,
    }))
  );
  const visible = rendered.filter((row) => row.image?.naturalWidth);
  const pad = 4;
  const sheet = document.createElement("canvas");
  const sheetContext = sheet.getContext("2d");
  if (visible.length) {
    const left = Math.min(...visible.map((row) => Number(row.record.x) || 0));
    const top = Math.min(...visible.map((row) => Number(row.record.y) || 0));
    const right = Math.max(
      ...visible.map((row) => (Number(row.record.x) || 0) + row.image.naturalWidth)
    );
    const bottom = Math.max(
      ...visible.map((row) => (Number(row.record.y) || 0) + row.image.naturalHeight)
    );
    sheet.width = Math.max(1, Math.ceil(right - left) + pad * 2);
    sheet.height = Math.max(1, Math.ceil(bottom - top) + pad * 2);
    visible.forEach((row) => {
      sheetContext.drawImage(
        row.image,
        Math.round((Number(row.record.x) || 0) - left + pad),
        Math.round((Number(row.record.y) || 0) - top + pad)
      );
    });
  } else {
    sheet.width = 320;
    sheet.height = 180;
    sheetContext.fillStyle = "#25482f";
    sheetContext.fillRect(0, 0, sheet.width, sheet.height);
    sheetContext.fillStyle = "#eef5ea";
    sheetContext.font = "14px Microsoft YaHei";
    sheetContext.textAlign = "center";
    sheetContext.fillText("没有可解析的带 UID 素材", sheet.width / 2, sheet.height / 2);
  }
  planOverlayDraft = {
    image: sheet,
    name: fileName,
    sourceKind: "code",
    codeDocument: doc,
    nativePixels: true,
    resolved: visible.length,
    unresolved: unresolved.length,
  };
  const preview = document.getElementById("planOverlayPreview");
  if (preview) preview.src = sheet.toDataURL("image/png");
  const title = document.querySelector("#dlgPlanOverlay .modal-cap span");
  if (title) title.textContent = "导入建筑代码";
  const info = document.getElementById("planOverlayInfo");
  if (info) {
    info.textContent =
      `已真实渲染 ${visible.length} 件素材` +
      (unresolved.length
        ? `，${unresolved.length} 件因 UID 或本地素材缺失未渲染。`
        : "，全部素材均已解析");
  }
  document.getElementById("planOverlayWidth").value = "11";
  document.getElementById("planOverlayHeight").value = "11";
  document.getElementById("btnApplyPlanOverlay").disabled = visible.length === 0;
  showDlg("dlgPlanOverlay", true);
}

async function importFile(file, expect) {
  try {
    const buf = await file.arrayBuffer();
    if (expect === "terrain") {
      const res = await fetch("/api/parse-terrain", { method: "POST", body: buf });
      if (!res.ok) throw new Error("地形图纸解析失败 (" + res.status + ")");
      await applyTerrain(await res.json(), false);
      return;
    }
    if (expect === "build") {
      const res = await fetch("/api/parse-building", { method: "POST", body: buf });
      if (!res.ok) throw new Error("建筑图纸解析失败 (" + res.status + ")");
      const doc = await res.json();
      if (doc.kind === "desk") {
        await openDeskBuildingCode(doc, file.name);
        return;
      }
      pushHist();
      state.bldKind = doc.kind;
      state.buildingSource = doc._source || null;
      state.buildings = doc.records.map((r) => ({ ...r }));
      state.buildings.forEach((b) => rememberItem(b.item || b.mat));
      markDirty();
      draw();
      await appAlert("已导入建筑 " + state.buildings.length + " 个（" + doc.kind + "）", { title: "导入完成" });
      return;
    }
    await appAlert("无法识别图纸格式。", { title: "导入失败" });
  } catch (err) {
    await appAlert(err.message || String(err), { title: "导入失败" });
  }
}

function pixelTerrainBrushes() {
  return sortBrushesFlat(state.kinds.brushes || []).filter(
    (brush) => Number(brush.stampSize || 1) === 1 && paperKindOfBrush(brush)
  );
}

function sampleImageTerrain() {
  if (!imageTerrainDraft?.image) return null;
  const width = Math.max(1, Math.min(96, Number(document.getElementById("imageTerrainWidth")?.value) || 1));
  const height = Math.max(1, Math.min(96, Number(document.getElementById("imageTerrainHeight")?.value) || 1));
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const g = scratch.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, width, height);
  g.imageSmoothingEnabled = true;
  if (g.imageSmoothingQuality) g.imageSmoothingQuality = "high";
  const image = imageTerrainDraft.image;
  const fit = document.getElementById("imageTerrainFit")?.value || "contain";
  if (fit === "stretch") {
    g.drawImage(image, 0, 0, width, height);
  } else {
    const scale =
      fit === "cover"
        ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
        : Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    g.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  const pixels = g.getImageData(0, 0, width, height).data;
  return { width, height, pixels, scratch };
}

function rgbToLab(r, g, b) {
  const linear = (value) => {
    const n = value / 255;
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const curve = (value) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = curve(x);
  const fy = curve(y);
  const fz = curve(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function clusteredImagePalette(pixels, requested, alphaThreshold) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < alphaThreshold) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = rgb.join(",");
    let entry = buckets.get(key);
    if (!entry) {
      entry = { rgb, lab: rgbToLab(...rgb), count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
  }
  const samples = [...buckets.values()];
  if (!samples.length) return [];
  const count = Math.max(1, Math.min(requested, samples.length));
  const centers = [samples.reduce((best, row) => (row.count > best.count ? row : best), samples[0])];
  while (centers.length < count) {
    let pick = null;
    let score = -1;
    samples.forEach((sample) => {
      const distance = Math.min(...centers.map((center) => labDistance(sample.lab, center.lab)));
      const next = distance * Math.sqrt(sample.count);
      if (next > score) {
        score = next;
        pick = sample;
      }
    });
    centers.push(pick);
  }
  let palette = centers.map((center) => ({ rgb: center.rgb.slice(), lab: center.lab.slice(), count: 0 }));
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = palette.map(() => ({ rgb: [0, 0, 0], count: 0 }));
    samples.forEach((sample) => {
      let best = 0;
      let distance = Infinity;
      palette.forEach((center, index) => {
        const next = labDistance(sample.lab, center.lab);
        if (next < distance) {
          distance = next;
          best = index;
        }
      });
      const sum = sums[best];
      sum.count += sample.count;
      for (let channel = 0; channel < 3; channel++) {
        sum.rgb[channel] += sample.rgb[channel] * sample.count;
      }
    });
    palette = palette.map((center, index) => {
      const sum = sums[index];
      if (!sum.count) return center;
      const rgb = sum.rgb.map((value) => Math.round(value / sum.count));
      return { rgb, lab: rgbToLab(...rgb), count: sum.count };
    });
  }
  return palette.sort((a, b) => b.count - a.count);
}

function imageTerrainLogicalPoint(px, py, width, height, center, projection) {
  const imageX = px - Math.floor(width / 2);
  const imageY = py - Math.floor(height / 2);
  if (projection === "iso") {
    return { u: center.u + imageX, v: center.v + imageY };
  }
  const anchor = logicalToNative(center.u, center.v);
  return uvFromColRow(anchor.col + imageX, anchor.row + imageY);
}

function suggestedPixelBrushIndex(rgb, brushes) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let type = "土地";
  if (max - min < 34) type = max > 205 ? "雪地" : "砖地";
  else if (b > r * 1.15 && b > g * 1.08) type = "水面";
  else if (g > r * 1.08 && g > b * 1.06) type = "草地";
  else if (r > 170 && b > 110 && g < r * 0.88) type = "花丛";
  else if (r > 190 && g > 160 && b < 130) type = "土地";
  const index = brushes.findIndex((brush) => brushPaletteType(brush) === type);
  return Math.max(0, index);
}

function renderImageTerrainMapping() {
  const sampled = sampleImageTerrain();
  const preview = document.getElementById("imageTerrainPreview");
  const mapping = document.getElementById("imageColorMap");
  if (!sampled || !preview || !mapping) return;
  const alphaThreshold = Math.max(
    0,
    Math.min(255, Number(document.getElementById("imageTerrainAlpha")?.value) || 0)
  );
  const colorCount = Math.max(
    2,
    Math.min(16, Number(document.getElementById("imageTerrainColors")?.value) || 8)
  );
  const palette = clusteredImagePalette(sampled.pixels, colorCount, alphaThreshold);
  const previewPixels = new Uint8ClampedArray(sampled.pixels);
  for (let i = 0; i < previewPixels.length; i += 4) {
    if (previewPixels[i + 3] < alphaThreshold || !palette.length) continue;
    const index = nearestImagePaletteIndex(
      previewPixels[i],
      previewPixels[i + 1],
      previewPixels[i + 2],
      palette
    );
    previewPixels[i] = palette[index].rgb[0];
    previewPixels[i + 1] = palette[index].rgb[1];
    previewPixels[i + 2] = palette[index].rgb[2];
  }
  preview.width = sampled.width;
  preview.height = sampled.height;
  preview.getContext("2d").putImageData(
    new ImageData(previewPixels, sampled.width, sampled.height),
    0,
    0
  );
  const brushes = pixelTerrainBrushes();
  imageTerrainDraft.sampled = sampled;
  imageTerrainDraft.palette = palette;
  mapping.replaceChildren();
  palette.forEach((entry, paletteIndex) => {
    const row = document.createElement("label");
    row.className = "image-color-row";
    const swatch = document.createElement("span");
    swatch.className = "image-color-swatch";
    swatch.style.background = `rgb(${entry.rgb.join(",")})`;
    const select = document.createElement("select");
    select.className = "input";
    select.dataset.paletteIndex = String(paletteIndex);
    const skip = document.createElement("option");
    skip.value = "-1";
    skip.textContent = "跳过（保留原地形）";
    select.appendChild(skip);
    brushes.forEach((brush, brushIndex) => {
      const option = document.createElement("option");
      option.value = String(brushIndex);
      option.textContent = `${brushPaletteType(brush)} · ${brushDisplayName(brush)}`;
      select.appendChild(option);
    });
    select.value = String(suggestedPixelBrushIndex(entry.rgb, brushes));
    const count = document.createElement("small");
    count.textContent = `${entry.count} 像素`;
    row.append(swatch, select, count);
    mapping.appendChild(row);
  });
}

function nearestImagePaletteIndex(r, g, b, palette) {
  const lab = rgbToLab(r, g, b);
  let best = 0;
  let distance = Infinity;
  palette.forEach((entry, index) => {
    const next = labDistance(lab, entry.lab || rgbToLab(...entry.rgb));
    if (next < distance) {
      distance = next;
      best = index;
    }
  });
  return best;
}

async function openImageTerrain(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("图片读取失败"));
      next.src = url;
    });
    imageTerrainDraft = { image, name: file.name, sampled: null, palette: [] };
    const maxCells = Math.max(1, Math.min(96, Math.floor(state.mapSize / SNAP)));
    const scale = Math.min(1, maxCells / Math.max(image.naturalWidth, image.naturalHeight));
    document.getElementById("imageTerrainWidth").value = String(
      Math.max(1, Math.round(image.naturalWidth * scale))
    );
    document.getElementById("imageTerrainHeight").value = String(
      Math.max(1, Math.round(image.naturalHeight * scale))
    );
    renderImageTerrainMapping();
    showDlg("dlgImageTerrain", true);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function applyImageTerrain() {
  const draft = imageTerrainDraft;
  if (!draft?.sampled || !draft.palette.length) return;
  const brushes = pixelTerrainBrushes();
  const chosen = [...document.querySelectorAll("#imageColorMap select")].map(
    (select) => brushes[Number(select.value) || 0]
  );
  const { width, height, pixels } = draft.sampled;
  const center = nativePointToLogical(state.mapSize / 2, state.mapSize / 2);
  const projection = document.getElementById("imageTerrainProjection")?.value || "front";
  const alphaThreshold = Math.max(
    0,
    Math.min(255, Number(document.getElementById("imageTerrainAlpha")?.value) || 0)
  );
  const cells = [];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const offset = (py * width + px) * 4;
      if (pixels[offset + 3] < alphaThreshold) continue;
      const paletteIndex = nearestImagePaletteIndex(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        draft.palette
      );
      const brush = chosen[paletteIndex];
      const logical = imageTerrainLogicalPoint(px, py, width, height, center, projection);
      if (!brush || !logical || !logicalInMap(logical.u, logical.v)) continue;
      cells.push({ u: logical.u, v: logical.v, brush });
    }
  }
  if (!cells.length) return;
  pushHist();
  if (document.getElementById("imageTerrainReplace")?.checked) {
    state.stamps = [];
    state.grassKeep = new Set();
  }
  const keys = new Set(cells.map((cell) => cellKey(cell.u, cell.v)));
  state.stamps = state.stamps.filter((stamp) => {
    const logical = nativePointToLogical(stamp.x, stamp.y);
    return !keys.has(cellKey(logical.u, logical.v));
  });
  const baseCells = [];
  const paintedCells = [];
  cells.forEach((cell) => {
    if (brushPaintsBase(cell.brush)) {
      baseCells.push(cell);
      return;
    }
    const pos = logicalToNative(cell.u, cell.v);
    state.stamps.push({ kind: paperKindOfBrush(cell.brush), x: pos.cx, y: pos.cy });
    paintedCells.push(cell);
  });
  markGrassKeep(baseCells, true);
  markGrassKeep(paintedCells, false);
  rebuildStampIndex();
  markDirty();
  showDlg("dlgImageTerrain", false);
  draw();
}

async function openPlanOverlay(file) {
  if (planOverlayDraft?.url) URL.revokeObjectURL(planOverlayDraft.url);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("建筑预览图读取失败"));
      next.src = url;
    });
    planOverlayDraft = { image, name: file.name, url };
    const preview = document.getElementById("planOverlayPreview");
    if (preview) preview.src = url;
    const title = document.querySelector("#dlgPlanOverlay .modal-cap span");
    if (title) title.textContent = "导入建筑图片";
    const info = document.getElementById("planOverlayInfo");
    if (info) info.textContent = "原图会保持宽高比例；占地与图片本身分开显示。";
    document.getElementById("btnApplyPlanOverlay").disabled = false;
    showDlg("dlgPlanOverlay", true);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function updatePlanOverlayMeta() {
  const meta = document.getElementById("planOverlayMeta");
  const label = document.getElementById("planOverlayFootprint");
  const overlay = state.planOverlay;
  if (meta) meta.hidden = !overlay;
  if (label && overlay) {
    const type = overlay.sourceKind === "code" ? "建筑代码" : "建筑图片";
    label.textContent =
      `${type} · 占地 ${overlay.footprint[0]}×${overlay.footprint[1]} · ` +
      `${overlay.footprint[0] * overlay.footprint[1]} 格 · 直接拖动建筑可移动`;
  }
}

function applyPlanOverlay() {
  if (!planOverlayDraft?.image) return;
  const width = Math.max(1, Math.min(64, Number(document.getElementById("planOverlayWidth")?.value) || 1));
  const height = Math.max(1, Math.min(64, Number(document.getElementById("planOverlayHeight")?.value) || 1));
  const center = screenToWorld(view.width / 2, view.height / 2);
  state.planOverlay = {
    ...planOverlayDraft,
    x: snap(center.x),
    y: snap(center.y),
    footprint: [width, height],
  };
  const showOverlay = document.getElementById("showPlanOverlay");
  if (showOverlay) showOverlay.checked = true;
  setLayer("build");
  showDlg("dlgPlanOverlay", false);
  updatePlanOverlayMeta();
  draw();
}

function removePlanOverlay() {
  if (planOverlayDraft?.url) URL.revokeObjectURL(planOverlayDraft.url);
  state.planOverlay = null;
  planOverlayDraft = null;
  const preview = document.getElementById("planOverlayPreview");
  if (preview) preview.removeAttribute("src");
  updatePlanOverlayMeta();
  draw();
}

function ensureSize(n) {
  const sel = document.getElementById("mapSize");
  if (!sel) {
    state.mapSize = n;
    return;
  }
  if (![...sel.options].some((o) => +o.value === n)) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = n + " · 图纸";
    sel.appendChild(o);
  }
  sel.value = String(n);
  state.mapSize = n;
}

function toGbkBytes(text) {
  if (text.startsWith("模板=")) {
    const prefix = new Uint8Array([0xc4, 0xa3, 0xb0, 0xe5, 0x3d]);
    const rest = new TextEncoder().encode(text.slice(3));
    const out = new Uint8Array(prefix.length + rest.length);
    out.set(prefix, 0);
    out.set(rest, prefix.length);
    return out;
  }
  return new TextEncoder().encode(text);
}

function isGbkTemplate(bytes) {
  return bytes && bytes.length >= 6 && bytes[0] === 0xc4 && bytes[1] === 0xa3 && bytes[2] === 0xb0 && bytes[3] === 0xe5 && bytes[4] === 0x3d;
}

function exportFileName(fallback) {
  const ext = (/\.[a-z0-9]+$/i.exec(fallback || "map.txt") || [".txt"])[0];
  const raw = (document.getElementById("desc")?.value || "").trim();
  let safe = raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim();
  safe = safe.replace(/\.[a-z0-9]+$/i, "");
  if (!safe) return fallback;
  return safe + ext;
}

function withDrawTarget(canvas, cam, fn) {
  const prevView = view;
  const prevCtx = ctx;
  const prevCam = { x: state.cam.x, y: state.cam.y, k: state.cam.k };
  view = canvas;
  ctx = canvas.getContext("2d", { alpha: false });
  state.cam.x = cam.x;
  state.cam.y = cam.y;
  state.cam.k = cam.k;
  try {
    fn();
  } finally {
    view = prevView;
    ctx = prevCtx;
    state.cam.x = prevCam.x;
    state.cam.y = prevCam.y;
    state.cam.k = prevCam.k;
  }
}

async function exportTerrainPng() {
  if (state.strokeNeedsRebuild) {
    commitPaintStroke();
    draw();
  }
  const n = worldExtent();
  const pad = TILE_DW;
  let k = 1;
  let w = Math.ceil(n * k + pad * 2);
  let h = Math.ceil(n * k * ISO_Y + pad * 2);
  const maxSide = 4096;
  const biggest = Math.max(w, h);
  if (biggest > maxSide) {
    k *= maxSide / biggest;
    w = Math.ceil(n * k + pad * 2);
    h = Math.ceil(n * k * ISO_Y + pad * 2);
  }
  const out = document.createElement("canvas");
  try {
    out.width = w;
    out.height = h;
  } catch (err) {
    await appAlert("图片太大，无法导出。", { title: "导出失败" });
    return;
  }
  setSaveStatus("正在导出图片…");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    withDrawTarget(out, { x: pad, y: pad, k }, () => {
    ctx.fillStyle = deskChrome();
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    clipMap();
    ctx.fillStyle = planeBackdrop();
    ctx.fillRect(0, 0, w, h);
    drawTerrainCells();
      ctx.restore();
      ctx.save();
      clipMap();
      drawPortal();
      ctx.restore();
      if (document.getElementById("showBuild")?.checked) {
        const order = state.buildings
          .map((b, i) => ({ b, i }))
          .sort((a, c) => a.b.x + a.b.y - (c.b.x + c.b.y));
        for (const { b, i } of order) drawBuilding(b, i === state.selectedBld);
      }
    });
  } catch (err) {
    console.warn(err);
    gridPixels = null;
    gridScreenKey = "";
    terrainScreenKey = "";
    setSaveStatus("导出失败");
    await appAlert("导出图片失败。", { title: "导出失败" });
    draw();
    return;
  }
  gridPixels = null;
  gridScreenKey = "";
  terrainScreenKey = "";
  const filename = exportFileName("map.png");
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  if (blob) fallbackDownload(blob, filename);
  else await appAlert("导出图片失败。", { title: "导出失败" });
  setSaveStatus("已导出 " + filename);
  draw();
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const file = new File([blob], filename, { type: "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: filename }).catch((err) => {
      if (err && err.name === "AbortError") return;
      fallbackDownload(blob, filename);
    });
  }
  fallbackDownload(blob, filename);
}

function fallbackDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadGbk(text, filename) {
  downloadBytes(toGbkBytes(text), filename);
}

async function exportTerrain() {
  const paper = state.stamps.filter((s) => s.kind && s.kind.charAt(0) !== "@");
  if (!paper.length && state.stamps.length) {
    await appAlert("当前预览里有商店图纸里没有的地块，导出时会跳过它们。请先用右侧列表里的地形刷一遍，再生成图纸。", {
      title: "无法导出",
    });
    return;
  }
  const text = formatTerrain(paper, state.mapSize, state.mapflag);
  let bytes = null;
  try {
    const res = await fetch("/api/format-terrain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stamps: paper,
        size: state.mapSize,
        mapflag: state.mapflag,
        _source: state.terrainSource,
      }),
    });
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    bytes = null;
  }
  if (!isGbkTemplate(bytes)) bytes = toGbkBytes(text);
  if (!isGbkTemplate(bytes)) {
    await appAlert("导出失败：文件头不是 GBK 的「模板=」，游戏会拒收。", { title: "导出失败" });
    return;
  }
  const filename = exportFileName("map.txt");
  downloadBytes(bytes, filename);
  await appAlert(
    "已导出 " +
      filename +
      "（GBK，" +
      state.stamps.length +
      " 个图章，size=" +
      state.mapSize +
      "）。游戏设计桌当前面积必须是 " +
      state.mapSize +
      " 才能导入；种类按游戏图纸用室内地块码（如 F/H）。",
    { title: "导出完成" }
  );
}

async function exportBuild() {
  const kind = state.bldKind || "manor";
  let bytes = null;
  try {
    const res = await fetch("/api/format-building", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        records: state.buildings,
        _source: state.buildingSource,
      }),
    });
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    bytes = null;
  }
  if (!bytes || bytes.length < 3 || bytes[0] !== 0x56 || bytes[1] !== 0x31 || bytes[2] !== 0x3b) {
    bytes = toGbkBytes(formatV1(state.buildings, kind));
  }
  downloadBytes(bytes, kind === "desk" ? "build.txt" : "manor.txt");
}

boot().catch((e) => {
  document.getElementById("stats").textContent = "启动失败: " + e;
});
