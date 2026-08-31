const DESIGN_W = 570;
const DESIGN_H = 550;
// TxtExport (0x6593c0 → 0x6663c0 → 0x6689b0) writes LIVE layer x/y.
// TxtInsert (0x6595d0 → 0x6663e0) loads them with ox=oy=0.
// Cfg layer is 570×550; SetAutoSize(100,100,-230,-50) on a 1920×1080
// client is 1690×1030. Papers from a maximized native desk are that live
// size. Do not guess 1370/1691 from content; do not use AddTemplate's
// (curr−570)/2 (that path is kits / TEMPIMG, not 保存设计).
const NATIVE_PAPER_W = 1690;
const NATIVE_PAPER_H = 1030;
const DESK_COORD_MIN = -0x4000;
const DESK_COORD_MAX = 0x3fff;
const ALL_CATEGORY = "全部";
const CUSTOM_CATEGORY = "组件";
const UNGROUPED_FOLDER = "__ungrouped__";
const THEME_ALL = "*";
const ASSET_TILE_MIN = 72;
const ASSET_TILE_GAP = 5;
const ASSET_WINDOW_PAD_ROWS = 3;
const ASSET_VIRTUAL_MIN = 80;
const MATERIAL_CATEGORIES = ["装饰", "门窗", "地面", "屋顶", "墙壁"];
/** 对齐 builddesign.cfg 素材列表 / 截图顺序；首格全部，末格用自定义组件顶替原版套件 */
const CATEGORY_ORDER = [ALL_CATEGORY, ...MATERIAL_CATEGORIES, CUSTOM_CATEGORY];
/** 对齐原版图鉴 合成时间 顺序；未登记的包放最后 */
const THEME_ORDER = [
  "europe",
  "egypt",
  "greece",
  "park",
  "q",
  "toy",
  "flower1",
  "flower2",
  "candy",
  "fruit",
  "sea",
  "space",
  "bazaar",
  "supermarket",
  "antique",
  "paradise",
  "giant",
  "japan",
  "tds",
  "rose",
  "shiqi",
  "snow",
  "muguang",
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
const ASSET_PREFS_KEY = "manor-building-asset-prefs-v1";
const HUD_LAYOUT_KEY = "manor-building-hud-layout-v1";
const OBJECT_SNAP_PX = 6;
const MAX_PLANE = 8192;
// Center / content-front helpers stay in the authored visible range.
const MAX_CONTENT_COORD = 2047;
const IMAGE_INFLIGHT_MAX = 8;
const IMAGE_RETRY_MAX = 2;
const LAYER_ROW_H = 52;
const LAYER_WINDOW_PAD = 10;
const SELECTION_DETAIL_LIMIT = 12;
const SPRITE_ALPHA_HIT = 16;
const MARQUEE_MIN_PX = 4;
const DRAG_PREVIEW_MAX = 32;
const STAMP_CAP = 360;
const STAMP_PREVIEW_MAX = 80;
const PLACE_TOOLS = new Set(["paint", "stamp", "tile", "rect", "line", "circle", "triangle", "diamond", "ring"]);
const TOOL_INFO = {
  select: { label: "选择", hint: "拖动圈选 · 左侧切换碰到 / 包含" },
  paint: { label: "纯笔刷", hint: "只铺不选 · 点到哪画到哪" },
  stamp: { label: "点刷", hint: "点击盖一枚，拖着连续盖" },
  tile: { label: "平铺", hint: "拖出区域错缝铺满 · Shift 整齐网格" },
  rect: { label: "矩形", hint: "拖出矩形铺满 · Shift 正方形" },
  line: { label: "直线", hint: "沿线铺放 · Shift 锁定 45° 斜线" },
  circle: { label: "圆形", hint: "拖出圆形铺放 · Shift 正圆" },
  triangle: { label: "三角", hint: "拖出三角形区域铺放" },
  diamond: { label: "菱形", hint: "斜向菱形铺满，贴地块 · Shift 正菱" },
  ring: { label: "描边", hint: "沿一圈铺放 · Shift 圆圈" },
};
const BI = globalThis.BuildingInteractions;
if (!BI) throw new Error("building-interactions.js 未加载");
const hitProbe = document.createElement("canvas");
hitProbe.width = 1;
hitProbe.height = 1;
const hitProbeCtx = hitProbe.getContext("2d", { willReadFrequently: true, alpha: true });
const DRAG_LAYER_MAX_AREA = 12 * 1024 * 1024;
const COMPONENT_LOOKUP = new Map();
const PACK_INDEX = new Map();

const state = {
  catalog: null,
  uidCatalog: null,
  packUids: {},
  itemIcons: {},
  packs: [],
  pack: null,
  themeFilter: "",
  category: "装饰",
  component: null,
  base: null,
  baseKind: 0,
  baseLayout: null,
  paperLayout: false,
  paperOrigin: null,
  basePicked: false,
  paperBaseHint: "",
  baseOverridden: false,
  baseAnchor: null,
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
  snap: { enabled: true, step: 4, object: true, grid: true, edges: true, centers: true, axis: "iso" },
  veil: { enabled: true, opacity: 0.42 },
  zoom: 1,
  guides: [],
  clipboard: null,
  customs: [],
  customFolders: [],
  customBrush: null,
  railTab: "assets",
  mobileSheetMode: "assets",
  mobileToolFamily: "select",
  layerCollapsed: new Set(),
  layerFilter: "",
  layerSelectedOnly: false,
  mobilePan: false,
  activePointers: new Map(),
  pointerGesture: null,
  pointerPending: null,
  paletteDrag: null,
  interaction: null,
  tool: "select",
  shapeStroke: null,
  marqueeMode: "touch",
  spacePan: false,
  railCollapsed: false,
  railWidth: 340,
  assetMode: "all",
  assetFavorites: new Set(),
  assetRecent: [],
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
let assetRowsCache = [];
let assetListBound = false;
let assetWindowRaf = 0;
let assetFilterKey = "";
let lastSceneKey = "";
let paintedOffset = { dx: 0, dy: 0 };
const spriteBoundsCache = new WeakMap();
const unresolvedMaterials = new Set();
const visualBoundsQueue = [];
let visualBoundsScheduled = false;

function upgradeWorkspaceChrome() {
  const stage = document.getElementById("buildingStage");
  const shell = document.getElementById("canvasShell");
  const dock = document.getElementById("designDock");
  if (stage && shell && dock) {
    dock.classList.add("stage-commandbar");
    stage.insertBefore(dock, shell);
  }
  const frame = document.getElementById("canvasFrame");
  ["marqueeOverlay", "selectionOverlay", "shapeOverlay", "guideOverlay"].forEach((id) => {
    const element = document.getElementById(id);
    if (frame && element && element.parentElement !== frame) frame.appendChild(element);
  });
  if (stage && shell && !document.getElementById("viewportOverlayRoot")) {
    const root = document.createElement("div");
    root.id = "viewportOverlayRoot";
    root.className = "viewport-overlay-root";
    shell.after(root);
    ["designDock", "canvasToolDock", "hudStack"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) root.appendChild(element);
    });
  }
  bindFloatingHuds();
}

function hudLayoutParent() {
  return document.getElementById("viewportOverlayRoot");
}

function loadHudLayout() {
  try {
    return JSON.parse(localStorage.getItem(HUD_LAYOUT_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveHudLayout() {
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  const payload = {};
  if (command?.classList.contains("is-placed")) {
    payload.command = { left: parseFloat(command.style.left), top: parseFloat(command.style.top) };
  }
  if (tools?.classList.contains("is-placed")) {
    payload.tools = { left: parseFloat(tools.style.left), top: parseFloat(tools.style.top) };
  }
  localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(payload));
}

function clampHudPosition(el, left, top) {
  const parent = hudLayoutParent();
  if (!parent || !el) return { left: 0, top: 0 };
  const pad = 6;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (width < 8 || height < 8) return { left, top };
  const maxL = Math.max(pad, parent.clientWidth - width - pad);
  const maxT = Math.max(pad, parent.clientHeight - height - pad);
  return {
    left: Math.min(maxL, Math.max(pad, left)),
    top: Math.min(maxT, Math.max(pad, top)),
  };
}

function applyHudPosition(el, pos) {
  if (!el || !pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
  el.classList.add("is-placed");
  el.style.left = `${Math.round(pos.left)}px`;
  el.style.top = `${Math.round(pos.top)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
}

function resetHudPosition(el) {
  if (!el) return;
  el.classList.remove("is-placed");
  el.style.left = "";
  el.style.top = "";
  el.style.right = "";
  el.style.bottom = "";
  el.style.transform = "";
  saveHudLayout();
}

function layoutFloatingHuds() {
  const parent = hudLayoutParent();
  if (!parent || parent.clientWidth < 32 || parent.clientHeight < 32) return;
  const saved = loadHudLayout();
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  const rail = document.getElementById("canvasToolrail");
  if (rail) rail.style.maxHeight = `${Math.max(120, parent.clientHeight - 16)}px`;
  [
    [command, "command"],
    [tools, "tools"],
  ].forEach(([el, key]) => {
    if (!el || el.hidden) return;
    const current = el.classList.contains("is-placed")
      ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) }
      : saved[key];
    if (Number.isFinite(current?.left) && Number.isFinite(current?.top)) {
      applyHudPosition(el, clampHudPosition(el, current.left, current.top));
    }
  });
}

function hudDragAllowed(event, mode) {
  if (event.button !== 0) return false;
  if (mode === "grip") return !!event.target.closest(".hud-drag-grip");
  if (event.target.closest("button:not(.hud-drag-grip), input, select, textarea, a, .tool-item, [data-command], [data-tool], [data-align], [data-marquee-mode]")) {
    return false;
  }
  return true;
}

function bindFloatingHud(el, mode, listenOn) {
  const node = listenOn || el;
  if (!el || !node || node.dataset.hudDragBound) return;
  node.dataset.hudDragBound = "1";
  node.addEventListener("pointerdown", (event) => {
    if (!hudDragAllowed(event, mode)) return;
    const parent = hudLayoutParent();
    if (!parent) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const originLeft = rect.left - parentRect.left;
    const originTop = rect.top - parentRect.top;
    let dragging = false;
    const pointerId = event.pointerId;
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && dx * dx + dy * dy < 16) return;
      dragging = true;
      el.classList.add("is-dragging-hud");
      applyHudPosition(el, clampHudPosition(el, originLeft + dx, originTop + dy));
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      el.classList.remove("is-dragging-hud");
      if (dragging) {
        saveHudLayout();
        const swallow = (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  });
  el.querySelector(".hud-drag-grip")?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetHudPosition(el);
  });
}

function bindFloatingHuds() {
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  bindFloatingHud(command, "chrome");
  bindFloatingHud(tools, "grip", tools?.querySelector(".hud-drag-grip"));
  layoutFloatingHuds();
}

function loadAssetPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(ASSET_PREFS_KEY) || "{}");
    state.assetFavorites = new Set(Array.isArray(saved.favorites) ? saved.favorites : []);
    state.assetRecent = Array.isArray(saved.recent) ? saved.recent.slice(0, 40) : [];
  } catch {
    state.assetFavorites = new Set();
    state.assetRecent = [];
  }
}

function saveAssetPreferences() {
  localStorage.setItem(
    ASSET_PREFS_KEY,
    JSON.stringify({ favorites: [...state.assetFavorites], recent: state.assetRecent.slice(0, 40) })
  );
}

function assetKey(component, pack = component?._pack || state.pack) {
  return `${pack?.key || ""}:${component?.id ?? ""}`;
}

function rememberAsset(component, pack = component?._pack || state.pack) {
  const key = assetKey(component, pack);
  state.assetRecent = [key, ...state.assetRecent.filter((row) => row !== key)].slice(0, 40);
  saveAssetPreferences();
}

async function bootBuilding() {
  document.documentElement.classList.add("boot-pending");
  window.MobileWorkspace?.init();
  upgradeWorkspaceChrome();
  loadAssetPreferences();
  loadImage("/bdesign/imgs/glsbg.gif");
  const [catalog, uidCatalog, packUids, itemIcons] = await Promise.all([
    fetch("/api/editor-catalog").then((response) => response.json()),
    fetch("/data/building_uid_map.json")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .catch(() => ({ packs: [] })),
    fetch("/data/building_pack_uids.json")
      .then((response) => (response.ok ? response.json() : { mapping: {} }))
      .catch(() => ({ mapping: {} })),
    fetch("/api/item-icons")
      .then((response) => (response.ok ? response.json() : { icons: {} }))
      .catch(() => ({ icons: {} })),
  ]);
  state.catalog = catalog;
  state.uidCatalog = uidCatalog;
  state.packUids = packUids.mapping || {};
  state.packUidAliases = packUids.aliases || {};
  state.itemIcons = itemIcons.icons || {};
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
    state.packs.find((pack) => pack.key === "europe") || state.packs[0] || null;
  state.themeFilter = THEME_ALL;
  ensureActiveCategory();
  state.base =
    catalog.building.bases.find((base) => base.kind === 0) || catalog.building.bases[0] || null;
  const remoteSaves = await fetchBuildingSaves();
  if (remoteSaves && remoteSaves.customs) {
    applyCustomsData(remoteSaves.customs);
    try {
      localStorage.setItem(
        CUSTOMS_KEY,
        JSON.stringify(
          Array.isArray(remoteSaves.customs)
            ? { items: remoteSaves.customs, folders: [] }
            : remoteSaves.customs
        )
      );
    } catch (error) {
      console.warn(error);
    }
  } else {
    loadCustoms();
  }
  bindBuilding();
  fillThemes();
  fillCategories();
  fillComponents();
  fillBaseKindTabs();
  fillBaseIcons();
  fillCustoms();
  setRailTab("assets");
  const restored = restoreBuildingSession(remoteSaves && remoteSaves.session);
  let wasMobileWorkspace = !!window.MobileWorkspace?.modeForViewport().mobile;
  if (wasMobileWorkspace) {
    state.railCollapsed = restored && state.phase === "design";
    applyRailState();
  }
  window.MobileWorkspace?.onModeChange((mode) => {
    if (mode.mobile !== wasMobileWorkspace) {
      setMobileToolsOpen(false);
      wasMobileWorkspace = mode.mobile;
      if (mode.mobile) {
        if (state.phase === "select") openBuildingRail("assets");
        else closeBuildingRail();
      } else {
        state.railCollapsed = false;
        applyRailState();
      }
    } else {
      syncBuildingRailAccessibility();
      fitStageToShell();
    }
  });
  if (restored && !(remoteSaves && remoteSaves.session)) saveBuildingSession();
  if (!(remoteSaves && remoteSaves.customs) && (state.customs.length || state.customFolders.length)) {
    saveCustoms();
  }
  if (!restored) {
    setPhase("select");
    updateBase();
  }
  if (wasMobileWorkspace && state.phase === "select") openBuildingRail("assets");
  syncSnapUi();
  syncMarqueeModeUi();
  syncVeilControls();
  updateToolHint();
  applyZoom();
  updateAlignBar();
  updateSelectionCaption();
  renderBuilding();
  let bootFinished = false;
  const finishBoot = () => {
    if (bootFinished) return;
    bootFinished = true;
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
    fitStageToShell();
  };
  requestAnimationFrame(finishBoot);
  setTimeout(finishBoot, 450);
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

function isCustomCategory(category = state.category) {
  return category === CUSTOM_CATEGORY;
}

function isAllCategory(category = state.category) {
  return category === ALL_CATEGORY;
}

function isAllThemes() {
  return state.themeFilter === THEME_ALL;
}

function isNativeDeskHiddenFile(file) {
  const stem = String(file || "")
    .toLowerCase()
    .replace(/\.ale$/, "");
  return /^try\d+$/.test(stem);
}

function isNativeDeskHiddenComponent(component) {
  return isNativeDeskHiddenFile(component?.file);
}

function isBrowsableComponent(component) {
  if (!component || component.kind === "kit") return false;
  if (component.category === CUSTOM_CATEGORY || component.category === "套件") return false;
  if (isNativeDeskHiddenComponent(component)) return false;
  return true;
}

function activeThemePacks() {
  if (isAllThemes()) return state.packs || [];
  const pack = packByKey(state.themeFilter) || state.pack;
  return pack ? [pack] : [];
}

function categoryCounts() {
  const counts = new Map(CATEGORY_ORDER.map((category) => [category, 0]));
  counts.set(CUSTOM_CATEGORY, state.customs.length);
  let all = 0;
  activeThemePacks().forEach((pack) => {
    (pack.components || []).forEach((component) => {
      if (!isBrowsableComponent(component)) return;
      all += 1;
      if (counts.has(component.category)) {
        counts.set(component.category, counts.get(component.category) + 1);
      }
    });
  });
  counts.set(ALL_CATEGORY, all);
  return counts;
}

function ensureActiveCategory() {
  if (state.category === "套件") state.category = CUSTOM_CATEGORY;
  if (isCustomCategory() || isAllCategory()) return;
  const counts = categoryCounts();
  if ((counts.get(state.category) || 0) > 0) return;
  const next = MATERIAL_CATEGORIES.find((category) => (counts.get(category) || 0) > 0);
  if (next) state.category = next;
}

function themeSearchQuery() {
  const input = document.getElementById("themeSearch");
  return (input?.value || "").trim().toLowerCase();
}

function themeFilterLabel() {
  if (isAllThemes()) return "全部主题";
  const pack = packByKey(state.themeFilter) || state.pack;
  return pack?.name || "主题";
}

function updateAssetFilterSummary() {
  const summary = document.getElementById("assetFilterSummary");
  if (!summary) return;
  if (isCustomCategory()) {
    const count = state.customs.length;
    summary.textContent = count ? `组件 · ${count} 件` : "还没有自定义组件";
    return;
  }
  if (!activeThemePacks().length) {
    summary.textContent = "选择主题与类别";
    return;
  }
  const counts = categoryCounts();
  const count = isAllCategory() ? counts.get(ALL_CATEGORY) || 0 : counts.get(state.category) || 0;
  const catLabel = isAllCategory() ? "全部" : state.category;
  summary.textContent = count
    ? `${themeFilterLabel()} · ${catLabel} · ${count} 项素材`
    : `${themeFilterLabel()} · ${catLabel} · 无素材`;
}

function setPhase(phase) {
  state.phase = phase;
  const app = document.getElementById("buildingApp");
  app.classList.toggle("phase-select", phase === "select");
  app.classList.toggle("phase-design", phase === "design");
  state.mobileSheetMode = phase === "select" ? "base" : "assets";
  syncMobileBuildingPanels();
  const designDock = document.getElementById("designDock");
  if (designDock) designDock.hidden = phase !== "design";
  layoutFloatingHuds();
  if (phase !== "design") {
    state.ghost = null;
    state.hover = null;
    state.marquee = null;
    state.dragging = null;
    state.shapeStroke = null;
    state.guides = [];
    syncMarqueeOverlay();
    syncShapeOverlay();
  }
  updateAlignBar();
  updateToolHint();
  updateSelectionCaption();
  syncMobileBuildingChrome();
  markBuildingDirty();
}

function placedDesignCount() {
  return state.records.filter((record) => !record.hidden && Number(record.mat) !== 0).length;
}

function invalidateBaseLayout() {
  state.baseLayout = null;
  lastSceneKey = "";
  paperFrontCache = null;
  paperFrontKey = "";
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

async function clearCurrentDesign({ ask = false } = {}) {
  const count = placedDesignCount();
  if (count < 1) {
    if (ask) await appAlert("当前没有可清空的装修。");
    return false;
  }
  if (ask) {
    const name = state.base?.name || "当前户型";
    const ok = await appConfirm(`清空「${name}」上的 ${count} 件装修，只留空地基？`, {
      title: "清空装修",
      okLabel: "清空",
      danger: true,
    });
    if (!ok) return false;
  }
  pushHistory();
  state.records = [];
  state.paperLayout = false;
  state.paperOrigin = null;
  state.source = null;
  state.baseAnchor = null;
  state.redo = [];
  invalidateBaseLayout();
  cancelPick();
  fillLayers();
  syncDesignResetButtons();
  markBuildingDirty();
  renderBuilding();
  return true;
}

async function beginDesign() {
  if (!state.base) {
    await appAlert("请先选择户型。", { title: "还没选户型" });
    return;
  }
  const count = placedDesignCount();
  if (count > 0) {
    const name = state.base.name;
    const wipe = await appConfirm(
      `当前已有 ${count} 件装修。要用「${name}」开始设计吗？\n\n清空后开始会丢掉现有装修；保留装修只换户型。`,
      {
        title: "开始设计",
        okLabel: "清空后开始",
        cancelLabel: "保留装修",
        danger: true,
        dismiss: "abort",
      }
    );
    if (wipe == null) return;
    if (wipe) clearCurrentDesign({ ask: false });
  }
  invalidateBaseLayout();
  setPhase("design");
  updateBase();
  fillLayers();
  syncDesignResetButtons();
  renderBuilding();
  if (window.MobileWorkspace?.modeForViewport().mobile) closeBuildingRail();
}

function setRailTab(tab) {
  if (tab === "customs") {
    state.category = CUSTOM_CATEGORY;
    tab = "assets";
  }
  state.railTab = tab;
  if (window.MobileWorkspace?.modeForViewport().mobile) state.mobileSheetMode = tab;
  document.querySelectorAll(".rail-tab").forEach((button) => {
    button.classList.toggle("on", button.dataset.tab === tab);
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  });
  document.getElementById("tabAssets").hidden = tab !== "assets";
  document.getElementById("tabLayers").hidden = tab !== "layers";
  if (tab === "layers") fillLayers();
  if (tab === "assets") syncAssetCategoryView();
  syncMobileBuildingPanels();
  syncMobileBuildingChrome();
}

function syncSnapUi() {
  const enabled = document.getElementById("snapEnabled");
  const grid = document.getElementById("snapGrid");
  const edges = document.getElementById("snapEdges");
  const centers = document.getElementById("snapCenters");
  const step = document.getElementById("snapStep");
  const axis = document.getElementById("snapAxis");
  if (enabled) enabled.checked = !!state.snap.enabled;
  if (grid) grid.checked = state.snap.grid !== false;
  if (edges) edges.checked = state.snap.edges !== false;
  if (centers) centers.checked = state.snap.centers !== false;
  if (step) step.value = String(state.snap.step);
  if (axis) axis.value = snapAxis();
}

function currentMarqueeMode() {
  return state.marqueeMode === "contain" ? "contain" : "touch";
}

function syncMarqueeModeUi() {
  const mode = currentMarqueeMode();
  document.querySelectorAll("[data-marquee-mode]").forEach((button) => {
    const on = button.dataset.marqueeMode === mode;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function setMarqueeMode(mode) {
  state.marqueeMode = mode === "contain" ? "contain" : "touch";
  if (state.marquee) state.marquee.mode = state.marqueeMode;
  syncMarqueeModeUi();
  syncMarqueeOverlay();
  updateToolHint();
  markBuildingDirty();
}

function isPlaceTool(tool = state.tool) {
  return PLACE_TOOLS.has(tool);
}

function isStampLike(tool = state.tool) {
  return tool === "stamp" || tool === "paint";
}

function armPaintBrush() {
  if (state.tool === "select") setActiveTool("paint");
}

function stampTemplate() {
  if (state.customBrush?.records?.length) return { type: "custom", custom: state.customBrush };
  if (state.component?.kind === "kit") return null;
  if (state.component?.kind === "sprite") {
    return { type: "sprite", component: state.component, pack: state.component._pack || state.pack };
  }
  if (state.selected.length === 1) {
    const record = state.records[state.selected[0]];
    if (record && Number(record.mat) && !record.hidden) return { type: "record", record };
  }
  return null;
}

function stampGeometry(template = stampTemplate()) {
  if (!template) return { width: 32, height: 24 };
  if (template.type === "custom") {
    const bounds = customBrushBounds(template.custom);
    return { width: Math.max(8, bounds.width), height: Math.max(8, bounds.height) };
  }
  if (template.type === "sprite") return frameGeometry(template.component, state.brushState);
  if (template.type === "record") {
    const component = recordComponent(template.record);
    return frameGeometry(component, template.record.state ?? template.record.flip ?? 0);
  }
  return { width: 32, height: 24 };
}

function stampPitch(aligned = false) {
  const geometry = stampGeometry();
  if (aligned) {
    return {
      x: Math.max(8, Math.round(geometry.width) || 16),
      y: Math.max(8, Math.round(geometry.height) || 16),
    };
  }
  return {
    x: Math.max(8, Math.round((geometry.width || 16) / 2)),
    y: Math.max(8, Math.round((geometry.height || 16) / 2)),
  };
}

function lineStampStep(stroke) {
  const geometry = stampGeometry();
  const dx = Number(stroke?.end?.x) - Number(stroke?.start?.x);
  const dy = Number(stroke?.end?.y) - Number(stroke?.start?.y);
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return 8;
  const ux = Math.abs(dx / length);
  const uy = Math.abs(dy / length);
  // Building sprites are upright on a 2:1 ground plane. Their full image
  // height is not footprint depth; using it creates huge gaps for lamps.
  const groundWidth = Math.max(12, Math.min(64, (Number(geometry.width) || 24) * 0.5));
  const groundDepth = Math.max(8, groundWidth * 0.5);
  return Math.max(8, (ux * groundWidth + uy * groundDepth) * 1.08);
}

function depthSortedStampPoints(points, tool) {
  const rows = points.slice();
  if (tool === "line") rows.sort((a, b) => a.y - b.y || a.x - b.x);
  return rows;
}

function currentShapeEnd(event) {
  const stroke = state.shapeStroke;
  if (!stroke) return null;
  const raw = stroke.transform.clientToScene(event.clientX, event.clientY);
  const aligned = !!(event.shiftKey || stroke.aligned);
  return BI.constrainShapeEnd(stroke.tool, stroke.start, raw, stroke.tool !== "tile" && !isStampLike(stroke.tool) && aligned);
}

function shapeStampPoints(stroke = state.shapeStroke) {
  if (!stroke) return [];
  if (isStampLike(stroke.tool) && stroke.points?.length) return stroke.points.slice(0, STAMP_CAP);
  const gridAligned =
    stroke.tool === "rect" ||
    stroke.tool === "diamond" ||
    (stroke.tool === "tile" && !!stroke.aligned);
  const ringEllipse = stroke.tool === "ring" && !!stroke.aligned;
  return BI.collectStampPoints(stroke.tool, stroke.start, stroke.end, stampPitch(gridAligned), {
    aligned: gridAligned || ringEllipse,
    cap: STAMP_CAP,
    lineStep: stroke.tool === "line" ? lineStampStep(stroke) : 0,
  });
}

function updateToolHint() {
  const hint = document.getElementById("toolHint");
  const app = document.getElementById("buildingApp");
  const info = TOOL_INFO[state.tool] || TOOL_INFO.select;
  if (app) app.dataset.canvasTool = state.tool;
  if (!hint) return;
  hint.hidden = false;
  if (state.phase !== "design") return;
  if (isPlaceTool() && !stampTemplate()) {
    hint.textContent = "先点右侧素材，或先点选一件";
    return;
  }
  const extra = state.shapeStroke ? ` · ${shapeStampPoints().length} 件` : "";
  hint.textContent = `${info.hint}${extra}`;
}

function packUidOf(pack = state.pack) {
  if (!pack) return null;
  const mapping = state.packUids || {};
  let found = null;
  for (const [uid, key] of Object.entries(mapping)) {
    if (key !== pack.key) continue;
    const n = Number(uid);
    if (found == null || n > found) found = n;
  }
  return found;
}

function packForPaperUid(paperUid) {
  const key =
    (state.packUids || {})[String(paperUid)] ||
    (state.packUidAliases || {})[String(paperUid)];
  return key ? packByKey(key) : null;
}

function componentUid(componentId, pack = state.pack) {
  const usePack = pack || state.pack;
  const component = usePack?.components.find((row) => row.id === componentId);
  if (component?.kind !== "sprite") return null;
  const usesGlobal = state.records.some((record) => Number(record.mat) >= 1000);
  const packUid = packUidOf(usePack);
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
  if (record.localPackUnknown && Number(record.mat) > 0 && Number(record.mat) < 1000) {
    return null;
  }
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
  const path = base.maskImage.split("/").map(encodeURIComponent).join("/");
  return base.maskImage.toLowerCase().endsWith(".ale")
    ? `/bdesign/imgs/${path}.png?f=0`
    : `/bdesign/imgs/${path}`;
}

function pumpImageQueue() {
  while (imageInflight < IMAGE_INFLIGHT_MAX && imageQueue.length) {
    const image = imageQueue.shift();
    if (!image || image._started) continue;
    image._started = true;
    imageInflight += 1;
    const finish = (loaded) => {
      image.onload = null;
      image.onerror = null;
      imageInflight = Math.max(0, imageInflight - 1);
      if (loaded) {
        image._failed = false;
        unresolvedMaterials.delete(image._url);
        syncUnresolvedDiagnostics();
        paperFrontCache = null;
        paperFrontKey = "";
        queueVisualBounds(image);
        if (String(image._url || "").includes("glsbg")) invalidateGrassLayers();
      } else if ((image._attempt || 0) < IMAGE_RETRY_MAX) {
        image._attempt = (image._attempt || 0) + 1;
        image._started = false;
        setTimeout(() => {
          imageQueue.push(image);
          pumpImageQueue();
        }, 160 * image._attempt);
      } else {
        image._failed = true;
        unresolvedMaterials.add(image._url);
        syncUnresolvedDiagnostics();
      }
      pumpImageQueue();
      scheduleRender();
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    const retry = image._attempt || 0;
    image.src = retry ? `${image._url}${image._url.includes("?") ? "&" : "?"}_retry=${retry}` : image._url;
  }
}

function loadImage(url) {
  if (!url) return null;
  if (state.images.has(url)) return state.images.get(url);
  const image = new Image();
  image.decoding = "async";
  image._url = url;
  image._attempt = 0;
  state.images.set(url, image);
  imageQueue.push(image);
  pumpImageQueue();
  return image;
}

function syncUnresolvedDiagnostics() {
  const status = document.getElementById("resourceStatus");
  if (status) {
    status.hidden = unresolvedMaterials.size < 1;
    status.textContent = unresolvedMaterials.size ? `缺失素材 ${unresolvedMaterials.size}` : "";
    status.title = [...unresolvedMaterials].join("\n");
  }
  if (unresolvedMaterials.size) {
    console.warn("未能解析的建筑素材（已重试）", [...unresolvedMaterials]);
  }
}

function queueVisualBounds(image) {
  if (!image?.naturalWidth || spriteBoundsCache.has(image)) return;
  visualBoundsQueue.push(image);
  if (visualBoundsScheduled) return;
  visualBoundsScheduled = true;
  const schedule = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 16));
  schedule(function drain(deadline) {
    visualBoundsScheduled = false;
    let count = 0;
    while (visualBoundsQueue.length && (count < 2 || !deadline?.timeRemaining || deadline.timeRemaining() > 3)) {
      cacheSpriteOpaqueBounds(visualBoundsQueue.shift());
      count += 1;
    }
    if (visualBoundsQueue.length) queueVisualBounds(visualBoundsQueue.shift());
    else scheduleRender();
  });
}

function cacheSpriteOpaqueBounds(image) {
  if (!image?.complete || !image.naturalWidth) return null;
  if (spriteBoundsCache.has(image)) return spriteBoundsCache.get(image);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  let bounds = { x: 0, y: 0, width, height };
  try {
    const sheet = document.createElement("canvas");
    sheet.width = width;
    sheet.height = height;
    const c = sheet.getContext("2d", { willReadFrequently: true, alpha: true });
    c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (pixels[row + x * 4 + 3] <= SPRITE_ALPHA_HIT) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right >= left && bottom >= top) {
      bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
  } catch (error) {
    console.debug("素材透明边界读取失败，使用稳定帧边界", error);
  }
  spriteBoundsCache.set(image, bounds);
  return bounds;
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
  }
  // Unlit darkening is applied after sprites (drawUnlitCover) so props that
  // stick out of the mask pick up the same veil as the surrounding grass.
}

function invalidateGrassLayers() {
  for (const key of [...state.images.keys()]) {
    const name = String(key);
    if (name.startsWith("room-mask:") || name.startsWith("room-shadow:")) state.images.delete(key);
  }
}

function nativeMaskAlpha(mask) {
  const key = `mask-alpha:${mask.src}:${mask.naturalWidth}x${mask.naturalHeight}`;
  if (state.images.has(key)) return state.images.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = mask.naturalWidth;
  sheet.height = mask.naturalHeight;
  const c = sheet.getContext("2d", { willReadFrequently: true });
  c.drawImage(mask, 0, 0);
  const pixels = c.getImageData(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luminance = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    pixels.data[i] = 255;
    pixels.data[i + 1] = 255;
    pixels.data[i + 2] = 255;
    pixels.data[i + 3] = Math.round((pixels.data[i + 3] * luminance) / 255);
  }
  c.putImageData(pixels, 0, 0);
  state.images.set(key, sheet);
  return sheet;
}

function opaqueBottomVertex(image, threshold = 32) {
  if (!image?.complete || !image.naturalWidth) return null;
  const key = `opaque-bottom:${threshold}:${image.src}:${image.naturalWidth}x${image.naturalHeight}`;
  if (state.images.has(key)) return state.images.get(key);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d", { willReadFrequently: true });
  c.drawImage(image, 0, 0);
  const pixels = c.getImageData(0, 0, width, height).data;
  for (let y = height - 1; y >= 0; y--) {
    let left = -1;
    let right = -1;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const cover = (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) * pixels[i + 3]) / 255;
      if (cover < threshold) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) {
      const vertex = { x: (left + right) >> 1, y };
      state.images.set(key, vertex);
      return vertex;
    }
  }
  return null;
}

/** Locked frame: maskimg stays put. Floor's visible front vertex sits on the mask front vertex. */
function floorSnugInMask(floor, mask, fw, fh, mw, mh) {
  if (window.BuildingPreview?.floorSnugInMask) {
    return window.BuildingPreview.floorSnugInMask(floor, mask);
  }
  const maskBottom = opaqueBottomVertex(mask, 32);
  // Floor ALE has a faint fringe below the grey tiles; use the solid surface
  // so the visible foundation sits on the mask's front edge, not the halo.
  const floorBottom = opaqueBottomVertex(floor, 96);
  if (maskBottom && floorBottom) {
    return { x: maskBottom.x - floorBottom.x, y: maskBottom.y - floorBottom.y };
  }
  return {
    x: Math.round((mw - fw) / 2),
    y: Math.max(0, mh - fh),
  };
}

function syncVeilControls() {
  invalidateGrassLayers();
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

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
const VIEW_NUDGE_Y = 20;

function fitStageToShell() {
  applyZoom();
  requestAnimationFrame(() => {
    centerCanvasInShell();
    renderBuilding();
  });
}

function shellViewSize() {
  const shell = document.getElementById("canvasShell");
  return {
    w: Math.max(1, Math.floor(shell?.clientWidth || DESIGN_W)),
    h: Math.max(1, Math.floor(shell?.clientHeight || DESIGN_H)),
  };
}

function houseFitScale(cssW, cssH) {
  return Math.min(cssW / DESIGN_W, cssH / DESIGN_H);
}

function fitCanvasBaseWidth() {
  return Math.max(200, shellViewSize().w);
}

function panGutter(sw, sh) {
  return {
    x: Math.max(160, Math.round(sw * 0.45)),
    y: Math.max(160, Math.round(sh * 0.45)),
  };
}

function applyZoom() {
  const frame = document.getElementById("canvasFrame");
  const inner = document.getElementById("canvasZoomInner");
  const shell = document.getElementById("canvasShell");
  const label = document.getElementById("btnZoomReset");
  if (!frame || !shell) return;
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(state.zoom) || 1));
  const { w: sw, h: sh } = shellViewSize();
  // The workspace is the canvas. Never letterbox a smaller rectangle of grass.
  const width = Math.max(sw, Math.round(sw * state.zoom));
  const height = Math.max(sh, Math.round(sh * state.zoom));
  const gutter = panGutter(sw, sh);
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.aspectRatio = `${width} / ${height}`;
  if (inner) {
    inner.style.width = `${width + gutter.x * 2}px`;
    inner.style.height = `${height + gutter.y * 2}px`;
  }
  shell.style.overflow = "auto";
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
  syncViewportOverlays();
  requestAnimationFrame(() => syncViewportOverlays());
}

function centerCanvasInShell() {
  const shell = document.getElementById("canvasShell");
  if (!shell) return;
  const maxX = Math.max(0, shell.scrollWidth - shell.clientWidth);
  const maxY = Math.max(0, shell.scrollHeight - shell.clientHeight);
  shell.scrollLeft = maxX / 2;
  const nudge = state.zoom > 1.01 ? VIEW_NUDGE_Y : 0;
  shell.scrollTop = Math.max(0, maxY / 2 - nudge);
}

function setZoom(next, clientX, clientY) {
  const shell = document.getElementById("canvasShell");
  const clamped = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
  if (!shell || Math.abs(clamped - state.zoom) < 0.001) {
    state.zoom = clamped;
    applyZoom();
    markBuildingDirty();
    renderBuilding();
    return;
  }
  const { w: sw, h: sh } = shellViewSize();
  const gutter = panGutter(sw, sh);
  const oldW = Math.max(sw, Math.round(sw * state.zoom));
  const oldH = Math.max(sh, Math.round(sh * state.zoom));
  const rect = shell.getBoundingClientRect();
  const anchorX = clientX != null ? clientX - rect.left : shell.clientWidth / 2;
  const anchorY = clientY != null ? clientY - rect.top : shell.clientHeight / 2;
  const frameX = shell.scrollLeft + anchorX - gutter.x;
  const frameY = shell.scrollTop + anchorY - gutter.y;
  state.zoom = clamped;
  applyZoom();
  const newW = Math.max(sw, Math.round(sw * state.zoom));
  const newH = Math.max(sh, Math.round(sh * state.zoom));
  const scaleX = oldW ? newW / oldW : 1;
  const scaleY = oldH ? newH / oldH : 1;
  shell.scrollLeft = gutter.x + frameX * scaleX - anchorX;
  shell.scrollTop = gutter.y + frameY * scaleY - anchorY;
  markBuildingDirty();
  renderBuilding();
}

function zoomBy(delta, clientX, clientY) {
  setZoom(state.zoom + delta, clientX, clientY);
}

/** Native ChgBaseMask behavior: tile the bright grass through base.tab maskimg. */
function roomMaskLayer(mask, grass, originX, originY) {
  if (!mask?.complete || !mask.naturalWidth) return null;
  const width = mask.naturalWidth;
  const height = mask.naturalHeight;
  const grassReady = !!(grass?.complete && grass.naturalWidth);
  const key = `room-mask:${mask.src}:${grass?.src || ""}:${grassReady ? "g" : "nog"}:${width}x${height}`;
  if (state.images.has(key)) return state.images.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d");
  fillGrassPattern(c, grass, width, height, true, originX, originY);
  c.save();
  c.globalCompositeOperation = "destination-in";
  c.drawImage(nativeMaskAlpha(mask), 0, 0, width, height);
  c.restore();
  const layer = { sheet };
  // Only cache when grass is ready — avoid locking in the solid-color fallback.
  if (grassReady) state.images.set(key, layer);
  return layer;
}

/** Darken everything outside maskimg so overflow props match in-game 遮罩. */
function unlitCoverLayer(layout, mask) {
  const width = canvas.width;
  const height = canvas.height;
  if (width < 2 || height < 2) return null;
  const alpha = state.veil.enabled
    ? Math.max(0, Math.min(0.95, Number(state.veil.opacity) || 0))
    : 0;
  if (alpha < 0.001) return null;
  const mx = layout?.maskX || 0;
  const my = layout?.maskY || 0;
  const maskKey = mask?.complete && mask.naturalWidth ? mask.src : "none";
  const key = `room-shadow:${width}x${height}:${mx},${my}:${maskKey}:${alpha.toFixed(3)}`;
  if (state.images.has(key)) return state.images.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d");
  c.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  c.fillRect(0, 0, width, height);
  if (mask?.complete && mask.naturalWidth) {
    c.globalCompositeOperation = "destination-out";
    c.drawImage(nativeMaskAlpha(mask), mx, my);
    c.globalCompositeOperation = "source-over";
  }
  const layer = { sheet };
  state.images.set(key, layer);
  return layer;
}

function drawUnlitCover() {
  const layout = state.baseLayout;
  if (!layout?.maskW) return;
  const maskUrl = buildingMaskUrl(state.base);
  const mask = maskUrl ? loadImage(maskUrl) : null;
  if (!mask?.complete || !mask.naturalWidth) return;
  const overlay = unlitCoverLayer(layout, mask);
  if (overlay?.sheet) ctx.drawImage(overlay.sheet, 0, 0);
}

function baseLayout(base, floor, mask) {
  const fw = floor.naturalWidth || floor.width;
  const fh = floor.naturalHeight || floor.height;
  const mw = mask?.naturalWidth || mask?.width || fw;
  const mh = mask?.naturalHeight || mask?.height || fh;
  const snug = floorSnugInMask(floor, mask, fw, fh, mw, mh);
  // Locked: the house frame stays where the empty 11×11 (etc.) preview put it.
  // Importing a paper must not drag the mask under the props or the frame
  // jumps up and the fit-to-shell zoom makes it look smaller.
  const mx = Math.round((Math.max(DESIGN_W, mw) - mw) / 2);
  const my = Math.round((Math.max(DESIGN_H, mh) - mh) / 2);
  const floorX = mx + snug.x;
  const floorY = my + snug.y;
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

/** Center only the house frame. Paper sprites stay in paper coords via contentDx/Dy. */
function centerBuildingInPlane(layout) {
  let left = layout.maskW ? layout.maskX : layout.floorX;
  let right = layout.maskW ? layout.maskX + layout.maskW : layout.floorX + layout.floorW;
  let top = layout.maskH ? layout.maskY : layout.floorY;
  let bottom = layout.maskH ? layout.maskY + layout.maskH : layout.floorY + layout.floorH;
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    layout.contentDx = 0;
    layout.contentDy = 0;
    layout.planeW = Math.max(DESIGN_W, layout.planeW || DESIGN_W);
    layout.planeH = Math.max(DESIGN_H, layout.planeH || DESIGN_H);
    return layout;
  }
  const bw = Math.max(1, right - left);
  const bh = Math.max(1, bottom - top);
  const padX = 40;
  // Locked rendering baseline: interaction code must not move the verified frame.
  const padTop = 40;
  const padBottom = 40;

  let planeW = Math.max(DESIGN_W, Math.ceil(bw + padX * 2));
  let planeH = Math.max(DESIGN_H, Math.ceil(bh + padTop + padBottom));
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

function decodeS15(value) {
  value = Number(value) | 0;
  value &= 0x7fff;
  return value > 0x3fff ? value - 0x8000 : value;
}

/** x86 cdq/sub/sar 1: signed divide-by-two toward zero. Mask center and AddTemplate. */
function nativeHalfDelta(a, b) {
  return window.BuildingPreview?.nativeHalfDelta
    ? window.BuildingPreview.nativeHalfDelta(a, b)
    : Math.trunc((Number(a) - Number(b)) / 2);
}

function nativeMaskOriginForLayer(layerW, layerH, maskW, maskH) {
  if (window.BuildingPreview?.nativeMaskOriginForLayer) {
    return window.BuildingPreview.nativeMaskOriginForLayer(layerW, layerH, maskW, maskH);
  }
  return {
    x: nativeHalfDelta(layerW, maskW || 0),
    y: nativeHalfDelta(layerH, maskH || 0),
  };
}

function paperNativeOrigin() {
  // mat=0 is GDesignSubUser, not a paper origin. TxtExport papers are live
  // layer coords; map the maximized native layer onto the locked frame.
  if (!state.paperLayout || !state.records.length) return null;
  const layout = state.baseLayout;
  if (!layout) return null;
  return nativeMaskOriginForLayer(NATIVE_PAPER_W, NATIVE_PAPER_H, layout.maskW, layout.maskH);
}

function nativePaperFloorOrigin(layout, maskOrigin) {
  if (window.BuildingPreview?.nativePaperFloorOrigin) {
    return window.BuildingPreview.nativePaperFloorOrigin(state.base, maskOrigin);
  }
  const anchor = state.base?.anchor;
  const frame = state.base?.assets?.baseImage?.frameTable?.[0];
  if (
    !layout?.maskW ||
    !maskOrigin ||
    !Array.isArray(anchor) ||
    !Number.isFinite(Number(anchor[0])) ||
    !Number.isFinite(Number(anchor[1])) ||
    !Number.isFinite(Number(frame?.anchorX)) ||
    !Number.isFinite(Number(frame?.anchorY))
  ) {
    return null;
  }
  // Blit 0x6646af puts the floor bitmap at mask+(cx,cy). ALE then shifts
  // the opaque tiles inside that bitmap; floorSnugInMask matches that
  // visible floor, so sprites stay on the grey tiles like TxtInsert.
  return {
    x: maskOrigin.x + Number(anchor[0]) + Number(frame.anchorX),
    y: maskOrigin.y + Number(anchor[1]) + Number(frame.anchorY),
  };
}

let paperFrontCache = null;
let paperFrontKey = "";

/** Lowest solid pixel of imported sprites, in paper coords (ignore ALE fringe). */
function paperContentFront() {
  const key = `${state.records.length}:${state.images.size}`;
  if (paperFrontCache && paperFrontKey === key) return paperFrontCache;
  let maxY = -Infinity;
  const row = [];
  state.records.forEach((record) => {
    if (record.hidden || Number(record.mat) === 0) return;
    if (
      Number(record.x) < 0 ||
      Number(record.y) < 0 ||
      Number(record.x) > MAX_CONTENT_COORD ||
      Number(record.y) > MAX_CONTENT_COORD
    ) {
      return;
    }
    const component = recordComponent(record);
    const pack = recordPack(record) || component?._pack;
    const url = spriteUrl(component, pack, record.state ?? record.flip ?? 0);
    const image = loadImage(url);
    let vx;
    let vy;
    if (image?.complete && image.naturalWidth) {
      const vertex = opaqueBottomVertex(image, 96);
      if (!vertex) return;
      vx = record.x + vertex.x;
      vy = record.y + vertex.y;
    } else {
      const box = recordBox(record);
      vx = record.x + Math.round((box.width || 0) / 2);
      vy = record.y + Math.max(8, box.height || 80);
    }
    if (vy > maxY) {
      maxY = vy;
      row.length = 0;
      row.push(vx);
    } else if (vy >= maxY - 1) {
      row.push(vx);
    }
  });
  if (!Number.isFinite(maxY) || !row.length) return null;
  let left = row[0];
  let right = row[0];
  row.forEach((x) => {
    if (x < left) left = x;
    if (x > right) right = x;
  });
  paperFrontCache = { x: (left + right) >> 1, y: maxY };
  paperFrontKey = key;
  return paperFrontCache;
}

function computeLiveContentOffset() {
  const layout = state.baseLayout;
  if (!layout) return { dx: 0, dy: 0 };
  if (state.paperLayout && state.records.length) {
    const origin = paperNativeOrigin();
    const nativeFloor = origin ? nativePaperFloorOrigin(layout, origin) : null;
    if (
      nativeFloor &&
      Number.isFinite(layout.floorX) &&
      Number.isFinite(layout.floorY)
    ) {
      // View transform only: map the maximized TxtInsert layer onto floorSnugInMask.
      return {
        dx: Math.round(layout.floorX - nativeFloor.x),
        dy: Math.round(layout.floorY - nativeFloor.y),
      };
    }
  }
  return {
    dx: layout.contentDx || 0,
    dy: layout.contentDy || 0,
  };
}

function layoutContentOffset() {
  if (state.interaction?.offset) return state.interaction.offset;
  return paintedOffset;
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

  if (!floor?.complete || !floor.naturalWidth) return expandPlaneToShell(layout);

  if (mask?.complete && mask.naturalWidth) {
    layout = baseLayout(base, floor, mask);
  } else {
    layout.floorW = floor.naturalWidth;
    layout.floorH = floor.naturalHeight;
    // valueA/valueB are AEX atlas crop offsets, not screen coordinates.
    layout.floorX = Math.round((DESIGN_W - floor.naturalWidth) / 2);
    layout.floorY = Math.max(52, DESIGN_H - floor.naturalHeight - 16);
    layout.planeW = Math.max(DESIGN_W, layout.floorX + layout.floorW);
    layout.planeH = Math.max(DESIGN_H, layout.floorY + layout.floorH);
  }

  layout = centerBuildingInPlane(layout);
  layout = attachFloorFront(layout, floor);
  return expandPlaneToShell(layout);
}

function attachFloorFront(layout, floor) {
  const local = opaqueBottomVertex(floor, 96);
  if (local) {
    layout.frontX = layout.floorX + local.x;
    layout.frontY = layout.floorY + local.y;
  } else {
    layout.frontX = layout.floorX + Math.round((layout.floorW || 0) / 2);
    layout.frontY = layout.floorY + (layout.floorH || 0);
  }
  return layout;
}

/** Grow grass+veil to the whole workspace. Do not move the locked 570×550 house frame. */
function expandPlaneToShell(layout) {
  const { w: cssW, h: cssH } = shellViewSize();
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(state.zoom) || 1));
  const fit = houseFitScale(cssW, cssH);
  // Zooming out grows grass around the house instead of shrinking a rectangle.
  const scale = fit * Math.min(1, zoom);
  const curW = Math.max(DESIGN_W, layout.planeW || DESIGN_W);
  const curH = Math.max(DESIGN_H, layout.planeH || DESIGN_H);
  if (!(scale > 0.001)) {
    layout.planeW = curW;
    layout.planeH = curH;
    return layout;
  }
  let needW = Math.min(MAX_PLANE, Math.max(curW, Math.ceil(cssW / scale)));
  let needH = Math.min(MAX_PLANE, Math.max(curH, Math.ceil(cssH / scale)));
  const aspect = cssW / cssH;
  if (needW / needH < aspect - 0.001) {
    needW = Math.min(MAX_PLANE, Math.ceil(needH * aspect));
  } else if (needW / needH > aspect + 0.001) {
    needH = Math.min(MAX_PLANE, Math.ceil(needW / aspect));
  }
  const padX = Math.max(0, Math.ceil((needW - curW) / 2));
  const padY = Math.max(0, Math.ceil((needH - curH) / 2));
  if (padX) {
    layout.maskX += padX;
    layout.floorX += padX;
    if (Number.isFinite(layout.frontX)) layout.frontX += padX;
    layout.contentDx = (layout.contentDx || 0) + padX;
  }
  if (padY) {
    layout.maskY += padY;
    layout.floorY += padY;
    if (Number.isFinite(layout.frontY)) layout.frontY += padY;
    layout.contentDy = (layout.contentDy || 0) + padY;
  }
  layout.planeW = Math.min(MAX_PLANE, curW + padX * 2);
  layout.planeH = Math.min(MAX_PLANE, curH + padY * 2);
  layout.viewPadX = padX;
  layout.viewPadY = padY;
  return layout;
}

function ensureDesignPlane(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

function applyThemePack(pack) {
  if (pack) {
    if (state.themeFilter === pack.key && pack === state.pack) return;
    state.themeFilter = pack.key;
    state.pack = pack;
  } else {
    if (state.themeFilter === THEME_ALL) return;
    state.themeFilter = THEME_ALL;
  }
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
}

function fillThemes() {
  const list = document.getElementById("themeList");
  if (!list) return;
  const query = themeSearchQuery();
  let packs = state.packs.filter((pack) => !query || pack.name.toLowerCase().includes(query));
  const current = packByKey(state.themeFilter) || state.pack;
  if (current && query && !packs.includes(current) && !isAllThemes()) {
    packs = [current, ...packs];
  }
  list.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = THEME_ALL;
  allOpt.textContent = "全部";
  list.appendChild(allOpt);
  if (!packs.length && !state.packs.length) {
    list.disabled = true;
    updateAssetFilterSummary();
    return;
  }
  list.disabled = false;
  packs.forEach((pack) => {
    const option = document.createElement("option");
    option.value = pack.key;
    option.textContent = pack.name;
    list.appendChild(option);
  });
  list.value = isAllThemes() ? THEME_ALL : current?.key || THEME_ALL;
  updateAssetFilterSummary();
}

function fillCategories() {
  const list = document.getElementById("componentKinds");
  list.innerHTML = "";
  const counts = categoryCounts();
  CATEGORY_ORDER.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    const customSlot = isCustomCategory(category);
    const allSlot = isAllCategory(category);
    const count = customSlot
      ? state.customs.length
      : allSlot
        ? counts.get(ALL_CATEGORY) || 0
        : counts.get(category) || 0;
    button.className = (category === state.category ? "on" : "") + (allSlot ? " cat-all" : "");
    button.disabled = !customSlot && !allSlot && count === 0;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", category === state.category ? "true" : "false");
    button.title = customSlot
      ? count
        ? `组件（${count}）`
        : "自定义组件"
      : allSlot
        ? count
          ? `全部类别（${count}）`
          : "全部类别"
        : count
          ? `${category}（${count}）`
          : `${category}（此主题无）`;
    const label = document.createElement("span");
    label.className = "cat-label";
    label.textContent = category;
    button.append(label);
    const badge = document.createElement("span");
    badge.className = "cat-count";
    badge.textContent = String(count);
    button.append(badge);
    button.onclick = () => {
      if (!customSlot && !allSlot && count === 0) return;
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
  syncAssetCategoryView();
}

function syncAssetCategoryView() {
  const custom = isCustomCategory();
  const themePicker = document.querySelector("#tabAssets .theme-picker");
  const quick = document.getElementById("assetQuickFilters");
  const list = document.getElementById("componentList");
  const customs = document.getElementById("tabCustoms");
  if (themePicker) themePicker.hidden = custom;
  if (quick) quick.hidden = custom;
  if (list) list.hidden = custom;
  const wasHidden = !customs || customs.hidden;
  if (customs) customs.hidden = !custom;
  if (custom && wasHidden) fillCustoms();
}

function directionLabel(component) {
  if (!component) return "";
  if (component.kind === "kit") return "套件";
  const frames = Math.max(1, component.asset?.frames || 1);
  return `${frames}方向`;
}

function assetCardBadge(component, pack) {
  if (isAllThemes()) return pack?.name || directionLabel(component);
  if (isAllCategory()) return component.category || directionLabel(component);
  return directionLabel(component);
}

function collectAssetRows() {
  const query = themeSearchQuery();
  const rows = [];
  activeThemePacks().forEach((pack) => {
    (pack.components || []).forEach((component) => {
      if (!isBrowsableComponent(component)) return;
      if (!isAllCategory() && component.category !== state.category) return;
      const key = assetKey(component, pack);
      if (state.assetMode === "favorite" && !state.assetFavorites.has(key)) return;
      if (state.assetMode === "recent" && !state.assetRecent.includes(key)) return;
      if (query) {
        const hay = `${pack.name} ${component.category} ${component.id} ${(component.materials || [])
          .map((item) => item.name)
          .join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return;
      }
      rows.push({ component, pack, key });
    });
  });
  return rows;
}

function currentAssetFilterKey() {
  return [state.category, state.themeFilter, state.assetMode, themeSearchQuery()].join("|");
}

function assetGridMetrics(list) {
  const pad = 12;
  const width = Math.max(1, (list.clientWidth || list.parentElement?.clientWidth || 260) - pad);
  const gap = ASSET_TILE_GAP;
  const cols = Math.max(1, Math.floor((width + gap) / (ASSET_TILE_MIN + gap)));
  const cellW = (width - gap * (cols - 1)) / cols;
  const rowH = cellW + 32 + gap;
  return { cols, rowH };
}

function bindAssetListScroll() {
  if (assetListBound) return;
  const list = document.getElementById("componentList");
  if (!list) return;
  assetListBound = true;
  const refresh = () => {
    if (!assetRowsCache.length) return;
    if (assetWindowRaf) return;
    assetWindowRaf = requestAnimationFrame(() => {
      assetWindowRaf = 0;
      paintAssetWindow();
    });
  };
  list.addEventListener("scroll", refresh, { passive: true });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(refresh).observe(list);
  }
}

function appendAssetTile(parent, row) {
  const { component, pack, key } = row;
  if (!component._pack) component._pack = pack;
  const tile = document.createElement("div");
  tile.className = "component-tile";
  const button = document.createElement("button");
  button.type = "button";
  const uid = componentUid(component.id, pack);
  const missing = component.kind === "sprite" && uid == null;
  button.className =
    "component-card" +
    (component === state.component && !state.customBrush ? " on" : "") +
    (missing ? " missing" : "");
  const image = document.createElement("img");
  if (component.kind === "sprite") image.src = spriteUrl(component, pack, 0, true);
  image.draggable = false;
  const label = document.createElement("span");
  label.className = "asset-card-badge";
  label.textContent = assetCardBadge(component, pack);
  button.title =
    `${pack.name} / ${component.category} #${component.id}` +
    (component.kind === "kit" ? " · 套件" : missing ? " · 缺失图像" : " · 拖到画布或点击选用") +
    "\n" +
    (component.materials || []).map((item) => `${item.name}×${item.count}`).join(" ");
  button.append(image, label);
  const selectBrush = () => {
    component._pack = pack;
    rememberAsset(component, pack);
    if (pack) state.pack = pack;
    state.component = component;
    state.customBrush = null;
    state.brushState = 0;
    state.selected = [];
    armPaintBrush();
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
    if (window.MobileWorkspace?.modeForViewport().mobile) closeBuildingRail();
  };
  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "favorite-toggle" + (state.assetFavorites.has(key) ? " on" : "");
  favorite.innerHTML =
    '<svg class="favorite-star" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.1 12.5 7.3 18 8l-4.2 3.7 1.3 5.5L10 14.5 4.9 17.2 6.2 11.7 2 8l5.5-.7z"/></svg>';
  favorite.title = state.assetFavorites.has(key) ? "取消收藏" : "收藏素材";
  favorite.setAttribute("aria-label", favorite.title);
  favorite.onclick = (event) => {
    event.stopPropagation();
    if (state.assetFavorites.has(key)) state.assetFavorites.delete(key);
    else state.assetFavorites.add(key);
    saveAssetPreferences();
    fillComponents();
  };
  tile.append(button, favorite);
  parent.appendChild(tile);
}

function paintAssetWindow() {
  const list = document.getElementById("componentList");
  if (!list) return;
  const rows = assetRowsCache;
  if (!rows.length) return;
  const scrollTop = list.scrollTop;
  const viewH = Math.max(1, list.clientHeight || 400);
  const { cols, rowH } = assetGridMetrics(list);
  const virtual = rows.length > ASSET_VIRTUAL_MIN;
  let start = 0;
  let end = rows.length;
  if (virtual) {
    const startRow = Math.max(0, Math.floor(scrollTop / rowH) - ASSET_WINDOW_PAD_ROWS);
    const visibleRows = Math.ceil(viewH / rowH) + ASSET_WINDOW_PAD_ROWS * 2;
    start = startRow * cols;
    end = Math.min(rows.length, start + visibleRows * cols);
  }
  const fragment = document.createDocumentFragment();
  if (virtual && start > 0) {
    const topPad = document.createElement("div");
    topPad.className = "asset-pad";
    topPad.style.height = `${(start / cols) * rowH}px`;
    fragment.appendChild(topPad);
  }
  for (let i = start; i < end; i++) appendAssetTile(fragment, rows[i]);
  if (virtual && end < rows.length) {
    const botPad = document.createElement("div");
    botPad.className = "asset-pad";
    const endRow = Math.ceil(end / cols);
    const totalRows = Math.ceil(rows.length / cols);
    botPad.style.height = `${Math.max(0, totalRows - endRow) * rowH}px`;
    fragment.appendChild(botPad);
  }
  list.replaceChildren(fragment);
  if (virtual) list.scrollTop = scrollTop;
}

function fillComponents() {
  const list = document.getElementById("componentList");
  if (!list) return;
  bindAssetListScroll();
  if (isCustomCategory()) {
    assetRowsCache = [];
    list.replaceChildren();
    syncAssetCategoryView();
    updateAssetFilterSummary();
    return;
  }
  syncAssetCategoryView();
  if (!activeThemePacks().length) {
    assetRowsCache = [];
    list.replaceChildren();
    updateAssetFilterSummary();
    return;
  }
  const filterKey = currentAssetFilterKey();
  if (filterKey !== assetFilterKey) {
    assetFilterKey = filterKey;
    list.scrollTop = 0;
  }
  assetRowsCache = collectAssetRows();
  if (!assetRowsCache.length) {
    const empty = document.createElement("div");
    empty.className = "base-icon-empty";
    empty.textContent = "没有匹配的素材。试试改搜索，或换个类别 / 主题。";
    list.replaceChildren(empty);
    updateAssetFilterSummary();
    return;
  }
  paintAssetWindow();
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
      state.baseOverridden = false;
      state.paperBaseHint = "";
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
    const url = materialIconUrl(item.name);
    if (url) {
      const icon = document.createElement("img");
      icon.className = "mat-icon";
      icon.src = url;
      icon.alt = item.name;
      icon.draggable = false;
      row.appendChild(icon);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "mat-icon-slot";
      row.appendChild(spacer);
    }
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
    const projectBase = document.getElementById("projectCurrentBase");
    if (projectBase) projectBase.textContent = "无";
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
  const projectBase = document.getElementById("projectCurrentBase");
  if (projectBase) projectBase.textContent = base.name;
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
  const mobileBar = document.getElementById("mobileSelectionBar");
  if (mobileBar) mobileBar.hidden = state.phase !== "design" || count < 1;
  const picking = hasBrush() || count > 0;
  if (btnClearPick) btnClearPick.hidden = !picking;
  if (actions) actions.hidden = count < 1;
  updateFacingControl();
  updateLayerOrderControl();
  updateToolHint();

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
    selected.textContent = `已选 ${count} 项${groupHint}${lockHint}${lockedCount === count ? "" : " · 可一起移动变换"}`;
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

function materialIconUrl(name) {
  const row = state.itemIcons?.[name];
  if (!row?.file) return "";
  const file = String(row.file).replace(/\\/g, "/").replace(/^\/+/, "");
  const frame = Number(row.frame) || 0;
  const path = file.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/item-ale/${path}.png?f=${frame}`;
}

function renderMaterialChip(name, count) {
  const chip = document.createElement("span");
  chip.className = "mat-chip";
  chip.title = `${name}×${count}`;
  const url = materialIconUrl(name);
  if (url) {
    const icon = document.createElement("img");
    icon.className = "mat-icon";
    icon.src = url;
    icon.alt = name;
    icon.draggable = false;
    chip.appendChild(icon);
  }
  const label = document.createElement("span");
  label.className = "mat-name";
  label.textContent = name;
  const em = document.createElement("em");
  em.textContent = `×${count}`;
  chip.append(label, em);
  return chip;
}

function updateCurrentMaterials(component) {
  const host = document.getElementById("currentMaterials");
  if (!host) return;
  host.replaceChildren();
  (component?.materials || []).forEach((item) => {
    host.appendChild(renderMaterialChip(item.name, item.count));
  });
}

function updateAlignBar() {
  const bar = document.getElementById("alignBar");
  if (bar) bar.hidden = false;
}

function frameGeometry(component, stateValue = 0) {
  const frames = component?.asset?.frameTable || [];
  const frame = frames.length ? frames[Math.max(0, Number(stateValue) || 0) % frames.length] : null;
  return {
    width: frame?.width || component?.asset?.width || 0,
    height: frame?.height || component?.asset?.height || 0,
  };
}

function isInCanvasBounds(record) {
  const x = Number(record?.x) || 0;
  const y = Number(record?.y) || 0;
  // After s15 decode, leftover 327xx values are small negatives and may
  // legally hang off the design layer. Clip by the painted canvas only.
  const offset = state.interaction?.offset || paintedOffset || { dx: 0, dy: 0 };
  const px = x + (Number(offset.dx) || 0);
  const py = y + (Number(offset.dy) || 0);
  const w = canvas?.width || DESIGN_W;
  const h = canvas?.height || DESIGN_H;
  return px > -w && py > -h && px < w * 2 && py < h * 2;
}

function drawFrameImage(target, image, x, y, width, height) {
  if (width > 0 && height > 0) {
    target.drawImage(image, x, y, width, height);
    return;
  }
  target.drawImage(image, x, y);
}

function isCanvasRecord(record) {
  return !!(
    record &&
    !record.hidden &&
    Number(record.mat) !== 0 &&
    isInCanvasBounds(record) &&
    !isNativeDeskHiddenComponent(recordComponent(record))
  );
}

function isSelectableRecord(record) {
  return !!(
    record &&
    Number(record.mat) !== 0 &&
    isInCanvasBounds(record) &&
    !isNativeDeskHiddenComponent(recordComponent(record))
  );
}

function recordBox(record) {
  const component = recordComponent(record);
  const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
  return {
    x: record.x,
    y: record.y,
    width: geometry.width || 0,
    height: geometry.height || 0,
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

  if (mask?.complete && mask.naturalWidth) {
    const volume = roomMaskLayer(mask, grass, layout.maskX, layout.maskY);
    if (volume) ctx.drawImage(volume.sheet, layout.maskX, layout.maskY);
  }

  if (!floor?.complete || !floor.naturalWidth) return;
  if (state.phase === "design" && !state.keepFoundation) return;
  ctx.drawImage(floor, layout.floorX, layout.floorY, layout.floorW, layout.floorH);
}

function afterBaseDrawn() {
  const key = `${state.base?.no || "?"}|${canvas.width}x${canvas.height}|${Number(state.zoom) || 1}`;
  if (key === lastSceneKey) return;
  lastSceneKey = key;
  applyZoom();
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
  if (state.shapeStroke) return;
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
        drawFrameImage(ctx, image, x, y, geometry.width, geometry.height);
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
    drawFrameImage(ctx, image, x, y, geometry.width, geometry.height);
  } else {
    ctx.fillStyle = "#7ec8a0";
    ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
  }
  ctx.restore();
}

function drawStampGhostAt(template, cx, cy) {
  if (template.type === "custom") {
    const custom = template.custom;
    const bounds = customBrushBounds(custom);
    const originX = Math.round(cx - (bounds.left + bounds.right) / 2);
    const originY = Math.round(cy - (bounds.top + bounds.bottom) / 2);
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
        drawFrameImage(ctx, image, x, y, geometry.width, geometry.height);
      } else ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
    });
    return;
  }
  const record = template.type === "record" ? template.record : null;
  const component = template.component || recordComponent(record);
  const pack = template.pack || recordPack(record) || component?._pack;
  const face = record ? record.state ?? record.flip ?? 0 : state.brushState;
  const geometry = frameGeometry(component, face);
  const x = Math.round(cx - geometry.width / 2);
  const y = Math.round(cy - geometry.height / 2);
  const url = spriteUrl(component, pack, face);
  const image = loadImage(url);
  if (image?.complete && image.naturalWidth) {
    drawFrameImage(ctx, image, x, y, geometry.width, geometry.height);
  } else {
    ctx.fillStyle = "#7ec8a0";
    ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
  }
}

function drawShapePreview() {
  const stroke = state.shapeStroke;
  const template = stampTemplate();
  if (!stroke || !template) return;
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = "#7ec8a0";
  depthSortedStampPoints(shapeStampPoints(stroke), stroke.tool)
    .slice(0, STAMP_PREVIEW_MAX)
    .forEach((point) => drawStampGhostAt(template, point.x, point.y));
  ctx.restore();
}

function drawMarquee() {
  /* Selection rubber-band is a DOM overlay so it is not clipped by the canvas bitmap. */
}

function drawGroupBounds() {
  /* Selection bounds live in the viewport overlay, outside the bitmap render. */
}

function drawGuides() {
  /* Snap feedback lives in the viewport overlay. */
}

function paintBuilding() {
  const prevW = canvas.width;
  const prevH = canvas.height;
  drawBase();
  const layoutReady = isBaseLayoutReady();
  const offset = state.interaction?.offset || computeLiveContentOffset();
  if (!state.interaction) paintedOffset = offset;
  const { dx, dy } = offset;
  const frameEl = document.getElementById("canvasFrame");
  if (frameEl) {
    frameEl.dataset.paintDx = String(dx);
    frameEl.dataset.paintDy = String(dy);
    if (state.paperLayout && state.baseLayout) {
      frameEl.dataset.nativeLayer = `${NATIVE_PAPER_W}x${NATIVE_PAPER_H}`;
    }
  }
  if (state.phase === "design" && layoutReady) {
    const drag = state.dragging;
    const movingSet = drag?.movingSet;
    const selectedSet = null;
    ctx.save();
    ctx.translate(dx, dy);
    state.records.forEach((record, index) => {
      if (!isCanvasRecord(record)) return;
      const moving = !!movingSet?.has(index);
      if (moving && drag.preview?.sheet) return;
      const component = recordComponent(record);
      const pack = recordPack(record) || component?._pack;
      const url = spriteUrl(component, pack, record.state ?? record.flip ?? 0);
      const image = loadImage(url);
      const box = recordBox(record);
      const offsetX = moving ? drag.offsetX || 0 : 0;
      const offsetY = moving ? drag.offsetY || 0 : 0;
      if (image?.complete && image.naturalWidth) {
        drawFrameImage(ctx, image, box.x + offsetX, box.y + offsetY, box.width, box.height);
      } else {
        ctx.fillStyle = "#d75d44";
        ctx.fillRect(box.hotX + offsetX - 4, box.hotY + offsetY - 4, 8, 8);
        ctx.fillStyle = "#fff";
        ctx.fillText(String(record.mat), box.hotX + offsetX + 6, box.hotY + offsetY);
      }
    });
    if (drag?.preview?.sheet && drag.bounds) {
      ctx.drawImage(
        drag.preview.sheet,
        Math.round(drag.bounds.left + (drag.offsetX || 0)),
        Math.round(drag.bounds.top + (drag.offsetY || 0))
      );
    }
    ctx.restore();
    drawUnlitCover();
    ctx.save();
    ctx.translate(dx, dy);
    drawGhost();
    drawShapePreview();
    if (selectedSet) {
      state.records.forEach((record, index) => {
        if (record.hidden || !selectedSet.has(index)) return;
        const moving = !!movingSet?.has(index);
        const offsetX = moving ? drag.offsetX || 0 : 0;
        const offsetY = moving ? drag.offsetY || 0 : 0;
        ctx.strokeStyle = record.locked ? "#9aa7b2" : "#ffed4a";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        const hitBox = recordHitBox(record);
        ctx.strokeRect(
          hitBox.x + offsetX - 1,
          hitBox.y + offsetY - 1,
          Math.max(8, hitBox.width + 2),
          Math.max(8, hitBox.height + 2)
        );
        ctx.setLineDash([]);
      });
    }
    drawGroupBounds();
    drawMarquee();
    drawGuides();
    ctx.restore();
  } else {
    drawUnlitCover();
  }
  if (canvas.width !== prevW || canvas.height !== prevH || state.base) afterBaseDrawn();
  if (!state.dragging && !state.marquee) updateAllMaterials();
  syncViewportOverlays();
}

function renderBuilding() {
  scheduleRender();
}

function materialResolutionReason(record) {
  const mat = Math.max(0, Math.round(Number(record?.mat) || 0));
  if (!mat) return "";
  if (mat < 1000) {
    if (record?.localPackUnknown) return `三位素材 #${mat} 无法从图纸确定主题`;
    const pack = recordPack(record);
    return pack
      ? `${pack.name || pack.key} 缺少素材 #${mat}`
      : `三位素材 #${mat} 尚未指定主题`;
  }
  const uid = Math.floor(mat / 1000);
  const local = mat % 1000;
  const pack = packForPaperUid(uid);
  return pack
    ? `${pack.name || pack.key} 缺少素材 #${local}`
    : `素材包 UID ${uid} 尚未登记`;
}

function buildingMaterialReport(records = state.records) {
  const totals = new Map();
  const unresolvedReasons = new Map();
  let visible = 0;
  let resolved = 0;
  (state.base?.baseMaterials || []).forEach((item) => totals.set(item.name, item.count));
  records.forEach((record) => {
    if (record.hidden || Number(record.mat) === 0) return;
    visible += 1;
    const component = recordComponent(record);
    if (!component) {
      const reason = materialResolutionReason(record);
      unresolvedReasons.set(reason, (unresolvedReasons.get(reason) || 0) + 1);
      return;
    }
    resolved += 1;
    (component?.materials || []).forEach((item) => {
      totals.set(item.name, (totals.get(item.name) || 0) + item.count);
    });
  });
  return { totals, visible, resolved, unresolved: visible - resolved, unresolvedReasons };
}

function buildingMaterialTotals(records = state.records) {
  return buildingMaterialReport(records).totals;
}

function fillMaterialList(host, totals = null, unresolved = null) {
  if (!host) return;
  host.replaceChildren();
  let rows = totals;
  let missing = unresolved;
  if (!rows) {
    const report = buildingMaterialReport();
    rows = report.totals;
    missing = report.unresolved;
  }
  if (Number(missing) > 0) {
    const warning = document.createElement("span");
    warning.className = "material-warning";
    warning.textContent = `部分统计：${missing} 件素材未解析`;
    warning.title = "未解析素材无法可靠计算所需材料，不会用其他素材包猜测补齐。";
    host.appendChild(warning);
  }
  [...rows].forEach(([name, count]) => {
    host.appendChild(renderMaterialChip(name, count));
  });
}

function updateAllMaterials() {
  const strip = document.getElementById("allMaterials");
  fillMaterialList(strip);
}

function sceneRectToFrame(rect, transform = viewportTransform()) {
  const frame = document.getElementById("canvasFrame");
  const row = BI.normalizeRect(rect);
  const width = Math.max(1, frame?.clientWidth || transform.display.width);
  const height = Math.max(1, frame?.clientHeight || transform.display.height);
  const scaleX = width / Math.max(1, transform.bitmapWidth);
  const scaleY = height / Math.max(1, transform.bitmapHeight);
  return {
    left: (row.left + transform.offsetX) * scaleX,
    top: (row.top + transform.offsetY) * scaleY,
    width: row.width * scaleX,
    height: row.height * scaleY,
  };
}

function bitmapRectToFrame(rect, transform = viewportTransform()) {
  const frame = document.getElementById("canvasFrame");
  const row = BI.normalizeRect(rect);
  const width = Math.max(1, frame?.clientWidth || transform.display.width);
  const height = Math.max(1, frame?.clientHeight || transform.display.height);
  const scaleX = width / Math.max(1, transform.bitmapWidth);
  const scaleY = height / Math.max(1, transform.bitmapHeight);
  return {
    left: row.left * scaleX,
    top: row.top * scaleY,
    width: row.width * scaleX,
    height: row.height * scaleY,
  };
}

function selectionDisplayBounds(indices, dragOffset) {
  const ox = Number(dragOffset?.x) || 0;
  const oy = Number(dragOffset?.y) || 0;
  const paint = layoutContentOffset();
  const painted = [];
  indices.forEach((index) => {
    const record = state.records[index];
    if (!isCanvasRecord(record)) return;
    const box = recordHitBox(record);
    painted.push({
      box: {
        x: box.x + paint.dx + ox,
        y: box.y + paint.dy + oy,
        width: box.width,
        height: box.height,
      },
    });
  });
  return unionBox(painted);
}

function scenePointToFrame(x, y, transform = viewportTransform()) {
  const frame = document.getElementById("canvasFrame");
  const width = Math.max(1, frame?.clientWidth || transform.display.width);
  const height = Math.max(1, frame?.clientHeight || transform.display.height);
  return {
    x: (Number(x) + transform.offsetX) * (width / Math.max(1, transform.bitmapWidth)),
    y: (Number(y) + transform.offsetY) * (height / Math.max(1, transform.bitmapHeight)),
  };
}

function viewportTransform(offset = layoutContentOffset()) {
  return BI.createViewportTransform({
    canvasRect: canvas.getBoundingClientRect(),
    bitmapWidth: canvas.width,
    bitmapHeight: canvas.height,
    offsetX: offset.dx,
    offsetY: offset.dy,
    objectFit: "fill",
  });
}

function clientToBitmap(clientX, clientY) {
  return viewportTransform().clientToBitmap(clientX, clientY);
}

function clientToContent(clientX, clientY) {
  return viewportTransform().clientToScene(clientX, clientY);
}

function canvasPoint(event) {
  return clientToContent(event.clientX, event.clientY);
}

function spriteOpaqueAt(image, lx, ly) {
  if (!image?.complete || !image.naturalWidth) return false;
  if (lx < 0 || ly < 0 || lx >= image.naturalWidth || ly >= image.naturalHeight) return false;
  try {
    hitProbeCtx.clearRect(0, 0, 1, 1);
    hitProbeCtx.drawImage(image, lx, ly, 1, 1, 0, 0, 1, 1);
    return hitProbeCtx.getImageData(0, 0, 1, 1).data[3] > SPRITE_ALPHA_HIT;
  } catch {
    return false;
  }
}

function recordHitBox(record) {
  const box = recordBox(record);
  if (box.width <= 0 || box.height <= 0) return box;
  const component = recordComponent(record);
  const pack = recordPack(record) || component?._pack;
  const image = loadImage(spriteUrl(component, pack, record.state ?? record.flip ?? 0));
  const opaque = cacheSpriteOpaqueBounds(image);
  if (!opaque) return box;
  const sx = box.width / Math.max(1, image.naturalWidth);
  const sy = box.height / Math.max(1, image.naturalHeight);
  return {
    x: box.x + opaque.x * sx,
    y: box.y + opaque.y * sy,
    width: Math.max(1, opaque.width * sx),
    height: Math.max(1, opaque.height * sy),
  };
}

function selectionHitBoxes(indices) {
  return indices
    .filter((index) => isCanvasRecord(state.records[index]))
    .map((index) => ({ index, box: recordHitBox(state.records[index]) }));
}

function recordSolidAt(record, x, y) {
  const box = recordBox(record);
  const lx = Math.floor(x - box.x);
  const ly = Math.floor(y - box.y);
  if (lx < 0 || ly < 0 || lx >= box.width || ly >= box.height) return false;
  const component = recordComponent(record);
  const pack = recordPack(record) || component?._pack;
  const image = loadImage(spriteUrl(component, pack, record.state ?? record.flip ?? 0));
  return spriteOpaqueAt(image, lx, ly);
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + b.height > b.y;
}

function marqueeMoved(marquee) {
  if (!marquee) return false;
  const dx = (marquee.cx1 ?? marquee.x1) - (marquee.cx0 ?? marquee.x0);
  const dy = (marquee.cy1 ?? marquee.y1) - (marquee.cy0 ?? marquee.y0);
  return Math.abs(dx) >= MARQUEE_MIN_PX || Math.abs(dy) >= MARQUEE_MIN_PX;
}

function collectMarqueeHits(marquee) {
  const result = BI.selectFromRect(
    marquee.index,
    marquee.startScene,
    marquee.endScene,
    { mode: marquee.mode || currentMarqueeMode() }
  );
  return result.matches.map((item) => item.value);
}

function syncMarqueeOverlay() {
  const el = document.getElementById("marqueeOverlay");
  if (!el) return;
  const marquee = state.marquee;
  if (!marquee) {
    el.hidden = true;
    return;
  }
  const rect = sceneRectToFrame(
    BI.rectFromPoints(marquee.startScene, marquee.endScene),
    marquee.transform
  );
  if (rect.width < 1 && rect.height < 1) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${Math.max(1, rect.width)}px`;
  el.style.height = `${Math.max(1, rect.height)}px`;
  const mode = marquee.mode || currentMarqueeMode();
  el.classList.toggle("is-contain", mode === "contain");
  el.dataset.mode = mode === "contain" ? "完整包含" : "碰到就选";
}

function syncShapeOverlay() {
  const svg = document.getElementById("shapeOverlay");
  if (!svg) return;
  const stroke = state.shapeStroke;
  if (!stroke || !isPlaceTool(stroke.tool)) {
    svg.hidden = true;
    svg.replaceChildren();
    return;
  }
  const transform = stroke.transform || viewportTransform();
  const a = scenePointToFrame(stroke.start.x, stroke.start.y, transform);
  const b = scenePointToFrame(stroke.end.x, stroke.end.y, transform);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.max(1, Math.abs(b.x - a.x));
  const height = Math.max(1, Math.abs(b.y - a.y));
  const ns = "http://www.w3.org/2000/svg";
  const style = (node, fill) => {
    node.setAttribute("fill", fill);
    node.setAttribute("stroke", "#7ed9a0");
    node.setAttribute("stroke-width", "1.5");
    node.setAttribute("stroke-dasharray", "5 4");
    return node;
  };
  let node;
  if (isStampLike(stroke.tool)) {
    node = document.createElementNS(ns, "polyline");
    const pts = (stroke.points || []).map((point) => {
      const frame = scenePointToFrame(point.x, point.y, transform);
      return `${frame.x},${frame.y}`;
    });
    node.setAttribute("points", pts.join(" "));
    style(node, "none");
  } else if (stroke.tool === "line") {
    node = document.createElementNS(ns, "line");
    node.setAttribute("x1", String(a.x));
    node.setAttribute("y1", String(a.y));
    node.setAttribute("x2", String(b.x));
    node.setAttribute("y2", String(b.y));
    style(node, "none");
  } else if (stroke.tool === "circle" || (stroke.tool === "ring" && stroke.aligned)) {
    node = document.createElementNS(ns, "ellipse");
    node.setAttribute("cx", String(left + width / 2));
    node.setAttribute("cy", String(top + height / 2));
    node.setAttribute("rx", String(width / 2));
    node.setAttribute("ry", String(height / 2));
    style(node, stroke.tool === "ring" ? "none" : "rgba(126, 215, 160, 0.12)");
  } else if (stroke.tool === "triangle") {
    node = document.createElementNS(ns, "polygon");
    node.setAttribute("points", `${left + width / 2},${top} ${left},${top + height} ${left + width},${top + height}`);
    style(node, "rgba(126, 215, 160, 0.12)");
  } else if (stroke.tool === "diamond") {
    node = document.createElementNS(ns, "polygon");
    node.setAttribute(
      "points",
      `${left + width / 2},${top} ${left + width},${top + height / 2} ${left + width / 2},${top + height} ${left},${top + height / 2}`
    );
    style(node, "rgba(126, 215, 160, 0.12)");
  } else {
    node = document.createElementNS(ns, "rect");
    node.setAttribute("x", String(left));
    node.setAttribute("y", String(top));
    node.setAttribute("width", String(width));
    node.setAttribute("height", String(height));
    style(node, stroke.tool === "ring" ? "none" : "rgba(126, 215, 160, 0.12)");
  }
  svg.replaceChildren(node);
  svg.hidden = false;
}

function syncViewportOverlays() {
  syncMarqueeOverlay();
  syncShapeOverlay();
  const shell = document.getElementById("canvasShell");
  const selection = document.getElementById("selectionOverlay");
  const guideLayer = document.getElementById("guideOverlay");
  if (!shell || !selection || !guideLayer) return;
  const shellRect = shell.getBoundingClientRect();
  const root = document.getElementById("viewportOverlayRoot");
  if (root) {
    const stage = document.getElementById("buildingStage");
    const stageRect = stage?.getBoundingClientRect();
    if (stageRect) {
      root.style.left = `${shellRect.left - stageRect.left}px`;
      root.style.top = `${shellRect.top - stageRect.top}px`;
      root.style.width = `${shellRect.width}px`;
      root.style.height = `${shellRect.height}px`;
    }
  }
  const transform = state.interaction?.transform || viewportTransform();
  const bounds = state.marquee
    ? null
    : selectionDisplayBounds(state.selected, {
        x: state.dragging?.offsetX || 0,
        y: state.dragging?.offsetY || 0,
      });
  if (!bounds) {
    selection.hidden = true;
  } else {
    const frameRect = bitmapRectToFrame(bounds, transform);
    selection.hidden = false;
    selection.style.left = `${frameRect.left}px`;
    selection.style.top = `${frameRect.top}px`;
    selection.style.width = `${Math.max(1, frameRect.width)}px`;
    selection.style.height = `${Math.max(1, frameRect.height)}px`;
    selection.dataset.count = `${state.selected.length} 项`;
    const badge = selection.querySelector(".selection-count");
    if (badge) {
      badge.textContent = `${state.selected.length} 项`;
      badge.style.top = "";
      badge.style.right = "";
      badge.style.bottom = "";
    }
  }
  layoutFloatingHuds();

  const frame = document.getElementById("canvasFrame");
  guideLayer.replaceChildren();
  state.guides.forEach((guide) => {
    const line = document.createElement("i");
    line.className = `snap-guide ${guide.type === "v" ? "is-vertical" : "is-horizontal"}`;
    const point = scenePointToFrame(
      guide.type === "v" ? guide.pos : 0,
      guide.type === "h" ? guide.pos : 0,
      transform
    );
    if (guide.type === "iso-u" || guide.type === "iso-v") {
      const left = transform.clientToScene(shell.getBoundingClientRect().left, shell.getBoundingClientRect().top);
      const right = transform.clientToScene(shell.getBoundingClientRect().right, shell.getBoundingClientRect().top);
      const x0 = left.x - 400;
      const x1 = right.x + 400;
      const yAt = (x) =>
        guide.type === "iso-u" ? 2 * guide.pos - x / 2 : x / 2 - 2 * guide.pos;
      const a = scenePointToFrame(x0, yAt(x0), transform);
      const b = scenePointToFrame(x1, yAt(x1), transform);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      line.className = "snap-guide is-iso";
      line.style.left = `${a.x}px`;
      line.style.top = `${a.y}px`;
      line.style.width = `${Math.max(1, Math.hypot(dx, dy))}px`;
      line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    } else if (guide.type === "v") {
      line.style.left = `${point.x}px`;
      line.style.top = "0px";
      line.style.height = `${frame?.clientHeight || shell.clientHeight}px`;
    } else {
      line.style.left = "0px";
      line.style.top = `${point.y}px`;
      line.style.width = `${frame?.clientWidth || shell.clientWidth}px`;
    }
    guideLayer.appendChild(line);
  });
}

function buildRecordSpatialIndex(excluded = new Set(), { includeLocked = true } = {}) {
  const skip = excluded instanceof Set ? excluded : new Set();
  const index = new BI.SpatialIndex(128);
  state.records.forEach((record, recordIndex) => {
    if (!isCanvasRecord(record) || skip.has(recordIndex)) return;
    if (!includeLocked && record.locked) return;
    index.insert(recordIndex, recordHitBox(record), recordIndex);
  });
  return index;
}

function pointInSelectionUnion(x, y) {
  if (state.selected.length < 2) return false;
  const union = unionBox(selectionHitBoxes(state.selected));
  if (!union) return false;
  const pad = 4;
  return x >= union.left - pad && x <= union.right + pad && y >= union.top - pad && y <= union.bottom + pad;
}

function hitRecord(x, y, { includeLocked = false, solid = false } = {}) {
  for (let index = state.records.length - 1; index >= 0; index--) {
    const record = state.records[index];
    if (!isCanvasRecord(record)) continue;
    if (record.locked && !includeLocked) continue;
    if (solid) {
      const tight = recordHitBox(record);
      if (x < tight.x || y < tight.y || x >= tight.x + tight.width || y >= tight.y + tight.height) continue;
      if (!recordSolidAt(record, x, y)) continue;
      return index;
    }
    const box = recordBox(record);
    if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) return index;
  }
  return -1;
}

function workingSet(indices) {
  return [...new Set(indices)].filter((index) => state.records[index] && !state.records[index].hidden);
}

function beginRecordDrag(x, y, indices, transform = viewportTransform()) {
  const dragIndices = workingSet(indices).filter((index) => !state.records[index].locked);
  if (!dragIndices.length) return false;
  const preview = buildDragLayer(dragIndices);
  const movingSet = preview.movingSet;
  state.dragging = {
    x,
    y,
    origins: dragIndices.map((index) => ({
      i: index,
      x: state.records[index].x,
      y: state.records[index].y,
    })),
    bounds: preview.bounds,
    movingSet,
    preview,
    transform,
    snapIndex: buildRecordSpatialIndex(movingSet),
    snapLatch: { x: null, y: null },
    offsetX: 0,
    offsetY: 0,
    moved: false,
    before: null,
  };
  state.guides = [];
  return true;
}

function updateMarqueePointer(clientX, clientY) {
  if (!state.marquee) return;
  state.marquee.cx1 = clientX;
  state.marquee.cy1 = clientY;
  state.marquee.endScene = state.marquee.transform.clientToScene(clientX, clientY);
  if (marqueeMoved(state.marquee)) state.marquee.pendingPlace = false;
  syncMarqueeOverlay();
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

function setSelection(indices, { expandGroup = false, layers = true } = {}) {
  let next = [...new Set(indices)].filter((index) => index >= 0 && index < state.records.length);
  if (expandGroup) next = expandGroupSelection(next);
  state.selected = next;
  updateSelectionCaption();
  updateAlignBar();
  syncViewportOverlays();
  if (layers) fillLayers();
}

function clearSelection({ layers = true } = {}) {
  state.selected = [];
  updateSelectionCaption();
  updateAlignBar();
  syncViewportOverlays();
  if (layers) fillLayers();
}

function cancelPick() {
  state.component = null;
  state.customBrush = null;
  state.brushState = 0;
  state.ghost = null;
  state.marquee = null;
  syncMarqueeOverlay();
  clearSelection();
  fillComponents();
  fillCustoms();
  updateFacingControl();
  renderBuilding();
}

function hasBrush() {
  return !!(state.customBrush || state.component);
}

function clearBrushHighlight() {
  state.component = null;
  state.customBrush = null;
  state.ghost = null;
  document.querySelectorAll(".component-card.on, .custom-card.on").forEach((node) => {
    node.classList.remove("on");
  });
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
  if (state.selected.length) {
    let max = 1;
    state.selected.forEach((index) => {
      const record = state.records[index];
      const component = record?.component || componentByUid(record?.mat, record?.pack || state.pack);
      max = Math.max(max, componentFrameCount(component));
    });
    return max;
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
  applyHoverTip(
    document.getElementById("facingLabel"),
    `朝向 ${state.brushState + 1}/${frames}`,
    "Q / E"
  );
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

const LAYER_DEPTHS = 4;

function currentLayerSlot() {
  const n = state.records.length;
  const indices = selectedUnlockedIndices();
  if (!n || !indices.length) return 0;
  if (n === 1) return LAYER_DEPTHS;
  const pos = Math.round((Math.min(...indices) + Math.max(...indices)) / 2);
  if (pos <= 0) return 1;
  if (pos >= n - 1) return LAYER_DEPTHS;
  return pos * 2 < n - 1 ? 2 : 3;
}

function moveSelectedToLayerSlot(slot) {
  const indices = selectedUnlockedIndices().sort((a, b) => a - b);
  if (!indices.length) return;
  const depth = Math.min(LAYER_DEPTHS, Math.max(1, Number(slot) || 1));
  if (depth === 1) {
    reorderSelected("bottom");
    return;
  }
  if (depth === LAYER_DEPTHS) {
    reorderSelected("top");
    return;
  }
  pushHistory();
  const moving = indices.map((index) => state.records[index]);
  const keep = state.records.filter((_, index) => !indices.includes(index));
  const insertAt = depth === 2
    ? Math.round(keep.length / 3)
    : Math.round((2 * keep.length) / 3);
  state.records = [...keep.slice(0, insertAt), ...moving, ...keep.slice(insertAt)];
  const idSet = new Set(moving);
  const newSelected = [];
  state.records.forEach((record, index) => {
    if (idSet.has(record)) newSelected.push(index);
  });
  setSelection(newSelected);
  renderBuilding();
}

function updateLayerOrderControl() {
  const label = document.getElementById("layerOrderLabel");
  if (!label) return;
  const slot = currentLayerSlot();
  label.textContent = slot ? `${slot}/${LAYER_DEPTHS}` : `-/4`;
  applyHoverTip(label, slot ? `图层 ${slot}/${LAYER_DEPTHS}` : "图层循环", "Z / X");
  applyHoverTip(document.getElementById("btnLayerBack"), "图层向后循环", "Z");
  applyHoverTip(document.getElementById("btnLayerFront"), "图层向前循环", "X");
}

function stepLayerOrder(delta) {
  const indices = selectedUnlockedIndices();
  if (!indices.length) return;
  const slot = currentLayerSlot() || 1;
  const next = ((slot - 1 + Number(delta) + LAYER_DEPTHS) % LAYER_DEPTHS) + 1;
  moveSelectedToLayerSlot(next);
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
  const transform = viewportTransform();
  const scene = transform.clientToScene(clientX, clientY);
  const shell = document.getElementById("canvasShell");
  const rect = shell?.getBoundingClientRect();
  return {
    x: scene.x,
    y: scene.y,
    inside: rect
      ? clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      : true,
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
      if (drag.payload?._pack) state.pack = drag.payload._pack;
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

async function fetchBuildingSaves() {
  try {
    const res = await fetch("/api/saves/building", { credentials: "same-origin" });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn(error);
    return null;
  }
}

function putBuildingSaves(payload, keepalive) {
  return fetch("/api/saves/building", {
    method: "PUT",
    credentials: "same-origin",
    keepalive: !!keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(String(res.status));
  });
}

function serializeSessionRecords() {
  return state.records.map((record) => ({
    mode: record.mode || "desk",
    x: record.x,
    y: record.y,
    mat: record.mat,
    state: record.state ?? record.flip ?? 0,
    packKey: record.localPackUnknown
      ? ""
      : record.packKey || record.pack?.key || state.pack?.key || "",
    localPackUnknown: !!record.localPackUnknown,
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
    themeFilter: state.themeFilter || state.pack?.key || "",
    category: state.category,
    records: serializeSessionRecords(),
    keepFoundation: !!state.keepFoundation,
    brushState: state.brushState || 0,
    snap: { ...state.snap },
    veil: { ...state.veil },
    zoom: state.zoom || 1,
    marqueeMode: currentMarqueeMode(),
    source: state.source
      ? { encoding: state.source.encoding || "gbk" }
      : null,
    selected: [...state.selected],
    railTab: state.railTab || "assets",
    railWidth: state.railWidth,
    railCollapsed: !!state.railCollapsed,
    layerCollapsed: [...state.layerCollapsed],
    layerFilter: state.layerFilter || "",
    paperLayout: !!state.paperLayout,
    paperOrigin: state.paperOrigin ? { ...state.paperOrigin } : null,
    basePicked: !!state.basePicked,
    paperBaseHint: state.paperBaseHint || "",
    baseOverridden: !!state.baseOverridden,
    baseAnchor: state.baseAnchor ? { ...state.baseAnchor } : null,
  };
}

function saveBuildingSession() {
  const snap = buildingSessionSnapshot();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
    state.sessionDirty = false;
  } catch (error) {
    console.warn("建筑会话保存失败", error);
  }
  putBuildingSaves({ session: snap }, true).catch((error) => console.warn(error));
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

function restoreBuildingSession(remoteSnap) {
  let snap = remoteSnap && typeof remoteSnap === "object" ? remoteSnap : null;
  if (!snap) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      snap = JSON.parse(raw);
    } catch {
      return false;
    }
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
    if (snap.themeFilter === THEME_ALL) state.themeFilter = THEME_ALL;
    else if (snap.themeFilter && packByKey(snap.themeFilter)) state.themeFilter = snap.themeFilter;
    else state.themeFilter = state.pack?.key || THEME_ALL;
    if (snap.category) state.category = snap.category;
    ensureActiveCategory();
    if (snap.snap) state.snap = { ...state.snap, ...snap.snap };
    if (snap.veil) state.veil = { ...state.veil, ...snap.veil };
    if (Number.isFinite(snap.zoom)) state.zoom = snap.zoom;
    state.marqueeMode = snap.marqueeMode === "contain" ? "contain" : "touch";
    state.keepFoundation = snap.keepFoundation !== false;
    state.brushState = Number(snap.brushState) || 0;
    state.source = snap.source || null;
    state.paperLayout = !!snap.paperLayout;
    state.paperOrigin =
      snap.paperOrigin && Number.isFinite(snap.paperOrigin.x) && Number.isFinite(snap.paperOrigin.y)
        ? { x: Number(snap.paperOrigin.x), y: Number(snap.paperOrigin.y) }
        : null;
    state.basePicked = snap.basePicked !== false && snap.baseNo != null;
    state.paperBaseHint = snap.paperBaseHint || "";
    state.baseOverridden = !!snap.baseOverridden;
    state.baseAnchor = null;
    state.layerFilter = snap.layerFilter || "";
    state.railWidth = Math.max(300, Math.min(520, Number(snap.railWidth) || 340));
    state.railCollapsed = !!snap.railCollapsed;
    applyRailState();
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
  const localPackUnknown = !!record.localPackUnknown;
  const packKey = localPackUnknown
    ? ""
    : record.packKey || record.pack?.key || state.pack?.key || "";
  const pack = localPackUnknown ? null : packByKey(packKey) || state.pack;
  const x = decodeS15(record.x);
  const y = decodeS15(record.y);
  const mat = Number(record.mat) || 0;
  return {
    mode: record.mode || "desk",
    x,
    y,
    mat,
    state: record.state ?? record.flip ?? 0,
    packKey,
    pack,
    localPackUnknown,
    component: null,
    group: record.group || null,
    groupName: record.groupName || null,
    label: record.label || null,
    locked: !!record.locked,
    hidden: !!record.hidden || mat === 0,
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

function snapAxis() {
  const axis = state.snap.axis;
  return axis === "ortho" || axis === "both" ? axis : "iso";
}

function snapGridPoint(x, y) {
  if (!state.snap.enabled) return { x: Math.round(x), y: Math.round(y) };
  return BI.snapGridPoint(x, y, state.snap.step, snapAxis());
}

function clampRecordPos(x, y) {
  return {
    x: Math.round(x),
    y: Math.round(y),
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

function buildDragLayer(indices) {
  const boxes = selectionBoxes(indices);
  const bounds = unionBox(boxes);
  const movingSet = new Set(indices);
  if (!bounds) return { bounds: null, movingSet, sheet: null };
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  if (
    indices.length > DRAG_PREVIEW_MAX ||
    width * height > DRAG_LAYER_MAX_AREA ||
    width > 4096 ||
    height > 4096
  ) {
    return { bounds, movingSet, sheet: null };
  }
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const c = sheet.getContext("2d");
  let allReady = true;
  indices.forEach((index) => {
    const record = state.records[index];
    if (!record || record.hidden) return;
    const component = recordComponent(record);
    const pack = recordPack(record) || component?._pack;
    const image = loadImage(spriteUrl(component, pack, record.state ?? record.flip ?? 0));
    const box = recordBox(record);
    if (image?.complete && image.naturalWidth) {
      drawFrameImage(
        c,
        image,
        Math.round(box.x - bounds.left),
        Math.round(box.y - bounds.top),
        box.width,
        box.height
      );
    } else allReady = false;
  });
  return { bounds, movingSet, sheet: allReady ? sheet : null };
}

function applyDragPositions(pointerX, pointerY, modifiers = {}) {
  if (!state.dragging) return;
  let rawDx = pointerX - state.dragging.x;
  let rawDy = pointerY - state.dragging.y;
  if (modifiers.shiftKey) {
    if (Math.abs(rawDx) >= Math.abs(rawDy)) rawDy = 0;
    else rawDx = 0;
  }
  if (Math.abs(rawDx) > 0.5 || Math.abs(rawDy) > 0.5) {
    state.dragging.moved = true;
    if (!state.dragging.before) state.dragging.before = recordsHistoryPayload();
  }
  const drag = state.dragging;
  let dx = Math.round(rawDx);
  let dy = Math.round(rawDy);
  if (state.snap.enabled && drag.bounds && !modifiers.altKey) {
    const threshold = drag.transform.pxToScene(OBJECT_SNAP_PX);
    const area = {
      x: drag.bounds.left + rawDx - threshold - 512,
      y: drag.bounds.top + rawDy - threshold - 512,
      width: drag.bounds.width + (threshold + 512) * 2,
      height: drag.bounds.height + (threshold + 512) * 2,
    };
    const targets = drag.snapIndex.query(area);
    const snapped = BI.snapMove({
      bounds: drag.bounds,
      offsetX: rawDx,
      offsetY: rawDy,
      threshold,
      axis: snapAxis(),
      gridEnabled: state.snap.grid !== false,
      gridStep: state.snap.step,
      objectEnabled:
        state.snap.object !== false && (state.snap.edges !== false || state.snap.centers !== false),
      edgeEnabled: state.snap.edges !== false,
      centerEnabled: state.snap.centers !== false,
      targets,
      latch: drag.snapLatch,
    });
    dx = snapped.x;
    dy = snapped.y;
    drag.snapLatch = snapped.latch;
    state.guides = snapped.guides;
  } else {
    drag.snapLatch = { x: null, y: null };
    state.guides = [];
  }
  drag.offsetX = Math.round(dx);
  drag.offsetY = Math.round(dy);
}

function commitDragPositions() {
  const drag = state.dragging;
  if (!drag) return;
  drag.origins.forEach(({ i, x, y }) => {
    const record = state.records[i];
    if (!record || record.locked) return;
    const clamped = clampRecordPos(x + drag.offsetX, y + drag.offsetY);
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
  const pack = state.component._pack || state.pack;
  const uid = componentUid(state.component.id, pack);
  if (uid == null) {
    appAlert("原版素材表中没有这个组件对应的图像记录。");
    return;
  }
  const geometry = frameGeometry(state.component, state.brushState);
  let px = x - geometry.width / 2;
  let py = y - geometry.height / 2;
  if (state.snap.enabled) {
    const snapped = snapGridPoint(px, py);
    px = snapped.x;
    py = snapped.y;
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
    pack,
    packKey: pack?.key,
  });
  setSelection([state.records.length - 1]);
  renderBuilding();
}

function appendSpriteStamp(component, pack, face, cx, cy, seen) {
  const usePack = pack || component?._pack || state.pack;
  const uid = componentUid(component?.id, usePack);
  if (uid == null || !component) return -1;
  const geometry = frameGeometry(component, face);
  let px = cx - geometry.width / 2;
  let py = cy - geometry.height / 2;
  if (state.snap.enabled) {
    const snapped = snapGridPoint(px, py);
    px = snapped.x;
    py = snapped.y;
  }
  const pos = clampRecordPos(px, py);
  const key = `${pos.x},${pos.y},${uid},${face}`;
  if (seen.has(key)) return -1;
  seen.add(key);
  state.records.push({
    mode: "desk",
    x: pos.x,
    y: pos.y,
    mat: uid,
    state: face,
    component,
    pack: pack || component._pack || state.pack,
    packKey: (pack || component._pack || state.pack)?.key,
  });
  return state.records.length - 1;
}

function placeStampBatch(points, tool = state.tool) {
  const template = stampTemplate();
  if (!template || !points.length) return;
  pushHistory();
  const seen = new Set();
  const indices = [];
  const historyLen = state.history.length;
  depthSortedStampPoints(points, tool).forEach((point) => {
    if (template.type === "sprite") {
      const index = appendSpriteStamp(
        template.component,
        template.pack,
        facingAbsolute(template.component),
        point.x,
        point.y,
        seen
      );
      if (index >= 0) indices.push(index);
      return;
    }
    if (template.type === "record") {
      const record = template.record;
      const component = recordComponent(record);
      const index = appendSpriteStamp(
        component,
        record.pack || recordPack(record),
        record.state ?? record.flip ?? 0,
        point.x,
        point.y,
        seen
      );
      if (index >= 0) indices.push(index);
      return;
    }
    if (template.type === "custom") {
      const start = state.records.length;
      placeCustomBrush(point.x, point.y, { history: false, select: false, render: false });
      for (let i = start; i < state.records.length; i++) indices.push(i);
    }
  });
  if (!indices.length) {
    if (state.history.length === historyLen) return;
    state.history.pop();
    return;
  }
  if (state.tool === "paint") clearSelection({ layers: false });
  else setSelection(indices);
  renderBuilding();
}

function addKitComponent(kit, x, y) {
  let parsed;
  try {
    parsed = parseV1(kit.paper);
  } catch (error) {
    appAlert("套件图纸解析失败：" + (error.message || error));
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
    appAlert("套件没有可用的原版组件。");
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
    const snapped = snapGridPoint(dx, dy);
    dx = snapped.x;
    dy = snapped.y;
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

function placeCustomBrush(x, y, options = {}) {
  const custom = state.customBrush;
  if (!custom?.records?.length) return;
  const bounds = customBrushBounds(custom);
  let originX = x - (bounds.left + bounds.right) / 2;
  let originY = y - (bounds.top + bounds.bottom) / 2;
  if (state.snap.enabled) {
    const snapped = snapGridPoint(originX, originY);
    originX = snapped.x;
    originY = snapped.y;
  }
  const group = `${Date.now()}-custom-${state.records.length}`;
  if (options.history !== false) pushHistory();
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
    if (options.select !== false) appAlert("自定义组件没有可用素材。");
    return;
  }
  if (options.select !== false) setSelection(newIndices);
  if (options.render !== false) renderBuilding();
}

function selectedUnlockedIndices() {
  return state.selected.filter((index) => state.records[index] && !state.records[index].locked);
}

function pruneCollapsedLayerGroups() {
  const live = new Set(state.records.map((record) => record.group).filter(Boolean));
  state.layerCollapsed.forEach((groupId) => {
    if (!live.has(groupId)) state.layerCollapsed.delete(groupId);
  });
}

function deleteSelected() {
  const indices = selectedUnlockedIndices().sort((a, b) => b - a);
  if (!indices.length) return;
  pushHistory();
  indices.forEach((index) => state.records.splice(index, 1));
  pruneCollapsedLayerGroups();
  clearSelection();
  fillLayers();
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

function pasteClipboard(atScene) {
  if (!state.clipboard?.length) return;
  pushHistory();
  const bounds = clipboardBounds(state.clipboard);
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  let originX;
  let originY;
  if (atScene && Number.isFinite(atScene.x) && Number.isFinite(atScene.y)) {
    originX = atScene.x - width / 2 - bounds.left;
    originY = atScene.y - height / 2 - bounds.top;
  } else if (state.ghost) {
    originX = state.ghost.x - width / 2 - bounds.left;
    originY = state.ghost.y - height / 2 - bounds.top;
  } else {
    const offset = state.snap.step || 4;
    originX = offset;
    originY = offset;
  }
  if (state.snap.enabled) {
    const snapped = snapGridPoint(originX, originY);
    originX = snapped.x;
    originY = snapped.y;
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

async function groupSelected() {
  const indices = selectedUnlockedIndices();
  if (indices.length < 2) {
    await appAlert("请先框选至少两个素材。分组只是方便图层里一次点选，圈选后已经可以一起移动。");
    return;
  }
  const name = await appPrompt("方便在图层里识别，也可以留空。", {
    title: "分组名称",
    fieldLabel: "名称",
    placeholder: "例如 屋顶一组",
    okLabel: "分组",
  });
  if (name == null) return;
  const group = `${Date.now()}-grp`;
  pushHistory();
  indices.forEach((index) => {
    state.records[index].group = group;
    if (name.trim()) state.records[index].groupName = name.trim();
    else delete state.records[index].groupName;
  });
  state.layerCollapsed.add(group);
  setSelection(indices, { expandGroup: true });
  updateSelectionCaption();
  fillLayers();
  renderBuilding();
}

async function ungroupSelected() {
  const indices = state.selected.filter((index) => state.records[index]?.group);
  if (!indices.length) {
    await appAlert("当前选择里没有已分组的素材。");
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
  groups.forEach((groupId) => state.layerCollapsed.delete(groupId));
  setSelection(indices);
  updateSelectionCaption();
  fillLayers();
  renderBuilding();
}

async function lockSelected() {
  const indices = state.selected.filter((index) => state.records[index] && !state.records[index].locked);
  if (!indices.length) {
    await appAlert("请先选中要锁定的素材（已锁定的不用再锁）。");
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

async function unlockSelected() {
  const indices = state.selected.filter((index) => state.records[index]?.locked);
  if (!indices.length) {
    await appAlert("当前选择没有已锁定的素材。可在「图层」里点锁图标，或先全选再解锁。");
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

async function toggleLockSelected() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) {
    await appAlert("请先选中要锁定/解锁的素材。");
    return;
  }
  if (indices.every((index) => state.records[index].locked)) unlockSelected();
  else lockSelected();
}

function nudgeSelected(dx, dy) {
  const indices = expandGroupSelection(selectedUnlockedIndices()).filter(
    (index) => state.records[index] && !state.records[index].locked
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
  markBuildingDirty();
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
  const marquee = state.marquee;
  state.marquee = null;
  syncMarqueeOverlay();
  if (marquee.pendingPlace && !marqueeMoved(marquee)) {
    addComponent(marquee.startScene.x, marquee.startScene.y);
    return;
  }
  if (!marqueeMoved(marquee)) {
    if (marquee.operation === "replace") clearSelection();
    renderBuilding();
    return;
  }
  const hits = collectMarqueeHits(marquee);
  setSelection(BI.applySelection(marquee.baseSelection || [], hits, marquee.operation));
  renderBuilding();
}

function commitRecordDrag() {
  if (!state.dragging) return;
  if (state.dragging.moved) commitDragPositions();
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
}

function cancelCanvasInteraction() {
  const interaction = state.interaction;
  if (!interaction) return false;
  if (interaction.mode === "move" && state.dragging?.origins) {
    state.dragging.origins.forEach((origin) => {
      const record = state.records[origin.i];
      if (record) {
        record.x = origin.x;
        record.y = origin.y;
      }
    });
  }
  if (interaction.baseSelection) setSelection(interaction.baseSelection, { layers: false });
  state.marquee = null;
  state.dragging = null;
  state.shapeStroke = null;
  state.guides = [];
  state.interaction = null;
  syncMarqueeOverlay();
  syncShapeOverlay();
  fillLayers();
  renderBuilding();
  return true;
}

function pickRecordAsBrush(record) {
  if (!record || !Number(record.mat)) return;
  const component = record.component || componentByUid(record.mat, record.pack || state.pack);
  if (!component || component.kind === "kit") return;
  rememberAsset(component);
  state.component = component;
  state.customBrush = null;
  state.brushState = record.state ?? record.flip ?? 0;
  clearSelection({ layers: false });
  if (!isPlaceTool()) setActiveTool("paint");
  updateSelectionCaption();
  updateCurrentMaterials(component);
  fillComponents();
  fillCustoms();
  fillLayers();
  updateAlignBar();
  updateFacingControl();
  renderBuilding();
}

function focusDesignCanvas() {
  const shell = document.getElementById("canvasShell");
  if (!shell || document.activeElement === shell) return;
  try {
    shell.focus({ preventScroll: true });
  } catch {
    shell.focus();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = String(target.type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "hidden", "color"].includes(type);
}

function beginCanvasPointer(event, shell) {
  if (event.button === 2) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (state.phase !== "design") return;
  if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
  if (event.pointerType === "touch") {
    event.preventDefault();
    state.activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    try { shell.setPointerCapture?.(event.pointerId); } catch {}
    if (state.activePointers.size >= 2) {
      if (state.pointerPending?.timer) clearTimeout(state.pointerPending.timer);
      state.pointerPending = null;
      cancelCanvasInteraction();
      const [a, b] = [...state.activePointers.values()];
      state.pointerGesture = {
        type: "pinch",
        distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        zoom: state.zoom,
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
      };
      shell.classList.add("is-panning");
      return;
    }
    if (!state._touchArmed) {
      if (state.pointerGesture) return;
      const armedEvent = {
        pointerId: event.pointerId,
        pointerType: "touch",
        button: 0,
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: !!event.shiftKey,
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        altKey: !!event.altKey,
        target: event.target,
        preventDefault() {},
      };
      state.pointerPending = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        event: armedEvent,
        timer: setTimeout(() => {
          if (state.pointerGesture || state.activePointers.size !== 1) return;
          const pending = state.pointerPending;
          state.pointerPending = null;
          if (!pending) return;
          state._touchArmed = true;
          beginCanvasPointer(pending.event, shell);
          state._touchArmed = false;
        }, 90),
      };
      return;
    }
  }
  if (state.pointerGesture) return;
  if (state.interaction) return;
  if (event.target.closest?.(".zoom-control, .base-meta, .stage-commandbar, .canvas-tool-dock, .canvas-toolrail, .ctx-menu, button, a, input, select, label")) return;
  focusDesignCanvas();
  if (event.button !== 2) event.preventDefault();
  const offset = layoutContentOffset();
  const transform = viewportTransform(offset);
  const startScene = transform.clientToScene(event.clientX, event.clientY);
  const baseSelection = state.selected.slice();
  const interaction = {
    pointerId: event.pointerId,
    mode: "pending",
    transform,
    offset,
    startClient: { x: event.clientX, y: event.clientY },
    startScene,
    baseSelection,
  };
  state.interaction = interaction;
  try {
    shell.setPointerCapture?.(event.pointerId);
  } catch {
    /* synthetic or inactive pointer */
  }

  if (event.button === 2) {
    hideContextMenu();
    interaction.mode = "right";
    interaction.startScroll = { x: shell.scrollLeft, y: shell.scrollTop };
    return;
  }

  if (event.button === 1 || state.spacePan || state.mobilePan) {
    interaction.mode = "pan";
    interaction.startScroll = { x: shell.scrollLeft, y: shell.scrollTop };
    shell.classList.add("is-panning");
    return;
  }

  if (isPlaceTool() && stampTemplate()) {
    interaction.mode = "shape";
    const points = [{ x: startScene.x, y: startScene.y }];
    state.shapeStroke = {
      tool: state.tool,
      start: startScene,
      end: startScene,
      points,
      transform,
      aligned: !!event.shiftKey,
    };
    updateToolHint();
    syncShapeOverlay();
    renderBuilding();
    return;
  }

  if (state.tool === "paint") {
    interaction.mode = "idle";
    return;
  }

  const hit = hitRecord(startScene.x, startScene.y, { solid: true, includeLocked: true });
  const operation = event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "add" : "replace";
  if (hit >= 0) {
    clearBrushHighlight();
    if (operation !== "replace") {
      const selected = new Set(baseSelection);
      if (operation === "toggle") {
        if (selected.has(hit)) selected.delete(hit);
        else selected.add(hit);
      } else selected.add(hit);
      setSelection([...selected]);
      interaction.mode = "select";
    } else {
      if (!baseSelection.includes(hit)) setSelection([hit], { expandGroup: true });
      const movable = state.selected.filter((index) => !state.records[index]?.locked);
      interaction.mode = beginRecordDrag(startScene.x, startScene.y, movable, transform) ? "move" : "select";
    }
    updateSelectionCaption();
    renderBuilding();
    return;
  }

  if (operation === "replace" && pointInSelectionUnion(startScene.x, startScene.y)) {
    clearBrushHighlight();
    const movable = state.selected.filter((index) => !state.records[index]?.locked);
    interaction.mode = beginRecordDrag(startScene.x, startScene.y, movable, transform) ? "move" : "select";
    renderBuilding();
    return;
  }

  const pendingPlace = hasBrush() && operation === "replace";
  if (operation === "replace" && !pendingPlace) clearSelection({ layers: false });
  state.marquee = {
    cx0: event.clientX,
    cy0: event.clientY,
    cx1: event.clientX,
    cy1: event.clientY,
    startScene,
    endScene: startScene,
    transform,
    index: buildRecordSpatialIndex(),
    operation,
    mode: currentMarqueeMode(),
    baseSelection,
    pendingPlace,
  };
  interaction.mode = "marquee";
  syncMarqueeOverlay();
}

function moveCanvasPointer(event, shell) {
  if (event.pointerType === "touch" && state.activePointers.has(event.pointerId)) {
    event.preventDefault();
    state.activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (state.pointerGesture?.type === "pinch" && state.activePointers.size >= 2) {
      const [a, b] = [...state.activePointers.values()];
      const distance = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      setZoom(state.pointerGesture.zoom * distance / state.pointerGesture.distance, midX, midY);
      shell.scrollLeft -= (midX - state.pointerGesture.midX);
      shell.scrollTop -= (midY - state.pointerGesture.midY);
      state.pointerGesture.midX = midX;
      state.pointerGesture.midY = midY;
      syncViewportOverlays();
      return;
    }
    if (state.pointerGesture) return;
    const pending = state.pointerPending;
    if (pending && pending.id === event.pointerId && !state.interaction) {
      const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (moved >= 12) {
        clearTimeout(pending.timer);
        pending.event.clientX = event.clientX;
        pending.event.clientY = event.clientY;
        state.pointerPending = null;
        state._touchArmed = true;
        beginCanvasPointer(pending.event, shell);
        state._touchArmed = false;
      }
    }
  }
  const interaction = state.interaction;
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  if (interaction.mode === "pan") {
    shell.scrollLeft = interaction.startScroll.x - (event.clientX - interaction.startClient.x);
    shell.scrollTop = interaction.startScroll.y - (event.clientY - interaction.startClient.y);
    syncViewportOverlays();
    return;
  }
  if (interaction.mode === "right") {
    const dx = event.clientX - interaction.startClient.x;
    const dy = event.clientY - interaction.startClient.y;
    if (Math.hypot(dx, dy) >= 5) {
      interaction.mode = "pan";
      interaction.fromRight = true;
      shell.classList.add("is-panning");
      hideContextMenu();
      shell.scrollLeft = interaction.startScroll.x - dx;
      shell.scrollTop = interaction.startScroll.y - dy;
      syncViewportOverlays();
    }
    return;
  }
  if (interaction.mode === "marquee") {
    updateMarqueePointer(event.clientX, event.clientY);
    return;
  }
  if (interaction.mode === "shape" && state.shapeStroke) {
    state.shapeStroke.aligned = !!event.shiftKey;
    const point = interaction.transform.clientToScene(event.clientX, event.clientY);
    if (isStampLike(state.shapeStroke.tool)) {
      const last = state.shapeStroke.points[state.shapeStroke.points.length - 1] || state.shapeStroke.start;
      const pitch = stampPitch(false);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= Math.min(pitch.x, pitch.y)) {
        if (state.shapeStroke.points.length < STAMP_CAP) state.shapeStroke.points.push(point);
      }
      state.shapeStroke.end = point;
    } else {
      state.shapeStroke.end = currentShapeEnd(event) || state.shapeStroke.end;
    }
    updateToolHint();
    syncShapeOverlay();
    renderBuilding();
    return;
  }
  if (interaction.mode === "move" && state.dragging) {
    const point = interaction.transform.clientToScene(event.clientX, event.clientY);
    applyDragPositions(point.x, point.y, event);
    renderBuilding();
  }
}

function finishCanvasPointer(event, shell, cancelled = false) {
  if (event.pointerType === "touch" && state.activePointers.has(event.pointerId)) {
    if (state.pointerGesture) {
      state.activePointers.delete(event.pointerId);
      state.pointerGesture = state.activePointers.size ? { type: "pinch-tail" } : null;
      if (!state.activePointers.size) shell.classList.remove("is-panning");
      return;
    }
    const pending = state.pointerPending;
    if (pending?.id === event.pointerId) {
      clearTimeout(pending.timer);
      state.pointerPending = null;
      if (!cancelled && !state.interaction) {
        pending.event.clientX = event.clientX;
        pending.event.clientY = event.clientY;
        state._touchArmed = true;
        beginCanvasPointer(pending.event, shell);
        state._touchArmed = false;
      }
    }
    state.activePointers.delete(event.pointerId);
  }
  const interaction = state.interaction;
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  try {
    if (shell.hasPointerCapture?.(event.pointerId)) shell.releasePointerCapture(event.pointerId);
  } catch {
    /* synthetic or inactive pointer */
  }
  shell.classList.remove("is-panning");
  if (cancelled) {
    cancelCanvasInteraction();
    return;
  }
  if (interaction.mode === "right") {
    const client = interaction.startClient;
    const scene = interaction.startScene;
    state.interaction = null;
    openCanvasContextMenu(client, scene);
    return;
  }
  if (interaction.mode === "marquee") {
    if (marqueeMoved(state.marquee)) clearBrushHighlight();
    finishMarquee();
  } else if (interaction.mode === "shape") {
    const stroke = state.shapeStroke;
    state.shapeStroke = null;
    syncShapeOverlay();
    if (stroke) placeStampBatch(shapeStampPoints(stroke), stroke.tool);
  } else if (interaction.mode === "move") {
    commitRecordDrag();
  }
  state.interaction = null;
  fillLayers();
  renderBuilding();
}

function applyCustomsData(data) {
  if (Array.isArray(data)) {
    state.customs = data;
    state.customFolders = [];
  } else {
    state.customs = Array.isArray(data?.items) ? data.items : [];
    state.customFolders = Array.isArray(data?.folders)
      ? data.folders.map((folder) => String(folder || "").trim()).filter(Boolean)
      : [];
  }
  if (!Array.isArray(state.customs)) state.customs = [];
}

function loadCustoms() {
  try {
    const raw = localStorage.getItem(CUSTOMS_KEY);
    applyCustomsData(raw ? JSON.parse(raw) : []);
  } catch {
    state.customs = [];
    state.customFolders = [];
  }
}

function saveCustoms() {
  const customs = {
    items: state.customs,
    folders: customFolders(),
  };
  localStorage.setItem(CUSTOMS_KEY, JSON.stringify(customs));
  putBuildingSaves({ customs }, true).catch((error) => console.warn(error));
}

function customFolders() {
  const folders = new Set(state.customFolders || []);
  state.customs.forEach((item) => {
    if (item.folder) folders.add(item.folder);
  });
  return [...folders].sort((a, b) => a.localeCompare(b, "zh"));
}

function ensureCustomFolder(name) {
  const folder = String(name || "").trim();
  if (!folder) return "";
  if (!(state.customFolders || []).includes(folder)) {
    state.customFolders = [...(state.customFolders || []), folder];
    saveCustoms();
  }
  return folder;
}

function refreshFolderSuggestions() {
  const list = document.getElementById("folderSuggestions");
  if (list) {
    list.innerHTML = "";
    customFolders().forEach((folder) => {
      const option = document.createElement("option");
      option.value = folder;
      list.appendChild(option);
    });
  }
  const filter = document.getElementById("customFolderFilter");
  if (!filter) return;
  const current = filter.value;
  const next = [
    ["", "全部分组"],
    [UNGROUPED_FOLDER, "未分组"],
    ...customFolders().map((folder) => [folder, folder]),
  ];
  const same =
    filter.options.length === next.length &&
    [...filter.options].every((option, index) => option.value === next[index][0] && option.textContent === next[index][1]);
  if (!same) {
    filter.innerHTML = "";
    next.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      filter.appendChild(option);
    });
    if ([...filter.options].some((option) => option.value === current)) filter.value = current;
  }
  syncFolderPickerUi();
}

let folderPickerAnchor = "";

function folderPickerMenu() {
  let menu = document.getElementById("customFolderMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "customFolderMenu";
  menu.className = "folder-picker-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "组件分组");
  document.body.appendChild(menu);
  return menu;
}

function folderFilterLabel(value) {
  if (value === UNGROUPED_FOLDER) return "未分组";
  return value || "全部分组";
}

function syncFolderPickerUi() {
  const filter = document.getElementById("customFolderFilter");
  const label = document.getElementById("customFolderFilterLabel");
  const btn = document.getElementById("customFolderFilterBtn");
  if (!filter) return;
  const text = folderFilterLabel(filter.value);
  if (label) label.textContent = text;
  if (btn) {
    btn.title = text;
    const menu = document.getElementById("customFolderMenu");
    btn.setAttribute("aria-expanded", menu && !menu.hidden ? "true" : "false");
  }
}

function folderPickerTriggerRect() {
  const btn = document.getElementById("customFolderFilterBtn");
  if (!btn) return "";
  const rect = btn.getBoundingClientRect();
  return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
}

function closeFolderPicker() {
  const menu = document.getElementById("customFolderMenu");
  if (menu) menu.hidden = true;
  const btn = document.getElementById("customFolderFilterBtn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function closeFolderPickerIfMoved() {
  const menu = document.getElementById("customFolderMenu");
  if (!menu || menu.hidden) return;
  if (folderPickerTriggerRect() === folderPickerAnchor) return;
  closeFolderPicker();
}

function fillFolderMenu() {
  const filter = document.getElementById("customFolderFilter");
  const menu = folderPickerMenu();
  if (!filter) return;
  const current = filter.value;
  menu.innerHTML = "";
  [...filter.options].forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", option.value === current ? "true" : "false");
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.onclick = () => {
      filter.value = option.value;
      closeFolderPicker();
      fillCustoms();
    };
    menu.appendChild(item);
  });
}

function openFolderPicker() {
  const btn = document.getElementById("customFolderFilterBtn");
  const menu = folderPickerMenu();
  if (!btn) return;
  fillFolderMenu();
  menu.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  const rect = btn.getBoundingClientRect();
  const width = Math.max(rect.width, 148);
  let left = rect.left;
  let top = rect.bottom + 4;
  const maxLeft = window.innerWidth - width - 8;
  if (left > maxLeft) left = Math.max(8, maxLeft);
  if (top + 240 > window.innerHeight - 8) top = Math.max(8, rect.top - 4 - Math.min(240, menu.scrollHeight || 240));
  menu.style.width = `${Math.round(width)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  folderPickerAnchor = folderPickerTriggerRect();
}

function toggleFolderPicker() {
  const menu = document.getElementById("customFolderMenu");
  if (menu && !menu.hidden) closeFolderPicker();
  else openFolderPicker();
}

function fillCustoms() {
  refreshFolderSuggestions();
  const list = document.getElementById("customList");
  if (!list) return;
  list.innerHTML = "";
  const folder = document.getElementById("customFolderFilter")?.value || "";
  const query = (document.getElementById("customSearch")?.value || "").trim().toLowerCase();
  const items = state.customs.filter((item) => {
    const inFolder =
      folder === UNGROUPED_FOLDER
        ? !item.folder
        : !folder || item.folder === folder;
    return inFolder && (!query || `${item.name} ${item.folder || ""}`.toLowerCase().includes(query));
  });
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "custom-hint";
    empty.textContent =
      folder === UNGROUPED_FOLDER
        ? "没有未分组的组件。"
        : folder
          ? `「${folder}」里还没有组件。选中画布素材后点 ★ 存为组件。`
          : "还没有自定义组件。选中画布素材后点 ★ 存为组件。";
    list.appendChild(empty);
    return;
  }
  items.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "custom-card" + (state.customBrush?.id === item.id ? " on" : "");
      card.title = "按住拖到画布放置，或点击选用";
      const thumb = buildCustomThumb(item);
      const body = document.createElement("div");
      body.className = "custom-card-body";
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
      del.onclick = async (event) => {
        event.stopPropagation();
        const ok = await appConfirm(`删除自定义组件「${item.name}」？`, {
          title: "删除组件",
          okLabel: "删除",
          danger: true,
        });
        if (!ok) return;
        state.customs = state.customs.filter((row) => row.id !== item.id);
        if (state.customBrush?.id === item.id) state.customBrush = null;
        saveCustoms();
        fillCategories();
        fillCustoms();
        updateSelectionCaption();
        renderBuilding();
      };
      card.append(thumb, body, del);
      const selectCustom = () => {
        state.customBrush = item;
        state.component = null;
        state.brushState = 0;
        state.selected = [];
        armPaintBrush();
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
        if (window.MobileWorkspace?.modeForViewport().mobile) closeBuildingRail();
      };
      list.appendChild(card);
    });
}

async function openPresetDialog() {
  const indices = state.selected.filter((index) => state.records[index]);
  if (!indices.length) {
    await appAlert("请先选择要保存的组件。");
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
  if (folder) ensureCustomFolder(folder);
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
  state.category = CUSTOM_CATEGORY;
  setRailTab("assets");
  fillCategories();
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

async function renameLayer(index) {
  const record = state.records[index];
  if (!record) return;
  const component = record.component || componentByUid(record.mat, record.pack || state.pack);
  const current = layerLabel(record, component);
  const next = await appPrompt("给这个图层起个好认的名字。", {
    title: "图层名称",
    value: current,
  });
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

function paintCompositeItems(sheet, items, size) {
  if (!items.length) return;
  const left = Math.min(...items.map((item) => item.box.x));
  const top = Math.min(...items.map((item) => item.box.y));
  const right = Math.max(...items.map((item) => item.box.x + item.width));
  const bottom = Math.max(...items.map((item) => item.box.y + item.height));
  const worldW = Math.max(1, right - left);
  const worldH = Math.max(1, bottom - top);
  const pad = size >= 48 ? 4 : 0;
  const inner = size - pad * 2;
  const scale = Math.min(inner / worldW, inner / worldH);
  const offsetX = pad + (inner - worldW * scale) / 2;
  const offsetY = pad + (inner - worldH * scale) / 2;
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
}

function buildCustomThumb(item) {
  const size = 64;
  const sheet = document.createElement("canvas");
  sheet.className = "custom-card-thumb";
  sheet.width = size;
  sheet.height = size;
  sheet.setAttribute("aria-hidden", "true");
  const items = [];
  (item?.records || []).slice(0, 24).forEach((row) => {
    const pack = packByKey(row.packKey) || row.pack || state.pack;
    const component = row.component || componentByUid(row.mat, pack);
    if (!component) return;
    const face = row.state ?? row.flip ?? 0;
    const geometry = frameGeometry(component, face);
    const url = spriteUrl(component, pack, face, true);
    const image = url ? loadImage(url) : null;
    items.push({
      box: {
        x: Number(row.dx ?? row.x) || 0,
        y: Number(row.dy ?? row.y) || 0,
      },
      width: Math.max(8, geometry.width || 24),
      height: Math.max(8, geometry.height || 24),
      image,
      hidden: false,
    });
  });
  paintCompositeItems(sheet, items, size);
  return sheet;
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
  paintCompositeItems(sheet, items, size);
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
  bindLayerContextMenu(row, memberIndices);
  row.ondblclick = async (event) => {
    event.stopPropagation();
    const next = await appPrompt("给这个组起个名字。", {
      title: "组名称",
      value: groupName,
    });
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
  bindLayerContextMenu(row, [index]);
  row.ondblclick = (event) => {
    if (event.target.closest("button")) return;
    event.stopPropagation();
    renameLayer(index);
  };
  list.appendChild(row);
  return true;
}

function bindLayerContextMenu(row, indices) {
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!indices.length) return;
    if (!indices.every((index) => state.selected.includes(index))) {
      setSelection(indices);
    }
    const record = state.records[indices[0]];
    const box = record ? recordBox(record) : { x: 0, y: 0, width: 0, height: 0 };
    openCanvasContextMenu(
      { x: event.clientX, y: event.clientY },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
  });
}

function collectLayerItems(selectedSet, filterText) {
  const items = [];
  const shownGroups = new Set();
  const forceGroupChildren = new Map();
  for (let index = state.records.length - 1; index >= 0; index--) {
    if (state.layerSelectedOnly && !selectedSet.has(index)) continue;
    const record = state.records[index];
    if (Number(record.mat) === 0 || isNativeDeskHiddenComponent(recordComponent(record))) continue;
    const groupId = record.group || null;
    if (groupId) {
      if (!shownGroups.has(groupId)) {
        shownGroups.add(groupId);
        const members = groupMemberIndices(groupId).filter(
          (memberIndex) => !state.layerSelectedOnly || selectedSet.has(memberIndex)
        );
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
  if (!state.records.length) {
    const empty = document.createElement("div");
    empty.className = "layer-empty";
    empty.textContent = "暂无图层，从「素材」里放置组件";
    list.replaceChildren(empty);
    return;
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "layer-empty";
    empty.textContent = filterText ? "没有匹配的图层" : "暂无图层";
    list.replaceChildren(empty);
    return;
  }

  const viewH = Math.max(1, list.clientHeight || 400);
  const maxScroll = Math.max(0, items.length * LAYER_ROW_H - viewH);
  const scrollTop = Math.min(list.scrollTop, maxScroll);
  if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
  const virtual = items.length > 60;
  let start = 0;
  let end = items.length;
  if (virtual) {
    start = Math.max(0, Math.floor(scrollTop / LAYER_ROW_H) - LAYER_WINDOW_PAD);
    end = Math.min(items.length, start + Math.ceil(viewH / LAYER_ROW_H) + LAYER_WINDOW_PAD * 2);
  }

  const fragment = document.createDocumentFragment();
  if (virtual) {
    const topPad = document.createElement("div");
    topPad.className = "layer-pad";
    topPad.style.height = `${start * LAYER_ROW_H}px`;
    fragment.appendChild(topPad);
  }
  for (let i = start; i < end; i++) {
    const item = items[i];
    if (item.kind === "group") {
      appendGroupHeader(fragment, item.groupId, item.members, selectedSet, item.filterText);
    } else {
      appendLayerRow(fragment, item.index, selectedSet, item.filterText, item.asChild);
    }
  }
  if (virtual) {
    const botPad = document.createElement("div");
    botPad.className = "layer-pad";
    botPad.style.height = `${(items.length - end) * LAYER_ROW_H}px`;
    fragment.appendChild(botPad);
  }
  list.replaceChildren(fragment);
  if (virtual) list.scrollTop = scrollTop;
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
  const selectedSet = new Set(state.selected);
  const filterText = (state.layerFilter || "").trim().toLowerCase();
  layerItemsCache = state.records.length ? collectLayerItems(selectedSet, filterText) : [];
  if (state.railTab !== "layers") return;
  bindLayerListScroll();
  if (state.selected.length && !state.dragging && !state.marquee) {
    const focus = state.selected[state.selected.length - 1];
    const focusGroup = state.records[focus]?.group;
    let itemIndex = layerItemsCache.findIndex((item) => item.kind === "row" && item.index === focus);
    if (itemIndex < 0 && focusGroup) {
      itemIndex = layerItemsCache.findIndex(
        (item) => item.kind === "group" && item.groupId === focusGroup
      );
    }
    if (itemIndex >= 0) {
      const top = itemIndex * LAYER_ROW_H;
      if (top < list.scrollTop || top + LAYER_ROW_H > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - Math.floor((list.clientHeight || 0) / 3));
      }
    }
  }
  paintLayerWindow();
}

function selectAllRecords() {
  setSelection(
    state.records.map((_, index) => index).filter((index) => isSelectableRecord(state.records[index]))
  );
  renderBuilding();
}

function focusSelection() {
  const bounds = unionBox(selectionHitBoxes(state.selected));
  const shell = document.getElementById("canvasShell");
  if (!bounds || !shell) return;
  const { w: sw, h: sh } = shellViewSize();
  const fit = houseFitScale(sw, sh);
  const next = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.min(sw / (bounds.width * fit), sh / (bounds.height * fit)) * 0.72)
  );
  setZoom(next);
  requestAnimationFrame(() => {
    const transform = viewportTransform();
    const center = transform.sceneToClient((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
    const shellRect = shell.getBoundingClientRect();
    shell.scrollLeft += center.x - shellRect.left - shell.clientWidth / 2;
    shell.scrollTop += center.y - shellRect.top - shell.clientHeight / 2;
    syncViewportOverlays();
  });
}

function zoomActualSize() {
  const { w: sw, h: sh } = shellViewSize();
  const fit = houseFitScale(sw, sh);
  setZoom(fit > 0.001 ? 1 / fit : 1);
}

function setActiveTool(tool) {
  const next = PLACE_TOOLS.has(tool) || tool === "select" ? tool : "select";
  state.tool = next;
  if (!isPlaceTool()) state.shapeStroke = null;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle("on", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const shell = document.getElementById("canvasShell");
  if (shell) shell.dataset.tool = state.tool;
  const toolButton = document.getElementById("btnBuildingMobileTools");
  if (toolButton) {
    const label = toolButton.querySelector("span:last-child");
    const activeName = document.querySelector(`#canvasToolrail [data-tool="${state.tool}"] .tool-name`);
    if (label && activeName) label.textContent = activeName.textContent;
  }
  updateToolHint();
  syncShapeOverlay();
}

const COMMANDS = [
  { id: "selectTool", label: "选择工具", shortcut: "V", run: () => setActiveTool("select") },
  { id: "paintTool", label: "纯笔刷", shortcut: "N", run: () => setActiveTool("paint") },
  { id: "stampTool", label: "点刷铺放", shortcut: "B", run: () => setActiveTool("stamp") },
  { id: "tileTool", label: "平铺铺放", shortcut: "T", run: () => setActiveTool("tile") },
  { id: "rectTool", label: "矩形铺放", shortcut: "U", run: () => setActiveTool("rect") },
  { id: "lineTool", label: "直线 / 斜线铺放", shortcut: "L", run: () => setActiveTool("line") },
  { id: "circleTool", label: "圆形铺放", shortcut: "O", run: () => setActiveTool("circle") },
  { id: "triangleTool", label: "三角形铺放", shortcut: "I", run: () => setActiveTool("triangle") },
  { id: "diamondTool", label: "菱形铺放", shortcut: "C", run: () => setActiveTool("diamond") },
  { id: "ringTool", label: "一圈描边", shortcut: "G", run: () => setActiveTool("ring") },
  { id: "undo", label: "撤销", shortcut: "Ctrl+Z", run: undo },
  { id: "redo", label: "重做", shortcut: "Ctrl+Y / Ctrl+Shift+Z", run: redo },
  { id: "selectAll", label: "全选素材", shortcut: "Ctrl+A", run: selectAllRecords },
  { id: "clearSelection", label: "清除选择", shortcut: "Ctrl+Shift+A", run: () => { clearSelection(); renderBuilding(); } },
  { id: "duplicate", label: "复制选中", shortcut: "Ctrl+D", run: duplicateSelected },
  { id: "delete", label: "删除选中", shortcut: "Delete / Backspace", run: deleteSelected },
  { id: "flip", label: "转向", shortcut: "R", run: flipSelectedOrBrush },
  { id: "lock", label: "锁定/解锁", shortcut: "Ctrl+L", run: toggleLockSelected },
  { id: "group", label: "成组", shortcut: "Ctrl+G", run: groupSelected },
  { id: "ungroup", label: "拆组", shortcut: "Ctrl+Shift+G", run: ungroupSelected },
  { id: "savePreset", label: "存为组件", shortcut: "P", run: openPresetDialog },
  { id: "bottom", label: "到底层", shortcut: "A", run: () => reorderSelected("bottom") },
  { id: "down", label: "下移一层", shortcut: "S", run: () => reorderSelected("down") },
  { id: "up", label: "上移一层", shortcut: "W", run: () => reorderSelected("up") },
  { id: "top", label: "到顶层", shortcut: "D", run: () => reorderSelected("top") },
  { id: "layerBack", label: "图层向后循环", shortcut: "Z", run: () => stepLayerOrder(-1) },
  { id: "layerFront", label: "图层向前循环", shortcut: "X", run: () => stepLayerOrder(1) },
  { id: "facingPrev", label: "上一朝向", shortcut: "Q", run: () => stepFacing(-1) },
  { id: "facingNext", label: "下一朝向", shortcut: "E", run: () => stepFacing(1) },
  { id: "alignLeft", label: "左对齐", shortcut: "Alt+←", run: () => alignSelection("left") },
  { id: "alignCenterX", label: "水平居中", shortcut: "Alt+H", run: () => alignSelection("centerX") },
  { id: "alignRight", label: "右对齐", shortcut: "Alt+→", run: () => alignSelection("right") },
  { id: "alignTop", label: "顶对齐", shortcut: "Alt+↑", run: () => alignSelection("top") },
  { id: "alignCenterY", label: "垂直居中", shortcut: "Alt+V", run: () => alignSelection("centerY") },
  { id: "alignBottom", label: "底对齐", shortcut: "Alt+↓", run: () => alignSelection("bottom") },
  { id: "distributeX", label: "水平分布", shortcut: "Alt+Shift+H", run: () => alignSelection("distributeX") },
  { id: "distributeY", label: "垂直分布", shortcut: "Alt+Shift+V", run: () => alignSelection("distributeY") },
  { id: "focus", label: "聚焦选中", shortcut: "F", run: focusSelection },
  { id: "fit", label: "适应画布", shortcut: "0", run: () => setZoom(1) },
  { id: "actual", label: "画布 100%", shortcut: "1", run: zoomActualSize },
  { id: "marqueeTouch", label: "圈选：碰到就选", shortcut: "M", run: () => setMarqueeMode("touch") },
  { id: "marqueeContain", label: "圈选：完整包含", shortcut: "Shift+M", run: () => setMarqueeMode("contain") },
  { id: "zoomIn", label: "放大", shortcut: "+", run: () => zoomBy(ZOOM_STEP) },
  { id: "zoomOut", label: "缩小", shortcut: "-", run: () => zoomBy(-ZOOM_STEP) },
  { id: "copy", label: "复制到剪贴工作集", shortcut: "Ctrl+C", run: copySelected },
  { id: "paste", label: "粘贴工作集", shortcut: "Ctrl+V", run: pasteClipboard },
  { id: "batchPreview", label: "打开图纸库", shortcut: "", run: () => togglePaperLibrary() },
];
const SHORTCUT_NOTES = [
  { label: "选中素材微移", shortcut: "方向键" },
  { label: "大步微移", shortcut: "Shift+方向键" },
  { label: "右键拖：平移画布；单击：菜单", shortcut: "右键" },
  { label: "按住平移画布", shortcut: "Space / 中键" },
  { label: "圈选碰到 / 完整包含", shortcut: "M / Shift+M" },
  { label: "点刷 / 平铺 / 矩形 / 直线", shortcut: "B / T / U / L" },
  { label: "圆 / 三角 / 菱形 / 描边", shortcut: "O / I / C / G" },
  { label: "到底 / 下移 / 上移 / 到顶", shortcut: "A / S / W / D" },
  { label: "图层循环（四层）", shortcut: "Z / X" },
  { label: "朝向上一 / 下一", shortcut: "Q / E" },
  { label: "转向", shortcut: "R" },
  { label: "画笔 Shift 约束（齐缝 / 正形 / 45°）", shortcut: "按住 Shift" },
  { label: "命令面板", shortcut: "Ctrl+K" },
  { label: "快捷键帮助", shortcut: "?" },
];
const COMMAND_INDEX = new Map(COMMANDS.map((command) => [command.id, command]));

function executeCommand(id) {
  const command = COMMAND_INDEX.get(id === "break" ? "ungroup" : id);
  if (command) command.run();
}

function tipText(label, shortcut) {
  return shortcut ? `${label}  ${shortcut}` : label;
}

function applyHoverTip(element, label, shortcut) {
  if (!element) return;
  element.dataset.tip = label;
  if (shortcut) element.dataset.tipKeys = shortcut;
  else delete element.dataset.tipKeys;
  element.setAttribute("aria-label", tipText(label, shortcut));
  element.removeAttribute("title");
}

function clearHoverTip(element) {
  if (!element) return;
  delete element.dataset.tip;
  delete element.dataset.tipKeys;
  element.removeAttribute("title");
}

function applyCommandTooltips() {
  document.querySelectorAll("[data-command]").forEach((button) => {
    const command = COMMAND_INDEX.get(button.dataset.command);
    if (command) applyHoverTip(button, command.label, command.shortcut);
  });
  document.querySelectorAll("[data-align]").forEach((button) => {
    const command = COMMAND_INDEX.get(
      button.dataset.align === "distributeX" ? "distributeX"
      : button.dataset.align === "distributeY" ? "distributeY"
      : `align${button.dataset.align[0].toUpperCase()}${button.dataset.align.slice(1)}`
    );
    if (command) applyHoverTip(button, command.label, command.shortcut);
  });
  applyHoverTip(document.getElementById("btnFacingPrev"), "上一朝向", "Q");
  applyHoverTip(document.getElementById("btnFacingNext"), "下一朝向", "E");
  applyHoverTip(document.getElementById("btnLayerBack"), "图层向后循环", "Z");
  applyHoverTip(document.getElementById("btnLayerFront"), "图层向前循环", "X");
  document.querySelectorAll(".facing-cap").forEach((cap) => {
    const layer = cap.closest("#layerOrderControl");
    applyHoverTip(cap, layer ? "图层循环" : "朝向", layer ? "Z / X" : "Q / E");
  });
  applyHoverTip(document.getElementById("commandHudGrip"), "拖动命令栏", "双击复位");
  applyHoverTip(document.getElementById("toolHudGrip"), "拖动画布工具", "双击复位");
  applyHoverTip(document.getElementById("btnZoomIn"), "放大", "+");
  applyHoverTip(document.getElementById("btnZoomOut"), "缩小", "-");
  applyHoverTip(document.getElementById("btnZoomReset"), "适应画布", "0");
  applyHoverTip(document.getElementById("facingLabel"), "朝向", "Q / E");
  applyHoverTip(document.getElementById("layerOrderLabel"), "图层循环", "Z / X");
  applyHoverTip(document.getElementById("snapAxis"), "吸附轴向", "水平 / 斜角 / 双轴");
  applyHoverTip(document.getElementById("btnCommandPalette"), "命令面板", "Ctrl+K");
  applyHoverTip(document.getElementById("btnShortcuts"), "快捷键帮助", "?");
  document.querySelectorAll("#canvasToolrail .tool-item").forEach(clearHoverTip);
}

function wireHoverTips() {
  if (document.getElementById("shortcutTip")) return;
  const pop = document.createElement("div");
  pop.id = "shortcutTip";
  pop.className = "shortcut-tip";
  pop.hidden = true;
  const caret = document.createElement("i");
  caret.className = "shortcut-tip-caret";
  const body = document.createElement("span");
  body.className = "shortcut-tip-body";
  pop.append(caret, body);
  document.body.appendChild(pop);
  let hideTimer = 0;
  let current = null;
  const hide = () => {
    current = null;
    pop.hidden = true;
  };
  const place = (el) => {
    const margin = 8;
    const gap = 7;
    const rect = el.getBoundingClientRect();
    const tipW = pop.offsetWidth;
    const tipH = pop.offsetHeight;
    if (!tipW || !tipH) return;
    const anchorX = rect.left + rect.width / 2;
    let left = anchorX - tipW / 2;
    let top = rect.bottom + gap;
    let above = false;
    if (top + tipH > window.innerHeight - margin && rect.top - gap - tipH >= margin) {
      top = rect.top - gap - tipH;
      above = true;
    }
    left = Math.min(window.innerWidth - tipW - margin, Math.max(margin, left));
    top = Math.min(window.innerHeight - tipH - margin, Math.max(margin, top));
    pop.classList.toggle("is-above", above);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    caret.style.left = `${Math.round(Math.min(tipW - 12, Math.max(12, anchorX - left)))}px`;
  };
  const fill = (el) => {
    const label = el.dataset.tip;
    if (!label) return false;
    body.replaceChildren();
    const lab = document.createElement("span");
    lab.className = "shortcut-tip-label";
    lab.textContent = label;
    body.append(lab);
    if (el.dataset.tipKeys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = el.dataset.tipKeys;
      body.append(kbd);
    }
    return true;
  };
  const showFor = (el) => {
    if (!el) return;
    clearTimeout(hideTimer);
    const same = current === el && !pop.hidden;
    current = el;
    if (!same && !fill(el)) {
      hide();
      return;
    }
    pop.hidden = false;
    place(el);
    requestAnimationFrame(() => {
      if (current === el && !pop.hidden) place(el);
    });
  };
  document.addEventListener("pointerover", (event) => {
    const el = event.target?.closest?.("[data-tip]");
    if (!el) return;
    if (el.closest("#canvasToolrail") && !el.classList.contains("hud-drag-grip")) return;
    showFor(el);
  });
  document.addEventListener("pointerout", (event) => {
    const el = event.target?.closest?.("[data-tip]");
    if (!el) return;
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (next?.closest?.("[data-tip]")) return;
    hideTimer = window.setTimeout(hide, 60);
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}

let ctxMenuScene = null;

function hideContextMenu() {
  const menu = document.getElementById("ctxMenu");
  if (!menu || menu.hidden) return false;
  menu.hidden = true;
  menu.replaceChildren();
  ctxMenuScene = null;
  return true;
}

function ensureCtxMenu() {
  let menu = document.getElementById("ctxMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "ctxMenu";
  menu.className = "ctx-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  return menu;
}

function addCtxItem(menu, spec) {
  if (spec === "sep" || spec.type === "sep") {
    const sep = document.createElement("div");
    sep.className = "ctx-sep";
    menu.append(sep);
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ctx-item" + (spec.danger ? " danger" : "");
  button.setAttribute("role", "menuitem");
  button.disabled = !!spec.disabled;
  const label = document.createElement("span");
  label.textContent = spec.label;
  button.append(label);
  if (spec.shortcut) {
    const kbd = document.createElement("kbd");
    kbd.textContent = spec.shortcut;
    button.append(kbd);
  }
  button.onclick = () => {
    const run = spec.run;
    hideContextMenu();
    run?.();
  };
  menu.append(button);
}

function openCanvasContextMenu(client, scene) {
  ctxMenuScene = scene;
  const hit = hitRecord(scene.x, scene.y, { solid: true, includeLocked: true });
  if (hit >= 0 && !state.selected.includes(hit)) {
    setSelection([hit], { expandGroup: true });
  }
  const selected = state.selected.filter((index) => state.records[index]);
  const unlocked = selectedUnlockedIndices();
  const grouped = selected.some((index) => state.records[index]?.group);
  const locked = selected.length && selected.every((index) => state.records[index].locked);
  const source = hit >= 0 ? state.records[hit] : selected.length === 1 ? state.records[selected[0]] : null;
  const items = [];
  if (hasBrush()) {
    items.push({ label: "取消选用", shortcut: "Esc", run: () => cancelPick() });
  }
  items.push({
    label: "粘贴到此处",
    shortcut: "Ctrl+V",
    disabled: !state.clipboard?.length,
    run: () => pasteClipboard(scene),
  });
  if (source && Number(source.mat)) {
    items.push({ label: "以此为笔刷", run: () => pickRecordAsBrush(source) });
  }
  if (selected.length) {
    items.push("sep");
    items.push({ label: "转向", shortcut: "R", disabled: !unlocked.length, run: () => executeCommand("flip") });
    items.push({ label: "上一朝向", shortcut: "Q", run: () => executeCommand("facingPrev") });
    items.push({ label: "下一朝向", shortcut: "E", run: () => executeCommand("facingNext") });
    items.push({ label: locked ? "解锁" : "锁定", shortcut: "Ctrl+L", run: () => executeCommand("lock") });
    items.push("sep");
    items.push({ label: "复制", shortcut: "Ctrl+C", run: () => executeCommand("copy") });
    items.push({ label: "再放一份", shortcut: "Ctrl+D", disabled: !unlocked.length, run: () => executeCommand("duplicate") });
    items.push({ label: "成组", shortcut: "Ctrl+G", disabled: unlocked.length < 2, run: () => executeCommand("group") });
    items.push({ label: "拆组", shortcut: "Ctrl+Shift+G", disabled: !grouped, run: () => executeCommand("ungroup") });
    items.push({ label: "存为组件", shortcut: "P", disabled: !unlocked.length, run: () => executeCommand("savePreset") });
    items.push("sep");
    items.push({ label: "下移一层", shortcut: "S", disabled: !unlocked.length, run: () => executeCommand("down") });
    items.push({ label: "上移一层", shortcut: "W", disabled: !unlocked.length, run: () => executeCommand("up") });
    items.push({ label: "到底层", shortcut: "A", disabled: !unlocked.length, run: () => executeCommand("bottom") });
    items.push({ label: "到顶层", shortcut: "D", disabled: !unlocked.length, run: () => executeCommand("top") });
    items.push({ label: "图层向后循环", shortcut: "Z", disabled: !unlocked.length, run: () => executeCommand("layerBack") });
    items.push({ label: "图层向前循环", shortcut: "X", disabled: !unlocked.length, run: () => executeCommand("layerFront") });
    items.push("sep");
    items.push({ label: "聚焦", shortcut: "F", run: () => executeCommand("focus") });
    items.push({ label: "删除", shortcut: "Delete", danger: true, disabled: !unlocked.length, run: () => executeCommand("delete") });
  } else {
    items.push("sep");
    items.push({ label: "选择工具", shortcut: "V", run: () => executeCommand("selectTool") });
    items.push({ label: "纯笔刷", shortcut: "N", run: () => executeCommand("paintTool") });
    items.push({ label: "适应画布", shortcut: "0", run: () => executeCommand("fit") });
  }

  const menu = ensureCtxMenu();
  menu.replaceChildren();
  items.forEach((spec) => addCtxItem(menu, spec));
  menu.hidden = false;
  const tip = document.getElementById("shortcutTip");
  if (tip) tip.hidden = true;
  const pad = 8;
  let left = client.x;
  let top = client.y;
  const rect = menu.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
  menu.style.left = `${Math.round(Math.max(pad, left))}px`;
  menu.style.top = `${Math.round(Math.max(pad, top))}px`;
}

function wireContextMenu() {
  if (wireContextMenu.done) return;
  wireContextMenu.done = true;
  const inCanvas = (event) => !!event.target?.closest?.("#canvasShell, #ctxMenu");
  const blockBrowserMenu = (event) => {
    if (event.type === "auxclick" && event.button !== 2) return;
    if (event.type === "mouseup" && event.button !== 2) return;
    if (!inCanvas(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("contextmenu", blockBrowserMenu, true);
  document.addEventListener("auxclick", blockBrowserMenu, true);
  document.addEventListener("mouseup", blockBrowserMenu, true);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button === 2 && inCanvas(event)) {
        event.preventDefault();
      }
      if (!event.target?.closest?.("#ctxMenu")) hideContextMenu();
    },
    true
  );
  window.addEventListener("blur", () => hideContextMenu());
}

function runLayerCommand(command) {
  executeCommand(command);
}

function setModalVisible(id, visible) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (visible) {
    closeBuildingRail();
    window.MobileWorkspace?.openLayer(modal, document.activeElement);
    const input = modal.querySelector("input");
    requestAnimationFrame(() => input?.focus());
  } else {
    window.MobileWorkspace?.closeLayer(modal);
  }
}

function fillCommandList() {
  const list = document.getElementById("commandList");
  const input = document.getElementById("commandSearch");
  if (!list) return;
  const query = (input?.value || "").trim().toLowerCase();
  list.replaceChildren();
  COMMANDS.filter((command) => !query || `${command.label} ${command.shortcut}`.toLowerCase().includes(query))
    .forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-row" + (index === 0 ? " on" : "");
      button.dataset.command = command.id;
      const label = document.createElement("span");
      label.textContent = command.label;
      const shortcut = document.createElement("kbd");
      shortcut.textContent = command.shortcut || "—";
      button.append(label, shortcut);
      button.onclick = () => {
        setModalVisible("dlgCommands", false);
        executeCommand(command.id);
      };
      list.appendChild(button);
    });
}

function fillShortcutHelp() {
  const grid = document.getElementById("shortcutGrid");
  if (!grid || grid.childElementCount) return;
  [...COMMANDS.filter((command) => command.shortcut), ...SHORTCUT_NOTES].forEach((command) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const label = document.createElement("span");
    label.textContent = command.label;
    const key = document.createElement("kbd");
    key.textContent = command.shortcut;
    row.append(label, key);
    grid.appendChild(row);
  });
}

function setMobileToolsOpen(open) {
  if (open) {
    state.mobilePan = false;
    syncMobilePanUi();
    setMobileToolFamily(state.tool === "select" ? "select" : "brush");
  }
  document.documentElement.classList.toggle("mobile-tools-open", !!open);
  const mobile = window.MobileWorkspace?.modeForViewport().mobile;
  if (mobile) {
    if (open && window.MobileWorkspace.activeSheet() !== "building-tools") {
      window.MobileWorkspace.openSheet("building-tools", {
        trigger: document.getElementById("btnBuildingMobileTools"),
        resetScroll: false,
      });
    } else if (!open && window.MobileWorkspace.activeSheet() === "building-tools") {
      window.MobileWorkspace.closeSheet("building-tools", { restoreFocus: false });
    }
  }
  const dock = document.getElementById("canvasToolDock");
  dock?.setAttribute("aria-hidden", String(mobile && !open));
  const button = document.getElementById("btnBuildingMobileTools");
  button?.classList.toggle("on", !!open);
  button?.setAttribute("aria-pressed", String(!!open));
  syncBuildingBackdrop();
}

function setMobileToolFamily(family) {
  state.mobileToolFamily = family === "brush" ? "brush" : "select";
  document.querySelectorAll("[data-mobile-tool-family]").forEach((button) => {
    const active = button.dataset.mobileToolFamily === state.mobileToolFamily;
    button.classList.toggle("on", active);
    button.setAttribute("aria-selected", String(active));
  });
  const dock = document.getElementById("canvasToolDock");
  if (dock) dock.dataset.mobileToolFamily = state.mobileToolFamily;
  const title = document.getElementById("buildingToolSheetTitle");
  if (title) title.textContent = state.mobileToolFamily === "brush" ? "工具 · 绘制" : "工具 · 选择";
}

function syncBuildingBackdrop() {
  const backdrop = document.getElementById("buildingRailBackdrop");
  if (!backdrop) return;
  const mobile = window.MobileWorkspace?.modeForViewport().mobile;
  if (!mobile) {
    backdrop.hidden = true;
    return;
  }
  const railOpen = !state.railCollapsed;
  const toolsOpen = document.documentElement.classList.contains("mobile-tools-open");
  backdrop.hidden = !(railOpen || toolsOpen);
}

function closeBuildingRail() {
  state.railCollapsed = true;
  applyRailState();
}

function openBuildingRail(mode = state.phase === "select" ? "base" : state.railTab || "assets") {
  setMobileToolsOpen(false);
  state.mobilePan = false;
  syncMobilePanUi();
  if (state.phase !== "design") mode = "base";
  if (!["base", "assets", "layers", "project"].includes(mode)) mode = "assets";
  state.mobileSheetMode = mode;
  if (mode === "assets" || mode === "layers") setRailTab(mode);
  state.railCollapsed = false;
  applyRailState();
  requestAnimationFrame(() => {
    const rail = document.querySelector(".building-rail");
    if (rail) rail.scrollTop = 0;
    if (mode === "assets") {
      const list = document.getElementById("componentList");
      if (list) list.scrollTop = 0;
      paintAssetWindow?.();
    }
    document.getElementById("btnBuildingSheetClose")?.focus({ preventScroll: true });
  });
}

function syncMobileBuildingPanels() {
  const mobile = !!window.MobileWorkspace?.modeForViewport().mobile;
  const base = document.getElementById("baseSelectSide");
  const material = document.getElementById("materialSide");
  const project = document.getElementById("buildingProjectPane");
  if (!mobile) {
    if (base) base.hidden = state.phase !== "select";
    if (material) material.hidden = state.phase !== "design";
    if (project) project.hidden = state.phase !== "design";
    return;
  }
  const mode = state.phase === "select" ? "base" : state.mobileSheetMode;
  if (base) base.hidden = mode !== "base";
  if (material) material.hidden = mode === "base" || mode === "project";
  if (project) project.hidden = mode !== "project";
}

function syncMobilePanUi() {
  const button = document.getElementById("btnBuildingMobilePan");
  button?.classList.toggle("on", state.mobilePan);
  button?.setAttribute("aria-pressed", String(state.mobilePan));
  document.getElementById("canvasShell")?.classList.toggle("mobile-pan-mode", state.mobilePan);
}

function syncBuildingRailAccessibility() {
  const mobile = window.MobileWorkspace?.modeForViewport().mobile;
  const rail = document.querySelector(".building-rail");
  const stage = document.querySelector(".building-stage");
  const open = mobile && !state.railCollapsed;
  if (open && window.MobileWorkspace?.activeSheet() !== "building-rail") {
    window.MobileWorkspace?.openSheet("building-rail", {
      trigger:
        state.mobileSheetMode === "project"
          ? document.getElementById("btnBuildingMobileProject")
          : document.getElementById("btnBuildingMobileAssets"),
      resetScroll: false,
    });
  } else if (!open && window.MobileWorkspace?.activeSheet() === "building-rail") {
    window.MobileWorkspace?.closeSheet("building-rail", { restoreFocus: false });
  }
  rail?.classList.toggle("open", open);
  window.MobileWorkspace?.setInert(rail, mobile && !open);
  window.MobileWorkspace?.setInert(stage, open);
  syncBuildingBackdrop();
  syncMobileBuildingPanels();
  syncMobileBuildingChrome();
  const assets = document.getElementById("btnBuildingMobileAssets");
  const project = document.getElementById("btnBuildingMobileProject");
  const mode = state.phase === "select" ? "base" : state.mobileSheetMode;
  assets?.setAttribute("aria-expanded", String(open && mode !== "project"));
  project?.setAttribute("aria-expanded", String(open && mode === "project"));
  assets?.classList.toggle("on", open && mode !== "project");
  project?.classList.toggle("on", open && mode === "project");
  if (open) setMobileToolsOpen(false);
}

function syncMobileBuildingChrome() {
  const label = document.getElementById("buildingMobileAssetsLabel");
  if (label) label.textContent = state.phase === "design" ? "素材" : "户型";
  const title = document.getElementById("buildingSheetTitle");
  if (!title) return;
  const mode = state.phase === "select" ? "base" : state.mobileSheetMode;
  title.textContent = mode === "base" ? "户型" : mode === "layers" ? "图层" : mode === "project" ? "项目" : "素材";
}

function applyRailState() {
  const app = document.getElementById("buildingApp");
  if (!app) return;
  state.railWidth = Math.max(300, Math.min(520, Number(state.railWidth) || 340));
  app.style.setProperty("--rail-w", `${state.railWidth}px`);
  app.classList.toggle("rail-collapsed", !!state.railCollapsed);
  const button = document.getElementById("btnToggleRail");
  if (button) button.textContent = state.railCollapsed ? "展开" : "侧栏";
  syncBuildingRailAccessibility();
  requestAnimationFrame(() => fitStageToShell());
}

function applyImportedPaperBase() {
  state.paperBaseHint = "";
  state.baseOverridden = false;
  if (state.base) {
    state.basePicked = true;
    return "keep";
  }
  return "paper";
}

async function parseBuildingFile(file) {
  const buffer = await file.arrayBuffer();
  const response = await fetch("/api/parse-building-desk", {
    method: "POST",
    body: buffer,
  });
  if (!response.ok) throw new Error("建筑图纸解析失败 (" + response.status + ")");
  return { buffer, documentData: await response.json() };
}

function showPaperPreviewPane(mode) {
  const current = document.getElementById("paperCurrentPreview");
  const batch = document.getElementById("paperBatchPreview");
  if (current) current.hidden = mode !== "current";
  if (batch) batch.hidden = mode !== "batch";
}

function openCurrentPaperPreview() {
  const target = document.getElementById("paperPreviewCanvas");
  if (!target) return;
  target.width = canvas.width;
  target.height = canvas.height;
  const previewCtx = target.getContext("2d");
  previewCtx.clearRect(0, 0, target.width, target.height);
  previewCtx.drawImage(canvas, 0, 0);
  const visible = state.records.filter(isCanvasRecord).length;
  const unresolved = state.records.filter(
    (record) => isCanvasRecord(record) && !recordComponent(record)
  ).length;
  const groups = new Set(state.records.map((record) => record.group).filter(Boolean)).size;
  const footprint = state.base?.put || state.base?.footprint;
  const footprintText = Array.isArray(footprint)
    ? footprint.join("×")
    : footprint || document.getElementById("buildingPut")?.textContent || "未知";
  const summary = document.getElementById("paperPreviewSummary");
  if (summary) {
    const report = buildingMaterialReport();
    const reasonText = [...report.unresolvedReasons]
      .slice(0, 4)
      .map(([reason, count]) => `· ${reason}：${count} 件`)
      .join("\n");
    summary.textContent =
      `户型：${state.base?.name || "当前户型"}\n` +
      `占地：${footprintText}\n` +
      `素材：${visible} 件\n` +
      `未解析：${unresolved} 件\n` +
      (reasonText ? `${reasonText}\n` : "") +
      `分组：${groups} 组\n` +
      `地基：${state.keepFoundation ? "保留" : "不保留"}\n\n` +
      "确认画面和遮挡关系后再下载。";
  }
  fillMaterialList(document.getElementById("paperPreviewMaterials"));
  showPaperPreviewPane("current");
  setModalVisible("dlgPaperPreview", true);
}

function saveCurrentPaperPreview() {
  const target = document.getElementById("paperPreviewCanvas");
  if (!target) return;
  target.toBlob((blob) => {
    if (!blob) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "building-preview.png";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  }, "image/png");
}

function previewPackForMat(mat) {
  if (mat >= 1000) return packForPaperUid(Math.floor(mat / 1000));
  return state.pack;
}

function loadPreviewImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function paintPaperThumbnail(target, documentData, options = {}) {
  const width = Math.max(80, Math.round(Number(options.width) || 240));
  const height = Math.max(60, Math.round(Number(options.height) || 180));
  target.width = width;
  target.height = height;
  const c = target.getContext("2d");
  c.fillStyle = "#315f39";
  c.fillRect(0, 0, width, height);
  c.fillStyle = "rgba(214, 233, 201, 0.22)";
  c.beginPath();
  c.moveTo(width / 2, 12);
  c.lineTo(width - 10, height / 2);
  c.lineTo(width / 2, height - 10);
  c.lineTo(10, height / 2);
  c.closePath();
  c.fill();

  const rows = (documentData.records || [])
    .filter((record) => Number(record.mat))
    .map((record) => {
      const mat = Number(record.mat) || 0;
      const pack = previewPackForMat(mat);
      const component = componentByUid(mat, pack);
      const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
      return {
        record,
        component,
        pack,
        width: geometry.width || 16,
        height: geometry.height || 16,
      };
    });
  if (!rows.length) {
    c.fillStyle = "#eef5ea";
    c.font = "12px sans-serif";
    c.textAlign = "center";
    c.fillText("没有可预览素材", width / 2, height / 2);
    return;
  }
  const left = Math.min(...rows.map((row) => Number(row.record.x) || 0));
  const top = Math.min(...rows.map((row) => Number(row.record.y) || 0));
  const right = Math.max(...rows.map((row) => (Number(row.record.x) || 0) + row.width));
  const bottom = Math.max(...rows.map((row) => (Number(row.record.y) || 0) + row.height));
  const scale = Math.min((width - 18) / Math.max(1, right - left), (height - 18) / Math.max(1, bottom - top), 1);
  const ox = (width - (right - left) * scale) / 2 - left * scale;
  const oy = (height - (bottom - top) * scale) / 2 - top * scale;
  const images = await Promise.all(
    rows.map((row) =>
      loadPreviewImage(spriteUrl(row.component, row.pack, row.record.state ?? row.record.flip ?? 0))
    )
  );
  rows.forEach((row, index) => {
    const x = ox + (Number(row.record.x) || 0) * scale;
    const y = oy + (Number(row.record.y) || 0) * scale;
    const image = images[index];
    if (image) c.drawImage(image, x, y, row.width * scale, row.height * scale);
    else {
      c.fillStyle = "#e7644d";
      c.fillRect(x, y, Math.max(3, 8 * scale), Math.max(3, 8 * scale));
    }
  });
}

const PAPER_INSPECT_MIN_ZOOM = 0.2;
const PAPER_INSPECT_MAX_ZOOM = 8;

const batchLibrary = {
  generation: 0,
  loading: false,
  folderLabel: "",
  query: "",
  entries: [],
  failed: 0,
};

const paperInspectView = {
  entry: null,
  bitmap: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  pointers: new Map(),
  pinch: null,
  resizeObserver: null,
};

function isPaperLibraryOpen() {
  const panel = document.getElementById("paperLibrary");
  return Boolean(panel && !panel.hidden);
}

function isPaperInspectOpen() {
  const panel = document.getElementById("paperInspect");
  return Boolean(panel && !panel.hidden);
}

function updateBatchPreviewButton() {
  const btn = document.getElementById("btnBatchPreview");
  if (!btn) return;
  const n = batchLibrary.entries.length;
  if (n) {
    btn.textContent = `图纸库 (${n})`;
    btn.title = "打开常驻图纸库（已缓存，不会重新解析）";
  } else if (batchLibrary.loading) {
    btn.textContent = "图纸库";
    btn.title = "图纸正在解析，打开可查看进度";
  } else {
    btn.textContent = "图纸库";
    btn.title = "打开常驻图纸库；第一次会选择本地文件夹";
  }
  btn.classList.toggle("on", isPaperLibraryOpen());
}

function syncPaperLibraryEmpty() {
  const empty = document.getElementById("paperLibraryEmpty");
  const grid = document.getElementById("paperPreviewGrid");
  const hasCards = batchLibrary.entries.length > 0 || batchLibrary.loading;
  if (empty) empty.hidden = hasCards;
  if (grid) grid.hidden = !batchLibrary.entries.length && !batchLibrary.loading;
}

function setPaperLibraryOpen(open) {
  const panel = document.getElementById("paperLibrary");
  if (!panel) return;
  if (!open) closePaperInspect();
  panel.hidden = !open;
  window.MobileWorkspace?.setInert(document.querySelector(".building-stage"), open);
  window.MobileWorkspace?.setInert(document.querySelector(".building-rail"), open || (window.MobileWorkspace.modeForViewport().mobile && state.railCollapsed));
  window.MobileWorkspace?.setInert(document.getElementById("buildingMobileDock"), open);
  document.getElementById("buildingApp")?.classList.toggle("library-open", open);
  if (open) {
    syncPaperLibraryEmpty();
    applyPaperLibraryFilter();
    updatePaperLibraryStatus();
  }
  if (!open) syncBuildingRailAccessibility();
  updateBatchPreviewButton();
}

function togglePaperLibrary() {
  if (isPaperLibraryOpen()) {
    setPaperLibraryOpen(false);
    return;
  }
  if (batchLibrary.entries.length || batchLibrary.loading) {
    setPaperLibraryOpen(true);
    return;
  }
  document.getElementById("buildingFolder")?.click();
}

function folderLabelFromFiles(files) {
  const rel = String(files[0]?.webkitRelativePath || files[0]?.name || "").replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "本地图纸";
}

function paperLibraryMaterials(records) {
  const materialTotals = new Map();
  let unresolved = 0;
  records.filter((record) => Number(record.mat)).forEach((record) => {
    const mat = Number(record.mat) || 0;
    const pack = previewPackForMat(mat);
    const component = componentByUid(mat, pack);
    if (!component) {
      unresolved += 1;
      return;
    }
    (component.materials || []).forEach((material) => {
      materialTotals.set(material.name, (materialTotals.get(material.name) || 0) + material.count);
    });
  });
  return { materialTotals, unresolved };
}

function updatePaperLibraryStatus(message = "") {
  const status = document.getElementById("paperBatchStatus");
  const title = document.getElementById("paperLibraryTitle");
  if (title) {
    title.textContent = batchLibrary.folderLabel
      ? `本地图纸库 · ${batchLibrary.folderLabel}`
      : "本地图纸库";
  }
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  const total = batchLibrary.entries.length;
  const unresolved = batchLibrary.entries.reduce((sum, entry) => sum + Number(entry.unresolved || 0), 0);
  const shown = [...(document.getElementById("paperPreviewGrid")?.children || [])].filter((card) => !card.hidden).length;
  if (batchLibrary.loading) {
    status.textContent = `正在解析… 已载入 ${total} 张`
      + (unresolved ? ` · ${unresolved} 件素材未解析` : "")
      + (batchLibrary.failed ? ` · ${batchLibrary.failed} 张无法读取` : "");
    return;
  }
  if (!total) {
    status.textContent = batchLibrary.failed
      ? `${batchLibrary.failed} 张文件无法读取。`
      : "还没有载入图纸。选择文件夹后会一直留在这里，关掉再开不用重新解析。";
    return;
  }
  const filterNote = batchLibrary.query && shown !== total ? ` · 显示 ${shown} 张` : "";
  status.textContent = `已载入 ${total} 张图纸${filterNote}`
    + (unresolved ? ` · ${unresolved} 件素材未解析` : "")
    + (batchLibrary.failed ? ` · ${batchLibrary.failed} 张无法读取` : "")
    + " · 已缓存";
}

function applyPaperLibraryFilter() {
  const query = (document.getElementById("paperBatchSearch")?.value || "").trim().toLowerCase();
  batchLibrary.query = query;
  const grid = document.getElementById("paperPreviewGrid");
  if (!grid) return;
  grid.querySelectorAll(".paper-preview-item").forEach((card) => {
    card.hidden = Boolean(query) && !String(card.dataset.search || "").includes(query);
  });
  updatePaperLibraryStatus();
}

function fillPaperCardMaterials(host, materials, unresolved, kind) {
  const preview = new Map([...materials].slice(0, 6));
  fillMaterialList(host, preview, 0);
  if (materials.size > 6) {
    const more = document.createElement("span");
    more.className = "mat-chip";
    more.textContent = `+${materials.size - 6}`;
    more.title = "在明细里查看全部材料";
    host.appendChild(more);
  } else if (!materials.size) {
    const empty = document.createElement("small");
    empty.textContent = kind === "desk" ? "没有可统计的材料" : "庄园摆放图不含装修材料";
    host.appendChild(empty);
  }
  if (unresolved) {
    host.title = `${unresolved} 件素材未解析`;
  }
}

function renderPaperLibraryCard(entry) {
  const card = document.createElement("article");
  card.className = "paper-preview-item" + (entry.unresolved ? " has-unresolved" : "");
  card.dataset.search = entry.search;
  card.dataset.id = String(entry.id);
  const visual = document.createElement("button");
  visual.type = "button";
  visual.className = "paper-preview-visual";
  visual.title = "点击放大，查看明细并缩放";
  const canvas = document.createElement("canvas");
  const badge = document.createElement("span");
  badge.className = "paper-preview-badge" + (entry.unresolved ? " is-warning" : "");
  badge.textContent = entry.unresolved ? `${entry.unresolved} 件未解析` : "素材已解析";
  const hint = document.createElement("span");
  hint.className = "paper-preview-zoom-hint";
  hint.textContent = "点击放大";
  visual.append(canvas, badge, hint);
  visual.onclick = () => openPaperInspect(entry);
  const copy = document.createElement("div");
  copy.className = "paper-preview-copy";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  name.title = entry.name;
  name.onclick = () => openPaperInspect(entry);
  const meta = document.createElement("small");
  meta.textContent = entry.meta;
  copy.append(name, meta);
  const materials = document.createElement("div");
  materials.className = "paper-preview-item-materials";
  fillPaperCardMaterials(materials, entry.materials, entry.unresolved, entry.kind);
  const actions = document.createElement("div");
  actions.className = "paper-preview-item-actions";
  if (entry.kind === "desk") {
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "btn";
    replace.textContent = "覆盖打开";
    replace.onclick = () => importLibraryPaper(entry, "replace");
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "btn btn-primary";
    merge.textContent = "合并到当前";
    merge.onclick = () => importLibraryPaper(entry, "merge");
    actions.append(replace, merge);
  } else {
    const terrain = document.createElement("button");
    terrain.type = "button";
    terrain.className = "btn btn-primary";
    terrain.textContent = "去地形桌查看";
    terrain.onclick = () => importLibraryPaper(entry, "replace");
    actions.appendChild(terrain);
  }
  card.append(visual, copy, materials, actions);
  return { card, canvas };
}

async function importLibraryPaper(entry, mode) {
  if (mode === "replace" && state.records.length) {
    const ok = await appConfirm("覆盖打开会清空当前设计，是否继续？", {
      title: "覆盖打开",
      okLabel: "覆盖",
      cancelLabel: "取消",
    });
    if (!ok) return;
  }
  closePaperInspect();
  setPaperLibraryOpen(false);
  try {
    await importDesign(entry.file, { mode });
  } catch (error) {
    await appAlert(error.message || String(error), { title: mode === "merge" ? "合并图纸失败" : "导入图纸失败" });
  }
}

function inspectViewportSize() {
  const viewport = document.getElementById("paperInspectViewport");
  const rect = viewport?.getBoundingClientRect();
  return {
    width: Math.max(1, rect?.width || 1),
    height: Math.max(1, rect?.height || 1),
  };
}

function inspectBitmapSize() {
  const bitmap = paperInspectView.bitmap;
  return {
    width: Math.max(1, bitmap?.width || DESIGN_W),
    height: Math.max(1, bitmap?.height || DESIGN_H),
  };
}

function clampPaperInspectZoom(zoom) {
  return Math.min(PAPER_INSPECT_MAX_ZOOM, Math.max(PAPER_INSPECT_MIN_ZOOM, zoom));
}

function updatePaperInspectZoomLabel() {
  const label = document.getElementById("paperInspectZoomLabel");
  if (label) label.textContent = `${Math.round(paperInspectView.zoom * 100)}%`;
}

function drawPaperInspect() {
  const canvas = document.getElementById("paperInspectCanvas");
  const bitmap = paperInspectView.bitmap;
  if (!canvas || !isPaperInspectOpen()) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const view = inspectViewportSize();
  canvas.width = Math.max(1, Math.round(view.width * dpr));
  canvas.height = Math.max(1, Math.round(view.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#163522";
  ctx.fillRect(0, 0, view.width, view.height);
  if (!bitmap) return;
  ctx.save();
  ctx.translate(paperInspectView.panX, paperInspectView.panY);
  ctx.scale(paperInspectView.zoom, paperInspectView.zoom);
  ctx.imageSmoothingEnabled = paperInspectView.zoom < 1.6;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  updatePaperInspectZoomLabel();
}

function fitPaperInspect() {
  const view = inspectViewportSize();
  const bitmap = inspectBitmapSize();
  const zoom = clampPaperInspectZoom(Math.min(view.width / bitmap.width, view.height / bitmap.height) * 0.96);
  paperInspectView.zoom = zoom;
  paperInspectView.panX = (view.width - bitmap.width * zoom) / 2;
  paperInspectView.panY = (view.height - bitmap.height * zoom) / 2;
  drawPaperInspect();
}

function actualPaperInspect() {
  const view = inspectViewportSize();
  const bitmap = inspectBitmapSize();
  paperInspectView.zoom = 1;
  paperInspectView.panX = (view.width - bitmap.width) / 2;
  paperInspectView.panY = (view.height - bitmap.height) / 2;
  drawPaperInspect();
}

function zoomPaperInspectAt(clientX, clientY, factor) {
  const viewport = document.getElementById("paperInspectViewport");
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const next = clampPaperInspectZoom(paperInspectView.zoom * factor);
  if (next === paperInspectView.zoom) return;
  const contentX = (mx - paperInspectView.panX) / paperInspectView.zoom;
  const contentY = (my - paperInspectView.panY) / paperInspectView.zoom;
  paperInspectView.zoom = next;
  paperInspectView.panX = mx - contentX * next;
  paperInspectView.panY = my - contentY * next;
  drawPaperInspect();
}

function zoomPaperInspectBy(direction) {
  const viewport = document.getElementById("paperInspectViewport");
  const rect = viewport?.getBoundingClientRect();
  const cx = (rect?.left || 0) + (rect?.width || 0) / 2;
  const cy = (rect?.top || 0) + (rect?.height || 0) / 2;
  zoomPaperInspectAt(cx, cy, direction > 0 ? 1.2 : 1 / 1.2);
}

function closePaperInspect() {
  const panel = document.getElementById("paperInspect");
  if (panel && !panel.hidden) window.MobileWorkspace?.closeLayer(panel);
  paperInspectView.entry = null;
  paperInspectView.bitmap = null;
  paperInspectView.dragging = false;
  paperInspectView.pointers.clear();
  paperInspectView.pinch = null;
  document.getElementById("paperInspectViewport")?.classList.remove("is-panning");
  paperInspectView.resizeObserver?.disconnect();
}

function bindPaperInspectControls() {
  const viewport = document.getElementById("paperInspectViewport");
  if (!viewport || viewport.dataset.bound === "1") return;
  viewport.dataset.bound = "1";
  viewport.addEventListener("wheel", (event) => {
    if (!isPaperInspectOpen()) return;
    event.preventDefault();
    zoomPaperInspectAt(event.clientX, event.clientY, event.deltaY > 0 ? 1 / 1.12 : 1.12);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !isPaperInspectOpen()) return;
    event.preventDefault();
    paperInspectView.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    paperInspectView.dragging = true;
    paperInspectView.lastX = event.clientX;
    paperInspectView.lastY = event.clientY;
    try { viewport.setPointerCapture(event.pointerId); } catch {}
    viewport.classList.add("is-panning");
    if (paperInspectView.pointers.size >= 2) {
      const [a, b] = [...paperInspectView.pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      paperInspectView.pinch = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: paperInspectView.zoom,
        contentX: (mx - paperInspectView.panX) / paperInspectView.zoom,
        contentY: (my - paperInspectView.panY) / paperInspectView.zoom,
      };
      paperInspectView.dragging = false;
    }
  });
  viewport.addEventListener("pointermove", (event) => {
    if (paperInspectView.pointers.has(event.pointerId)) {
      paperInspectView.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (paperInspectView.pinch && paperInspectView.pointers.size >= 2) {
      event.preventDefault();
      const [a, b] = [...paperInspectView.pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const zoom = clampPaperInspectZoom(paperInspectView.pinch.zoom * distance / paperInspectView.pinch.distance);
      paperInspectView.zoom = zoom;
      paperInspectView.panX = mx - paperInspectView.pinch.contentX * zoom;
      paperInspectView.panY = my - paperInspectView.pinch.contentY * zoom;
      drawPaperInspect();
      return;
    }
    if (!paperInspectView.dragging) return;
    paperInspectView.panX += event.clientX - paperInspectView.lastX;
    paperInspectView.panY += event.clientY - paperInspectView.lastY;
    paperInspectView.lastX = event.clientX;
    paperInspectView.lastY = event.clientY;
    drawPaperInspect();
  });
  const endPan = (event) => {
    paperInspectView.pointers.delete(event.pointerId);
    if (paperInspectView.pinch) {
      paperInspectView.pinch = paperInspectView.pointers.size ? { tail: true } : null;
      if (!paperInspectView.pointers.size) viewport.classList.remove("is-panning");
      try { viewport.releasePointerCapture(event.pointerId); } catch {}
      return;
    }
    if (!paperInspectView.dragging) return;
    paperInspectView.dragging = false;
    viewport.classList.remove("is-panning");
    try { viewport.releasePointerCapture(event.pointerId); } catch {}
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);
  viewport.addEventListener("dblclick", (event) => {
    event.preventDefault();
    fitPaperInspect();
  });
}

async function paintPaperInspectBitmap(documentData) {
  const rows = (documentData.records || []).filter((record) => Number(record.mat));
  if (!rows.length) {
    const empty = document.createElement("canvas");
    await paintPaperThumbnail(empty, documentData, { width: DESIGN_W, height: DESIGN_H });
    return empty;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  rows.forEach((record) => {
    const mat = Number(record.mat) || 0;
    const pack = previewPackForMat(mat);
    const component = componentByUid(mat, pack);
    const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
    const x = Number(record.x) || 0;
    const y = Number(record.y) || 0;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + (geometry.width || 16));
    bottom = Math.max(bottom, y + (geometry.height || 16));
  });
  const cap = 2400;
  const contentW = Math.max(1, right - left);
  const contentH = Math.max(1, bottom - top);
  const scale = Math.min(1, cap / contentW, cap / contentH);
  const width = Math.max(80, Math.ceil(contentW * scale) + 24);
  const height = Math.max(60, Math.ceil(contentH * scale) + 24);
  const bitmap = document.createElement("canvas");
  await paintPaperThumbnail(bitmap, documentData, { width, height });
  return bitmap;
}

async function openPaperInspect(entry) {
  if (!entry) return;
  bindPaperInspectControls();
  paperInspectView.entry = entry;
  const name = document.getElementById("paperInspectName");
  const summary = document.getElementById("paperInspectSummary");
  if (name) name.textContent = entry.name;
  if (summary) {
    summary.textContent = [
      entry.kind === "desk" ? "建筑图纸" : "庄园摆放图",
      entry.meta,
      entry.unresolved ? `${entry.unresolved} 件素材未解析` : "素材已全部解析",
    ].join("\n");
  }
  fillMaterialList(document.getElementById("paperInspectMaterials"), entry.materials, entry.unresolved);
  if (!entry.materials.size) {
    const host = document.getElementById("paperInspectMaterials");
    if (host && !host.childElementCount) {
      const empty = document.createElement("small");
      empty.textContent = entry.kind === "desk" ? "没有可统计的材料" : "庄园摆放图不含装修材料";
      host.appendChild(empty);
    }
  }
  const mergeBtn = document.getElementById("btnPaperInspectMerge");
  const replaceBtn = document.getElementById("btnPaperInspectReplace");
  if (entry.kind === "desk") {
    if (replaceBtn) {
      replaceBtn.hidden = false;
      replaceBtn.textContent = "覆盖打开";
    }
    if (mergeBtn) mergeBtn.hidden = false;
  } else {
    if (replaceBtn) {
      replaceBtn.hidden = false;
      replaceBtn.textContent = "去地形桌查看";
    }
    if (mergeBtn) mergeBtn.hidden = true;
  }
  const panel = document.getElementById("paperInspect");
  window.MobileWorkspace?.openLayer(panel, document.activeElement);
  if (!paperInspectView.resizeObserver) {
    paperInspectView.resizeObserver = new ResizeObserver(() => drawPaperInspect());
  }
  paperInspectView.resizeObserver.disconnect();
  paperInspectView.resizeObserver.observe(document.getElementById("paperInspectViewport"));
  const bitmap = await paintPaperInspectBitmap(entry.documentData);
  if (paperInspectView.entry !== entry) return;
  paperInspectView.bitmap = bitmap;
  requestAnimationFrame(() => {
    fitPaperInspect();
    document.getElementById("paperInspectViewport")?.focus();
  });
}

async function openBatchPaperPreview(files) {
  const candidates = [...files].filter((file) => /\.txt$/i.test(file.name));
  const grid = document.getElementById("paperPreviewGrid");
  const search = document.getElementById("paperBatchSearch");
  if (!grid) return;
  if (search) search.value = "";
  batchLibrary.query = "";
  batchLibrary.generation += 1;
  const gen = batchLibrary.generation;
  batchLibrary.loading = true;
  batchLibrary.entries = [];
  batchLibrary.failed = 0;
  batchLibrary.folderLabel = candidates.length ? folderLabelFromFiles(candidates) : "";
  grid.replaceChildren();
  setPaperLibraryOpen(true);
  syncPaperLibraryEmpty();
  if (!candidates.length) {
    batchLibrary.loading = false;
    updatePaperLibraryStatus("所选文件夹里没有 .txt 图纸。");
    updateBatchPreviewButton();
    return;
  }
  updatePaperLibraryStatus(`正在读取 ${candidates.length} 张图纸…`);
  updateBatchPreviewButton();
  let unresolvedTotal = 0;
  for (const [index, file] of candidates.entries()) {
    try {
      const { documentData } = await parseBuildingFile(file);
      if (gen !== batchLibrary.generation) return;
      const records = documentData.records || [];
      const paperRows = records.filter((record) => Number(record.mat));
      const { materialTotals, unresolved } = paperLibraryMaterials(records);
      unresolvedTotal += unresolved;
      const relative = String(file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const entry = {
        id: `${gen}-${index}`,
        file,
        documentData,
        name: relative,
        search: relative.toLowerCase(),
        kind: documentData.kind,
        count: paperRows.length,
        meta: documentData.kind === "desk"
          ? `${paperRows.length} 件素材 · ${materialTotals.size} 种材料`
          : `${records.length} 个庄园建筑点`,
        materials: materialTotals,
        unresolved,
      };
      batchLibrary.entries.push(entry);
      const { card, canvas } = renderPaperLibraryCard(entry);
      grid.appendChild(card);
      grid.hidden = false;
      const empty = document.getElementById("paperLibraryEmpty");
      if (empty) empty.hidden = true;
      await paintPaperThumbnail(canvas, documentData);
      if (gen !== batchLibrary.generation) return;
    } catch (error) {
      if (gen !== batchLibrary.generation) return;
      batchLibrary.failed += 1;
      console.warn(`图纸预览失败：${file.name}`, error);
    }
    applyPaperLibraryFilter();
    updatePaperLibraryStatus(
      `正在解析 ${index + 1} / ${candidates.length} 张图纸`
      + (unresolvedTotal ? ` · ${unresolvedTotal} 件素材未解析` : "")
      + (batchLibrary.failed ? ` · ${batchLibrary.failed} 张无法读取` : "")
    );
    if (index % 4 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (gen !== batchLibrary.generation) return;
  batchLibrary.loading = false;
  syncPaperLibraryEmpty();
  updatePaperLibraryStatus();
  updateBatchPreviewButton();
}

function importedPaperRows(records) {
  let lastTheme = state.pack;
  const inferredThemeKeys = new Set(
    records
      .map((record) => {
        const mat = Number(record.mat) || 0;
        const pack = mat >= 1000 ? packForPaperUid(Math.floor(mat / 1000)) : null;
        return pack?.kind === "theme" ? pack.key : "";
      })
      .filter(Boolean)
  );
  const inferredLocalPack =
    inferredThemeKeys.size === 1 ? packByKey([...inferredThemeKeys][0]) : null;
  const rows = records.map((record) => {
    const mat = Number(record.mat) || 0;
    let packKey = mat < 1000 ? inferredLocalPack?.key || "" : state.pack?.key || "";
    if (mat >= 1000) {
      const pack = packForPaperUid(Math.floor(mat / 1000));
      if (pack) {
        packKey = pack.key;
        if (pack.kind === "theme") lastTheme = pack;
      }
    }
    return {
      mode: "desk",
      x: decodeS15(record.x),
      y: decodeS15(record.y),
      mat,
      state: record.state ?? record.flip ?? 0,
      packKey,
      localPackUnknown: mat > 0 && mat < 1000 && !inferredLocalPack,
      hidden: mat === 0,
    };
  });
  return { rows, lastTheme };
}

async function importDesign(file, options = {}) {
  const { buffer, documentData } = await parseBuildingFile(file);
  if (documentData.kind !== "desk") {
    const goTerrain = await appConfirm(
      `「${file.name}」是庄园摆放图（共 ${documentData.records?.length || 0} 个点），不是户型装修图。\n\n是否打开地形设计桌导入？`,
      { title: "图纸类型不对", okLabel: "去地形桌", cancelLabel: "取消" }
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
  const mode = options.mode === "merge" && placedDesignCount() ? "merge" : "replace";
  const imported = importedPaperRows(records);
  if (mode === "merge") {
    const body = imported.rows.filter((record) => Number(record.mat) !== 0);
    if (!body.length) throw new Error("这张图纸没有可合并的建筑素材。");
    const group = `${Date.now()}-import`;
    const groupName = file.name.replace(/\.[^.]+$/, "") || "合并图纸";
    pushHistory();
    const first = state.records.length;
    body.forEach((record) => {
      state.records.push({
        ...record,
        hidden: false,
        group,
        groupName,
      });
    });
    state.layerCollapsed.add(group);
    setSelection(body.map((_, index) => first + index), { expandGroup: true });
    updateSelectionCaption();
    fillLayers();
    syncDesignResetButtons();
    renderBuilding();
    return;
  }
  applyImportedPaperBase(records);
  invalidateBaseLayout();
  pushHistory();
  state.source = {
    encoding: documentData._source?.encoding || "gbk",
  };
  state.paperLayout = true;
  state.records = imported.rows;
  state.baseAnchor = null;
  state.paperOrigin = null;
  invalidateBaseLayout();
  if (imported.lastTheme) state.pack = imported.lastTheme;
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

function serializeExportRecord(record) {
  const {
    component,
    pack,
    group,
    locked,
    hidden,
    groupName,
    label,
    packKey,
    localPackUnknown,
    ...rest
  } = record;
  return {
    ...rest,
    mode: "desk",
    x: Math.max(DESK_COORD_MIN, Math.min(DESK_COORD_MAX, Math.round(Number(rest.x) || 0))),
    y: Math.max(DESK_COORD_MIN, Math.min(DESK_COORD_MAX, Math.round(Number(rest.y) || 0))),
    mat: Math.max(0, Math.round(Number(rest.mat) || 0)),
    state: Math.max(0, Math.min(63, Math.round(Number(rest.state ?? rest.flip) || 0))),
  };
}

function existingUserReferences() {
  return state.records
    .filter((record) => Number(record.mat) === 0)
    .map(serializeExportRecord);
}

function buildExportRecords() {
  const body = state.records
    .filter((record) => Number(record.mat) !== 0)
    .map(serializeExportRecord);
  return [...existingUserReferences(), ...body];
}

async function placeCurrentBuildingOnTerrain() {
  if (!state.base) {
    await appAlert("请先选择建筑户型。", { title: "无法放置" });
    return;
  }
  const records = buildExportRecords();
  if (!records.some((record) => Number(record.mat))) {
    await appAlert("当前建筑还没有可预览的素材。", { title: "无法放置" });
    return;
  }
  const payload = {
    v: 1,
    name: state.base?.name || "设计建筑",
    baseNo: Number(state.base.no),
    localPackKey: state.pack?.key || "",
    coordinateSpace: state.paperLayout ? "paper" : "editor",
    documentData: { kind: "desk", records },
    createdAt: Date.now(),
  };
  sessionStorage.setItem("manor-pending-preview-building", JSON.stringify(payload));
  saveBuildingSession();
  location.href = "/?placeBuilding=1";
}

async function exportDesign() {
  const payload = {
    kind: "desk",
    records: buildExportRecords(),
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
  window.MobileWorkspace?.registerSheet({
    id: "building-rail",
    root: ".building-rail",
    backdrop: "#buildingRailBackdrop",
    inert: [".building-stage", ".building-app .topbar"],
    initialFocus: "#btnBuildingSheetClose",
    mutex: "building-workspace",
  });
  window.MobileWorkspace?.registerSheet({
    id: "building-tools",
    root: "#canvasToolDock",
    backdrop: "#buildingRailBackdrop",
    inert: ["#canvasZoomInner", ".stage-bar", ".building-app .topbar"],
    initialFocus: "#btnBuildingToolsClose",
    mutex: "building-workspace",
    resetScroll: false,
  });
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
  document.getElementById("keepFoundation").onchange = (event) => {
    state.keepFoundation = event.target.checked;
    markBuildingDirty();
    renderBuilding();
  };
  document.getElementById("snapEnabled").onchange = (event) => {
    state.snap.enabled = event.target.checked;
    markBuildingDirty();
  };
  const snapGrid = document.getElementById("snapGrid");
  const snapEdges = document.getElementById("snapEdges");
  const snapCenters = document.getElementById("snapCenters");
  if (snapGrid) {
    snapGrid.checked = state.snap.grid !== false;
    snapGrid.onchange = (event) => {
      state.snap.grid = event.target.checked;
      markBuildingDirty();
    };
  }
  if (snapEdges) {
    snapEdges.checked = state.snap.edges !== false;
    snapEdges.onchange = (event) => {
      state.snap.edges = event.target.checked;
      markBuildingDirty();
    };
  }
  if (snapCenters) {
    snapCenters.checked = state.snap.centers !== false;
    snapCenters.onchange = (event) => {
      state.snap.centers = event.target.checked;
      markBuildingDirty();
    };
  }
  document.getElementById("snapStep").onchange = (event) => {
    state.snap.step = Math.max(1, Number(event.target.value) || 4);
    markBuildingDirty();
  };
  const snapAxisEl = document.getElementById("snapAxis");
  if (snapAxisEl) {
    snapAxisEl.value = snapAxis();
    snapAxisEl.onchange = (event) => {
      const next = event.target.value;
      state.snap.axis = next === "ortho" || next === "both" ? next : "iso";
      markBuildingDirty();
    };
  }
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
        if (event.target.closest(".stage-bar, .base-meta, .zoom-control, .stage-commandbar")) return;
        if (state.interaction) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomBy(delta, event.clientX, event.clientY);
      },
      { passive: false }
    );
    if (typeof ResizeObserver === "function") {
      const shellFit = new ResizeObserver(() => fitStageToShell());
      shellFit.observe(canvasShell);
    }
  }
  window.addEventListener("resize", () => fitStageToShell());
  const btnFacingPrev = document.getElementById("btnFacingPrev");
  const btnFacingNext = document.getElementById("btnFacingNext");
  if (btnFacingPrev) btnFacingPrev.onclick = () => stepFacing(-1);
  if (btnFacingNext) btnFacingNext.onclick = () => stepFacing(1);
  updateFacingControl();
  const btnLayerBack = document.getElementById("btnLayerBack");
  const btnLayerFront = document.getElementById("btnLayerFront");
  if (btnLayerBack) btnLayerBack.onclick = () => stepLayerOrder(-1);
  if (btnLayerFront) btnLayerFront.onclick = () => stepLayerOrder(1);
  updateLayerOrderControl();
  let pendingImportMode = "replace";
  document.getElementById("btnImportDesign").onclick = () => {
    pendingImportMode = "replace";
    document.getElementById("buildingFile").click();
  };
  document.getElementById("btnMergeDesign").onclick = () => {
    pendingImportMode = "merge";
    document.getElementById("buildingFile").click();
  };
  document.getElementById("btnBatchPreview").onclick = () => togglePaperLibrary();
  document.getElementById("btnPaperLibraryClose")?.addEventListener("click", () => setPaperLibraryOpen(false));
  document.getElementById("btnPaperLibraryFolder")?.addEventListener("click", () => {
    document.getElementById("buildingFolder")?.click();
  });
  document.getElementById("btnPaperLibraryPick")?.addEventListener("click", () => {
    document.getElementById("buildingFolder")?.click();
  });
  document.getElementById("paperBatchSearch")?.addEventListener("input", () => applyPaperLibraryFilter());
  document.getElementById("btnPaperInspectBack")?.addEventListener("click", () => closePaperInspect());
  document.getElementById("btnPaperInspectClose")?.addEventListener("click", () => closePaperInspect());
  document.getElementById("btnPaperInspectZoomIn")?.addEventListener("click", () => zoomPaperInspectBy(1));
  document.getElementById("btnPaperInspectZoomOut")?.addEventListener("click", () => zoomPaperInspectBy(-1));
  document.getElementById("btnPaperInspectFit")?.addEventListener("click", () => fitPaperInspect());
  document.getElementById("btnPaperInspect100")?.addEventListener("click", () => actualPaperInspect());
  document.getElementById("btnPaperInspectReplace")?.addEventListener("click", () => {
    if (paperInspectView.entry) importLibraryPaper(paperInspectView.entry, "replace");
  });
  document.getElementById("btnPaperInspectMerge")?.addEventListener("click", () => {
    if (paperInspectView.entry) importLibraryPaper(paperInspectView.entry, "merge");
  });
  bindPaperInspectControls();
  document.getElementById("buildingFolder").onchange = async (event) => {
    await openBatchPaperPreview(event.target.files || []);
    event.target.value = "";
  };
  document.getElementById("btnDownloadPaper").onclick = () => {
    exportDesign().catch((error) => appAlert(error.message || String(error), { title: "导出失败" }));
  };
  document.getElementById("btnSavePaperPreview").onclick = saveCurrentPaperPreview;
  document.getElementById("btnAllMaterials").onclick = () => {
    const line = document.querySelector(".material-line");
    if (!line) return;
    line.classList.toggle("is-open");
    document.getElementById("btnAllMaterials").setAttribute(
      "aria-expanded",
      line.classList.contains("is-open") ? "true" : "false"
    );
  };
  document.getElementById("buildingFile").onchange = async (event) => {
    if (!event.target.files[0]) return;
    try {
      await importDesign(event.target.files[0], { mode: pendingImportMode });
    } catch (error) {
      await appAlert(error.message || String(error), { title: "导入失败" });
    }
    pendingImportMode = "replace";
    event.target.value = "";
  };
  document.getElementById("btnMakeBuilding").onclick = () => {
    openCurrentPaperPreview();
  };
  document.getElementById("btnPlaceOnTerrain").onclick = () => {
    placeCurrentBuildingOnTerrain().catch((error) => {
      appAlert(error.message || String(error), { title: "放置失败" });
    });
  };
  document.querySelectorAll("button[data-command]").forEach((button) => {
    button.onclick = () => executeCommand(button.dataset.command);
  });
  document.querySelectorAll("button[data-tool]").forEach((button) => {
    button.onclick = () => {
      setActiveTool(button.dataset.tool);
      if (window.MobileWorkspace?.modeForViewport().mobile) setMobileToolsOpen(false);
    };
  });
  document.querySelectorAll("[data-marquee-mode]").forEach((button) => {
    button.onclick = () => {
      setMarqueeMode(button.dataset.marqueeMode);
      setActiveTool("select");
      if (window.MobileWorkspace?.modeForViewport().mobile) setMobileToolsOpen(false);
    };
  });
  document.querySelectorAll("[data-mobile-tool-family]").forEach((button) => {
    button.onclick = () => setMobileToolFamily(button.dataset.mobileToolFamily);
  });
  document.querySelectorAll("#alignBar button").forEach((button) => {
    button.onclick = () => alignSelection(button.dataset.align);
  });
  document.querySelectorAll(".rail-tab").forEach((button) => {
    button.onclick = () => setRailTab(button.dataset.tab);
  });
  document.getElementById("btnSelectAll").onclick = selectAllRecords;
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
  const setSelectedVisibility = (hidden) => {
    const indices = state.selected.filter((index) => state.records[index]);
    if (!indices.length) return;
    pushHistory();
    indices.forEach((index) => { state.records[index].hidden = hidden; });
    fillLayers();
    renderBuilding();
  };
  document.getElementById("btnShowSel").onclick = () => setSelectedVisibility(false);
  document.getElementById("btnHideSel").onclick = () => setSelectedVisibility(true);
  document.getElementById("btnLockLayers").onclick = lockSelected;
  document.getElementById("btnUnlockLayers").onclick = unlockSelected;
  const layerFilter = document.getElementById("layerFilter");
  if (layerFilter) {
    layerFilter.oninput = () => {
      state.layerFilter = layerFilter.value || "";
      fillLayers();
    };
  }
  const layerSelectedOnly = document.getElementById("layerSelectedOnly");
  if (layerSelectedOnly) {
    layerSelectedOnly.onchange = () => {
      state.layerSelectedOnly = layerSelectedOnly.checked;
      fillLayers();
    };
  }
  const themeList = document.getElementById("themeList");
  if (themeList) {
    themeList.onchange = () => {
      const value = themeList.value;
      if (value === THEME_ALL) applyThemePack(null);
      else applyThemePack(packByKey(value) || state.pack);
    };
  }
  const themeSearch = document.getElementById("themeSearch");
  if (themeSearch) {
    themeSearch.oninput = () => {
      fillThemes();
      fillComponents();
    };
  }
  document.querySelectorAll("[data-asset-mode]").forEach((button) => {
    button.onclick = () => {
      state.assetMode = button.dataset.assetMode;
      document.querySelectorAll("[data-asset-mode]").forEach((node) =>
        node.classList.toggle("on", node === button)
      );
      fillComponents();
    };
  });
  document.getElementById("customFolderFilter").onchange = () => fillCustoms();
  document.getElementById("customFolderFilterBtn").onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFolderPicker();
  };
  document.addEventListener("pointerdown", (event) => {
    const menu = document.getElementById("customFolderMenu");
    if (!menu || menu.hidden) return;
    if (event.target.closest("#customFolderMenu, #customFolderFilterBtn")) return;
    closeFolderPicker();
  });
  window.addEventListener("resize", closeFolderPickerIfMoved);
  document.addEventListener(
    "scroll",
    (event) => {
      if (event.target.closest?.("#customFolderMenu")) return;
      closeFolderPickerIfMoved();
    },
    true
  );
  document.getElementById("customSearch").oninput = () => fillCustoms();
  document.getElementById("btnNewFolder").onclick = async () => {
    const name = await appPrompt("给新分组起个名字。", {
      title: "新建分组",
      fieldLabel: "分组名称",
      placeholder: "例如 常用 / 屋顶",
      okLabel: "创建",
    });
    if (name == null) return;
    const folder = name.trim();
    if (!folder) {
      await appAlert("请输入分组名称。", { title: "新建分组" });
      return;
    }
    ensureCustomFolder(folder);
    const filter = document.getElementById("customFolderFilter");
    refreshFolderSuggestions();
    if (filter) filter.value = folder;
    const preset = document.getElementById("presetFolder");
    if (preset) preset.value = folder;
    fillCustoms();
  };
  document.getElementById("btnPresetClose").onclick = closePresetDialog;
  document.getElementById("btnPresetOk").onclick = confirmPresetDialog;
  document.getElementById("dlgPreset").addEventListener("click", (event) => {
    if (event.target.id === "dlgPreset") closePresetDialog();
  });
  const btnToggleRail = document.getElementById("btnToggleRail");
  if (btnToggleRail) {
    btnToggleRail.onclick = () => {
      state.railCollapsed = !state.railCollapsed;
      applyRailState();
      markBuildingDirty();
    };
  }
  document.getElementById("btnBuildingMobileAssets")?.addEventListener("click", () => {
    setMobileToolsOpen(false);
    const mode = state.phase === "select" ? "base" : "assets";
    if (!state.railCollapsed && state.mobileSheetMode === mode) {
      closeBuildingRail();
    } else openBuildingRail(mode);
  });
  document.getElementById("btnBuildingMobileTools")?.addEventListener("click", () => {
    const open = !document.documentElement.classList.contains("mobile-tools-open");
    if (open) closeBuildingRail();
    setMobileToolsOpen(open);
  });
  document.getElementById("btnBuildingToolsClose")?.addEventListener("click", () => setMobileToolsOpen(false));
  document.getElementById("canvasEmpty")?.addEventListener("click", () => {
    if (window.MobileWorkspace?.modeForViewport().mobile) openBuildingRail("assets");
  });
  document.getElementById("canvasEmpty")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (window.MobileWorkspace?.modeForViewport().mobile) openBuildingRail("assets");
  });
  document.getElementById("btnBuildingMobileProject")?.addEventListener("click", () => {
    setMobileToolsOpen(false);
    if (!state.railCollapsed && state.mobileSheetMode === "project") closeBuildingRail();
    else openBuildingRail("project");
  });
  document.getElementById("btnBuildingMobileUndo")?.addEventListener("click", undo);
  document.getElementById("btnBuildingMobilePan")?.addEventListener("click", (event) => {
    closeBuildingRail();
    setMobileToolsOpen(false);
    state.mobilePan = !state.mobilePan;
    syncMobilePanUi();
  });
  document.getElementById("btnProjectChooseBase")?.addEventListener("click", () => {
    setPhase("select");
    openBuildingRail("base");
  });
  document.getElementById("btnBuildingSheetClose")?.addEventListener("click", closeBuildingRail);
  document.getElementById("buildingRailBackdrop")?.addEventListener("click", () => {
    closeBuildingRail();
    setMobileToolsOpen(false);
  });
  const railResizer = document.getElementById("railResizer");
  if (railResizer) {
    railResizer.onpointerdown = (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = state.railWidth;
      try {
        railResizer.setPointerCapture?.(event.pointerId);
      } catch {
        /* synthetic or inactive pointer */
      }
      railResizer.classList.add("is-resizing");
      const move = (moveEvent) => {
        state.railWidth = Math.max(300, Math.min(520, startWidth + startX - moveEvent.clientX));
        applyRailState();
      };
      const finish = () => {
        railResizer.classList.remove("is-resizing");
        railResizer.removeEventListener("pointermove", move);
        railResizer.removeEventListener("pointerup", finish);
        railResizer.removeEventListener("pointercancel", finish);
        markBuildingDirty();
      };
      railResizer.addEventListener("pointermove", move);
      railResizer.addEventListener("pointerup", finish);
      railResizer.addEventListener("pointercancel", finish);
    };
  }
  document.getElementById("btnCommandPalette").onclick = () => {
    document.getElementById("commandSearch").value = "";
    fillCommandList();
    setModalVisible("dlgCommands", true);
  };
  document.getElementById("btnShortcuts").onclick = () => {
    fillShortcutHelp();
    setModalVisible("dlgShortcuts", true);
  };
  document.getElementById("commandSearch").oninput = fillCommandList;
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.onclick = () => setModalVisible(button.dataset.closeModal, false);
  });
  ["dlgCommands", "dlgShortcuts"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (event) => {
      if (event.target.id === id) setModalVisible(id, false);
    });
  });
  applyRailState();
  setActiveTool(state.tool);
  applyCommandTooltips();
  wireHoverTips();
  wireContextMenu();

  if (canvasShell) {
    canvasShell.addEventListener("pointerdown", (event) => beginCanvasPointer(event, canvasShell));
    canvasShell.addEventListener("pointermove", (event) => moveCanvasPointer(event, canvasShell));
    canvasShell.addEventListener("pointerup", (event) => finishCanvasPointer(event, canvasShell));
    canvasShell.addEventListener("pointercancel", (event) =>
      finishCanvasPointer(event, canvasShell, true)
    );
    canvasShell.addEventListener("scroll", () => {
      hideContextMenu();
      syncViewportOverlays();
    }, { passive: true });
    canvasShell.addEventListener("auxclick", (event) => {
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    canvasShell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  window.addEventListener("pointerup", (event) => {
    if (state.paletteDrag) {
      finishPaletteDrag(event);
    }
  });

  window.addEventListener("pointermove", (event) => {
    if (state.paletteDrag) updatePaletteDrag(event);
    if (state.phase === "design" && hasBrush() && event.target.closest?.("#canvasShell")) {
      const { x, y } = canvasPoint(event);
      state.ghost = { x, y };
      renderBuilding();
    }
  });

  window.addEventListener("blur", () => {
    if (state.paletteDrag) {
      state.paletteDrag = null;
      clearPaletteGhost();
    }
    if (state.interaction) cancelCanvasInteraction();
    state.spacePan = false;
  });

  window.addEventListener("keydown", (event) => {
    if (typeof isAppDialogOpen === "function" && isAppDialogOpen()) return;
    const commandDialog = document.getElementById("dlgCommands");
    const shortcutDialog = document.getElementById("dlgShortcuts");
    if (!commandDialog.hidden || !shortcutDialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        setModalVisible(commandDialog.hidden ? "dlgShortcuts" : "dlgCommands", false);
      } else if (!commandDialog.hidden && event.key === "Enter") {
        const first = document.querySelector("#commandList .command-row");
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("btnCommandPalette").click();
      return;
    }
    if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
      event.preventDefault();
      document.getElementById("btnShortcuts").click();
      return;
    }
    if (isPaperInspectOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePaperInspect();
        return;
      }
      if (!isTypingTarget(event.target)) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          zoomPaperInspectBy(1);
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          zoomPaperInspectBy(-1);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          fitPaperInspect();
          return;
        }
        if (event.key === "1") {
          event.preventDefault();
          actualPaperInspect();
          return;
        }
        return;
      }
    }
    if (isPaperLibraryOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPaperLibraryOpen(false);
        return;
      }
      if (isTypingTarget(event.target)) return;
      return;
    }
    if (event.key === "Escape" && window.MobileWorkspace?.modeForViewport().mobile) {
      if (document.documentElement.classList.contains("mobile-tools-open")) {
        event.preventDefault();
        setMobileToolsOpen(false);
        document.getElementById("btnBuildingMobileTools")?.focus({ preventScroll: true });
        return;
      }
      if (!state.railCollapsed) {
        event.preventDefault();
        closeBuildingRail();
        document
          .getElementById(state.mobileSheetMode === "project" ? "btnBuildingMobileProject" : "btnBuildingMobileAssets")
          ?.focus({ preventScroll: true });
        return;
      }
    }
    if (isTypingTarget(event.target)) return;
    if (state.phase !== "design") return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      executeCommand("delete");
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "a") {
      event.preventDefault();
      executeCommand("clearSelection");
    } else if ((event.ctrlKey || event.metaKey) && key === "a") {
      event.preventDefault();
      executeCommand("selectAll");
    } else if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowDown") executeCommand(event.shiftKey ? "bottom" : "down");
      else executeCommand(event.shiftKey ? "top" : "up");
    } else if ((key === "q" || event.key === ",") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("facingPrev");
    } else if ((key === "e" || event.key === ".") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("facingNext");
    } else if (key === "z" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("layerBack");
    } else if (key === "x" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("layerFront");
    } else if (key === "a" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("bottom");
    } else if (key === "s" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("down");
    } else if (key === "w" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("up");
    } else if (key === "d" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("top");
    } else if (key === "p" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("savePreset");
    } else if (key === "r" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("flip");
    } else if (event.key === " ") {
      event.preventDefault();
      state.spacePan = true;
      document.getElementById("canvasShell")?.classList.add("is-pan-ready");
    } else if (key === "v" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("selectTool");
    } else if (key === "n" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("paintTool");
    } else if (key === "b" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("stampTool");
    } else if (key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("tileTool");
    } else if (key === "u" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("rectTool");
    } else if (key === "l" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("lineTool");
    } else if (key === "o" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("circleTool");
    } else if (key === "i" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("triangleTool");
    } else if (key === "c" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("diamondTool");
    } else if (key === "g" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("ringTool");
    } else if (key === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand(event.shiftKey ? "marqueeContain" : "marqueeTouch");
    } else if (key === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("focus");
    } else if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      executeCommand(event.shiftKey ? "redo" : "undo");
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      executeCommand("redo");
    } else if ((event.ctrlKey || event.metaKey) && key === "d") {
      event.preventDefault();
      executeCommand("duplicate");
    } else if ((event.ctrlKey || event.metaKey) && key === "l") {
      event.preventDefault();
      event.stopImmediatePropagation();
      executeCommand("lock");
    } else if ((event.ctrlKey || event.metaKey) && key === "c") {
      event.preventDefault();
      executeCommand("copy");
    } else if ((event.ctrlKey || event.metaKey) && key === "v") {
      event.preventDefault();
      executeCommand("paste");
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "g") {
      event.preventDefault();
      executeCommand("ungroup");
    } else if ((event.ctrlKey || event.metaKey) && key === "g") {
      event.preventDefault();
      executeCommand("group");
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === "h") {
      event.preventDefault();
      executeCommand(event.shiftKey ? "distributeX" : "alignCenterX");
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === "v") {
      event.preventDefault();
      executeCommand(event.shiftKey ? "distributeY" : "alignCenterY");
    } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      executeCommand(
        event.key === "ArrowLeft" ? "alignLeft"
        : event.key === "ArrowRight" ? "alignRight"
        : event.key === "ArrowUp" ? "alignTop"
        : "alignBottom"
      );
    } else if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")
      && !event.ctrlKey && !event.metaKey && !event.altKey
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      nudgeSelected(dx, dy);
    } else if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      executeCommand("zoomIn");
    } else if (event.key === "-") {
      event.preventDefault();
      executeCommand("zoomOut");
    } else if (event.key === "0") {
      event.preventDefault();
      executeCommand("fit");
    } else if (event.key === "1") {
      event.preventDefault();
      executeCommand("actual");
    } else if (event.key === "Escape") {
      event.preventDefault();
      const folderMenu = document.getElementById("customFolderMenu");
      if (folderMenu && !folderMenu.hidden) {
        closeFolderPicker();
        return;
      }
      if (hideContextMenu()) return;
      if (!cancelCanvasInteraction()) {
        if (isPlaceTool()) setActiveTool("select");
        else cancelPick();
      }
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (event.key === " ") {
      state.spacePan = false;
      document.getElementById("canvasShell")?.classList.remove("is-pan-ready");
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
  appAlert("建筑设计桌启动失败：" + (error.message || error), { title: "启动失败" });
});
