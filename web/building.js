const DESIGN_W = 570;
const DESIGN_H = 550;
/** 对齐 builddesign.cfg 素材列表 / 截图顺序 */
const CATEGORY_ORDER = ["装饰", "门窗", "地面", "屋顶", "墙壁", "套件"];
/** 截图与常见主题优先排序 */
const THEME_ORDER = [
  "redera",
  "giant",
  "paradise",
  "shiqi",
  "snow",
  "rose",
  "antique",
  "japan",
  "europe",
  "greece",
  "egypt",
  "park",
  "bazaar",
  "fruit",
  "flower1",
  "flower2",
  "sea",
  "military",
  "space",
  "supermarket",
  "candy",
  "q",
  "toy",
  "muguang",
  "tds",
];
const BASE_KIND_TABS = [
  { kind: 0, label: "普通房屋" },
  { kind: 1, label: "种植房屋" },
  { kind: 2, label: "养殖房屋" },
  { kind: 3, label: "装饰建筑" },
  { kind: 4, label: "高级装饰" },
];
const CUSTOMS_KEY = "manor-building-customs-v1";
const SESSION_KEY = "manor-building-session-v1";
const OBJECT_SNAP_PX = 6;
const MAX_PLANE = 2560;
// Locked: ignore wrapped uint15 outliers so mixed papers stay canvas-centered.
const MAX_CONTENT_COORD = 2047;
const IMAGE_INFLIGHT_MAX = 8;
const LAYER_ROW_H = 52;
const LAYER_WINDOW_PAD = 10;
const COMPONENT_LOOKUP = new Map();
const PACK_INDEX = new Map();

const state = {
  catalog: null,
  uidCatalog: null,
  packUids: {},
  packs: [],
  pack: null,
  category: "装饰",
  component: null,
  base: null,
  baseKind: 0,
  baseLayout: null,
  paperLayout: false,
  basePicked: false,
  paperBaseHint: "",
  phase: "select",
  records: [],
  source: null,
  selected: [],
  marquee: null,
  dragging: null,
  hover: null,
  ghost: null,
  images: new Map(),
  history: [],
  redo: [],
  keepFoundation: true,
  brushState: 0,
  snap: { enabled: true, step: 4, object: true },
  veil: { enabled: true, opacity: 0.42 },
  zoom: 1,
  guides: [],
  clipboard: null,
  customs: [],
  customBrush: null,
  railTab: "assets",
  layerCollapsed: new Set(),
  layerFilter: "",
  paletteDrag: null,
  sessionDirty: false,
};

const canvas = document.getElementById("buildingView");
const ctx = canvas.getContext("2d", { alpha: false });
let sessionSaveTimer = null;
let restoringSession = false;
let renderQueued = false;
let imageInflight = 0;
const imageQueue = [];
let layerItemsCache = [];
let layerListBound = false;
let layerWindowRaf = 0;
let lastSceneKey = "";

async function bootBuilding() {
  document.documentElement.classList.add("boot-pending");
  loadImage("/bdesign/imgs/glsbg.gif");
  const [catalog, uidCatalog, packUids] = await Promise.all([
    fetch("/api/editor-catalog").then((response) => response.json()),
    fetch("/data/building_uid_map.json")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .catch(() => ({ packs: [] })),
    fetch("/data/building_pack_uids.json")
      .then((response) => (response.ok ? response.json() : { mapping: {} }))
      .catch(() => ({ mapping: {} })),
  ]);
  state.catalog = catalog;
  state.uidCatalog = uidCatalog;
  state.packUids = packUids.mapping || {};
  state.packs = sortThemes(catalog.building.packs.filter((pack) => pack.kind === "theme"));
  state.indexedPacks = (catalog.building.packs || []).filter(
    (pack) => pack.kind === "theme" || pack.kind === "item"
  );
  PACK_INDEX.clear();
  COMPONENT_LOOKUP.clear();
  (state.indexedPacks || []).forEach((pack) => PACK_INDEX.set(pack.key, pack));
  state.packs.forEach((pack) => {
    if (!PACK_INDEX.has(pack.key)) PACK_INDEX.set(pack.key, pack);
  });
  state.pack =
    state.packs.find((pack) => pack.key === "redera") || state.packs[0] || null;
  ensureActiveCategory();
  state.base =
    catalog.building.bases.find((base) => base.kind === 0) || catalog.building.bases[0] || null;
  loadCustoms();
  bindBuilding();
  fillThemes();
  fillCategories();
  fillComponents();
  fillBaseKindTabs();
  fillBaseIcons();
  fillCustoms();
  setRailTab("assets");
  const restored = restoreBuildingSession();
  if (!restored) {
    setPhase("select");
    updateBase();
  }
  syncSnapUi();
  syncVeilControls();
  applyZoom();
  updateAlignBar();
  updateSelectionCaption();
  renderBuilding();
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
  });
}

function sortThemes(packs) {
  const rank = new Map(THEME_ORDER.map((key, index) => [key, index]));
  return [...packs].sort((a, b) => {
    const ai = rank.has(a.key) ? rank.get(a.key) : 1000;
    const bi = rank.has(b.key) ? rank.get(b.key) : 1000;
    if (ai !== bi) return ai - bi;
    return String(a.name).localeCompare(String(b.name), "zh");
  });
}

function categoryCounts(pack) {
  const counts = new Map(CATEGORY_ORDER.map((category) => [category, 0]));
  if (!pack) return counts;
  pack.components.forEach((component) => {
    if (counts.has(component.category)) {
      counts.set(component.category, counts.get(component.category) + 1);
    }
  });
  return counts;
}

function ensureActiveCategory() {
  if (!state.pack) return;
  const counts = categoryCounts(state.pack);
  if ((counts.get(state.category) || 0) > 0) return;
  const next = CATEGORY_ORDER.find((category) => (counts.get(category) || 0) > 0);
  if (next) state.category = next;
}

function themeSearchQuery() {
  const input = document.getElementById("themeSearch");
  return (input?.value || "").trim().toLowerCase();
}

function updateAssetFilterSummary() {
  const summary = document.getElementById("assetFilterSummary");
  if (!summary) return;
  if (!state.pack) {
    summary.textContent = "选择主题与类别";
    return;
  }
  const count = state.pack.components.filter((component) => component.category === state.category).length;
  summary.textContent = count
    ? `${state.pack.name} · ${state.category} · ${count} 项素材`
    : `${state.pack.name} · ${state.category} · 无素材`;
}

function setPhase(phase) {
  state.phase = phase;
  const app = document.getElementById("buildingApp");
  app.classList.toggle("phase-select", phase === "select");
  app.classList.toggle("phase-design", phase === "design");
  document.getElementById("materialSide").hidden = phase !== "design";
  document.getElementById("baseSelectSide").hidden = phase !== "select";
  const designDock = document.getElementById("designDock");
  if (designDock) designDock.hidden = phase !== "design";
  if (phase !== "design") {
    state.ghost = null;
    state.hover = null;
    state.marquee = null;
    state.dragging = null;
    state.guides = [];
  }
  updateAlignBar();
  markBuildingDirty();
}

function placedDesignCount() {
  return state.records.filter((record) => !record.hidden && Number(record.mat) !== 0).length;
}

function invalidateBaseLayout() {
  state.baseLayout = null;
  lastSceneKey = "";
}

function syncDesignResetButtons() {
  const count = placedDesignCount();
  const start = document.getElementById("btnNextBase");
  if (start) {
    start.textContent = count ? "重新开始设计" : "开始设计";
    start.title = count
      ? `当前有 ${count} 件装修，点此会询问是否清空后换户型`
      : "进入当前户型开始装修";
  }
  const clear = document.getElementById("btnClearDesign");
  if (clear) {
    clear.disabled = count < 1;
    clear.title = count ? `清空 ${count} 件装修，保留当前户型` : "没有可清空的装修";
  }
}

function clearCurrentDesign({ ask = false } = {}) {
  const count = placedDesignCount();
  if (count < 1) {
    if (ask) alert("当前没有可清空的装修。");
    return false;
  }
  if (ask) {
    const name = state.base?.name || "当前户型";
    if (!confirm(`清空「${name}」上的 ${count} 件装修，只留空地基？`)) return false;
  }
  pushHistory();
  state.records = [];
  state.paperLayout = false;
  state.source = null;
  state.redo = [];
  invalidateBaseLayout();
  cancelPick();
  fillLayers();
  syncDesignResetButtons();
  markBuildingDirty();
  renderBuilding();
  return true;
}

function beginDesign() {
  if (!state.base) {
    alert("请先选择户型。");
    return;
  }
  const count = placedDesignCount();
  if (count > 0) {
    const name = state.base.name;
    const wipe = confirm(
      `当前已有 ${count} 件装修。\n要用「${name}」清空后重新开始吗？\n\n确定：清空现有设计\n取消：只换户型，保留装修`
    );
    if (wipe) clearCurrentDesign({ ask: false });
  }
  invalidateBaseLayout();
  setPhase("design");
  updateBase();
  fillLayers();
  syncDesignResetButtons();
  renderBuilding();
}

function setRailTab(tab) {
  state.railTab = tab;
  document.querySelectorAll(".rail-tab").forEach((button) => {
    button.classList.toggle("on", button.dataset.tab === tab);
  });
  document.getElementById("tabAssets").hidden = tab !== "assets";
  document.getElementById("tabLayers").hidden = tab !== "layers";
  document.getElementById("tabCustoms").hidden = tab !== "customs";
  if (tab === "layers") fillLayers();
  if (tab === "customs") fillCustoms();
}

function syncSnapUi() {
  const enabled = document.getElementById("snapEnabled");
  const step = document.getElementById("snapStep");
  if (enabled) enabled.checked = !!state.snap.enabled;
  if (step) step.value = String(state.snap.step);
}

function packUidOf(pack = state.pack) {
  if (!pack) return null;
  const mapping = state.packUids || {};
  for (const [uid, key] of Object.entries(mapping)) {
    if (key === pack.key) return Number(uid);
  }
  return null;
}

function packForPaperUid(paperUid) {
  const key = (state.packUids || {})[String(paperUid)];
  return key ? packByKey(key) : null;
}

function componentUid(componentId) {
  const component = state.pack?.components.find((row) => row.id === componentId);
  if (component?.kind !== "sprite") return null;
  const usesGlobal = state.records.some((record) => Number(record.mat) >= 1000);
  const packUid = packUidOf(state.pack);
  if (usesGlobal && packUid != null) return packUid * 1000 + componentId;
  return componentId;
}

function indexedPacks() {
  return state.indexedPacks || state.packs || [];
}

function findSpriteInPack(pack, localId) {
  if (!pack) return null;
  const direct = pack.components.find(
    (component) => component.kind === "sprite" && component.id === localId
  );
  return direct ? { ...direct, _pack: pack } : null;
}

// Locked mixed-paper path: uid*1000+local → mapping[uid] → that pack's local.
// Do not borrow missing locals from mat.cfg 框架 packs.
function componentByUid(uid, pack = state.pack) {
  if (uid == null || uid === 0) return null;
  const raw = Number(uid);
  const cacheKey =
    raw >= 1000 ? `g:${raw}` : `l:${(pack || state.pack)?.key || ""}:${raw}`;
  if (COMPONENT_LOOKUP.has(cacheKey)) return COMPONENT_LOOKUP.get(cacheKey);
  let found = null;
  if (raw >= 1000) {
    const paperUid = Math.floor(raw / 1000);
    const local = raw % 1000;
    const primary = packForPaperUid(paperUid);
    found = findSpriteInPack(primary, local);
  } else {
    const preferred = pack || state.pack;
    if (preferred) {
      found = findSpriteInPack(preferred, raw);
      if (!found) {
        const solved = (state.uidCatalog.packs || []).find((row) => row.pack === preferred.key);
        const componentId = solved?.mapping?.[String(raw)]?.componentId;
        const mapped = preferred.components.find((component) => component.id === componentId);
        found = mapped ? { ...mapped, _pack: preferred } : null;
      }
    }
  }
  COMPONENT_LOOKUP.set(cacheKey, found);
  return found;
}

function packByKey(key) {
  if (!key) return null;
  return PACK_INDEX.get(key) || indexedPacks().find((pack) => pack.key === key) || null;
}

function recordPack(record) {
  return record?.pack || packByKey(record?.packKey) || state.pack;
}

function recordComponent(record) {
  if (!record) return null;
  if (record.component) return record.component;
  const pack = recordPack(record);
  const component = componentByUid(record.mat, pack);
  if (component) {
    record.component = component;
    if (!record.pack) record.pack = component._pack || pack;
    if (!record.packKey) record.packKey = (component._pack || pack)?.key;
  }
  return component;
}

function spriteUrl(component, pack = state.pack, frame = 0, thumb = false) {
  const usePack = component?._pack || pack;
  if (!component || component.kind !== "sprite" || !component.file || !usePack) return "";
  const path = `/bdesign/ale/${usePack.kind === "item" ? "item" : "res"}/${encodeURIComponent(usePack.key)}/${component.file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}.png`;
  const frameCount = Math.max(1, component.asset?.frames || 1);
  const face = Math.max(0, Number(frame) || 0) % frameCount;
  return `${path}?f=${face}${thumb ? "&thumb=1" : ""}`;
}

function buildingBaseUrl(base, preferWork = false) {
  const src = preferWork && base?.workImage ? base.workImage : base?.baseImage;
  if (!src) return "";
  return `/bdesign/imgs/${src.split("/").map(encodeURIComponent).join("/")}.png?f=0`;
}

function buildingMaskUrl(base) {
  if (!base?.maskImage) return "";
  return `/bdesign/imgs/${base.maskImage.split("/").map(encodeURIComponent).join("/")}`;
}

function pumpImageQueue() {
  while (imageInflight < IMAGE_INFLIGHT_MAX && imageQueue.length) {
    const image = imageQueue.shift();
    if (!image || image._started) continue;
    image._started = true;
    imageInflight += 1;
    const finish = () => {
      imageInflight = Math.max(0, imageInflight - 1);
      pumpImageQueue();
      scheduleRender();
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
    if (String(image._url || "").includes("glsbg")) {
      image.addEventListener("load", () => invalidateGrassLayers(), { once: true });
    }
    image.src = image._url;
  }
}

function loadImage(url) {
  if (!url) return null;
  if (state.images.has(url)) return state.images.get(url);
  const image = new Image();
  image.decoding = "async";
  image._url = url;
  state.images.set(url, image);
  imageQueue.push(image);
  pumpImageQueue();
  return image;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    paintBuilding();
  });
}

function parseSpaceTuple(raw) {
  if (!raw || typeof raw !== "string") return [0, 0, 0, 0];
  return raw.split(",").map((part) => Number(part) || 0);
}

function formatInsideSpace(base) {
  const [item, , breed] = parseSpaceTuple(base?.insideSpace);
  if (item <= 0 && breed <= 0) return "无";
  const parts = [];
  if (item > 0) parts.push(`物品 ${item}`);
  if (breed > 0) parts.push(`养殖 ${breed}`);
  return parts.join("　");
}

function formatOutsideSpace(base) {
  const [, plant, , beauty] = parseSpaceTuple(base?.outsideSpace);
  if (plant <= 0 && beauty <= 0) return "无";
  const parts = [];
  if (plant > 0) parts.push(`种植 ${plant}`);
  if (beauty > 0) parts.push(`美化 ${beauty}`);
  return parts.join("　");
}

function grassTileSource(grass) {
  if (!grass?.complete || !grass.naturalWidth) return null;
  const key = `grass-tile:${grass.src}:${grass.naturalWidth}x${grass.naturalHeight}`;
  if (state.images.has(key)) return state.images.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = grass.naturalWidth;
  sheet.height = grass.naturalHeight;
  sheet.getContext("2d").drawImage(grass, 0, 0);
  state.images.set(key, sheet);
  return sheet;
}

function fillGrassPattern(targetCtx, grass, width, height, lighten, offsetX = 0, offsetY = 0) {
  const tile = grassTileSource(grass);
  if (tile) {
    const tw = tile.width;
    const th = tile.height;
    const startX = -(((offsetX % tw) + tw) % tw);
    const startY = -(((offsetY % th) + th) % th);
    for (let y = startY; y < height; y += th) {
      for (let x = startX; x < width; x += tw) {
        targetCtx.drawImage(tile, x, y);
      }
    }
  } else {
    targetCtx.fillStyle = "#1a3a22";
    targetCtx.fillRect(0, 0, width, height);
  }
  if (lighten) {
    // Bright design volume: keep grass grain, only lift exposure slightly.
    targetCtx.fillStyle = "rgba(255, 255, 220, 0.10)";
    targetCtx.fillRect(0, 0, width, height);
  } else if (state.veil.enabled) {
    const alpha = Math.max(0, Math.min(0.95, Number(state.veil.opacity) || 0));
    if (alpha > 0.001) {
      targetCtx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      targetCtx.fillRect(0, 0, width, height);
    }
  }
}

function invalidateGrassLayers() {
  for (const key of [...state.images.keys()]) {
    if (String(key).startsWith("room-tight:")) state.images.delete(key);
  }
}

function syncVeilControls() {
  const enabled = document.getElementById("veilEnabled");
  const opacity = document.getElementById("veilOpacity");
  const label = document.getElementById("veilOpacityLabel");
  if (enabled) enabled.checked = !!state.veil.enabled;
  const pct = Math.round((Number(state.veil.opacity) || 0) * 100);
  if (opacity) {
    opacity.value = String(pct);
    opacity.disabled = !state.veil.enabled;
  }
  if (label) label.textContent = `${pct}%`;
  const app = document.getElementById("buildingApp");
  if (app) {
    const alpha = state.veil.enabled ? Math.max(0, Math.min(0.95, Number(state.veil.opacity) || 0)) : 0;
    app.style.setProperty("--build-veil", `rgba(0, 0, 0, ${alpha})`);
  }
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

function fitCanvasBaseWidth() {
  const shell = document.getElementById("canvasShell");
  if (!shell) return DESIGN_W;
  const cw = Math.max(1, canvas.width || DESIGN_W);
  const ch = Math.max(1, canvas.height || DESIGN_H);
  const padX = 0;
  const padY = 0;
  const byWidth = Math.max(200, shell.clientWidth - padX);
  const byHeight = Math.max(200, ((shell.clientHeight || 400) - padY) * (cw / ch));
  return Math.min(byWidth, byHeight);
}

function applyZoom() {
  const frame = document.getElementById("canvasFrame");
  const inner = document.getElementById("canvasZoomInner");
  const shell = document.getElementById("canvasShell");
  const label = document.getElementById("btnZoomReset");
  if (!frame || !shell) return;
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(state.zoom) || 1));
  const cw = Math.max(1, canvas.width || DESIGN_W);
  const ch = Math.max(1, canvas.height || DESIGN_H);
  const base = fitCanvasBaseWidth();
  const width = Math.max(160, Math.round(base * state.zoom));
  const height = Math.round(width * (ch / cw));
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.aspectRatio = `${cw} / ${ch}`;
  if (inner) {
    inner.style.width = `${Math.max(shell.clientWidth, width)}px`;
    inner.style.height = `${Math.max(shell.clientHeight, height)}px`;
  }
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
}

function centerCanvasInShell() {
  const shell = document.getElementById("canvasShell");
  if (!shell) return;
  const maxX = Math.max(0, shell.scrollWidth - shell.clientWidth);
  const maxY = Math.max(0, shell.scrollHeight - shell.clientHeight);
  shell.scrollLeft = maxX / 2;
  shell.scrollTop = maxY / 2;
}

function setZoom(next, clientX, clientY) {
  const shell = document.getElementById("canvasShell");
  const clamped = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
  if (!shell || Math.abs(clamped - state.zoom) < 0.001) {
    state.zoom = clamped;
    applyZoom();
    markBuildingDirty();
    return;
  }
  const rect = shell.getBoundingClientRect();
  const anchorX = clientX != null ? clientX - rect.left : shell.clientWidth / 2;
  const anchorY = clientY != null ? clientY - rect.top : shell.clientHeight / 2;
  const contentX = shell.scrollLeft + anchorX;
  const contentY = shell.scrollTop + anchorY;
  const ratio = clamped / state.zoom;
  state.zoom = clamped;
  applyZoom();
  shell.scrollLeft = contentX * ratio - anchorX;
  shell.scrollTop = contentY * ratio - anchorY;
  markBuildingDirty();
}

function zoomBy(delta, clientX, clientY) {
  setZoom(state.zoom + delta, clientX, clientY);
}

function floorOpaqueDiamond(floor) {
  const key = `floor-opaque:${floor.src}:${floor.naturalWidth}x${floor.naturalHeight}`;
  if (state.images.has(key)) return state.images.get(key);
  const width = floor.naturalWidth;
  const height = floor.naturalHeight;
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d");
  c.drawImage(floor, 0, 0);
  const { data } = c.getImageData(0, 0, width, height);
  const solid = (x, y) => data[(y * width + x) * 4 + 3] >= 200;
  let topY = -1;
  let botY = -1;
  let leftX = width;
  let rightX = -1;
  let leftY = 0;
  let rightY = 0;
  let topX0 = 0;
  let topX1 = 0;
  let botX0 = 0;
  let botX1 = 0;
  for (let y = 0; y < height; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      if (lo < 0) lo = x;
      hi = x;
      if (x < leftX) {
        leftX = x;
        leftY = y;
      }
      if (x > rightX) {
        rightX = x;
        rightY = y;
      }
    }
    if (lo < 0) continue;
    if (topY < 0) {
      topY = y;
      topX0 = lo;
      topX1 = hi;
    }
    botY = y;
    botX0 = lo;
    botX1 = hi;
  }
  if (topY < 0 || rightX < 0) return null;
  const diamond = {
    top: [(topX0 + topX1) >> 1, topY],
    bottom: [(botX0 + botX1) >> 1, botY],
    left: [leftX, leftY],
    right: [rightX, rightY],
  };
  state.images.set(key, diamond);
  return diamond;
}

function roomWallHeight(diamond, mask) {
  const floorW = Math.max(8, diamond.right[0] - diamond.left[0]);
  const floorH = Math.max(8, diamond.bottom[1] - diamond.top[1]);
  const mw = mask?.naturalWidth || 0;
  const mh = mask?.naturalHeight || 0;
  if (mw > 8 && mh > 8) {
    const fromMask = Math.round((mh * floorW) / mw - floorH);
    if (fromMask > 8) return fromMask;
  }
  return Math.round(floorH);
}

function roomHexagon(diamond, wallH) {
  return [
    [diamond.top[0], diamond.top[1] - wallH],
    [diamond.right[0], diamond.right[1] - wallH],
    diamond.right,
    diamond.bottom,
    diamond.left,
    [diamond.left[0], diamond.left[1] - wallH],
  ];
}

function pathFromVerts(ctx, verts, dx, dy) {
  ctx.beginPath();
  verts.forEach((point, index) => {
    const x = point[0] + dx + 0.5;
    const y = point[1] + dy + 0.5;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Bright volume + yellow outline built from the stone diamond — no gaps, no overflow. */
function roomVolumeLayer(floor, grass, diamond, wallH, originX, originY) {
  const hex = roomHexagon(diamond, wallH);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  hex.forEach((point) => {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  });
  const pad = 1;
  const dx = pad - minX;
  const dy = pad - minY;
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);
  const grassReady = !!(grass?.complete && grass.naturalWidth);
  const key = `room-tight:${floor.src}:${grass?.src || ""}:${grassReady ? "g" : "nog"}:${wallH}:${width}x${height}`;
  if (state.images.has(key)) return state.images.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d");
  fillGrassPattern(c, grass, width, height, true, originX - dx, originY - dy);
  c.save();
  pathFromVerts(c, hex, dx, dy);
  c.clip();
  c.fillStyle = "rgba(0, 0, 0, 0.16)";
  c.beginPath();
  c.moveTo(hex[0][0] + dx, hex[0][1] + dy);
  c.lineTo(hex[5][0] + dx, hex[5][1] + dy);
  c.lineTo(hex[4][0] + dx, hex[4][1] + dy);
  c.lineTo(diamond.top[0] + dx, diamond.top[1] + dy);
  c.closePath();
  c.fill();
  c.fillStyle = "rgba(255, 255, 220, 0.08)";
  c.beginPath();
  c.moveTo(hex[0][0] + dx, hex[0][1] + dy);
  c.lineTo(diamond.top[0] + dx, diamond.top[1] + dy);
  c.lineTo(hex[2][0] + dx, hex[2][1] + dy);
  c.lineTo(hex[1][0] + dx, hex[1][1] + dy);
  c.closePath();
  c.fill();
  c.restore();
  c.save();
  pathFromVerts(c, hex, dx, dy);
  c.globalCompositeOperation = "destination-in";
  c.fillStyle = "#fff";
  c.fill();
  c.restore();
  c.save();
  pathFromVerts(c, hex, dx, dy);
  c.strokeStyle = "#ffed4a";
  c.lineWidth = 1;
  c.setLineDash([4, 3]);
  c.lineJoin = "miter";
  c.stroke();
  c.restore();
  const layer = { sheet, dx, dy };
  // Only cache when grass is ready — avoid locking in the solid-color fallback.
  if (grassReady) state.images.set(key, layer);
  return layer;
}

function baseLayout(base, floor, mask) {
  const frame = base?.assets?.baseImage?.frameTable?.[0] || {};
  const fw = floor.naturalWidth || floor.width;
  const fh = floor.naturalHeight || floor.height;
  const mw = mask?.naturalWidth || mask?.width || fw;
  const mh = mask?.naturalHeight || mask?.height || fh;
  // Allow negative X when floor sprite is wider than mask (common for 3×3).
  const floorInMaskX = Math.round((mw - fw) / 2);
  const floorInMaskY = Math.max(0, mh - fh);

  let mx;
  let my;
  if (Number.isFinite(frame.valueA) && Number.isFinite(frame.valueB) && (frame.valueA || frame.valueB)) {
    mx = frame.valueA - floorInMaskX;
    my = frame.valueB - floorInMaskY;
  } else if (mw > DESIGN_W || mh > DESIGN_H) {
    mx = 0;
    my = 0;
  } else {
    mx = Math.round((DESIGN_W - mw) / 2);
    my = Math.round((DESIGN_H - mh) / 2);
  }

  const floorX = mx + floorInMaskX;
  const floorY = my + floorInMaskY;
  return {
    planeW: Math.max(DESIGN_W, Math.ceil(Math.max(mx + mw, floorX + fw, 0))),
    planeH: Math.max(DESIGN_H, Math.ceil(Math.max(my + mh, floorY + fh, 0))),
    maskX: mx,
    maskY: my,
    maskW: mw,
    maskH: mh,
    floorX,
    floorY,
    floorW: fw,
    floorH: fh,
  };
}

/** Center the full building volume (walls + floor + paper props) in the design scene. */
function centerBuildingInPlane(layout, diamond, wallH) {
  let left = layout.floorX;
  let right = layout.floorX + layout.floorW;
  let top = layout.floorY;
  let bottom = layout.floorY + layout.floorH;
  if (diamond) {
    const hex = roomHexagon(diamond, Math.max(0, wallH || 0));
    left = Infinity;
    right = -Infinity;
    top = Infinity;
    bottom = -Infinity;
    hex.forEach(([x, y]) => {
      left = Math.min(left, layout.floorX + x);
      right = Math.max(right, layout.floorX + x);
      top = Math.min(top, layout.floorY + y);
      bottom = Math.max(bottom, layout.floorY + y);
    });
  }
  // House-select preview must ignore leftover paper props, or the empty
  // base is shoved into a corner of the previous design's huge plane.
  if (state.phase === "design") {
    state.records.forEach((record) => {
      if (record.hidden || record.mat === 0) return;
      // Native papers can retain off-plane helper/deleted records (notably
      // wrapped uint15 x values near 32768). They render clipped in-game and
      // must not pull the visible building away from the canvas center.
      if (
        (record.x || 0) < 0 ||
        (record.y || 0) < 0 ||
        (record.x || 0) > MAX_CONTENT_COORD ||
        (record.y || 0) > MAX_CONTENT_COORD
      ) {
        return;
      }
      const box = recordBox(record);
      const width = Math.max(8, box.width || 80);
      const height = Math.max(8, box.height || 80);
      left = Math.min(left, box.x);
      right = Math.max(right, box.x + width);
      top = Math.min(top, box.y);
      bottom = Math.max(bottom, box.y + height);
    });
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    layout.contentDx = 0;
    layout.contentDy = 0;
    layout.planeW = Math.max(DESIGN_W, layout.planeW || DESIGN_W);
    layout.planeH = Math.max(DESIGN_H, layout.planeH || DESIGN_H);
    return layout;
  }
  const bw = Math.max(1, right - left);
  const bh = Math.max(1, bottom - top);
  const pad = 36;

  let planeW = Math.max(DESIGN_W, Math.ceil(bw + pad * 2));
  let planeH = Math.max(DESIGN_H, Math.ceil(bh + pad * 2));
  planeW = Math.min(MAX_PLANE, planeW);
  planeH = Math.min(MAX_PLANE, planeH);
  const dx = Math.round((planeW - bw) / 2 - left);
  const dy = Math.round((planeH - bh) / 2 - top);

  layout.floorX += dx;
  layout.floorY += dy;
  layout.maskX += dx;
  layout.maskY += dy;
  layout.planeW = planeW;
  layout.planeH = planeH;
  layout.contentDx = dx;
  layout.contentDy = dy;
  return layout;
}

function layoutContentOffset() {
  return {
    dx: state.baseLayout?.contentDx || 0,
    dy: state.baseLayout?.contentDy || 0,
  };
}

function isBaseLayoutReady() {
  const base = state.base;
  if (!base) return true;
  const floorUrl = buildingBaseUrl(base);
  if (!floorUrl) return true;
  const floor = loadImage(floorUrl);
  return !!(floor?.complete && floor.naturalWidth);
}

function computeBaseLayout(base, floor, mask) {
  let layout = {
    planeW: DESIGN_W,
    planeH: DESIGN_H,
    maskX: 0,
    maskY: 0,
    maskW: 0,
    maskH: 0,
    floorX: 0,
    floorY: 0,
    floorW: 0,
    floorH: 0,
    contentDx: 0,
    contentDy: 0,
  };

  if (!floor?.complete || !floor.naturalWidth) return layout;

  if (mask?.complete && mask.naturalWidth) {
    layout = baseLayout(base, floor, mask);
  } else {
    const frame = base?.assets?.baseImage?.frameTable?.[0];
    layout.floorW = floor.naturalWidth;
    layout.floorH = floor.naturalHeight;
    layout.floorX = Number.isFinite(frame?.valueA)
      ? frame.valueA
      : Math.round((DESIGN_W - floor.naturalWidth) / 2);
    layout.floorY = Number.isFinite(frame?.valueB)
      ? frame.valueB
      : Math.max(52, DESIGN_H - floor.naturalHeight - 16);
    layout.planeW = Math.max(DESIGN_W, layout.floorX + layout.floorW);
    layout.planeH = Math.max(DESIGN_H, layout.floorY + layout.floorH);
  }

  const diamond = floorOpaqueDiamond(floor);
  const wallH = diamond ? roomWallHeight(diamond, mask) : 0;
  // Always center the base + props. Paper imports keep relative coords via contentDx/Dy.
  return centerBuildingInPlane(layout, diamond, wallH);
}

function ensureDesignPlane(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

function fillThemes() {
  const list = document.getElementById("themeList");
  list.innerHTML = "";
  const query = themeSearchQuery();
  let packs = state.packs.filter((pack) => !query || pack.name.toLowerCase().includes(query));
  if (state.pack && query && !packs.includes(state.pack)) {
    packs = [state.pack, ...packs];
  }
  if (!packs.length) {
    const empty = document.createElement("div");
    empty.className = "theme-empty";
    empty.textContent = query ? "无匹配主题" : "暂无主题";
    list.appendChild(empty);
    updateAssetFilterSummary();
    return;
  }
  packs.forEach((pack) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = pack.name;
    button.title = pack.name;
    const selected = pack === state.pack;
    button.className = selected ? "on" : "";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.onclick = () => {
      state.pack = pack;
      state.component = null;
      state.customBrush = null;
      state.brushState = 0;
      ensureActiveCategory();
      fillThemes();
      fillCategories();
      fillComponents();
      fillCustoms();
      updateSelectionCaption();
      renderBuilding();
    };
    list.appendChild(button);
    if (selected) {
      requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
    }
  });
  updateAssetFilterSummary();
}

function fillCategories() {
  const list = document.getElementById("componentKinds");
  list.innerHTML = "";
  const counts = categoryCounts(state.pack);
  CATEGORY_ORDER.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    const count = counts.get(category) || 0;
    button.className = category === state.category ? "on" : "";
    button.disabled = count === 0;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", category === state.category ? "true" : "false");
    button.title = count ? `${category}（${count}）` : `${category}（此主题无）`;
    const label = document.createElement("span");
    label.className = "cat-label";
    label.textContent = category;
    button.append(label);
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "cat-count";
      badge.textContent = String(count);
      button.append(badge);
    }
    button.onclick = () => {
      if (count === 0) return;
      state.category = category;
      state.component = null;
      state.customBrush = null;
      state.brushState = 0;
      fillCategories();
      fillComponents();
      updateSelectionCaption();
      renderBuilding();
    };
    list.appendChild(button);
  });
  updateAssetFilterSummary();
}

function directionLabel(component) {
  if (!component) return "";
  if (component.kind === "kit") return "套件";
  const frames = Math.max(1, component.asset?.frames || 1);
  return `${frames}方向`;
}

function fillComponents() {
  const list = document.getElementById("componentList");
  list.innerHTML = "";
  if (!state.pack) {
    updateAssetFilterSummary();
    return;
  }
  const components = state.pack.components.filter(
    (component) => component.category === state.category
  );
  if (!components.length) {
    const empty = document.createElement("div");
    empty.className = "base-icon-empty";
    empty.textContent = "当前主题在此类别下没有素材";
    list.appendChild(empty);
    updateAssetFilterSummary();
    return;
  }
  components.forEach((component) => {
    const button = document.createElement("button");
    button.type = "button";
    const uid = componentUid(component.id);
    const missing = component.kind === "sprite" && uid == null;
    button.className =
      "component-card" +
      (component === state.component && !state.customBrush ? " on" : "") +
      (missing ? " missing" : "");
    const image = document.createElement("img");
    if (component.kind === "sprite") image.src = spriteUrl(component, state.pack, 0, true);
    image.draggable = false;
    const label = document.createElement("span");
    label.textContent = directionLabel(component);
    button.title =
      `${state.pack.name} / ${component.category} #${component.id}` +
      (component.kind === "kit" ? " · 套件" : missing ? " · 缺失图像" : " · 拖到画布或点击选用") +
      "\n" +
      (component.materials || []).map((item) => `${item.name}×${item.count}`).join(" ");
    button.append(image, label);
    const selectBrush = () => {
      state.component = component;
      state.customBrush = null;
      state.brushState = 0;
      state.selected = [];
      updateSelectionCaption();
      updateCurrentMaterials(component);
      fillComponents();
      fillCustoms();
      fillLayers();
      updateAlignBar();
      updateFacingControl();
      renderBuilding();
    };
    button.onpointerdown = (event) => {
      if (missing || component.kind === "kit") return;
      if (event.button !== 0) return;
      event.preventDefault();
      selectBrush();
      beginPaletteDrag("component", component, event, button);
    };
    button.onclick = (event) => {
      if (state.paletteClickIgnore) {
        state.paletteClickIgnore = false;
        return;
      }
      event.preventDefault();
      if (component === state.component && !state.customBrush) {
        cancelPick();
        return;
      }
      selectBrush();
    };
    list.appendChild(button);
  });
  updateAssetFilterSummary();
}

function basesOfKind(kind) {
  return (state.catalog?.building?.bases || [])
    .filter((base) => base.kind === kind)
    .sort((a, b) => (a.no || 0) - (b.no || 0));
}

function fillBaseKindTabs() {
  const tabs = document.getElementById("baseKindTabs");
  tabs.innerHTML = "";
  BASE_KIND_TABS.forEach((tab) => {
    const list = basesOfKind(tab.kind);
    if (!list.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${tab.label} ${list.length}`;
    button.title = `${tab.label} · ${list.length} 种户型`;
    button.className = tab.kind === state.baseKind ? "on" : "";
    button.onclick = () => {
      state.baseKind = tab.kind;
      state.base = list.find((base) => base === state.base) || list[0];
      state.basePicked = true;
      invalidateBaseLayout();
      fillBaseKindTabs();
      fillBaseIcons();
      updateBase();
      markBuildingDirty();
      renderBuilding();
    };
    tabs.appendChild(button);
  });
}

function fillBaseIcons() {
  const grid = document.getElementById("baseIconGrid");
  grid.innerHTML = "";
  const list = basesOfKind(state.baseKind);
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "base-icon-empty";
    empty.textContent = "当前分类没有户型";
    grid.appendChild(empty);
    return;
  }
  if (!list.includes(state.base)) state.base = list[0];
  list.forEach((base) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "base-icon" + (base === state.base ? " on" : "");
    const image = document.createElement("img");
    const workUrl = buildingBaseUrl(base, true);
    const floorUrl = buildingBaseUrl(base);
    image.src = workUrl || floorUrl;
    image.alt = base.name;
    image.draggable = false;
    image.onerror = () => {
      if (image.dataset.fallback || !floorUrl) return;
      image.dataset.fallback = "1";
      image.src = floorUrl;
    };
    const caption = document.createElement("span");
    caption.className = "base-icon-cap";
    const size = base.footprint?.join("×") || "";
    caption.innerHTML = `<strong>${base.name}</strong>${size ? `<small>${size}</small>` : ""}`;
    button.title = `${base.name}${size ? ` · ${size}` : ""}`;
    button.append(image, caption);
    button.onclick = () => {
      state.base = base;
      state.basePicked = true;
      invalidateBaseLayout();
      fillBaseIcons();
      updateBase();
      markBuildingDirty();
      renderBuilding();
    };
    grid.appendChild(button);
  });
}

function fillBaseMaterials(base) {
  const list = document.getElementById("baseMatList");
  list.innerHTML = "";
  const materials = base?.baseMaterials || [];
  if (!materials.length) {
    const empty = document.createElement("div");
    empty.className = "base-mat-empty";
    empty.textContent = "无材料需求";
    list.appendChild(empty);
    return;
  }
  materials.forEach((item) => {
    const row = document.createElement("div");
    row.className = "base-mat-row";
    const name = document.createElement("span");
    name.textContent = item.name;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(item.count);
    row.append(name, count);
    list.appendChild(row);
  });
}

function updateBase() {
  const base = state.base;
  const empty = document.getElementById("canvasEmpty");
  const meta = document.getElementById("baseMeta");
  if (empty) empty.hidden = !!base;
  if (meta) meta.hidden = !base;
  if (!base) {
    document.getElementById("currentBase").textContent = "无";
    document.getElementById("buildingName").textContent = "无";
    document.getElementById("buildingPut").textContent = "0×0";
    document.getElementById("buildingSpace").textContent = "无";
    document.getElementById("buildingOutside").textContent = "无";
    const hint = document.getElementById("paperBaseHint");
    if (hint) hint.hidden = true;
    syncDesignResetButtons();
    return;
  }
  document.getElementById("currentBase").textContent = base.name;
  document.getElementById("buildingName").textContent = base.name;
  document.getElementById("buildingPut").textContent = base.footprint?.join("×") || "0×0";
  document.getElementById("buildingSpace").textContent = formatInsideSpace(base);
  document.getElementById("buildingOutside").textContent = formatOutsideSpace(base);
  const hint = document.getElementById("paperBaseHint");
  if (hint) {
    hint.hidden = !state.paperBaseHint;
    hint.textContent = state.paperBaseHint ? `图纸原户型 ${state.paperBaseHint}` : "";
  }
  fillBaseMaterials(base);
  syncDesignResetButtons();
  const preview = document.getElementById("basePreviewImg");
  const url = buildingBaseUrl(base);
  preview.src = url || "";
  if (url) loadImage(url);
  const maskUrl = buildingMaskUrl(base);
  if (maskUrl) loadImage(maskUrl);
  loadImage("/bdesign/imgs/glsbg.gif");
  updateAllMaterials();
}

function primarySelected() {
  if (!state.selected.length) return -1;
  return state.selected[state.selected.length - 1];
}

function updateSelectionCaption() {
  const selected = document.getElementById("selectedComponent");
  const actions = document.getElementById("selectionActions");
  const btnClearPick = document.getElementById("btnClearPick");
  const count = state.selected.length;
  const picking = hasBrush() || count > 0;
  if (btnClearPick) btnClearPick.hidden = !picking;
  if (actions) actions.hidden = count < 1;
  updateFacingControl();

  const groupNames = new Set(
    state.selected
      .map((index) => state.records[index]?.groupName || (state.records[index]?.group ? "未命名组" : ""))
      .filter(Boolean)
  );
  const groupHint =
    groupNames.size === 1 ? ` · 组「${[...groupNames][0]}」` : groupNames.size > 1 ? ` · ${groupNames.size}组` : "";
  const lockedCount = state.selected.filter((index) => state.records[index]?.locked).length;
  const lockHint =
    lockedCount === count && count > 0
      ? " · 已锁定"
      : lockedCount > 0
        ? ` · ${lockedCount}件锁定`
        : "";

  const btnLockSel = document.getElementById("btnLockSel");
  const btnUnlockSel = document.getElementById("btnUnlockSel");
  if (btnLockSel) btnLockSel.hidden = count < 1 || lockedCount === count;
  if (btnUnlockSel) btnUnlockSel.hidden = lockedCount < 1;

  if (count > 1) {
    selected.textContent = `已选 ${count} 项${groupHint}${lockHint}${lockedCount === count ? "" : "（可一起移动）"}`;
    updateCurrentMaterials(null);
    updateAlignBar();
    return;
  }
  if (count === 1 && state.records[state.selected[0]]) {
    const record = state.records[state.selected[0]];
    const component = record.component || componentByUid(record.mat, record.pack || state.pack);
    selected.textContent = `${layerLabel(record, component)}${groupHint}${lockHint}`;
    updateCurrentMaterials(component);
    updateAlignBar();
    return;
  }
  if (state.customBrush) {
    selected.textContent = `自定义 · ${state.customBrush.name} · 朝向 ${state.brushState + 1}`;
    updateCurrentMaterials(null);
    updateAlignBar();
    return;
  }
  if (state.component) {
    selected.textContent = `${state.pack?.name || ""} / ${state.component.category} #${state.component.id} · 朝向 ${state.brushState + 1}`;
    updateCurrentMaterials(state.component);
    updateAlignBar();
    return;
  }
  selected.textContent = "无";
  updateCurrentMaterials(null);
  updateAlignBar();
}

function updateCurrentMaterials(component) {
  document.getElementById("currentMaterials").textContent = component
    ? (component.materials || []).map((item) => `${item.name}×${item.count}`).join("　")
    : "";
}

function updateAlignBar() {
  const bar = document.getElementById("alignBar");
  if (!bar) return;
  bar.hidden = state.phase !== "design" || state.selected.length < 2;
}

function frameGeometry(component, stateValue = 0) {
  const frames = component?.asset?.frameTable || [];
  const frame = frames.length ? frames[Math.max(0, Number(stateValue) || 0) % frames.length] : null;
  return {
    width: frame?.width || component?.asset?.width || 0,
    height: frame?.height || component?.asset?.height || 0,
  };
}

function recordBox(record) {
  const component = recordComponent(record);
  const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
  return {
    x: record.x,
    y: record.y,
    width: geometry.width,
    height: geometry.height,
    hotX: record.x,
    hotY: record.y,
  };
}

function drawBase() {
  const grass = loadImage("/bdesign/imgs/glsbg.gif");
  const base = state.base;
  const floorUrl = buildingBaseUrl(base);
  const floor = floorUrl ? loadImage(floorUrl) : null;
  const maskUrl = buildingMaskUrl(base);
  const mask = maskUrl ? loadImage(maskUrl) : null;

  if (!isBaseLayoutReady()) {
    const layout = state.baseLayout || { planeW: DESIGN_W, planeH: DESIGN_H };
    ensureDesignPlane(layout.planeW, layout.planeH);
    fillGrassPattern(ctx, grass, canvas.width, canvas.height, false);
    return;
  }

  const layout = computeBaseLayout(base, floor, mask);
  state.baseLayout = layout;
  ensureDesignPlane(layout.planeW, layout.planeH);
  fillGrassPattern(ctx, grass, canvas.width, canvas.height, false);

  const diamond = floorOpaqueDiamond(floor);
  if (diamond) {
    const wallH = roomWallHeight(diamond, mask);
    const volume = roomVolumeLayer(floor, grass, diamond, wallH, layout.floorX, layout.floorY);
    ctx.drawImage(volume.sheet, layout.floorX - volume.dx, layout.floorY - volume.dy);
  }

  if (!floor?.complete || !floor.naturalWidth) return;
  if (state.phase === "design" && !state.keepFoundation) return;
  ctx.drawImage(floor, layout.floorX, layout.floorY, layout.floorW, layout.floorH);
}

function afterBaseDrawn() {
  const key = `${state.base?.no || "?"}|${canvas.width}x${canvas.height}|${Number(state.zoom) || 1}`;
  applyZoom();
  if (key === lastSceneKey) return;
  lastSceneKey = key;
  requestAnimationFrame(() => centerCanvasInShell());
}

function customBrushBounds(custom) {
  const boxes = (custom?.records || []).map((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    const face = facingOffset(row.state ?? 0, component);
    const geometry = frameGeometry(component, face);
    return {
      x: row.dx,
      y: row.dy,
      width: Math.max(8, geometry.width),
      height: Math.max(8, geometry.height),
    };
  });
  if (!boxes.length) return { left: 0, top: 0, right: 32, bottom: 32, width: 32, height: 32 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function drawGhost() {
  if (!state.ghost || state.phase !== "design" || !hasBrush()) return;
  if (state.customBrush) {
    const custom = state.customBrush;
    const bounds = customBrushBounds(custom);
    const originX = Math.round(state.ghost.x - (bounds.left + bounds.right) / 2);
    const originY = Math.round(state.ghost.y - (bounds.top + bounds.bottom) / 2);
    ctx.save();
    ctx.globalAlpha = 0.5;
    custom.records.forEach((row) => {
      const pack = packByKey(row.packKey) || state.pack;
      const component = componentByUid(row.mat, pack);
      const face = facingOffset(row.state ?? 0, component);
      const url = spriteUrl(component, pack, face);
      const image = loadImage(url);
      const geometry = frameGeometry(component, face);
      const x = originX + row.dx;
      const y = originY + row.dy;
      if (image?.complete && image.naturalWidth) {
        ctx.drawImage(image, x, y);
      } else {
        ctx.fillStyle = "#7ec8a0";
        ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
      }
    });
    ctx.restore();
    return;
  }
  if (!state.component || state.component.kind !== "sprite") return;
  const component = state.component;
  const url = spriteUrl(component, state.pack, state.brushState);
  const image = loadImage(url);
  const geometry = frameGeometry(component, state.brushState);
  const x = Math.round(state.ghost.x - geometry.width / 2);
  const y = Math.round(state.ghost.y - geometry.height / 2);
  ctx.save();
  ctx.globalAlpha = 0.55;
  if (image?.complete && image.naturalWidth) {
    ctx.drawImage(image, x, y);
  } else {
    ctx.fillStyle = "#7ec8a0";
    ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
  }
  ctx.restore();
}

function drawMarquee() {
  if (!state.marquee) return;
  const { x0, y0, x1, y1 } = state.marquee;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  ctx.save();
  ctx.fillStyle = "rgba(80, 160, 255, 0.18)";
  ctx.strokeStyle = "rgba(60, 130, 230, 0.9)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

function drawGroupBounds() {
  if (state.selected.length < 2) return;
  const boxes = selectionBoxes(state.selected);
  const union = unionBox(boxes);
  if (!union) return;
  const hasGroup = state.selected.some((index) => state.records[index]?.group);
  ctx.save();
  ctx.strokeStyle = hasGroup ? "rgba(70, 190, 120, 0.95)" : "rgba(255, 237, 74, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash(hasGroup ? [] : [6, 4]);
  ctx.strokeRect(
    union.left - 2,
    union.top - 2,
    union.right - union.left + 4,
    union.bottom - union.top + 4
  );
  ctx.restore();
}

function drawGuides() {
  if (!state.guides.length) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 90, 120, 0.85)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  state.guides.forEach((guide) => {
    if (guide.type === "v") {
      ctx.beginPath();
      ctx.moveTo(guide.pos + 0.5, 0);
      ctx.lineTo(guide.pos + 0.5, canvas.height);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, guide.pos + 0.5);
      ctx.lineTo(canvas.width, guide.pos + 0.5);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function paintBuilding() {
  const prevW = canvas.width;
  const prevH = canvas.height;
  drawBase();
  const layoutReady = isBaseLayoutReady();
  const { dx, dy } = layoutContentOffset();
  if (state.phase === "design" && layoutReady) {
    const selectedSet = new Set(state.selected);
    ctx.save();
    ctx.translate(dx, dy);
    state.records.forEach((record, index) => {
      if (record.hidden) return;
      const component = recordComponent(record);
      const pack = recordPack(record) || component?._pack;
      const url = spriteUrl(component, pack, record.state ?? record.flip ?? 0);
      const image = loadImage(url);
      const box = recordBox(record);
      if (image?.complete && image.naturalWidth) {
        ctx.drawImage(image, box.x, box.y);
      } else {
        ctx.fillStyle = "#d75d44";
        ctx.fillRect(box.hotX - 4, box.hotY - 4, 8, 8);
        ctx.fillStyle = "#fff";
        ctx.fillText(String(record.mat), box.hotX + 6, box.hotY);
      }
      if (selectedSet.has(index)) {
        ctx.strokeStyle = record.locked ? "#9aa7b2" : "#ffed4a";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(box.x - 1, box.y - 1, Math.max(8, box.width + 2), Math.max(8, box.height + 2));
        ctx.setLineDash([]);
      }
    });
    drawGhost();
    drawGroupBounds();
    drawMarquee();
    drawGuides();
    ctx.restore();
  }
  if (canvas.width !== prevW || canvas.height !== prevH || state.base) afterBaseDrawn();
  if (!state.dragging && !state.marquee) updateAllMaterials();
}

function renderBuilding() {
  scheduleRender();
}

function updateAllMaterials() {
  const totals = new Map();
  (state.base?.baseMaterials || []).forEach((item) => totals.set(item.name, item.count));
  state.records.forEach((record) => {
    const component = recordComponent(record);
    (component?.materials || []).forEach((item) => {
      totals.set(item.name, (totals.get(item.name) || 0) + item.count);
    });
  });
  const strip = document.getElementById("allMaterials");
  strip.innerHTML = "";
  [...totals].forEach(([name, count]) => {
    const chip = document.createElement("span");
    chip.className = "mat-chip";
    chip.innerHTML = `${name}<em>×${count}</em>`;
    strip.appendChild(chip);
  });
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const { dx, dy } = layoutContentOffset();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width - dx,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height - dy,
  };
}

function hitRecord(x, y, { includeLocked = false } = {}) {
  for (let index = state.records.length - 1; index >= 0; index--) {
    const record = state.records[index];
    if (record.hidden) continue;
    if (record.locked && !includeLocked) continue;
    const box = recordBox(record);
    if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
      return index;
    }
  }
  return -1;
}

function expandGroupSelection(indices) {
  const set = new Set(indices);
  const groups = new Set();
  indices.forEach((index) => {
    const group = state.records[index]?.group;
    if (group) groups.add(group);
  });
  if (!groups.size) return [...set].sort((a, b) => a - b);
  state.records.forEach((record, index) => {
    if (record.group && groups.has(record.group)) set.add(index);
  });
  return [...set].sort((a, b) => a - b);
}

function setSelection(indices, { expandGroup = false } = {}) {
  let next = [...new Set(indices)].filter((index) => index >= 0 && index < state.records.length);
  if (expandGroup) next = expandGroupSelection(next);
  state.selected = next;
  updateSelectionCaption();
  updateAlignBar();
  fillLayers();
}

function clearSelection() {
  state.selected = [];
  updateSelectionCaption();
  updateAlignBar();
  fillLayers();
}

function cancelPick() {
  state.component = null;
  state.customBrush = null;
  state.brushState = 0;
  state.ghost = null;
  clearSelection();
  fillComponents();
  fillCustoms();
  updateFacingControl();
  renderBuilding();
}

function hasBrush() {
  return !!(state.customBrush || state.component);
}

function componentFrameCount(component) {
  return Math.max(1, component?.asset?.frames || 1);
}

function currentFacingFrames() {
  if (state.component?.kind === "sprite") return componentFrameCount(state.component);
  if (state.customBrush?.records?.length) {
    let max = 1;
    state.customBrush.records.forEach((row) => {
      const pack = packByKey(row.packKey) || state.pack;
      const component = componentByUid(row.mat, pack);
      max = Math.max(max, componentFrameCount(component));
    });
    return max;
  }
  if (state.clipboard?.length) {
    let max = 1;
    state.clipboard.forEach((row) => {
      const pack = packByKey(row.packKey) || state.pack;
      const component = componentByUid(row.mat, pack);
      max = Math.max(max, componentFrameCount(component));
    });
    return max;
  }
  if (state.selected.length === 1) {
    const record = state.records[state.selected[0]];
    const component = record?.component || componentByUid(record?.mat, record?.pack || state.pack);
    if (component) return componentFrameCount(component);
  }
  return 4;
}

function normalizeBrushState() {
  const frames = currentFacingFrames();
  state.brushState = ((Number(state.brushState) || 0) % frames + frames) % frames;
  return frames;
}

function updateFacingControl() {
  const label = document.getElementById("facingLabel");
  if (!label) return;
  const frames = normalizeBrushState();
  label.textContent = `${state.brushState + 1}/${frames}`;
  const control = document.getElementById("facingControl");
  if (control) {
    control.title =
      "放置朝向 / 粘贴与自定义组件的旋转偏移 · 当前 " +
      `${state.brushState + 1}/${frames}（空格或◀▶切换，0 偏移即保持原朝向）`;
  }
}

function stepFacing(delta) {
  const frames = currentFacingFrames();
  state.brushState = (((Number(state.brushState) || 0) + delta) % frames + frames) % frames;
  if (state.selected.length && !hasBrush()) {
    const indices = selectedUnlockedIndices();
    if (indices.length) {
      pushHistory();
      indices.forEach((index) => {
        const record = state.records[index];
        const component = record.component || componentByUid(record.mat, record.pack || state.pack);
        const count = componentFrameCount(component);
        record.state = ((record.state ?? record.flip ?? 0) + delta) % count;
        delete record.flip;
      });
    }
  }
  updateFacingControl();
  updateSelectionCaption();
  renderBuilding();
}

function facingAbsolute(component) {
  const frames = componentFrameCount(component);
  return ((Number(state.brushState) || 0) % frames + frames) % frames;
}

function facingOffset(baseState, component) {
  const frames = componentFrameCount(component);
  return (((Number(baseState) || 0) + (Number(state.brushState) || 0)) % frames + frames) % frames;
}

function clipboardBounds(rows) {
  const boxes = rows.map((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    const geometry = frameGeometry(component, facingOffset(row.state ?? 0, component));
    return {
      left: row.x,
      top: row.y,
      right: row.x + geometry.width,
      bottom: row.y + geometry.height,
    };
  });
  if (!boxes.length) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

function canvasPointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  const { dx, dy } = layoutContentOffset();
  return {
    x: (clientX - rect.left) * scaleX - dx,
    y: (clientY - rect.top) * scaleY - dy,
    inside:
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom,
  };
}

function ensurePaletteGhost(label) {
  let el = document.getElementById("paletteDragGhost");
  if (!el) {
    el = document.createElement("div");
    el.id = "paletteDragGhost";
    el.className = "palette-drag-ghost";
    document.body.appendChild(el);
  }
  el.textContent = label;
  el.hidden = false;
  return el;
}

function clearPaletteGhost() {
  const el = document.getElementById("paletteDragGhost");
  if (el) el.hidden = true;
  document.body.classList.remove("is-palette-dragging");
  document.querySelectorAll(".custom-card.dragging, .component-card.dragging").forEach((node) => {
    node.classList.remove("dragging");
  });
}

function beginPaletteDrag(kind, payload, event, sourceEl) {
  if (event.button !== 0) return;
  state.paletteDrag = {
    kind,
    payload,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    placed: false,
    sourceEl,
    label: kind === "custom" ? `拖出 · ${payload.name}` : `拖出 · ${payload.category || "素材"} #${payload.id}`,
  };
}

function updatePaletteDrag(event) {
  const drag = state.paletteDrag;
  if (!drag) return;
  const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active && dist > 6) {
    drag.active = true;
    document.body.classList.add("is-palette-dragging");
    drag.sourceEl?.classList.add("dragging");
    if (drag.kind === "custom") {
      state.customBrush = drag.payload;
      state.component = null;
      state.selected = [];
      state.brushState = 0;
    } else {
      state.component = drag.payload;
      state.customBrush = null;
      state.selected = [];
      state.brushState = 0;
    }
    fillComponents();
    fillCustoms();
    updateSelectionCaption();
    updateFacingControl();
  }
  if (!drag.active) return;
  const ghost = ensurePaletteGhost(drag.label);
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  const point = canvasPointFromClient(event.clientX, event.clientY);
  if (point.inside && state.phase === "design") {
    state.ghost = { x: point.x, y: point.y };
    renderBuilding();
  }
}

function finishPaletteDrag(event) {
  const drag = state.paletteDrag;
  if (!drag) return;
  const wasActive = drag.active;
  state.paletteDrag = null;
  clearPaletteGhost();
  if (!wasActive) return;
  state.paletteClickIgnore = true;
  const point = canvasPointFromClient(event.clientX, event.clientY);
  if (state.phase === "design" && point.inside) {
    addComponent(point.x, point.y);
  }
  renderBuilding();
}

function historyCap() {
  return state.records.length > 400 ? 16 : 80;
}

function recordsHistoryPayload() {
  return JSON.stringify(serializeSessionRecords());
}

function pushHistory() {
  state.history.push(recordsHistoryPayload());
  const cap = historyCap();
  while (state.history.length > cap) state.history.shift();
  state.redo = [];
  markBuildingDirty();
}

function markBuildingDirty() {
  if (restoringSession) return;
  state.sessionDirty = true;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    saveBuildingSession();
  }, 350);
}

function serializeSessionRecords() {
  return state.records.map((record) => ({
    mode: record.mode || "desk",
    x: record.x,
    y: record.y,
    mat: record.mat,
    state: record.state ?? record.flip ?? 0,
    packKey: record.packKey || record.pack?.key || state.pack?.key || "",
    group: record.group || null,
    groupName: record.groupName || null,
    label: record.label || null,
    locked: !!record.locked,
    hidden: !!record.hidden,
  }));
}

function buildingSessionSnapshot() {
  return {
    v: 1,
    savedAt: Date.now(),
    phase: state.phase,
    baseNo: state.base?.no ?? null,
    baseMap: state.base?.map || "",
    baseName: state.base?.name || "",
    baseKind: state.baseKind,
    packKey: state.pack?.key || "",
    category: state.category,
    records: serializeSessionRecords(),
    keepFoundation: !!state.keepFoundation,
    brushState: state.brushState || 0,
    snap: { ...state.snap },
    veil: { ...state.veil },
    zoom: state.zoom || 1,
    source: state.source
      ? { encoding: state.source.encoding || "gbk" }
      : null,
    selected: [...state.selected],
    railTab: state.railTab || "assets",
    layerCollapsed: [...state.layerCollapsed],
    layerFilter: state.layerFilter || "",
    paperLayout: !!state.paperLayout,
    basePicked: !!state.basePicked,
    paperBaseHint: state.paperBaseHint || "",
  };
}

function saveBuildingSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(buildingSessionSnapshot()));
    state.sessionDirty = false;
  } catch (error) {
    console.warn("建筑会话保存失败", error);
  }
}

function findBaseFromSession(snap) {
  const bases = state.catalog?.building?.bases || [];
  if (!bases.length) return null;
  return (
    bases.find((base) => snap.baseNo != null && base.no === snap.baseNo) ||
    bases.find((base) => snap.baseMap && base.map === snap.baseMap) ||
    bases.find((base) => snap.baseName && base.name === snap.baseName && base.kind === snap.baseKind) ||
    bases.find((base) => base.kind === snap.baseKind) ||
    bases[0]
  );
}

function restoreBuildingSession() {
  let snap = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    snap = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!snap || snap.v !== 1) return false;

  restoringSession = true;
  try {
    const base = findBaseFromSession(snap);
    if (base) {
      state.base = base;
      state.baseKind = base.kind ?? snap.baseKind ?? 0;
    }
    if (snap.packKey) {
      state.pack = packByKey(snap.packKey) || state.pack;
    }
    if (snap.category) state.category = snap.category;
    ensureActiveCategory();
    if (snap.snap) state.snap = { ...state.snap, ...snap.snap };
    if (snap.veil) state.veil = { ...state.veil, ...snap.veil };
    if (Number.isFinite(snap.zoom)) state.zoom = snap.zoom;
    state.keepFoundation = snap.keepFoundation !== false;
    state.brushState = Number(snap.brushState) || 0;
    state.source = snap.source || null;
    state.paperLayout = !!snap.paperLayout;
    state.basePicked = snap.basePicked !== false && snap.baseNo != null;
    state.paperBaseHint = snap.paperBaseHint || "";
    state.layerFilter = snap.layerFilter || "";
    state.layerCollapsed = new Set(Array.isArray(snap.layerCollapsed) ? snap.layerCollapsed : []);
    const keep = document.getElementById("keepFoundation");
    if (keep) keep.checked = state.keepFoundation;

    state.records = (snap.records || []).map(hydrateRecord);

    fillThemes();
    fillCategories();
    fillComponents();
    fillBaseKindTabs();
    fillBaseIcons();
    fillCustoms();
    updateBase();

    const phase = snap.phase === "design" || state.records.length ? "design" : "select";
    setPhase(phase);
    if (snap.railTab) setRailTab(snap.railTab);

    const max = state.records.length;
    state.selected = (snap.selected || []).filter((index) => index >= 0 && index < max);
    state.sessionDirty = false;
    applyZoom();
    return !!(state.records.length || phase === "design" || snap.baseNo != null);
  } finally {
    restoringSession = false;
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

function hydrateRecord(record) {
  const packKey = record.packKey || record.pack?.key || state.pack?.key || "";
  const pack = packByKey(packKey) || state.pack;
  return {
    mode: record.mode || "desk",
    x: Number(record.x) || 0,
    y: Number(record.y) || 0,
    mat: Number(record.mat) || 0,
    state: record.state ?? record.flip ?? 0,
    packKey,
    pack,
    component: null,
    group: record.group || null,
    groupName: record.groupName || null,
    label: record.label || null,
    locked: !!record.locked,
    hidden: !!record.hidden,
  };
}

function restoreRecords(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  state.records = (parsed || []).map(hydrateRecord);
}

function undo() {
  if (!state.history.length) return;
  state.redo.push(recordsHistoryPayload());
  restoreRecords(state.history.pop());
  clearSelection();
  state.guides = [];
  renderBuilding();
}

function redo() {
  if (!state.redo.length) return;
  state.history.push(recordsHistoryPayload());
  restoreRecords(state.redo.pop());
  clearSelection();
  state.guides = [];
  renderBuilding();
}

function snapGridValue(value) {
  if (!state.snap.enabled) return Math.round(value);
  const step = Math.max(1, Number(state.snap.step) || 1);
  return Math.round(value / step) * step;
}

function clampRecordPos(x, y) {
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.min(0x7fff, Math.round(y))),
  };
}

function selectionBoxes(indices) {
  return indices.map((index) => ({ index, box: recordBox(state.records[index]) }));
}

function unionBox(boxes) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((row) => row.box.x));
  const top = Math.min(...boxes.map((row) => row.box.y));
  const right = Math.max(...boxes.map((row) => row.box.x + row.box.width));
  const bottom = Math.max(...boxes.map((row) => row.box.y + row.box.height));
  return { x: left, y: top, width: right - left, height: bottom - top, left, top, right, bottom };
}

function objectSnapDelta(movingIndices, proposedOrigins) {
  const guides = [];
  if (!state.snap.enabled || !state.snap.object) return { dx: 0, dy: 0, guides };
  const movingSet = new Set(movingIndices);
  const movers = proposedOrigins.map(({ i, x, y }) => {
    const box = recordBox({ ...state.records[i], x, y });
    return {
      index: i,
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
    };
  });
  const others = [];
  state.records.forEach((record, index) => {
    if (movingSet.has(index) || record.hidden) return;
    const box = recordBox(record);
    others.push({
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
    });
  });
  if (!others.length || !movers.length) return { dx: 0, dy: 0, guides };

  let bestDx = 0;
  let bestDy = 0;
  let bestAbsX = OBJECT_SNAP_PX + 1;
  let bestAbsY = OBJECT_SNAP_PX + 1;
  let guideX = null;
  let guideY = null;

  movers.forEach((mover) => {
    const mx = [mover.left, mover.cx, mover.right];
    const my = [mover.top, mover.cy, mover.bottom];
    others.forEach((other) => {
      const ox = [other.left, other.cx, other.right];
      const oy = [other.top, other.cy, other.bottom];
      mx.forEach((value, mi) => {
        ox.forEach((target) => {
          const delta = target - value;
          const abs = Math.abs(delta);
          if (abs <= OBJECT_SNAP_PX && abs < bestAbsX) {
            bestAbsX = abs;
            bestDx = delta;
            guideX = target;
          }
        });
      });
      my.forEach((value) => {
        oy.forEach((target) => {
          const delta = target - value;
          const abs = Math.abs(delta);
          if (abs <= OBJECT_SNAP_PX && abs < bestAbsY) {
            bestAbsY = abs;
            bestDy = delta;
            guideY = target;
          }
        });
      });
    });
  });

  if (guideX != null) guides.push({ type: "v", pos: guideX });
  if (guideY != null) guides.push({ type: "h", pos: guideY });
  return { dx: bestAbsX <= OBJECT_SNAP_PX ? bestDx : 0, dy: bestAbsY <= OBJECT_SNAP_PX ? bestDy : 0, guides };
}

function applyDragPositions(pointerX, pointerY) {
  if (!state.dragging) return;
  const rawDx = pointerX - state.dragging.x;
  const rawDy = pointerY - state.dragging.y;
  if (Math.abs(rawDx) > 0.5 || Math.abs(rawDy) > 0.5) state.dragging.moved = true;

  let proposed = state.dragging.origins.map(({ i, x, y }) => {
    let nx = x + rawDx;
    let ny = y + rawDy;
    if (state.snap.enabled) {
      nx = snapGridValue(nx);
      ny = snapGridValue(ny);
    } else {
      nx = Math.round(nx);
      ny = Math.round(ny);
    }
    return { i, x: nx, y: ny };
  });

  const soft = objectSnapDelta(
    proposed.map((row) => row.i),
    proposed
  );
  if (soft.dx || soft.dy) {
    proposed = proposed.map((row) => ({
      i: row.i,
      x: row.x + soft.dx,
      y: row.y + soft.dy,
    }));
  }
  state.guides = soft.guides;

  proposed.forEach(({ i, x, y }) => {
    const record = state.records[i];
    if (!record || record.locked) return;
    const clamped = clampRecordPos(x, y);
    record.x = clamped.x;
    record.y = clamped.y;
  });
}

function addComponent(x, y) {
  if (state.phase !== "design") return;
  if (state.customBrush) {
    placeCustomBrush(x, y);
    return;
  }
  if (!state.component) return;
  if (state.component.kind === "kit") {
    addKitComponent(state.component, x, y);
    return;
  }
  const uid = componentUid(state.component.id);
  if (uid == null) {
    alert("原版素材表中没有这个组件对应的图像记录。");
    return;
  }
  const geometry = frameGeometry(state.component, state.brushState);
  let px = x - geometry.width / 2;
  let py = y - geometry.height / 2;
  if (state.snap.enabled) {
    px = snapGridValue(px);
    py = snapGridValue(py);
  }
  const pos = clampRecordPos(px, py);
  pushHistory();
  state.records.push({
    mode: "desk",
    x: pos.x,
    y: pos.y,
    mat: uid,
    state: facingAbsolute(state.component),
    component: state.component,
    pack: state.pack,
    packKey: state.pack?.key,
  });
  setSelection([state.records.length - 1]);
  renderBuilding();
}

function addKitComponent(kit, x, y) {
  let parsed;
  try {
    parsed = parseV1(kit.paper);
  } catch (error) {
    alert("套件图纸解析失败：" + (error.message || error));
    return;
  }
  const records = parsed.records
    .map((record) => ({
      ...record,
      mode: "desk",
      component: componentByUid(record.mat),
      pack: state.pack,
      packKey: state.pack?.key,
    }))
    .filter((record) => record.component);
  if (!records.length) {
    alert("套件没有可用的原版组件。");
    return;
  }
  const boxes = records.map(recordBox);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  let dx = x - (left + right) / 2;
  let dy = y - (top + bottom) / 2;
  if (state.snap.enabled) {
    dx = snapGridValue(dx);
    dy = snapGridValue(dy);
  }
  const group = `${Date.now()}-${state.records.length}`;
  pushHistory();
  const newIndices = [];
  records.forEach((record) => {
    const pos = clampRecordPos(record.x + dx, record.y + dy);
    record.x = pos.x;
    record.y = pos.y;
    record.group = group;
    state.records.push(record);
    newIndices.push(state.records.length - 1);
  });
  setSelection(newIndices);
  renderBuilding();
}

function placeCustomBrush(x, y) {
  const custom = state.customBrush;
  if (!custom?.records?.length) return;
  const bounds = customBrushBounds(custom);
  let originX = x - (bounds.left + bounds.right) / 2;
  let originY = y - (bounds.top + bounds.bottom) / 2;
  if (state.snap.enabled) {
    originX = snapGridValue(originX);
    originY = snapGridValue(originY);
  }
  const group = `${Date.now()}-custom-${state.records.length}`;
  pushHistory();
  const newIndices = [];
  custom.records.forEach((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    if (!component) return;
    const pos = clampRecordPos(originX + row.dx, originY + row.dy);
    state.records.push({
      mode: "desk",
      x: pos.x,
      y: pos.y,
      mat: row.mat,
      state: facingOffset(row.state ?? 0, component),
      component,
      pack: component._pack || pack,
      packKey: (component._pack || pack)?.key || row.packKey,
      group,
      groupName: custom.name,
    });
    newIndices.push(state.records.length - 1);
  });
  if (!newIndices.length) {
    alert("自定义组件没有可用素材。");
    return;
  }
  setSelection(newIndices);
  renderBuilding();
}

function selectedUnlockedIndices() {
  return state.selected.filter((index) => state.records[index] && !state.records[index].locked);
}

function deleteSelected() {
  const indices = selectedUnlockedIndices().sort((a, b) => b - a);
  if (!indices.length) return;
  pushHistory();
  indices.forEach((index) => state.records.splice(index, 1));
  clearSelection();
  renderBuilding();
}

function flipSelectedOrBrush() {
  const indices = selectedUnlockedIndices();
  if (indices.length) {
    pushHistory();
    indices.forEach((index) => {
      const record = state.records[index];
      const component = record.component || componentByUid(record.mat, record.pack || state.pack);
      const frameCount = componentFrameCount(component);
      record.state = ((record.state ?? record.flip ?? 0) + 1) % frameCount;
      delete record.flip;
    });
    updateFacingControl();
    updateSelectionCaption();
    renderBuilding();
    return;
  }
  stepFacing(1);
}

function reorderSelected(command) {
  const indices = selectedUnlockedIndices().sort((a, b) => a - b);
  if (!indices.length) return;
  pushHistory();
  const moving = indices.map((index) => state.records[index]);
  const keep = state.records.filter((_, index) => !indices.includes(index));

  if (command === "bottom") {
    state.records = [...moving, ...keep];
  } else if (command === "top") {
    state.records = [...keep, ...moving];
  } else if (command === "down") {
    const set = new Set(indices);
    const next = state.records.slice();
    for (let i = 0; i < next.length; i++) {
      if (!set.has(i) || i === 0) continue;
      if (set.has(i - 1)) continue;
      const tmp = next[i - 1];
      next[i - 1] = next[i];
      next[i] = tmp;
      set.delete(i);
      set.add(i - 1);
    }
    state.records = next;
  } else if (command === "up") {
    const set = new Set(indices);
    const next = state.records.slice();
    for (let i = next.length - 1; i >= 0; i--) {
      if (!set.has(i) || i >= next.length - 1) continue;
      if (set.has(i + 1)) continue;
      const tmp = next[i + 1];
      next[i + 1] = next[i];
      next[i] = tmp;
      set.delete(i);
      set.add(i + 1);
    }
    state.records = next;
  } else {
    return;
  }

  const idSet = new Set(moving);
  const newSelected = [];
  state.records.forEach((record, index) => {
    if (idSet.has(record)) newSelected.push(index);
  });
  setSelection(newSelected);
  renderBuilding();
}

function duplicateSelected() {
  const indices = selectedUnlockedIndices();
  if (!indices.length) return;
  pushHistory();
  const clones = [];
  const groupMap = new Map();
  indices.forEach((index) => {
    const source = state.records[index];
    const clone = {
      ...source,
      x: source.x + (state.snap.step || 4),
      y: source.y + (state.snap.step || 4),
      component: source.component,
      pack: source.pack,
    };
    if (source.group) {
      if (!groupMap.has(source.group)) groupMap.set(source.group, `${Date.now()}-dup-${groupMap.size}`);
      clone.group = groupMap.get(source.group);
    }
    clones.push(clone);
  });
  const start = state.records.length;
  state.records.push(...clones);
  setSelection(clones.map((_, offset) => start + offset));
  renderBuilding();
}

function serializeClipboardRecords(indices) {
  return indices.map((index) => {
    const record = state.records[index];
    return {
      mat: record.mat,
      state: record.state ?? record.flip ?? 0,
      x: record.x,
      y: record.y,
      packKey: record.packKey || record.pack?.key || state.pack?.key,
      group: record.group || null,
      groupName: record.groupName || null,
      label: record.label || null,
    };
  });
}

function copySelected() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) return;
  state.clipboard = serializeClipboardRecords(indices);
}

function pasteClipboard() {
  if (!state.clipboard?.length) return;
  pushHistory();
  const bounds = clipboardBounds(state.clipboard);
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  let originX;
  let originY;
  if (state.ghost) {
    originX = state.ghost.x - width / 2 - bounds.left;
    originY = state.ghost.y - height / 2 - bounds.top;
  } else {
    const offset = state.snap.step || 4;
    originX = offset;
    originY = offset;
  }
  if (state.snap.enabled) {
    originX = snapGridValue(originX);
    originY = snapGridValue(originY);
  }
  const groupMap = new Map();
  const newIndices = [];
  state.clipboard.forEach((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    if (!component) return;
    let group = null;
    if (row.group) {
      if (!groupMap.has(row.group)) groupMap.set(row.group, `${Date.now()}-paste-${groupMap.size}`);
      group = groupMap.get(row.group);
    }
    const pos = clampRecordPos(row.x + originX, row.y + originY);
    state.records.push({
      mode: "desk",
      x: pos.x,
      y: pos.y,
      mat: row.mat,
      state: facingOffset(row.state ?? 0, component),
      component,
      pack: component._pack || pack,
      packKey: (component._pack || pack)?.key || row.packKey,
      group: group || undefined,
      groupName: row.groupName || undefined,
      label: row.label || undefined,
    });
    newIndices.push(state.records.length - 1);
  });
  if (!newIndices.length) return;
  state.clipboard = serializeClipboardRecords(newIndices);
  setSelection(newIndices);
  updateFacingControl();
  renderBuilding();
}

function groupSelected() {
  const indices = selectedUnlockedIndices();
  if (indices.length < 2) {
    alert("请先框选或 Ctrl 点选至少两个素材，再点「分组」。");
    return;
  }
  const name = prompt("分组名称（可留空，方便图层里识别）", "") || "";
  const group = `${Date.now()}-grp`;
  pushHistory();
  indices.forEach((index) => {
    state.records[index].group = group;
    if (name) state.records[index].groupName = name;
    else delete state.records[index].groupName;
  });
  setSelection(indices, { expandGroup: true });
  updateSelectionCaption();
  renderBuilding();
}

function ungroupSelected() {
  const indices = state.selected.filter((index) => state.records[index]?.group);
  if (!indices.length) {
    alert("当前选择里没有已分组的素材。");
    return;
  }
  const groups = new Set(indices.map((index) => state.records[index].group));
  pushHistory();
  state.records.forEach((record) => {
    if (record.group && groups.has(record.group)) {
      delete record.group;
      delete record.groupName;
    }
  });
  setSelection(indices);
  updateSelectionCaption();
  renderBuilding();
}

function lockSelected() {
  const indices = state.selected.filter((index) => state.records[index] && !state.records[index].locked);
  if (!indices.length) {
    alert("请先选中要锁定的素材（已锁定的不用再锁）。");
    return;
  }
  pushHistory();
  indices.forEach((index) => {
    state.records[index].locked = true;
  });
  updateSelectionCaption();
  fillLayers();
  renderBuilding();
}

function unlockSelected() {
  const indices = state.selected.filter((index) => state.records[index]?.locked);
  if (!indices.length) {
    alert("当前选择没有已锁定的素材。可在「图层」里点锁图标，或先全选再解锁。");
    return;
  }
  pushHistory();
  indices.forEach((index) => {
    state.records[index].locked = false;
  });
  updateSelectionCaption();
  fillLayers();
  renderBuilding();
}

function toggleLockSelected() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) {
    alert("请先选中要锁定/解锁的素材。");
    return;
  }
  if (indices.every((index) => state.records[index].locked)) unlockSelected();
  else lockSelected();
}

function nudgeSelected(dx, dy) {
  const indices = expandGroupSelection(selectedUnlockedIndices()).filter(
    (index) => !state.records[index]?.locked
  );
  if (!indices.length) return;
  pushHistory();
  indices.forEach((index) => {
    const record = state.records[index];
    const pos = clampRecordPos(record.x + dx, record.y + dy);
    record.x = pos.x;
    record.y = pos.y;
  });
  setSelection(indices);
  renderBuilding();
}

function alignSelection(mode) {
  const indices = selectedUnlockedIndices();
  if (indices.length < 2) return;
  const rows = selectionBoxes(indices);
  const union = unionBox(rows);
  if (!union) return;
  pushHistory();

  if (mode === "left") {
    rows.forEach(({ index, box }) => {
      state.records[index].x = Math.round(union.left);
    });
  } else if (mode === "right") {
    rows.forEach(({ index, box }) => {
      state.records[index].x = Math.round(union.right - box.width);
    });
  } else if (mode === "centerX") {
    const cx = (union.left + union.right) / 2;
    rows.forEach(({ index, box }) => {
      state.records[index].x = Math.round(cx - box.width / 2);
    });
  } else if (mode === "top") {
    rows.forEach(({ index, box }) => {
      state.records[index].y = Math.round(union.top);
    });
  } else if (mode === "bottom") {
    rows.forEach(({ index, box }) => {
      state.records[index].y = Math.round(union.bottom - box.height);
    });
  } else if (mode === "centerY") {
    const cy = (union.top + union.bottom) / 2;
    rows.forEach(({ index, box }) => {
      state.records[index].y = Math.round(cy - box.height / 2);
    });
  } else if (mode === "distributeX" && rows.length >= 3) {
    const ordered = [...rows].sort((a, b) => a.box.x - b.box.x);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const span = last.box.x - first.box.x;
    ordered.forEach((row, i) => {
      if (i === 0 || i === ordered.length - 1) return;
      state.records[row.index].x = Math.round(first.box.x + (span * i) / (ordered.length - 1));
    });
  } else if (mode === "distributeY" && rows.length >= 3) {
    const ordered = [...rows].sort((a, b) => a.box.y - b.box.y);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const span = last.box.y - first.box.y;
    ordered.forEach((row, i) => {
      if (i === 0 || i === ordered.length - 1) return;
      state.records[row.index].y = Math.round(first.box.y + (span * i) / (ordered.length - 1));
    });
  } else {
    return;
  }

  indices.forEach((index) => {
    const pos = clampRecordPos(state.records[index].x, state.records[index].y);
    state.records[index].x = pos.x;
    state.records[index].y = pos.y;
  });
  renderBuilding();
}

function finishMarquee() {
  if (!state.marquee) return;
  const { x0, y0, x1, y1, additive } = state.marquee;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  state.marquee = null;
  if (Math.abs(right - left) < 2 && Math.abs(bottom - top) < 2) {
    if (!additive) clearSelection();
    renderBuilding();
    return;
  }
  const hits = [];
  state.records.forEach((record, index) => {
    if (record.hidden || record.locked) return;
    const box = recordBox(record);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) hits.push(index);
  });
  if (additive) {
    const set = new Set(state.selected);
    hits.forEach((index) => set.add(index));
    setSelection([...set]);
  } else {
    setSelection(hits);
  }
  renderBuilding();
}

function loadCustoms() {
  try {
    const raw = localStorage.getItem(CUSTOMS_KEY);
    state.customs = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.customs)) state.customs = [];
  } catch {
    state.customs = [];
  }
}

function saveCustoms() {
  localStorage.setItem(CUSTOMS_KEY, JSON.stringify(state.customs));
}

function customFolders() {
  const folders = new Set();
  state.customs.forEach((item) => {
    if (item.folder) folders.add(item.folder);
  });
  return [...folders].sort((a, b) => a.localeCompare(b, "zh"));
}

function refreshFolderSuggestions() {
  const list = document.getElementById("folderSuggestions");
  if (!list) return;
  list.innerHTML = "";
  customFolders().forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder;
    list.appendChild(option);
  });
  const filter = document.getElementById("customFolderFilter");
  if (!filter) return;
  const current = filter.value;
  filter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部分组";
  filter.appendChild(all);
  customFolders().forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder;
    option.textContent = folder;
    filter.appendChild(option);
  });
  if ([...filter.options].some((option) => option.value === current)) filter.value = current;
}

function fillCustoms() {
  refreshFolderSuggestions();
  const list = document.getElementById("customList");
  if (!list) return;
  list.innerHTML = "";
  const folder = document.getElementById("customFolderFilter")?.value || "";
  state.customs
    .filter((item) => !folder || item.folder === folder)
    .forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "custom-card" + (state.customBrush?.id === item.id ? " on" : "");
      card.title = "按住拖到画布放置，或点击选用";
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${item.folder || "未分组"} · ${item.records?.length || 0} 件 · 可拖出`;
      body.append(title, meta);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.title = "删除";
      del.textContent = "✕";
      del.onclick = (event) => {
        event.stopPropagation();
        if (!confirm(`删除自定义组件「${item.name}」？`)) return;
        state.customs = state.customs.filter((row) => row.id !== item.id);
        if (state.customBrush?.id === item.id) state.customBrush = null;
        saveCustoms();
        fillCustoms();
        updateSelectionCaption();
        renderBuilding();
      };
      card.append(body, del);
      const selectCustom = () => {
        state.customBrush = item;
        state.component = null;
        state.brushState = 0;
        state.selected = [];
        fillComponents();
        fillCustoms();
        updateSelectionCaption();
        updateAlignBar();
        updateFacingControl();
        renderBuilding();
      };
      card.onpointerdown = (event) => {
        if (event.target.closest(".del")) return;
        if (event.button !== 0) return;
        event.preventDefault();
        selectCustom();
        beginPaletteDrag("custom", item, event, card);
      };
      card.onclick = (event) => {
        if (event.target.closest(".del")) return;
        if (state.paletteClickIgnore) {
          state.paletteClickIgnore = false;
          return;
        }
        selectCustom();
      };
      list.appendChild(card);
    });
}

function openPresetDialog() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) {
    alert("请先选择要保存的组件。");
    return;
  }
  refreshFolderSuggestions();
  document.getElementById("presetName").value = "";
  document.getElementById("presetFolder").value =
    document.getElementById("customFolderFilter")?.value || "";
  document.getElementById("dlgPreset").hidden = false;
  document.getElementById("presetName").focus();
}

function closePresetDialog() {
  document.getElementById("dlgPreset").hidden = true;
}

function confirmPresetDialog() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) {
    closePresetDialog();
    return;
  }
  const name = document.getElementById("presetName").value.trim() || "未命名组件";
  const folder = document.getElementById("presetFolder").value.trim();
  const boxes = selectionBoxes(indices);
  const union = unionBox(boxes);
  const records = indices.map((index) => {
    const record = state.records[index];
    return {
      mat: record.mat,
      state: record.state ?? record.flip ?? 0,
      dx: record.x - union.left,
      dy: record.y - union.top,
      packKey: record.packKey || record.pack?.key || state.pack?.key || "",
    };
  });
  state.customs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    folder,
    createdAt: Date.now(),
    records,
  });
  saveCustoms();
  closePresetDialog();
  setRailTab("customs");
  fillCustoms();
}

function layerLabel(record, component) {
  if (record?.label) return record.label;
  if (component) return `${component.category || "组件"} #${component.id || record.mat}`;
  return `mat ${record?.mat ?? "?"}`;
}

function groupMemberIndices(groupId) {
  const indices = [];
  state.records.forEach((record, index) => {
    if (record.group === groupId) indices.push(index);
  });
  return indices;
}

function toggleGroupVisibility(groupId) {
  const indices = groupMemberIndices(groupId);
  if (!indices.length) return;
  const anyVisible = indices.some((index) => !state.records[index].hidden);
  indices.forEach((index) => {
    state.records[index].hidden = anyVisible;
  });
  if (anyVisible) {
    const hideSet = new Set(indices);
    state.selected = state.selected.filter((index) => !hideSet.has(index));
    updateSelectionCaption();
    updateAlignBar();
  }
  fillLayers();
  renderBuilding();
}

function toggleGroupLock(groupId) {
  const indices = groupMemberIndices(groupId);
  if (!indices.length) return;
  pushHistory();
  const anyUnlocked = indices.some((index) => !state.records[index].locked);
  indices.forEach((index) => {
    state.records[index].locked = anyUnlocked;
  });
  updateSelectionCaption();
  fillLayers();
  renderBuilding();
}

function selectLayerIndex(index, event) {
  const record = state.records[index];
  if (!record) return;
  if (event.altKey) {
    setSelection([index]);
  } else if (event.ctrlKey || event.metaKey) {
    const set = new Set(state.selected);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    setSelection([...set]);
  } else if (event.shiftKey && state.selected.length) {
    const anchor = state.selected[state.selected.length - 1];
    const lo = Math.min(anchor, index);
    const hi = Math.max(anchor, index);
    const range = [];
    for (let i = lo; i <= hi; i++) {
      if (!state.records[i]?.hidden) range.push(i);
    }
    setSelection(range);
  } else {
    setSelection([index], { expandGroup: !!record.group });
  }
  state.component = null;
  state.customBrush = null;
  fillComponents();
  fillCustoms();
  renderBuilding();
}

function renameLayer(index) {
  const record = state.records[index];
  if (!record) return;
  const component = record.component || componentByUid(record.mat, record.pack || state.pack);
  const current = layerLabel(record, component);
  const next = prompt("图层名称", current);
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === current) return;
  pushHistory();
  record.label = trimmed;
  fillLayers();
  updateSelectionCaption();
}

function createLayerEyeButton(hidden, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "layer-eye" + (hidden ? " off" : "");
  btn.title = hidden ? "显示" : "隐藏";
  btn.textContent = hidden ? "◌" : "👁";
  btn.onclick = (event) => {
    event.stopPropagation();
    onClick();
  };
  return btn;
}

function createLayerLockButton(locked, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "layer-lock";
  btn.title = locked ? "解锁" : "锁定";
  btn.textContent = locked ? "🔒" : "🔓";
  btn.onclick = (event) => {
    event.stopPropagation();
    onClick();
  };
  return btn;
}

function buildGroupThumb(memberIndices) {
  const size = 32;
  const wrap = document.createElement("span");
  wrap.className = "layer-group-thumb";
  const sheet = document.createElement("canvas");
  sheet.className = "layer-thumb";
  sheet.width = size;
  sheet.height = size;
  sheet.title = "分组预览";
  wrap.appendChild(sheet);
  const badge = document.createElement("span");
  badge.className = "layer-group-badge";
  badge.textContent = "组";
  wrap.appendChild(badge);
  if (memberIndices.length > 8 || state.records.length > 200) return wrap;

  const items = [];
  memberIndices.forEach((index) => {
    const record = state.records[index];
    if (!record) return;
    const component = recordComponent(record);
    const pack = component?._pack || recordPack(record);
    if (!component) return;
    const face = record.state ?? record.flip ?? 0;
    const box = recordBox(record);
    const url = spriteUrl(component, pack, face);
    const image = url ? loadImage(url) : null;
    items.push({
      box,
      image,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      hidden: !!record.hidden,
    });
  });
  if (!items.length) return wrap;

  const left = Math.min(...items.map((item) => item.box.x));
  const top = Math.min(...items.map((item) => item.box.y));
  const right = Math.max(...items.map((item) => item.box.x + item.width));
  const bottom = Math.max(...items.map((item) => item.box.y + item.height));
  const worldW = Math.max(1, right - left);
  const worldH = Math.max(1, bottom - top);
  const scale = Math.min(size / worldW, size / worldH);
  const offsetX = (size - worldW * scale) / 2;
  const offsetY = (size - worldH * scale) / 2;
  const ctx = sheet.getContext("2d");

  const paint = () => {
    ctx.clearRect(0, 0, size, size);
    items.forEach(({ box, image, width, height, hidden }) => {
      const dx = offsetX + (box.x - left) * scale;
      const dy = offsetY + (box.y - top) * scale;
      const dw = Math.max(1, width * scale);
      const dh = Math.max(1, height * scale);
      ctx.globalAlpha = hidden ? 0.35 : 1;
      if (image?.complete && image.naturalWidth) {
        ctx.drawImage(image, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = "rgba(47, 107, 79, 0.35)";
        ctx.fillRect(dx, dy, dw, dh);
      }
      ctx.globalAlpha = 1;
    });
  };
  paint();
  items.forEach(({ image }) => {
    if (image && !image.complete) {
      image.addEventListener("load", paint, { once: true });
    }
  });
  return wrap;
}

function appendGroupHeader(list, groupId, memberIndices, selectedSet, filterText) {
  const sample = state.records[memberIndices[0]];
  const groupName = sample?.groupName || "未命名组";
  const collapsed = state.layerCollapsed.has(groupId);
  const allHidden = memberIndices.every((index) => state.records[index].hidden);
  const allLocked = memberIndices.every((index) => state.records[index].locked);
  const selected = memberIndices.some((index) => selectedSet.has(index));
  const groupHit = !filterText || `${groupName}`.toLowerCase().includes(filterText);
  const memberHit = !filterText || memberIndices.some((index) => {
    const record = state.records[index];
    const component = record.component || componentByUid(record.mat, record.pack || state.pack);
    return layerLabel(record, component).toLowerCase().includes(filterText);
  });
  if (filterText && !groupHit && !memberHit) return { shown: false, forceChildren: false };

  const row = document.createElement("div");
  row.className = "layer-row is-group" + (selected ? " on" : "") + (allHidden ? " is-hidden" : "");
  row.dataset.group = groupId;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", selected ? "true" : "false");

  const twist = document.createElement("button");
  twist.type = "button";
  twist.className = "layer-twist";
  twist.title = collapsed ? "展开" : "折叠";
  twist.textContent = collapsed ? "▸" : "▾";
  twist.onclick = (event) => {
    event.stopPropagation();
    if (collapsed) state.layerCollapsed.delete(groupId);
    else state.layerCollapsed.add(groupId);
    fillLayers();
  };

  const eye = createLayerEyeButton(allHidden, () => toggleGroupVisibility(groupId));
  const thumb = buildGroupThumb(memberIndices);
  const name = document.createElement("span");
  name.className = "layer-name";
  name.innerHTML = `${groupName}<small>${memberIndices.length} 个图层</small>`;
  const lock = createLayerLockButton(allLocked, () => toggleGroupLock(groupId));

  row.style.gridTemplateColumns = "22px 24px 36px minmax(0,1fr) 28px";
  row.append(twist, eye, thumb, name, lock);

  row.onclick = (event) => {
    if (event.target.closest("button")) return;
    if (event.ctrlKey || event.metaKey) {
      const set = new Set(state.selected);
      const allIn = memberIndices.every((index) => set.has(index));
      if (allIn) memberIndices.forEach((index) => set.delete(index));
      else memberIndices.forEach((index) => set.add(index));
      setSelection([...set]);
    } else {
      setSelection(memberIndices);
    }
    state.component = null;
    state.customBrush = null;
    fillComponents();
    fillCustoms();
    renderBuilding();
  };
  row.ondblclick = (event) => {
    event.stopPropagation();
    const next = prompt("组名称", groupName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    pushHistory();
    memberIndices.forEach((index) => {
      state.records[index].groupName = trimmed;
    });
    fillLayers();
    updateSelectionCaption();
  };
  list.appendChild(row);
  return { shown: true, forceChildren: groupHit && !!filterText };
}

function appendLayerRow(list, index, selectedSet, filterText, asChild) {
  const record = state.records[index];
  const component = recordComponent(record);
  const pack = recordPack(record) || component?._pack;
  const label = layerLabel(record, component);
  const packName = pack?.name || pack?.key || "";
  if (filterText) {
    const hay = `${label} ${packName} ${record.groupName || ""}`.toLowerCase();
    if (!hay.includes(filterText)) return false;
  }

  const row = document.createElement("div");
  row.className =
    "layer-row" +
    (asChild ? " is-child" : "") +
    (selectedSet.has(index) ? " on" : "") +
    (record.locked ? " locked" : "") +
    (record.hidden ? " is-hidden" : "");
  row.dataset.index = String(index);
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", selectedSet.has(index) ? "true" : "false");

  if (asChild) {
    const indent = document.createElement("span");
    indent.className = "layer-indent";
    row.appendChild(indent);
  }

  const eye = createLayerEyeButton(!!record.hidden, () => {
    record.hidden = !record.hidden;
    if (record.hidden) state.selected = state.selected.filter((i) => i !== index);
    updateSelectionCaption();
    updateAlignBar();
    fillLayers();
    renderBuilding();
  });

  const thumb = document.createElement("img");
  thumb.className = "layer-thumb";
  thumb.alt = "";
  thumb.draggable = false;
  const url = spriteUrl(component, pack, record.state ?? record.flip ?? 0, true);
  if (url) thumb.src = url;

  const name = document.createElement("span");
  name.className = "layer-name";
  name.title = `${label}${packName ? ` · ${packName}` : ""}\n双击重命名`;
  const meta = packName ? `<small>${packName}</small>` : "";
  name.innerHTML = `${label}${meta}`;

  const lock = createLayerLockButton(!!record.locked, () => {
    pushHistory();
    record.locked = !record.locked;
    updateSelectionCaption();
    fillLayers();
    renderBuilding();
  });

  row.append(eye, thumb, name, lock);
  row.onclick = (event) => {
    if (event.target.closest("button")) return;
    selectLayerIndex(index, event);
  };
  row.ondblclick = (event) => {
    if (event.target.closest("button")) return;
    event.stopPropagation();
    renameLayer(index);
  };
  list.appendChild(row);
  return true;
}

function collectLayerItems(selectedSet, filterText) {
  const items = [];
  const shownGroups = new Set();
  const forceGroupChildren = new Map();
  for (let index = state.records.length - 1; index >= 0; index--) {
    const record = state.records[index];
    const groupId = record.group || null;
    if (groupId) {
      if (!shownGroups.has(groupId)) {
        shownGroups.add(groupId);
        const members = groupMemberIndices(groupId);
        const header = measureGroupHeader(groupId, members, filterText);
        if (header.shown) items.push({ kind: "group", groupId, members, filterText });
        forceGroupChildren.set(groupId, header.forceChildren);
      }
      if (state.layerCollapsed.has(groupId)) continue;
      const childFilter = forceGroupChildren.get(groupId) ? "" : filterText;
      if (layerRowVisible(index, childFilter)) {
        items.push({ kind: "row", index, asChild: true, filterText: childFilter });
      }
      continue;
    }
    if (layerRowVisible(index, filterText)) {
      items.push({ kind: "row", index, asChild: false, filterText });
    }
  }
  return items;
}

function layerRowVisible(index, filterText) {
  if (!filterText) return true;
  const record = state.records[index];
  const component = recordComponent(record);
  const pack = recordPack(record) || component?._pack;
  const label = layerLabel(record, component);
  const packName = pack?.name || pack?.key || "";
  const hay = `${label} ${packName} ${record.groupName || ""}`.toLowerCase();
  return hay.includes(filterText);
}

function measureGroupHeader(groupId, memberIndices, filterText) {
  const sample = state.records[memberIndices[0]];
  const groupName = sample?.groupName || "未命名组";
  const groupHit = !filterText || `${groupName}`.toLowerCase().includes(filterText);
  const memberHit =
    !filterText ||
    memberIndices.some((index) => {
      const record = state.records[index];
      const component = recordComponent(record);
      return layerLabel(record, component).toLowerCase().includes(filterText);
    });
  if (filterText && !groupHit && !memberHit) return { shown: false, forceChildren: false };
  return { shown: true, forceChildren: groupHit && !!filterText };
}

function paintLayerWindow() {
  const list = document.getElementById("layerList");
  if (!list || state.railTab !== "layers") return;
  const selectedSet = new Set(state.selected);
  const items = layerItemsCache;
  const filterText = (state.layerFilter || "").trim().toLowerCase();
  list.replaceChildren();
  if (!state.records.length) {
    const empty = document.createElement("div");
    empty.className = "layer-empty";
    empty.textContent = "暂无图层，从「素材」里放置组件";
    list.appendChild(empty);
    return;
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "layer-empty";
    empty.textContent = filterText ? "没有匹配的图层" : "暂无图层";
    list.appendChild(empty);
    return;
  }

  const virtual = items.length > 60;
  let start = 0;
  let end = items.length;
  if (virtual) {
    const viewH = list.clientHeight || 400;
    start = Math.max(0, Math.floor(list.scrollTop / LAYER_ROW_H) - LAYER_WINDOW_PAD);
    end = Math.min(items.length, start + Math.ceil(viewH / LAYER_ROW_H) + LAYER_WINDOW_PAD * 2);
    const topPad = document.createElement("div");
    topPad.className = "layer-pad";
    topPad.style.height = `${start * LAYER_ROW_H}px`;
    list.appendChild(topPad);
  }
  for (let i = start; i < end; i++) {
    const item = items[i];
    if (item.kind === "group") {
      appendGroupHeader(list, item.groupId, item.members, selectedSet, item.filterText);
    } else {
      appendLayerRow(list, item.index, selectedSet, item.filterText, item.asChild);
    }
  }
  if (virtual) {
    const botPad = document.createElement("div");
    botPad.className = "layer-pad";
    botPad.style.height = `${(items.length - end) * LAYER_ROW_H}px`;
    list.appendChild(botPad);
  }
}

function bindLayerListScroll() {
  if (layerListBound) return;
  const list = document.getElementById("layerList");
  if (!list) return;
  layerListBound = true;
  list.addEventListener(
    "scroll",
    () => {
      if (layerItemsCache.length <= 60) return;
      if (layerWindowRaf) return;
      layerWindowRaf = requestAnimationFrame(() => {
        layerWindowRaf = 0;
        paintLayerWindow();
      });
    },
    { passive: true }
  );
}

function fillLayers() {
  const list = document.getElementById("layerList");
  if (!list) return;
  if (state.railTab !== "layers") return;
  bindLayerListScroll();
  const selectedSet = new Set(state.selected);
  const filterText = (state.layerFilter || "").trim().toLowerCase();
  layerItemsCache = state.records.length ? collectLayerItems(selectedSet, filterText) : [];
  if (state.selected.length && !state.dragging && !state.marquee) {
    const focus = state.selected[state.selected.length - 1];
    const itemIndex = layerItemsCache.findIndex((item) => item.kind === "row" && item.index === focus);
    if (itemIndex >= 0) {
      const top = itemIndex * LAYER_ROW_H;
      if (top < list.scrollTop || top + LAYER_ROW_H > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - Math.floor((list.clientHeight || 0) / 3));
      }
    }
  }
  paintLayerWindow();
}

function runLayerCommand(command) {
  if (command === "undo") return undo();
  if (command === "redo") return redo();
  if (command === "delete") return deleteSelected();
  if (command === "flip") return flipSelectedOrBrush();
  if (command === "lock") return toggleLockSelected();
  if (command === "duplicate") return duplicateSelected();
  if (command === "group") return groupSelected();
  if (command === "ungroup") return ungroupSelected();
  if (command === "savePreset") return openPresetDialog();
  if (command === "break") return ungroupSelected();
  if (command === "bottom" || command === "top" || command === "down" || command === "up") {
    return reorderSelected(command);
  }
}

function paperBaseFromRecords(records) {
  const header = (records || []).find((record) => Number(record.mat) === 0);
  const paperNo = header ? Number(header.state) : 0;
  if (!(paperNo > 0)) return null;
  return (state.catalog?.building?.bases || []).find((row) => row.no === paperNo) || null;
}

function applyImportedPaperBase(records) {
  const paperBase = paperBaseFromRecords(records);
  state.paperBaseHint = "";
  if (!paperBase) return;
  const keepCurrent =
    state.basePicked && state.base && Number(state.base.no) !== Number(paperBase.no);
  if (keepCurrent) {
    const size = paperBase.footprint?.join("×") || "";
    state.paperBaseHint = `${paperBase.name}${size ? ` ${size}` : ""}`;
    return;
  }
  state.base = paperBase;
  state.baseKind = paperBase.kind ?? 0;
  fillBaseKindTabs();
  fillBaseIcons();
}

async function importDesign(file) {
  const buffer = await file.arrayBuffer();
  const response = await fetch("/api/parse-building", {
    method: "POST",
    body: buffer,
  });
  if (!response.ok) throw new Error("建筑图纸解析失败 (" + response.status + ")");
  const documentData = await response.json();
  if (documentData.kind !== "desk") {
    const goTerrain = confirm(
      `「${file.name}」是庄园摆放图（共 ${documentData.records?.length || 0} 个点），不是户型装修图。\n\n` +
        "是否打开地形设计桌导入？"
    );
    if (!goTerrain) return;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    sessionStorage.setItem(
      "manor-pending-building-import",
      JSON.stringify({
        name: file.name,
        encoding: documentData._source?.encoding || "gbk",
        base64: btoa(binary),
        at: Date.now(),
      })
    );
    location.href = "/web/index.html?importBuilding=1";
    return;
  }
  const records = documentData.records || [];
  applyImportedPaperBase(records);
  invalidateBaseLayout();
  pushHistory();
  state.source = {
    encoding: documentData._source?.encoding || "gbk",
  };
  state.paperLayout = true;
  let lastTheme = state.pack;
  state.records = records.map((record) => {
    const mat = Number(record.mat) || 0;
    const offscreen = (record.x || 0) >= 32000 || (record.y || 0) >= 32000;
    let packKey = state.pack?.key || "";
    if (mat >= 1000) {
      const pack = packForPaperUid(Math.floor(mat / 1000));
      if (pack) {
        packKey = pack.key;
        if (pack.kind === "theme") lastTheme = pack;
      }
    }
    return {
      mode: "desk",
      x: Number(record.x) || 0,
      y: Number(record.y) || 0,
      mat,
      state: record.state ?? record.flip ?? 0,
      packKey,
      hidden: mat === 0 || offscreen,
    };
  });
  if (lastTheme) state.pack = lastTheme;
  ensureActiveCategory();
  fillThemes();
  fillCategories();
  clearSelection();
  setPhase("design");
  updateSelectionCaption();
  fillComponents();
  fillLayers();
  syncDesignResetButtons();
  updateBase();
  renderBuilding();
}

async function exportDesign() {
  const payload = {
    kind: "desk",
    records: state.records.map((record) => {
      const {
        component,
        pack,
        group,
        locked,
        hidden,
        groupName,
        label,
        packKey,
        ...rest
      } = record;
      return rest;
    }),
    _source: state.source,
  };
  const response = await fetch("/api/format-building", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("建筑图纸生成失败 (" + response.status + ")");
  const blob = await response.blob();
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "build.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function bindBuilding() {
  document.getElementById("btnChooseBase").onclick = () => {
    state.baseKind = state.base?.kind ?? 0;
    fillBaseKindTabs();
    fillBaseIcons();
    setPhase("select");
    invalidateBaseLayout();
    updateBase();
    renderBuilding();
  };
  document.getElementById("btnNextBase").onclick = () => beginDesign();
  const btnClearDesign = document.getElementById("btnClearDesign");
  if (btnClearDesign) btnClearDesign.onclick = () => clearCurrentDesign({ ask: true });
  document.getElementById("btnBackBase").onclick = () => {
    window.location.href = "/";
  };
  document.getElementById("btnCloseBuilding").onclick = () => {
    window.location.href = "/";
  };
  document.getElementById("keepFoundation").onchange = (event) => {
    state.keepFoundation = event.target.checked;
    markBuildingDirty();
    renderBuilding();
  };
  document.getElementById("snapEnabled").onchange = (event) => {
    state.snap.enabled = event.target.checked;
    markBuildingDirty();
  };
  document.getElementById("snapStep").onchange = (event) => {
    state.snap.step = Math.max(1, Number(event.target.value) || 4);
    markBuildingDirty();
  };
  const veilEnabled = document.getElementById("veilEnabled");
  const veilOpacity = document.getElementById("veilOpacity");
  if (veilEnabled) {
    veilEnabled.onchange = (event) => {
      state.veil.enabled = event.target.checked;
      syncVeilControls();
      markBuildingDirty();
      renderBuilding();
    };
  }
  if (veilOpacity) {
    const applyVeilOpacity = () => {
      state.veil.opacity = Math.max(0, Math.min(0.9, (Number(veilOpacity.value) || 0) / 100));
      syncVeilControls();
      markBuildingDirty();
      renderBuilding();
    };
    veilOpacity.oninput = applyVeilOpacity;
    veilOpacity.onchange = applyVeilOpacity;
  }
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomReset = document.getElementById("btnZoomReset");
  if (btnZoomOut) btnZoomOut.onclick = () => zoomBy(-ZOOM_STEP);
  if (btnZoomIn) btnZoomIn.onclick = () => zoomBy(ZOOM_STEP);
  if (btnZoomReset) btnZoomReset.onclick = () => setZoom(1);
  const canvasShell = document.getElementById("canvasShell");
  if (canvasShell) {
    canvasShell.addEventListener(
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomBy(delta, event.clientX, event.clientY);
      },
      { passive: false }
    );
  }
  window.addEventListener("resize", () => {
    applyZoom();
  });
  const btnFacingPrev = document.getElementById("btnFacingPrev");
  const btnFacingNext = document.getElementById("btnFacingNext");
  if (btnFacingPrev) btnFacingPrev.onclick = () => stepFacing(-1);
  if (btnFacingNext) btnFacingNext.onclick = () => stepFacing(1);
  updateFacingControl();
  document.getElementById("btnImportDesign").onclick = () => {
    document.getElementById("buildingFile").click();
  };
  document.getElementById("btnAllMaterials").onclick = () => {
    const text = [...document.querySelectorAll(".mat-chip")]
      .map((node) => node.textContent)
      .join("\n");
    if (text) alert(text);
  };
  document.getElementById("buildingFile").onchange = async (event) => {
    if (!event.target.files[0]) return;
    try {
      await importDesign(event.target.files[0]);
    } catch (error) {
      alert(error.message || String(error));
    }
    event.target.value = "";
  };
  document.getElementById("btnSaveDesign").onclick = () => {
    exportDesign().catch((error) => alert(error.message || String(error)));
  };
  document.getElementById("btnMakeBuilding").onclick = () => {
    exportDesign().catch((error) => alert(error.message || String(error)));
  };
  document.querySelectorAll(".canvas-toolbar button[data-command]").forEach((button) => {
    button.onclick = () => runLayerCommand(button.dataset.command);
  });
  document.querySelectorAll("#alignBar button").forEach((button) => {
    button.onclick = () => alignSelection(button.dataset.align);
  });
  document.querySelectorAll(".rail-tab").forEach((button) => {
    button.onclick = () => setRailTab(button.dataset.tab);
  });
  document.getElementById("btnSelectAll").onclick = () => {
    setSelection(state.records.map((_, index) => index).filter((index) => !state.records[index].hidden));
    renderBuilding();
  };
  document.getElementById("btnClearSel").onclick = () => {
    clearSelection();
    renderBuilding();
  };
  const btnGroupSel = document.getElementById("btnGroupSel");
  const btnUngroupSel = document.getElementById("btnUngroupSel");
  const btnLockSel = document.getElementById("btnLockSel");
  const btnUnlockSel = document.getElementById("btnUnlockSel");
  if (btnGroupSel) btnGroupSel.onclick = () => groupSelected();
  if (btnUngroupSel) btnUngroupSel.onclick = () => ungroupSelected();
  if (btnLockSel) btnLockSel.onclick = () => lockSelected();
  if (btnUnlockSel) btnUnlockSel.onclick = () => unlockSelected();
  const btnClearPick = document.getElementById("btnClearPick");
  if (btnClearPick) btnClearPick.onclick = () => cancelPick();
  const btnLayerGroup = document.getElementById("btnLayerGroup");
  const btnLayerUngroup = document.getElementById("btnLayerUngroup");
  const btnLayerDelete = document.getElementById("btnLayerDelete");
  if (btnLayerGroup) btnLayerGroup.onclick = () => groupSelected();
  if (btnLayerUngroup) btnLayerUngroup.onclick = () => ungroupSelected();
  if (btnLayerDelete) btnLayerDelete.onclick = () => deleteSelected();
  const layerFilter = document.getElementById("layerFilter");
  if (layerFilter) {
    layerFilter.oninput = () => {
      state.layerFilter = layerFilter.value || "";
      fillLayers();
    };
  }
  const themeSearch = document.getElementById("themeSearch");
  if (themeSearch) {
    themeSearch.oninput = () => fillThemes();
  }
  document.getElementById("customFolderFilter").onchange = () => fillCustoms();
  document.getElementById("btnNewFolder").onclick = () => {
    const name = prompt("新建分组名称", "");
    if (!name || !name.trim()) return;
    const folder = name.trim();
    const filter = document.getElementById("customFolderFilter");
    refreshFolderSuggestions();
    if (![...filter.options].some((option) => option.value === folder)) {
      const option = document.createElement("option");
      option.value = folder;
      option.textContent = folder;
      filter.appendChild(option);
    }
    filter.value = folder;
    document.getElementById("presetFolder").value = folder;
    const list = document.getElementById("folderSuggestions");
    if (list && ![...list.options].some((option) => option.value === folder)) {
      const option = document.createElement("option");
      option.value = folder;
      list.appendChild(option);
    }
    fillCustoms();
  };
  document.getElementById("btnPresetClose").onclick = closePresetDialog;
  document.getElementById("btnPresetOk").onclick = confirmPresetDialog;
  document.getElementById("dlgPreset").addEventListener("click", (event) => {
    if (event.target.id === "dlgPreset") closePresetDialog();
  });

  canvas.onmousedown = (event) => {
    if (state.phase !== "design") return;
    if (event.button === 2) {
      event.preventDefault();
      cancelPick();
      return;
    }
    if (event.button !== 0) return;
    const { x, y } = canvasPoint(event);
    const hit = hitRecord(x, y);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const wantMarquee = event.altKey || !hasBrush();

    if (hit >= 0) {
      state.component = null;
      state.customBrush = null;
      fillComponents();
      fillCustoms();
      if (additive) {
        const set = new Set(state.selected);
        if (set.has(hit)) set.delete(hit);
        else set.add(hit);
        // Ctrl 多选时不自动扩组，方便从组里加减单件
        setSelection([...set]);
      } else if (event.altKey) {
        // Alt 点选：只选组内单件
        setSelection([hit]);
      } else {
        // 普通点击：若属于某组则整组选中，拖动能一起移动
        setSelection([hit], { expandGroup: true });
      }
      const dragIndices = expandGroupSelection(state.selected.length ? state.selected : [hit]).filter(
        (index) => !state.records[index]?.locked
      );
      if (!event.altKey && !additive) setSelection(expandGroupSelection([hit]));
      if (!dragIndices.length) {
        updateSelectionCaption();
        renderBuilding();
        return;
      }
      state.dragging = {
        x,
        y,
        origins: dragIndices.map((index) => ({
          i: index,
          x: state.records[index].x,
          y: state.records[index].y,
        })),
        moved: false,
        before: recordsHistoryPayload(),
      };
      state.guides = [];
      updateSelectionCaption();
      renderBuilding();
      return;
    }

    if (state.selected.length && !additive) {
      clearSelection();
      renderBuilding();
      return;
    }

    if (hasBrush() && !event.altKey) {
      addComponent(x, y);
      return;
    }

    if (wantMarquee) {
      if (!additive) clearSelection();
      state.marquee = { x0: x, y0: y, x1: x, y1: y, additive };
      renderBuilding();
    }
  };

  canvas.oncontextmenu = (event) => {
    if (state.phase !== "design") return;
    event.preventDefault();
    cancelPick();
  };

  canvas.onmousemove = (event) => {
    if (state.phase !== "design") return;
    const { x, y } = canvasPoint(event);
    state.ghost = hasBrush() ? { x, y } : null;
    if (state.marquee) {
      state.marquee.x1 = x;
      state.marquee.y1 = y;
    } else if (state.dragging) {
      applyDragPositions(x, y);
    }
    renderBuilding();
  };

  canvas.onmouseleave = () => {
    state.ghost = null;
    if (!state.dragging && !state.marquee) renderBuilding();
  };

  window.addEventListener("mouseup", (event) => {
    if (state.paletteDrag) {
      finishPaletteDrag(event);
      return;
    }
    if (state.marquee) {
      finishMarquee();
      return;
    }
    if (state.dragging) {
      if (state.dragging.moved && state.dragging.before) {
        const after = recordsHistoryPayload();
        if (after !== state.dragging.before) {
          state.history.push(state.dragging.before);
          const cap = historyCap();
          while (state.history.length > cap) state.history.shift();
          state.redo = [];
          markBuildingDirty();
        }
      }
      state.dragging = null;
      state.guides = [];
      renderBuilding();
    }
  });

  window.addEventListener("pointermove", (event) => {
    if (state.paletteDrag) updatePaletteDrag(event);
  });

  window.addEventListener("blur", () => {
    if (state.paletteDrag) {
      state.paletteDrag = null;
      clearPaletteGhost();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (state.phase !== "design") return;
    const tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const key = event.key.toLowerCase();

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === "[" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      reorderSelected("bottom");
    } else if (event.key === "]" && event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      reorderSelected("top");
    } else if (event.key === "[" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      reorderSelected("down");
    } else if (event.key === "]" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      reorderSelected("up");
    } else if (event.key === "," || event.key === "，") {
      event.preventDefault();
      stepFacing(-1);
    } else if (event.key === "." || event.key === "。") {
      event.preventDefault();
      stepFacing(1);
    } else if (event.key === " " || key === "f") {
      event.preventDefault();
      flipSelectedOrBrush();
    } else if (event.ctrlKey && key === "z") {
      event.preventDefault();
      undo();
    } else if (event.ctrlKey && key === "y") {
      event.preventDefault();
      redo();
    } else if (event.ctrlKey && key === "d") {
      event.preventDefault();
      duplicateSelected();
    } else if (event.ctrlKey && key === "l") {
      event.preventDefault();
      toggleLockSelected();
    } else if (event.ctrlKey && key === "c") {
      event.preventDefault();
      copySelected();
    } else if (event.ctrlKey && key === "v") {
      event.preventDefault();
      pasteClipboard();
    } else if (event.ctrlKey && event.shiftKey && key === "g") {
      event.preventDefault();
      ungroupSelected();
    } else if (event.ctrlKey && key === "g") {
      event.preventDefault();
      groupSelected();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = (state.snap.step || 4) * (event.shiftKey ? 4 : 1);
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      nudgeSelected(dx, dy);
    } else if ((event.ctrlKey || event.metaKey) && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if ((event.ctrlKey || event.metaKey) && event.key === "-") {
      event.preventDefault();
      zoomBy(-ZOOM_STEP);
    } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      event.preventDefault();
      setZoom(1);
    } else if (event.key === "Escape") {
      cancelPick();
    }
  });

  wireDeskSwitchSave(() => {
    saveBuildingSession();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveBuildingSession();
  });
  window.addEventListener("pagehide", () => {
    saveBuildingSession();
  });
}

bootBuilding().catch((error) => {
  console.error(error);
  alert("建筑设计桌启动失败：" + (error.message || error));
});
