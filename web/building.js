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
const HUD_LAYOUT_KEY = "manor-building-hud-layout-v2";
const SHEET_LAYOUT_KEY = "manor-building-sheet-layout-v1";
const MATERIALS_DOCK_KEY = "manor-building-materials-dock-collapsed";
const SMART_STYLES_KEY = "manor-building-smart-styles-v1";
const SHEET_MIN_W = 280;
const SHEET_MIN_H = 260;
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
const SELECT_LIT = 0.45;
const MARQUEE_MIN_PX = 4;
const DRAG_PREVIEW_MAX = 32;
const STAMP_CAP = 360;
const STAMP_PREVIEW_MAX = 80;
const PLACE_TOOLS = new Set(["paint", "stamp", "tile", "rect", "line", "circle", "triangle", "diamond", "ring"]);
const SMART_TOOLS = new Set(["smart-wall"]);
const HIDDEN_TOOLS = new Set(["smart-wall", "tile", "rect", "line", "circle", "triangle", "ring"]);
const TOOL_INFO = {
  select: { label: "选择", hint: "点击选中 · 双击选组内单件 · 拖动移动 · 空白处圈选 · Space/中键平移" },
  paint: { label: "纯笔刷", hint: "只铺不选 · 拖选中组可移动 · 空白处按贴地点连续盖" },
  stamp: { label: "点刷", hint: "点击盖一枚 · 拖选中组可移动 · 拖着按地块格子连续盖" },
  tile: { label: "平铺", hint: "按 2:1 地块格子铺满 · Shift 正方形区域" },
  rect: { label: "矩形", hint: "按地块格子铺满矩形 · Shift 正方形" },
  line: { label: "直线", hint: "沿线贴地排开，间距跟脚印走 · Shift 锁 45°" },
  circle: { label: "圆形", hint: "按地块格子铺圆 · Shift 正圆" },
  triangle: { label: "三角", hint: "按地块格子铺三角形" },
  diamond: { label: "菱形", hint: "斜向菱形铺满，贴地块 · Shift 正菱" },
  ring: { label: "描边", hint: "沿一圈按脚印间距铺 · Shift 圆圈" },
  "smart-wall": { label: "智能建筑", hint: "拖动画墙 · 切换门窗后点墙放置 · 双指平移缩放" },
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
  layerInsert: null,
  lastPlaceTool: "stamp",
  mobilePan: false,
  activePointers: new Map(),
  pointerGesture: null,
  pointerPending: null,
  groupIsolate: null,
  paletteDrag: null,
  interaction: null,
  tool: "select",
  shapeStroke: null,
  marqueeMode: "touch",
  spacePan: false,
  railCollapsed: false,
  railWidth: 340,
  sheetPinned: false,
  sheetLayout: null,
  assetMode: "all",
  assetFavorites: new Set(),
  assetRecent: [],
  sessionDirty: false,
  designName: "",
  sourcePaper: null,
  smartBuilder: {
    styles: [],
    styleId: "",
    mode: "wall",
    walls: [],
    props: [],
    warnings: [],
  },
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
let assetWindowKey = "";
let assetPrefetchKey = "";
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
    ["designDock", "canvasToolDock", "hudStack", "mobileSelectionBar", "materialsDock"].forEach((id) => {
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
    return JSON.parse(deskGet(HUD_LAYOUT_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveHudLayout() {
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  const materials = document.getElementById("materialsDock");
  const payload = {};
  if (command?.classList.contains("is-placed")) {
    payload.command = { left: parseFloat(command.style.left), top: parseFloat(command.style.top) };
  }
  if (tools?.classList.contains("is-placed")) {
    payload.tools = { left: parseFloat(tools.style.left), top: parseFloat(tools.style.top) };
  }
  if (materials?.classList.contains("is-placed")) {
    payload.materials = { left: parseFloat(materials.style.left), top: parseFloat(materials.style.top) };
  }
  deskSet(HUD_LAYOUT_KEY, JSON.stringify(payload));
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
  const left = `${Math.round(pos.left)}px`;
  const top = `${Math.round(pos.top)}px`;
  el.style.setProperty("--hud-left", left);
  el.style.setProperty("--hud-top", top);
  el.style.left = left;
  el.style.top = top;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
}

function resetHudPosition(el, options = {}) {
  if (!el) return;
  el.classList.remove("is-placed");
  el.style.removeProperty("--hud-left");
  el.style.removeProperty("--hud-top");
  el.style.left = "";
  el.style.top = "";
  el.style.right = "";
  el.style.bottom = "";
  el.style.transform = "";
  if (options.persist !== false) saveHudLayout();
}

function workspaceMode() {
  return window.MobileWorkspace?.modeForViewport() || { mobile: false, tablet: false, coarse: false };
}

function isCoarsePointer() {
  return !!workspaceMode().coarse;
}

function layerListUsesMultiSelect() {
  const mode = workspaceMode();
  return !!(mode.mobile || mode.tablet || mode.coarse);
}

function buildingFloatingHud() {
  const mode = workspaceMode();
  return mode.mobile && (mode.tablet || state.phase === "design");
}

function hudDragEnabled() {
  return !workspaceMode().mobile || buildingFloatingHud();
}

function layoutFloatingHuds() {
  if (!hudDragEnabled()) return;
  const parent = hudLayoutParent();
  if (!parent || parent.clientWidth < 32 || parent.clientHeight < 32) return;
  const saved = loadHudLayout();
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  const materials = document.getElementById("materialsDock");
  const rail = document.getElementById("canvasToolrail");
  if (rail) rail.style.maxHeight = `${Math.max(120, parent.clientHeight - 16)}px`;
  [
    [command, "command"],
    [tools, "tools"],
    [materials, "materials"],
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
  if (!hudDragEnabled()) return false;
  if (event.pointerType === "mouse" && event.button !== 0) return false;
  if (event.target.closest(".hud-drag-grip")) return true;
  if (
    event.target.closest(
      "button:not(.hud-drag-grip), input, select, textarea, a, .tool-item, [data-command], [data-tool], [data-align], [data-marquee-mode], .facing-control, .mobile-tool-tabs"
    )
  ) {
    return false;
  }
  const modeWs = workspaceMode();
  if (buildingFloatingHud() && mode === "chrome") return true;
  if (mode === "grip") return false;
  const needGrip = event.pointerType !== "mouse" || isCoarsePointer();
  if (needGrip) return false;
  return mode === "chrome";
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
    try {
      node.setPointerCapture(pointerId);
    } catch {
      // Capture may fail for synthetic events.
    }
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && dx * dx + dy * dy < 16) return;
      dragging = true;
      el.classList.add("is-dragging-hud");
      applyHudPosition(el, clampHudPosition(el, originLeft + dx, originTop + dy));
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      try {
        node.releasePointerCapture(pointerId);
      } catch {
        // Already released.
      }
      el.classList.remove("is-dragging-hud");
      const tapped = !dragging;
      const now = performance.now();
      const prevTap = Number(node.dataset.hudTapAt || 0);
      node.dataset.hudTapAt = tapped ? String(now) : "0";
      if (tapped && prevTap && now - prevTap < 420) {
        node.dataset.hudTapAt = "0";
        resetHudPosition(el);
        return;
      }
      if (dragging) {
        saveHudLayout();
        const swallow = (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
      }
    };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }, { passive: false });
  el.querySelector(".hud-drag-grip")?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetHudPosition(el);
  });
}

function bindFloatingHuds() {
  const command = document.getElementById("designDock");
  const tools = document.getElementById("canvasToolDock");
  const materials = document.getElementById("materialsDock");
  const toolrail = tools?.querySelector(".canvas-toolrail");
  bindFloatingHud(command, "chrome", command);
  if (toolrail) bindFloatingHud(tools, "chrome", toolrail);
  else bindFloatingHud(tools, "grip", tools?.querySelector(".hud-drag-grip"));
  bindFloatingHud(materials, "grip", materials?.querySelector(".materials-dock-grip"));
  layoutFloatingHuds();
}

function loadAssetPreferences() {
  try {
    const saved = JSON.parse(deskGet(ASSET_PREFS_KEY) || "{}");
    state.assetFavorites = new Set(Array.isArray(saved.favorites) ? saved.favorites : []);
    state.assetRecent = Array.isArray(saved.recent) ? saved.recent.slice(0, 40) : [];
  } catch {
    state.assetFavorites = new Set();
    state.assetRecent = [];
  }
}

function saveAssetPreferences() {
  deskSet(
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
  if (window.deskAccountReady) await window.deskAccountReady;
  document.documentElement.classList.add("boot-pending");
  window.MobileWorkspace?.init();
  window.MaterialLedger?.bind();
  upgradeWorkspaceChrome();
  loadAssetPreferences();
  loadImage("/bdesign/imgs/glsbg.gif");
  const remoteSavesPromise = fetchBuildingSaves();
  const [catalog, uidCatalog, packUids, itemIcons, semanticStyles] = await Promise.all([
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
    fetch("/data/semantic_building_styles.json")
      .then((response) => (response.ok ? response.json() : { styles: [] }))
      .catch(() => ({ styles: [] })),
  ]);
  state.catalog = catalog;
  state.uidCatalog = uidCatalog;
  state.packUids = packUids.mapping || {};
  state.packUidAliases = packUids.aliases || {};
  state.itemIcons = itemIcons.icons || {};
  state.smartBuilder.styles = [
    ...normalizeSemanticStyles(semanticStyles),
    ...loadCustomSemanticStyles(),
  ];
  state.smartBuilder.styleId =
    state.smartBuilder.styles.find((style) => style.id === "bazaar-bookshop")?.id ||
    state.smartBuilder.styles[0]?.id ||
    "";
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
  const remoteSaves = await remoteSavesPromise;
  if (remoteSaves && remoteSaves.customs) {
    applyCustomsData(remoteSaves.customs);
    try {
      deskSet(
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
  syncSmartBuildingUi();
  fillThemes();
  fillCategories();
  fillComponents();
  fillBaseKindTabs();
  fillBaseIcons();
  fillCustoms();
  setRailTab("assets");
  const sessionSnap = pickNewerBuildingSnap(
    readLocalBuildingSession(),
    remoteSaves && remoteSaves.session
  );
  const restored = restoreBuildingSession(sessionSnap);
  let wasMobileWorkspace = !!workspaceMode().mobile;
  if (wasMobileWorkspace) {
    state.railCollapsed = restored && state.phase === "design";
    applyRailState();
    if (!buildingFloatingHud()) {
      resetHudPosition(document.getElementById("designDock"), { persist: false });
      resetHudPosition(document.getElementById("canvasToolDock"), { persist: false });
    }
  }
  window.MobileWorkspace?.onModeChange((mode) => {
    if (mode.mobile !== wasMobileWorkspace) {
      setMobileToolsOpen(mode.mobile && state.phase === "design");
      wasMobileWorkspace = mode.mobile;
      if (mode.mobile && !buildingFloatingHud()) {
        resetHudPosition(document.getElementById("designDock"), { persist: false });
        resetHudPosition(document.getElementById("canvasToolDock"), { persist: false });
      } else {
        layoutFloatingHuds();
      }
      if (mode.mobile) {
        if (state.phase === "select") openBuildingRail("assets");
        else closeBuildingRail();
      } else {
        state.railCollapsed = false;
        applyRailState();
        layoutFloatingHuds();
      }
    } else {
      syncBuildingRailAccessibility();
      syncBuildingSheetLayout();
      fitStageToShell();
      if (mode.mobile) layoutFloatingHuds();
    }
  });
  if (
    restored &&
    sessionSnap &&
    Number(sessionSnap.savedAt) > Number(remoteSaves?.session?.savedAt || 0)
  ) {
    putBuildingSaves({ session: sessionSnap }, false).catch((error) => console.warn(error));
  }
  if (!(remoteSaves && remoteSaves.customs) && (state.customs.length || state.customFolders.length)) {
    saveCustoms();
  }
  if (!restored) {
    setPhase("select");
    updateBase();
  }
  if (wasMobileWorkspace && state.phase === "select") openBuildingRail("assets");
  if (wasMobileWorkspace && state.phase === "design") setMobileToolsOpen(true);
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
  warmOtherDesk("/", ["/api/kinds", "/web/app.js?v=289"]);
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

function materialsDockCollapsed() {
  try {
    return deskGet(MATERIALS_DOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function applyMaterialsDockCollapsed(collapsed) {
  const dock = document.getElementById("materialsDock");
  const button = document.getElementById("btnMaterialsDockToggle");
  if (dock) dock.classList.toggle("is-collapsed", !!collapsed);
  if (button) {
    button.textContent = collapsed ? "展开" : "收起";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "展开材料清单" : "收起材料清单");
  }
  layoutFloatingHuds();
}

function setMaterialsDockCollapsed(collapsed) {
  applyMaterialsDockCollapsed(collapsed);
  try {
    deskSet(MATERIALS_DOCK_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

function syncMaterialsDock() {
  const dock = document.getElementById("materialsDock");
  if (dock) dock.hidden = state.phase !== "design";
  applyMaterialsDockCollapsed(materialsDockCollapsed());
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
  syncMaterialsDock();
  if (workspaceMode().mobile) setMobileToolsOpen(phase === "design");
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

function paperFileStem() {
  return String(state.designName || "").replace(/\.txt$/i, "").trim();
}

function updatePaperFileLabel() {
  const row = document.getElementById("paperFileRow");
  const label = document.getElementById("paperFileName");
  if (!row || !label) return;
  const full = String(state.designName || "").trim();
  row.hidden = !full;
  label.textContent = full;
  label.title = full;
}

function currentPaperDownloadName(ext = "txt") {
  const safe = PaperLibraryCore.downloadSafePaperFileName(paperFileStem() || "build");
  return ext === "txt" ? safe : `${safe.replace(/\.txt$/i, "")}.${ext}`;
}

function paperLibraryFileName(raw) {
  return PaperLibraryCore.sanitizePaperFileName(raw || "build");
}

function sourcePaperId() {
  return String(state.sourcePaper?.id || "").trim();
}

function rememberSourcePaper(paper) {
  const id = String(paper?.contentId || paper?.id || "").trim();
  if (!id) {
    state.sourcePaper = null;
    return;
  }
  state.sourcePaper = {
    id,
    name: paperLibraryFileName(paper?.name || state.designName),
    groupId: String(paper?.groupId || paper?.group || ""),
  };
}

function newPaperLibraryId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  state.sourcePaper = null;
  state.baseAnchor = null;
  state.designName = "";
  updatePaperFileLabel();
  state.redo = [];
  invalidateBaseLayout();
  cancelPick();
  fillLayers();
  syncDesignResetButtons();
  markBuildingDirty();
  renderBuilding();
  return true;
}

let houseSelectBackup = null;

function enterHouseSelect() {
  if (state.phase === "design" && state.base) {
    houseSelectBackup = { base: state.base, baseKind: state.baseKind };
  }
  state.baseKind = state.base?.kind ?? state.baseKind ?? 0;
  fillBaseKindTabs();
  fillBaseIcons();
  setPhase("select");
  invalidateBaseLayout();
  updateBase();
  renderBuilding();
}

function cancelHouseSelect() {
  if (houseSelectBackup) {
    state.base = houseSelectBackup.base;
    state.baseKind = houseSelectBackup.baseKind ?? state.base?.kind ?? 0;
    houseSelectBackup = null;
  } else if (!(state.base && placedDesignCount() > 0)) {
    window.location.href = "/";
    return;
  }
  setPhase("design");
  invalidateBaseLayout();
  updateBase();
  fillLayers();
  syncDesignResetButtons();
  renderBuilding();
  if (workspaceMode().mobile) closeBuildingRail();
}

async function beginDesign() {
  houseSelectBackup = null;
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
  if (tab !== "layers" && tab !== "materials") tab = "assets";
  state.railTab = tab;
  if (window.MobileWorkspace?.modeForViewport().mobile) state.mobileSheetMode = tab;
  document.querySelectorAll(".rail-tab").forEach((button) => {
    button.classList.toggle("on", button.dataset.tab === tab);
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  });
  const assets = document.getElementById("tabAssets");
  const layers = document.getElementById("tabLayers");
  const materials = document.getElementById("tabMaterials");
  if (assets) assets.hidden = tab !== "assets";
  if (layers) layers.hidden = tab !== "layers";
  if (materials) materials.hidden = tab !== "materials";
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

function isSmartTool(tool = state.tool) {
  return SMART_TOOLS.has(tool);
}

function normalizeSemanticStyles(doc) {
  const source = Array.isArray(doc)
    ? doc
    : Array.isArray(doc?.styles)
      ? doc.styles
      : doc?.styles && typeof doc.styles === "object"
        ? Object.entries(doc.styles).map(([id, style]) => ({ id, ...style }))
        : [];
  return source
    .filter((style) => style && typeof style === "object")
    .map((style, index) => ({
      ...style,
      id: String(style.id || style.key || `style-${index + 1}`),
      name: String(style.name || style.label || style.id || `风格 ${index + 1}`),
      roles: style.roles && typeof style.roles === "object" ? style.roles : {},
    }));
}

function loadCustomSemanticStyles() {
  try {
    return normalizeSemanticStyles(JSON.parse(deskGet(SMART_STYLES_KEY) || "[]"))
      .map((style) => ({ ...style, custom: true }));
  } catch {
    return [];
  }
}

function saveCurrentMaterialToSmartStyle() {
  const component = state.component;
  const packKey = component?._pack?.key || state.pack?.key || "";
  const local = Number(component?.local ?? component?.id ?? component?.no);
  const roleName = document.getElementById("smartCustomRole")?.value || "wall.body";
  if (!component || component.kind !== "sprite" || !packKey || !Number.isFinite(local)) {
    appAlert("请先在右侧素材栏选择一件素材。", { title: "自定义风格" });
    return;
  }
  let custom = state.smartBuilder.styles.find((style) => style.id === "custom-slot-1");
  if (!custom) {
    const base = currentSmartStyle() || { roles: {} };
    custom = {
      ...JSON.parse(JSON.stringify(base)),
      id: "custom-slot-1",
      name: "我的自定义风格",
      custom: true,
      roles: { ...(base.roles || {}) },
    };
    state.smartBuilder.styles.push(custom);
  }
  custom.roles[roleName] = {
    label: document.querySelector(".component-card.on .component-name")?.textContent?.trim() || roleName,
    candidates: [{
      pack: packKey,
      local,
      legalStates: Array.from({ length: Math.max(1, Math.min(4, component.frames?.length || 1)) }, (_, index) => index),
    }],
    spacing: roleName === "wall.body" ? 28 : 32,
    offsets: { x: 0, y: 0 },
  };
  const saved = state.smartBuilder.styles.filter((style) => style.custom);
  deskSet(SMART_STYLES_KEY, JSON.stringify(saved));
  state.smartBuilder.styleId = custom.id;
  const select = document.getElementById("smartBuildingStyle");
  if (select) select.replaceChildren();
  markBuildingDirty();
  syncSmartBuildingUi();
}

function currentSmartStyle() {
  return (
    state.smartBuilder.styles.find((style) => style.id === state.smartBuilder.styleId) ||
    state.smartBuilder.styles[0] ||
    null
  );
}

function semanticRole(style, name) {
  if (!style?.roles || !name) return null;
  if (["base", "body", "cap", "corner"].includes(name) && style.roles["front-wall"] && style.roles["back-wall"]) {
    const primary = name === "base" ? style.roles["back-wall"] : style.roles["front-wall"];
    return {
      ...primary,
      label: primary.label || name,
      candidates: [
        ...(style.roles["front-wall"].candidates || []),
        ...(style.roles["back-wall"].candidates || []),
      ],
    };
  }
  if (style.roles[name]) return style.roles[name];
  const nested = name.split(".").reduce((node, key) => node?.[key], style.roles);
  if (nested) return nested;
  const aliases = {
    base: ["wall.base", "wall", "back-wall", "ground"],
    body: ["wall.body", "wall", "front-wall", "back-wall"],
    cap: ["wall.cap", "front-wall", "roof"],
    corner: ["wall.corner", "wall", "front-wall"],
    door: ["door", "opening", "window"],
    window: ["window", "opening", "door"],
    sign: ["sign", "ornament", "decor"],
    decor: ["decor", "ornament", "sign"],
  };
  return (aliases[name] || []).map((key) => style.roles[key]).find(Boolean) || null;
}

function semanticCandidate(role, desiredState = null) {
  if (!role) return null;
  if (Array.isArray(role)) {
    const matched = desiredState == null ? null : role.find((candidate) => {
      const states = candidate?.legalStates || candidate?.states;
      return !Array.isArray(states) || states.includes(Number(desiredState));
    });
    return semanticCandidate(matched || role[0], desiredState);
  }
  if (Array.isArray(role.candidates)) return semanticCandidate(role.candidates, desiredState);
  if (Array.isArray(role.materials)) return semanticCandidate(role.materials, desiredState);
  if (role.material) return semanticCandidate(role.material, desiredState);
  return role.pack && Number.isFinite(Number(role.local))
    ? { ...role, pack: String(role.pack), local: Number(role.local) }
    : null;
}

function smartPackUid(packKey) {
  const row = Object.entries(state.packUids || {}).find(([, key]) => key === packKey);
  return row ? Number(row[0]) : 0;
}

function smartConstrainEnd(start, end) {
  if (typeof BI.projectToIsoAxis === "function") {
    const projected = BI.projectToIsoAxis(start, end);
    if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) return projected;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const axes = [{ x: 1, y: 0.5 }, { x: 1, y: -0.5 }];
  let best = end;
  let bestError = Infinity;
  axes.forEach((axis) => {
    const den = axis.x * axis.x + axis.y * axis.y;
    const t = (dx * axis.x + dy * axis.y) / den;
    const point = { x: start.x + axis.x * t, y: start.y + axis.y * t };
    const error = Math.hypot(point.x - end.x, point.y - end.y);
    if (error < bestError) {
      best = point;
      bestError = error;
    }
  });
  return snapGridPoint(best.x, best.y);
}

function nearestSmartWall(point, maxDistance = 34) {
  let best = null;
  state.smartBuilder.walls.forEach((wall, index) => {
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const length2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy) / length2));
    const x = wall.a.x + dx * t;
    const y = wall.a.y + dy * t;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { wall, index, t, x, y, distance };
  });
  return best;
}

function addSmartWall(start, end) {
  const b = smartConstrainEnd(start, end);
  if (Math.hypot(b.x - start.x, b.y - start.y) < 18) return;
  const last = state.smartBuilder.walls[state.smartBuilder.walls.length - 1];
  const a =
    last && Math.hypot(last.b.x - start.x, last.b.y - start.y) < 16
      ? { ...last.b }
      : { x: Math.round(start.x), y: Math.round(start.y) };
  state.smartBuilder.walls.push({
    a,
    b: { x: Math.round(b.x), y: Math.round(b.y) },
    openings: [],
  });
  markBuildingDirty();
  syncSmartBuildingUi();
}

function addSmartMarker(point) {
  const mode = state.smartBuilder.mode;
  if (mode === "door" || mode === "window") {
    const nearest = nearestSmartWall(point);
    if (!nearest) return;
    const width = mode === "door" ? 30 : 34;
    const openings = nearest.wall.openings || (nearest.wall.openings = []);
    const existing = openings.find((row) => Math.abs(Number(row.t) - nearest.t) < 0.08);
    if (existing) {
      existing.kind = mode;
      existing.width = width;
      existing.w = width;
    } else {
      openings.push({ kind: mode, t: Math.max(0.08, Math.min(0.92, nearest.t)), width, w: width });
    }
  } else if (mode === "sign") {
    state.smartBuilder.props.push({ role: "sign", x: Math.round(point.x), y: Math.round(point.y) });
  }
  markBuildingDirty();
  syncSmartBuildingUi();
}

function smartBuilderSnapshot() {
  return {
    v: 1,
    styleId: state.smartBuilder.styleId || "",
    mode: state.smartBuilder.mode || "wall",
    walls: state.smartBuilder.walls.map((wall) => ({
      a: { x: Number(wall.a.x) || 0, y: Number(wall.a.y) || 0 },
      b: { x: Number(wall.b.x) || 0, y: Number(wall.b.y) || 0 },
      openings: (wall.openings || []).map((row) => ({
        kind: row.kind === "door" ? "door" : "window",
        t: Math.max(0, Math.min(1, Number(row.t) || 0)),
        width: Math.max(8, Number(row.width ?? row.w) || 24),
      })),
    })),
    props: state.smartBuilder.props.map((row) => ({
      role: row.role || "sign",
      x: Number(row.x) || 0,
      y: Number(row.y) || 0,
    })),
  };
}

function restoreSmartBuilder(value) {
  if (!value || typeof value !== "object") return;
  const styleId = String(value.styleId || "");
  if (state.smartBuilder.styles.some((style) => style.id === styleId)) state.smartBuilder.styleId = styleId;
  state.smartBuilder.mode = ["wall", "door", "window", "sign"].includes(value.mode) ? value.mode : "wall";
  state.smartBuilder.walls = (Array.isArray(value.walls) ? value.walls : [])
    .filter((wall) => wall?.a && wall?.b)
    .map((wall) => ({
      a: { x: Number(wall.a.x) || 0, y: Number(wall.a.y) || 0 },
      b: { x: Number(wall.b.x) || 0, y: Number(wall.b.y) || 0 },
      openings: Array.isArray(wall.openings) ? wall.openings.map((row) => ({ ...row })) : [],
    }));
  state.smartBuilder.props = (Array.isArray(value.props) ? value.props : []).map((row) => ({ ...row }));
}

function solveSmartDraft() {
  const style = currentSmartStyle();
  if (!style || !state.smartBuilder.walls.length || typeof BI.solveSmartBuilding !== "function") {
    return { placements: [], warnings: style ? [] : ["没有可用风格"] };
  }
  const solverStyle = {
    ...style,
    pitch: Number(style.pitch) || Number(style.spacing?.wall) || 28,
    layers: ["base", "body", "cap"],
    roles: {
      base: { ...(semanticRole(style, "base") || {}), offsetY: Number(semanticRole(style, "base")?.offsetY) || 2 },
      body: { ...(semanticRole(style, "body") || {}) },
      cap: { ...(semanticRole(style, "cap") || {}), offsetY: Number(semanticRole(style, "cap")?.offsetY) || -22 },
      corner: { ...(semanticRole(style, "corner") || {}) },
      door: { ...(semanticRole(style, "door") || {}) },
      window: { ...(semanticRole(style, "window") || {}) },
      sign: { ...(semanticRole(style, "sign") || {}) },
      decor: { ...(semanticRole(style, "decor") || {}) },
    },
  };
  const input = {
    style: solverStyle,
    walls: state.smartBuilder.walls,
    props: state.smartBuilder.props,
  };
  const solved = BI.solveSmartBuilding(input);
  return Array.isArray(solved)
    ? { placements: solved, warnings: [] }
    : {
        placements: solved?.placements || solved?.records || [],
        warnings: (solved?.warnings || []).map((warning) => warning?.message || String(warning)),
      };
}

function smartRoleGroup(role) {
  const prefix = String(role || "decor").split(".")[0];
  return {
    wall: "墙身",
    base: "地基",
    cap: "檐口",
    roof: "屋顶",
    door: "门窗",
    window: "门窗",
    sign: "招牌",
    decor: "装饰",
  }[prefix] || (String(role).includes("base") ? "地基" : String(role).includes("cap") ? "檐口" : "墙身");
}

function smartPlacementRecord(placement, runId) {
  const roleName = String(placement.role || placement.semanticRole || "wall.body");
  const role = semanticRole(currentSmartStyle(), roleName);
  const candidate =
    semanticCandidate(placement.material || placement.candidate || role, placement.state) ||
    semanticCandidate(semanticRole(currentSmartStyle(), role?.fallback), placement.state);
  if (!candidate) return null;
  const uid = smartPackUid(candidate.pack);
  if (!uid) return null;
  const legalStates = candidate.legalStates || candidate.states || role?.legalStates || role?.states;
  const requestedState = Number(placement.state ?? candidate.state ?? legalStates?.[0] ?? 0);
  const safeState = Array.isArray(legalStates) && legalStates.length && !legalStates.includes(requestedState)
    ? Number(legalStates[0]) || 0
    : Math.max(0, Math.min(63, Math.round(requestedState) || 0));
  const groupName = smartRoleGroup(roleName);
  return hydrateRecord({
    mode: "desk",
    x: Math.round(Number(placement.x) || 0),
    y: Math.round(Number(placement.y) || 0),
    mat: uid * 1000 + Number(candidate.local),
    state: safeState,
    packKey: candidate.pack,
    group: `${runId}-${groupName}`,
    groupName,
    label: String(placement.label || role?.label || candidate.label || groupName),
  });
}

function applySmartBuilding() {
  const solved = solveSmartDraft();
  const runId = `smart-${Date.now().toString(36)}`;
  const rows = solved.placements.map((placement) => smartPlacementRecord(placement, runId)).filter(Boolean);
  if (!rows.length) {
    appAlert(solved.warnings[0] || "当前风格缺少可生成的语义素材。", { title: "无法生成" });
    return;
  }
  pushHistory();
  const indices = insertDeskRecords(rows);
  setSelection(indices, { expandGroup: false });
  state.smartBuilder.warnings = solved.warnings;
  fillLayers();
  renderBuilding();
  syncSmartBuildingUi();
}

function syncSmartBuildingOverlay() {
  const svg = document.getElementById("smartBuildingOverlay");
  if (!svg) return;
  const visible = state.phase === "design" && state.smartBuilder.walls.length > 0;
  svg.hidden = !visible;
  svg.setAttribute("viewBox", "0 0 570 550");
  svg.replaceChildren();
  if (!visible) return;
  const ns = "http://www.w3.org/2000/svg";
  state.smartBuilder.walls.forEach((wall) => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "smart-wall-line");
    line.setAttribute("x1", wall.a.x);
    line.setAttribute("y1", wall.a.y);
    line.setAttribute("x2", wall.b.x);
    line.setAttribute("y2", wall.b.y);
    svg.append(line);
    [wall.a, wall.b].forEach((point) => {
      const node = document.createElementNS(ns, "circle");
      node.setAttribute("class", "smart-wall-node");
      node.setAttribute("cx", point.x);
      node.setAttribute("cy", point.y);
      node.setAttribute("r", "5");
      svg.append(node);
    });
    (wall.openings || []).forEach((opening) => {
      const marker = document.createElementNS(ns, opening.kind === "door" ? "rect" : "circle");
      marker.setAttribute("class", "smart-opening");
      const x = wall.a.x + (wall.b.x - wall.a.x) * opening.t;
      const y = wall.a.y + (wall.b.y - wall.a.y) * opening.t;
      if (opening.kind === "door") {
        marker.setAttribute("x", x - 6);
        marker.setAttribute("y", y - 8);
        marker.setAttribute("width", "12");
        marker.setAttribute("height", "16");
      } else {
        marker.setAttribute("cx", x);
        marker.setAttribute("cy", y);
        marker.setAttribute("r", "6");
      }
      svg.append(marker);
    });
  });
  state.smartBuilder.props.forEach((prop) => {
    const marker = document.createElementNS(ns, "circle");
    marker.setAttribute("class", "smart-opening");
    marker.setAttribute("cx", prop.x);
    marker.setAttribute("cy", prop.y);
    marker.setAttribute("r", "7");
    svg.append(marker);
  });
}

function syncSmartBuildingUi() {
  const panel = document.getElementById("smartBuildingPanel");
  const styleSelect = document.getElementById("smartBuildingStyle");
  if (styleSelect && !styleSelect.options.length) {
    state.smartBuilder.styles.forEach((style) => styleSelect.add(new Option(style.name, style.id)));
  }
  if (styleSelect) styleSelect.value = state.smartBuilder.styleId;
  document.querySelectorAll("[data-smart-mode]").forEach((button) => {
    const on = button.dataset.smartMode === state.smartBuilder.mode;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const openings = state.smartBuilder.walls.reduce((sum, wall) => sum + (wall.openings?.length || 0), 0);
  const summary = document.getElementById("smartBuildingSummary");
  if (summary) {
    const warning = state.smartBuilder.warnings[0] ? ` ${state.smartBuilder.warnings[0]}` : "";
    const mode = state.smartBuilder.mode;
    let next = "下一步：在草地上按住鼠标拖一条斜线";
    if (!state.smartBuilder.walls.length) {
      next = mode === "wall"
        ? "下一步：在草地上按住拖一条斜线，松开后出现绿虚线"
        : "先画至少一段墙，再点绿线放门窗";
    } else if (mode === "door" || mode === "window") {
      next = `已画 ${state.smartBuilder.walls.length} 段墙。点绿虚线放${mode === "door" ? "门" : "窗"}，再点「生成建筑」`;
    } else if (mode === "sign") {
      next = "点画布放招牌位置，再点「生成建筑」";
    } else if (state.smartBuilder.walls.length === 1) {
      next = "已画 1 段墙。再拖一条接成 L，或直接点「生成建筑」铺素材";
    } else {
      next = `已画 ${state.smartBuilder.walls.length} 段墙 · ${openings} 个门窗。点「生成建筑」铺墙/基座/檐口`;
    }
    summary.textContent = `${next}${warning}`;
  }
  const apply = document.getElementById("btnSmartBuildingApply");
  if (apply) apply.disabled = !state.smartBuilder.walls.length || !currentSmartStyle();
  if (panel && isSmartTool()) panel.hidden = false;
  syncSmartBuildingOverlay();
}

function openSmartBuilder() {
  setRailTab("assets");
  const panel = document.getElementById("smartBuildingPanel");
  if (panel) panel.hidden = false;
  setActiveTool("smart-wall");
  syncSmartBuildingUi();
  if (workspaceMode().mobile) openBuildingRail("assets");
}

function closeSmartBuilder() {
  const panel = document.getElementById("smartBuildingPanel");
  if (panel) panel.hidden = true;
  if (isSmartTool()) setActiveTool("select");
  syncSmartBuildingOverlay();
}

function isStampLike(tool = state.tool) {
  return tool === "stamp" || tool === "paint";
}

function armPaintBrush() {
  // 点选素材默认停留在“选择”工具：点空白处放一件并选中它，点已有素材则
  // 直接选中。连续笔刷要显式切到点刷（B）等铺放工具。
  if (isPlaceTool()) return;
  if (state.tool !== "select") setActiveTool("select");
}

function selectionAsCustomBrush() {
  const records = selectedUnlockedIndices()
    .map((index) => state.records[index])
    .filter((record) => record && Number(record.mat) && !record.hidden);
  if (records.length < 2) return null;
  const originX = Math.min(...records.map((record) => Number(record.x) || 0));
  const originY = Math.min(...records.map((record) => Number(record.y) || 0));
  return {
    id: "selection-brush",
    name: `选中 ${records.length} 件`,
    records: records.map((record) => ({
      mat: record.mat,
      packKey: record.packKey || record.pack?.key,
      state: record.state ?? record.flip ?? 0,
      dx: (Number(record.x) || 0) - originX,
      dy: (Number(record.y) || 0) - originY,
    })),
  };
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
  const selection = selectionAsCustomBrush();
  if (selection) return { type: "custom", custom: selection };
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

function stampGroundSize(component = stampTemplate()?.component, face = state.brushState) {
  const geometry = component
    ? frameGeometry(component, face)
    : stampGeometry();
  const pack = component?._pack || state.pack;
  const image = component ? loadImage(spriteUrl(component, pack, face)) : null;
  const opaque = cacheSpriteOpaqueBounds(image);
  const span = opaque?.width > 1 ? opaque.width : Number(geometry.width) || 24;
  const width = Math.max(12, Math.min(72, span * 0.72));
  return { width, depth: Math.max(8, width * 0.5) };
}

function stampFootOffset(component, face = 0) {
  const geometry = frameGeometry(component, face);
  const pack = component?._pack || state.pack;
  const image = loadImage(spriteUrl(component, pack, face));
  const opaque = cacheSpriteOpaqueBounds(image);
  if (opaque && opaque.width > 1 && opaque.height > 1) {
    return {
      x: opaque.x + opaque.width / 2,
      y: opaque.y + opaque.height - Math.max(1, opaque.height * 0.08),
    };
  }
  return {
    x: (geometry.width || 16) / 2,
    y: (geometry.height || 16) * 0.8,
  };
}

function stampPitch(aligned = false) {
  const ground = stampGroundSize();
  const width = Math.max(8, Math.round(ground.width));
  const depth = Math.max(8, Math.round(ground.depth));
  if (aligned) return { x: width, y: depth };
  return { x: width, y: depth };
}

function lineStampStep(stroke) {
  const ground = stampGroundSize();
  const dx = Number(stroke?.end?.x) - Number(stroke?.start?.x);
  const dy = Number(stroke?.end?.y) - Number(stroke?.start?.y);
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return Math.max(6, ground.width * 0.5);
  const ux = Math.abs(dx / length);
  const uy = Math.abs(dy / length);
  return Math.max(6, ux * ground.width + uy * ground.depth);
}

function depthSortedStampPoints(points) {
  return points.slice().sort((a, b) => a.x + 2 * a.y - (b.x + 2 * b.y) || a.x - b.x);
}

function isoCellKey(x, y, stepU) {
  const iso = BI.sceneToIso(x, y);
  const step = Math.max(1, Number(stepU) || 4);
  return `${Math.round(iso.u / step)}:${Math.round(iso.v / step)}`;
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
  const useIso = snapAxis() !== "ortho";
  const lineStep = stroke.tool === "line" || stroke.tool === "ring" ? lineStampStep(stroke) : 0;
  return BI.collectStampPoints(stroke.tool, stroke.start, stroke.end, stampPitch(gridAligned), {
    aligned: gridAligned || ringEllipse,
    cap: STAMP_CAP,
    lineStep,
    lattice: useIso ? "iso" : "ortho",
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
  const insertNote = state.layerInsert
    ? state.layerInsert.kind === "front"
      ? "新素材将插到最前 · Esc 取消插入点"
      : "新素材将插到标记的图层之间 · Esc 取消插入点"
    : "";
  if (state.tool === "select" && hasBrush()) {
    hint.textContent = insertNote
      ? `${insertNote} · 点空白处放一件`
      : "点空白处放一件并选中 · 连续铺放按 B 切点刷";
    return;
  }
  if (isPlaceTool() && !stampTemplate()) {
    hint.textContent = insertNote || "先点右侧素材，或先选中一组再铺";
    return;
  }
  if (isPlaceTool() && selectionAsCustomBrush() && !state.customBrush && !state.component) {
    hint.textContent = insertNote
      ? `${insertNote} · 拖选中组移动 · 点空白处按组铺放`
      : "拖选中组移动 · 点空白处按组铺放";
    return;
  }
  const extra = state.shapeStroke ? ` · ${shapeStampPoints().length} 件` : "";
  hint.textContent = insertNote ? `${insertNote} · ${info.hint}${extra}` : `${info.hint}${extra}`;
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
  const packUid = packUidOf(usePack);
  const local = Number(componentId);
  if (packUid != null) return packUid * 1000 + local;
  return local;
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
  if (record?.pack) return record.pack;
  if (record?.packKey) return packByKey(record.packKey);
  if (record?.localPackUnknown) return null;
  return state.pack;
}

function recordComponent(record) {
  if (!record) return null;
  if (record.component) return record.component;
  const pack = recordPack(record);
  if (!pack) return null;
  const component = componentByUid(record.mat, pack);
  if (component) {
    record.component = component;
    if (!record.pack) record.pack = component._pack || pack;
    if (!record.packKey) record.packKey = (component._pack || pack)?.key;
    if (record.packKey) record.localPackUnknown = false;
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
let lastCanvasClient = null;
let pendingZoomAnchor = null;

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

function canvasFrameSize() {
  const { w: sw, h: sh } = shellViewSize();
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(state.zoom) || 1));
  const gutter = panGutter(sw, sh);
  return {
    sw,
    sh,
    zoom,
    gutter,
    width: Math.max(sw, Math.round(sw * zoom)) + gutter.x * 2,
    height: Math.max(sh, Math.round(sh * zoom)) + gutter.y * 2,
  };
}

function applyZoom() {
  const frame = document.getElementById("canvasFrame");
  const inner = document.getElementById("canvasZoomInner");
  const shell = document.getElementById("canvasShell");
  const label = document.getElementById("btnZoomReset");
  if (!frame || !shell) return;
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(state.zoom) || 1));
  // The workspace is the canvas. Never letterbox a smaller rectangle of grass.
  const { width, height } = canvasFrameSize();
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.aspectRatio = `${width} / ${height}`;
  if (inner) {
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;
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

function rememberCanvasClient(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  lastCanvasClient = { x: clientX, y: clientY };
}

function zoomClientPoint(clientX, clientY) {
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return { x: clientX, y: clientY };
  }
  if (lastCanvasClient) return lastCanvasClient;
  const shell = document.getElementById("canvasShell");
  if (!shell) return null;
  const rect = shell.getBoundingClientRect();
  return {
    x: rect.left + shell.clientWidth / 2,
    y: rect.top + shell.clientHeight / 2,
  };
}

function keepSceneUnderClient(scene, clientX, clientY) {
  const shell = document.getElementById("canvasShell");
  if (!shell || !scene || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  const after = viewportTransform().sceneToClient(scene.x, scene.y);
  if (!Number.isFinite(after.x) || !Number.isFinite(after.y)) return;
  shell.scrollLeft += after.x - clientX;
  shell.scrollTop += after.y - clientY;
}

function setZoom(next, clientX, clientY, options = {}) {
  const shell = document.getElementById("canvasShell");
  const clamped = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
  const recenter = options.recenter === true;
  const pin = options.pin !== false && !recenter;
  if (!shell || Math.abs(clamped - state.zoom) < 0.001) {
    state.zoom = clamped;
    applyZoom();
    markBuildingDirty();
    renderBuilding();
    return;
  }
  let scene = null;
  let point = null;
  if (pin) {
    point = zoomClientPoint(clientX, clientY);
    if (point) {
      rememberCanvasClient(point.x, point.y);
      scene = clientToContent(point.x, point.y);
      pendingZoomAnchor = { scene, clientX: point.x, clientY: point.y };
    }
  } else {
    pendingZoomAnchor = null;
  }
  state.zoom = clamped;
  applyZoom();
  if (recenter) {
    centerCanvasInShell();
  } else if (scene && point) {
    keepSceneUnderClient(scene, point.x, point.y);
  }
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

/** Grow grass to the zoomed frame, including pan room. Do not move the locked 570×550 house frame. */
function expandPlaneToShell(layout) {
  const frame = canvasFrameSize();
  const fit = houseFitScale(frame.sw, frame.sh);
  const scale = fit * frame.zoom;
  const curW = Math.max(DESIGN_W, layout.planeW || DESIGN_W);
  const curH = Math.max(DESIGN_H, layout.planeH || DESIGN_H);
  if (!(scale > 0.001)) {
    layout.planeW = curW;
    layout.planeH = curH;
    return layout;
  }
  let needW = Math.min(MAX_PLANE, Math.max(curW, Math.ceil(frame.width / scale)));
  let needH = Math.min(MAX_PLANE, Math.max(curH, Math.ceil(frame.height / scale)));
  const aspect = frame.width / frame.height;
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
  if (component.kind === "sprite") bindSpriteThumb(image, spriteUrl(component, pack, 0, true));
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
    if (isCoarsePointer()) return;
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
    if (window.MobileWorkspace?.modeForViewport().mobile) closeBuildingRailOnPick();
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

function bindSpriteThumb(image, url) {
  if (!image || !url) return;
  const cached = loadImage(url);
  if (cached?.complete && cached.naturalWidth) {
    image.src = cached.currentSrc || cached.src || url;
    return;
  }
  image.src = url;
}

function scheduleAssetThumbPrefetch(rows) {
  const key = `${assetFilterKey}|${rows.length}|${rows[0]?.key || ""}`;
  if (key === assetPrefetchKey) return;
  assetPrefetchKey = key;
  const limit = Math.min(rows.length, 48);
  let index = 0;
  const schedule = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 80));
  const step = (deadline) => {
    while (index < limit && (!deadline?.timeRemaining || deadline.timeRemaining() > 6)) {
      const row = rows[index++];
      if (row?.component?.kind === "sprite") {
        const url = spriteUrl(row.component, row.pack, 0, true);
        if (url) loadImage(url);
      }
    }
    if (index < limit) schedule(step);
  };
  schedule(step);
}

function paintAssetWindow(force = false) {
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
  const windowKey = `${assetFilterKey}|${start}|${end}|${cols}|${Math.round(rowH)}`;
  if (!force && windowKey === assetWindowKey && list.childElementCount) return;
  assetWindowKey = windowKey;
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
    assetWindowKey = "";
    list.replaceChildren();
    syncAssetCategoryView();
    updateAssetFilterSummary();
    return;
  }
  syncAssetCategoryView();
  if (!activeThemePacks().length) {
    assetRowsCache = [];
    assetWindowKey = "";
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
    assetWindowKey = "";
    list.replaceChildren(empty);
    updateAssetFilterSummary();
    return;
  }
  paintAssetWindow(true);
  scheduleAssetThumbPrefetch(assetRowsCache);
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
  const mobileActive =
    state.phase === "design" && (count >= 1 || hasBrush() || !!state.component || !!state.customBrush);
  if (mobileBar) mobileBar.hidden = !mobileActive;
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
    state.groupIsolate && count === 1
      ? ` · 组内单件`
      : groupNames.size === 1
        ? ` · 组「${[...groupNames][0]}」`
        : groupNames.size > 1
          ? ` · ${groupNames.size}组`
          : "";
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
    updateCurrentMaterials(null, {
      records: state.selected.map((index) => state.records[index]).filter(Boolean),
      title: `已选 ${count} 项`,
    });
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

function sortedMaterialPairs(map) {
  return [...(map || [])].sort(
    (a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0) || String(a[0]).localeCompare(String(b[0]), "zh")
  );
}

function materialRowsFromPairs(pairs, source = "") {
  return pairs.map(([name, count]) => ({
    name,
    count,
    iconUrl: materialIconUrl(name),
    source,
  }));
}

function materialsFromComponent(component, source = "") {
  return (component?.materials || []).map((item) => ({
    name: item.name,
    count: item.count,
    iconUrl: materialIconUrl(item.name),
    source: source || component.category || "此件",
  }));
}

function materialsFromRecords(records, source = "选中") {
  const map = new Map();
  (records || []).forEach((record) => {
    const component = recordComponent(record);
    (component?.materials || []).forEach((item) => {
      map.set(item.name, (map.get(item.name) || 0) + item.count);
    });
  });
  return materialRowsFromPairs(sortedMaterialPairs(map), source);
}

function buildingMaterialGroups(records = state.records) {
  const report = buildingMaterialReport(records);
  const baseMap = new Map();
  (state.base?.baseMaterials || []).forEach((item) => {
    baseMap.set(item.name, (baseMap.get(item.name) || 0) + item.count);
  });
  const spriteMap = new Map();
  records.forEach((record) => {
    if (record.hidden || Number(record.mat) === 0) return;
    const component = recordComponent(record);
    (component?.materials || []).forEach((item) => {
      spriteMap.set(item.name, (spriteMap.get(item.name) || 0) + item.count);
    });
  });
  const groups = [];
  const totalRows = materialRowsFromPairs(sortedMaterialPairs(report.totals), "整栋");
  if (totalRows.length) groups.push({ id: "total", name: "合计", rows: totalRows });
  if (baseMap.size) {
    groups.push({ name: "户型", rows: materialRowsFromPairs(sortedMaterialPairs(baseMap), "户型") });
  }
  if (spriteMap.size) {
    groups.push({
      name: "装修素材",
      rows: materialRowsFromPairs(sortedMaterialPairs(spriteMap), "装修"),
    });
  }
  return { groups, report, totalRows };
}

function buildingLedgerPayload() {
  const { groups } = buildingMaterialGroups();
  const baseName = state.base?.name || "建筑";
  return {
    title: `${baseName} 材料清单`,
    filename: `${baseName}-材料清单`,
    groups,
  };
}

let pieceMaterialPayload = null;
let showingPieceMaterials = false;

function pieceLedgerPayload(rows, title) {
  return {
    title: title || "此件材料",
    filename: `${title || "此件"}-材料清单`,
    groups: [{ name: title || "此件", rows: rows || [] }],
  };
}

function openBuildingMaterialLedger() {
  window.MaterialLedger?.open(buildingLedgerPayload());
}

function openPieceMaterialLedger() {
  if (pieceMaterialPayload?.groups?.[0]?.rows?.length) {
    window.MaterialLedger?.open(pieceMaterialPayload);
    return;
  }
  openBuildingMaterialLedger();
}

function fillMaterialRows(host, rows, emptyText) {
  if (!host) return;
  if (window.MaterialLedger?.fillList) {
    window.MaterialLedger.fillList(host, rows, { empty: emptyText || "暂无材料" });
    return;
  }
  host.replaceChildren();
  if (!rows?.length) {
    const empty = document.createElement("p");
    empty.className = "design-materials-empty";
    empty.textContent = emptyText || "暂无材料";
    host.appendChild(empty);
  }
}

function setDesignMaterials(rows, title, piece) {
  const heading = document.getElementById("designMaterialsTitle");
  const pieceBtn = document.getElementById("btnPieceMaterials");
  if (heading) heading.textContent = title || (piece ? "此件材料" : "整栋材料");
  if (pieceBtn) pieceBtn.hidden = !piece;
  fillMaterialRows(document.getElementById("designMaterialsList"), rows, piece ? "此件没有材料需求" : "还没有材料");
}

function updateCurrentMaterials(component, options = {}) {
  const host = document.getElementById("currentMaterials");
  const records = options.records || null;
  let rows = [];
  let title = "整栋材料";
  showingPieceMaterials = false;
  if (component) {
    rows = materialsFromComponent(component);
    title = options.title || `${component.category || ""} #${component.id}`.trim() || "此件材料";
    showingPieceMaterials = true;
  } else if (records?.length) {
    rows = materialsFromRecords(records, options.title || "选中");
    title = options.title || `已选 ${records.length} 项`;
    showingPieceMaterials = true;
  } else {
    rows = buildingMaterialGroups().totalRows;
  }
  pieceMaterialPayload = showingPieceMaterials ? pieceLedgerPayload(rows, title) : null;
  if (host) {
    host.replaceChildren();
    rows.slice(0, 12).forEach((item) => host.appendChild(renderMaterialChip(item.name, item.count)));
    host.disabled = !showingPieceMaterials || !rows.length;
    host.hidden = false;
    host.title = showingPieceMaterials ? "查看此件材料" : "";
  }
  const pieceRow = host?.closest(".materials-dock-piece");
  const mode = workspaceMode();
  if (pieceRow && mode.mobile) pieceRow.hidden = !showingPieceMaterials;
  setDesignMaterials(rows, showingPieceMaterials ? title : "整栋材料", showingPieceMaterials);
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
  sortedMaterialPairs(rows).forEach(([name, count]) => {
    host.appendChild(renderMaterialChip(name, count));
  });
}

function updateAllMaterials() {
  const report = buildingMaterialReport();
  const strip = document.getElementById("allMaterials");
  fillMaterialList(strip, report.totals, report.unresolved);
  const meta = document.getElementById("allMaterialsMeta");
  const kinds = report.totals.size;
  let pieces = 0;
  report.totals.forEach((count) => {
    pieces += count;
  });
  if (meta) meta.textContent = kinds ? `${kinds} 种 · ${pieces} 件` : "";
  const totalRows = materialRowsFromPairs(sortedMaterialPairs(report.totals), "整栋");
  const projectMeta = document.getElementById("projectMaterialsMeta");
  if (projectMeta) projectMeta.textContent = kinds ? `${kinds}种 · ${pieces}件` : "暂无材料";
  if (!showingPieceMaterials) setDesignMaterials(totalRows, "整栋材料", false);
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
  const prev = target.imageSmoothingEnabled;
  target.imageSmoothingEnabled = false;
  const dx = Math.round(Number(x) || 0);
  const dy = Math.round(Number(y) || 0);
  const dw = Math.round(Number(width) || 0);
  const dh = Math.round(Number(height) || 0);
  if (dw > 0 && dh > 0) target.drawImage(image, dx, dy, dw, dh);
  else target.drawImage(image, dx, dy);
  target.imageSmoothingEnabled = prev;
}

function drawSpriteHighlight(target, image, x, y, width, height) {
  if (!image?.complete || !image.naturalWidth) return;
  const prevComp = target.globalCompositeOperation;
  const prevAlpha = target.globalAlpha;
  target.globalCompositeOperation = "lighter";
  target.globalAlpha = SELECT_LIT;
  drawFrameImage(target, image, x, y, width, height);
  target.globalCompositeOperation = prevComp;
  target.globalAlpha = prevAlpha;
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

let grassPlaneCache = null;
let grassPlaneKey = "";

function drawGrassPlane(grass) {
  // The grass backdrop is identical between frames; tiling it per paint was a
  // few hundred drawImage calls on every ghost move / drag frame. Cache the
  // composed plane and re-tile only when the plane size or source changes.
  const ready = !!(grass?.complete && grass.naturalWidth);
  const key = (ready ? grass.src : "pending") + "|" + canvas.width + "x" + canvas.height;
  if (grassPlaneKey !== key) {
    if (!grassPlaneCache) grassPlaneCache = document.createElement("canvas");
    grassPlaneCache.width = canvas.width;
    grassPlaneCache.height = canvas.height;
    fillGrassPattern(grassPlaneCache.getContext("2d"), grass, canvas.width, canvas.height, false);
    grassPlaneKey = key;
  }
  ctx.drawImage(grassPlaneCache, 0, 0);
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
    drawGrassPlane(grass);
    return;
  }

  const layout = computeBaseLayout(base, floor, mask);
  state.baseLayout = layout;
  ensureDesignPlane(layout.planeW, layout.planeH);
  drawGrassPlane(grass);

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
  const prevKey = lastSceneKey;
  lastSceneKey = key;
  applyZoom();
  if (pendingZoomAnchor) {
    const anchor = pendingZoomAnchor;
    pendingZoomAnchor = null;
    requestAnimationFrame(() => {
      keepSceneUnderClient(anchor.scene, anchor.clientX, anchor.clientY);
      syncViewportOverlays();
    });
    return;
  }
  const prevBase = prevKey.split("|")[0];
  const baseNo = String(state.base?.no || "?");
  if (!prevKey || prevBase !== baseNo) {
    requestAnimationFrame(() => centerCanvasInShell());
  }
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
  if (!state.ghost || state.phase !== "design") return;
  const template = stampTemplate();
  if (!template) return;
  if (template.type === "custom") {
    const custom = template.custom;
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
  const record = template.record;
  const component = template.component || recordComponent(record);
  if (!component || component.kind !== "sprite") return;
  const pack = template.pack || recordPack(record) || component._pack || state.pack;
  const face = record ? record.state ?? record.flip ?? 0 : state.brushState;
  const url = spriteUrl(component, pack, face);
  const image = loadImage(url);
  const geometry = frameGeometry(component, face);
  const foot = stampFootOffset(component, face);
  const x = Math.round(state.ghost.x - foot.x);
  const y = Math.round(state.ghost.y - foot.y);
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawGroundDiamond(state.ghost.x, state.ghost.y);
  if (image?.complete && image.naturalWidth) {
    drawFrameImage(ctx, image, x, y, geometry.width, geometry.height);
  } else {
    ctx.fillStyle = "#7ec8a0";
    ctx.fillRect(x, y, Math.max(16, geometry.width), Math.max(16, geometry.height));
  }
  ctx.restore();
}

function drawGroundDiamond(cx, cy) {
  const ground = stampGroundSize();
  ctx.beginPath();
  ctx.moveTo(cx, cy - ground.depth / 2);
  ctx.lineTo(cx + ground.width / 2, cy);
  ctx.lineTo(cx, cy + ground.depth / 2);
  ctx.lineTo(cx - ground.width / 2, cy);
  ctx.closePath();
  ctx.strokeStyle = "rgba(46, 107, 79, 0.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawStampGhostAt(template, cx, cy) {
  drawGroundDiamond(cx, cy);
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
  const foot = stampFootOffset(component, face);
  const x = Math.round(cx - foot.x);
  const y = Math.round(cy - foot.y);
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
  depthSortedStampPoints(shapeStampPoints(stroke))
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
  ctx.imageSmoothingEnabled = false;
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
    const selectedSet = new Set(state.selected);
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
        if (selectedSet.has(index)) {
          drawSpriteHighlight(ctx, image, box.x + offsetX, box.y + offsetY, box.width, box.height);
        }
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
      state.records.forEach((record, index) => {
        if (!movingSet?.has(index) || !selectedSet.has(index) || !isCanvasRecord(record)) return;
        const component = recordComponent(record);
        const pack = recordPack(record) || component?._pack;
        const image = loadImage(spriteUrl(component, pack, record.state ?? record.flip ?? 0));
        const box = recordBox(record);
        drawSpriteHighlight(
          ctx,
          image,
          box.x + (drag.offsetX || 0),
          box.y + (drag.offsetY || 0),
          box.width,
          box.height
        );
      });
    }
    ctx.restore();
    drawUnlitCover();
    ctx.save();
    ctx.translate(dx, dy);
    drawGhost();
    drawShapePreview();
    drawGroupBounds();
    drawMarquee();
    drawGuides();
    ctx.restore();
  } else {
    drawUnlitCover();
  }
  if (canvas.width !== prevW || canvas.height !== prevH || state.base) afterBaseDrawn();
  if (!state.dragging && !state.marquee) scheduleMaterials();
  syncViewportOverlays();
}

let materialsTimer = 0;

function scheduleMaterials() {
  // Ghost moves repaint at pointer rate; the material report is O(records)
  // plus a DOM rebuild and never needs to track the cursor. Trail it.
  if (materialsTimer) return;
  materialsTimer = setTimeout(() => {
    materialsTimer = 0;
    updateAllMaterials();
  }, 250);
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
  if (!stroke || (!isPlaceTool(stroke.tool) && !isSmartTool(stroke.tool))) {
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
  } else if (stroke.tool === "line" || stroke.tool === "smart-wall") {
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

let refGuidesActive = false;

function setRefGuidesActive(active) {
  if (refGuidesActive === active) return;
  refGuidesActive = active;
  syncViewportOverlays();
}

function syncSelectionOverlay() {
  const selection = document.getElementById("selectionOverlay");
  if (!selection) return;
  selection.hidden = true;
  selection.replaceChildren();
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
  syncSelectionOverlay();
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
    if ((guide.type === "v" || guide.type === "h") && guide.from != null && guide.to != null) {
      // 对齐区段加粗高亮：这段才是真正“贴上”的两个盒子的范围。
      const core = document.createElement("i");
      core.className = `snap-guide is-core ${guide.type === "v" ? "is-vertical" : "is-horizontal"}`;
      if (guide.type === "v") {
        const a = scenePointToFrame(guide.pos, guide.from, transform);
        const b = scenePointToFrame(guide.pos, guide.to, transform);
        core.style.left = `${a.x}px`;
        core.style.top = `${a.y}px`;
        core.style.height = `${Math.max(1, b.y - a.y)}px`;
      } else {
        const a = scenePointToFrame(guide.from, guide.pos, transform);
        const b = scenePointToFrame(guide.to, guide.pos, transform);
        core.style.left = `${a.x}px`;
        core.style.top = `${a.y}px`;
        core.style.width = `${Math.max(1, b.x - a.x)}px`;
      }
      guideLayer.appendChild(core);
      if (guide.gap && guide.gapAt != null) {
        const badge = document.createElement("span");
        badge.className = "snap-gap-badge";
        badge.textContent = `${guide.gap}`;
        const at =
          guide.type === "v"
            ? scenePointToFrame(guide.pos, guide.gapAt, transform)
            : scenePointToFrame(guide.gapAt, guide.pos, transform);
        badge.style.left = `${at.x}px`;
        badge.style.top = `${at.y}px`;
        guideLayer.appendChild(badge);
      }
    }
  });
  if (refGuidesActive && state.phase === "design" && state.selected.length && !state.marquee) {
    appendNeighborRefGuides(guideLayer, transform);
  }
}

function selectionSceneBounds() {
  const ox = state.dragging?.offsetX || 0;
  const oy = state.dragging?.offsetY || 0;
  const boxes = [];
  state.selected.forEach((index) => {
    const record = state.records[index];
    if (!isCanvasRecord(record)) return;
    const box = recordHitBox(record);
    boxes.push({ box: { x: box.x + ox, y: box.y + oy, width: box.width, height: box.height } });
  });
  return unionBox(boxes);
}

const REF_GUIDE_RANGE = 360;
const REF_GUIDE_NEIGHBORS = 4;

function appendNeighborRefGuides(guideLayer, transform) {
  // 按住 Ctrl：以选区为基准，找最近的几件素材，画出它们的中线/近对齐边
  // 和两者的间距，作为手动对齐的参考。
  const bounds = selectionSceneBounds();
  if (!bounds) return;
  const selectedSet = new Set(state.selected);
  const rows = [];
  state.records.forEach((record, index) => {
    if (selectedSet.has(index) || !isCanvasRecord(record) || record.hidden) return;
    const box = BI.normalizeRect(recordHitBox(record));
    const dx = Math.max(box.left - bounds.right, bounds.left - box.right, 0);
    const dy = Math.max(box.top - bounds.bottom, bounds.top - box.bottom, 0);
    const dist = Math.hypot(dx, dy);
    if (dist <= REF_GUIDE_RANGE) rows.push({ box, dist });
  });
  rows.sort((a, b) => a.dist - b.dist);
  const s = {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
    cx: (bounds.left + bounds.right) / 2,
    cy: (bounds.top + bounds.bottom) / 2,
  };
  const addLine = (vertical, pos, lo, hi, aligned) => {
    const line = document.createElement("i");
    line.className =
      `ref-guide ${vertical ? "is-vertical" : "is-horizontal"}` + (aligned ? " is-aligned" : "");
    const a = vertical ? scenePointToFrame(pos, lo, transform) : scenePointToFrame(lo, pos, transform);
    const b = vertical ? scenePointToFrame(pos, hi, transform) : scenePointToFrame(hi, pos, transform);
    line.style.left = `${a.x}px`;
    line.style.top = `${a.y}px`;
    if (vertical) line.style.height = `${Math.max(1, b.y - a.y)}px`;
    else line.style.width = `${Math.max(1, b.x - a.x)}px`;
    guideLayer.appendChild(line);
  };
  const addBadge = (x, y, text) => {
    const badge = document.createElement("span");
    badge.className = "ref-gap-badge";
    badge.textContent = text;
    const at = scenePointToFrame(x, y, transform);
    badge.style.left = `${at.x}px`;
    badge.style.top = `${at.y}px`;
    guideLayer.appendChild(badge);
  };
  rows.slice(0, REF_GUIDE_NEIGHBORS).forEach(({ box }) => {
    const n = {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      cx: (box.left + box.right) / 2,
      cy: (box.top + box.bottom) / 2,
    };
    const outline = document.createElement("i");
    outline.className = "ref-box";
    const a = scenePointToFrame(n.left, n.top, transform);
    const b = scenePointToFrame(n.right, n.bottom, transform);
    outline.style.left = `${a.x}px`;
    outline.style.top = `${a.y}px`;
    outline.style.width = `${Math.max(1, b.x - a.x)}px`;
    outline.style.height = `${Math.max(1, b.y - a.y)}px`;
    guideLayer.appendChild(outline);
    const spanY = [Math.min(n.top, s.top) - 12, Math.max(n.bottom, s.bottom) + 12];
    const spanX = [Math.min(n.left, s.left) - 12, Math.max(n.right, s.right) + 12];
    const vFeatures = [
      [n.cx, [s.cx]],
      [n.left, [s.left, s.right]],
      [n.right, [s.left, s.right]],
    ];
    vFeatures.forEach(([pos, mine], featureIndex) => {
      const delta = Math.min(...mine.map((value) => Math.abs(value - pos)));
      const aligned = delta <= 0.75;
      // 中线永远画，边线只在接近对齐时出现，避免满屏都是线。
      if (featureIndex === 0 || delta <= 8) addLine(true, pos, spanY[0], spanY[1], aligned);
    });
    const hFeatures = [
      [n.cy, [s.cy]],
      [n.top, [s.top, s.bottom]],
      [n.bottom, [s.top, s.bottom]],
    ];
    hFeatures.forEach(([pos, mine], featureIndex) => {
      const delta = Math.min(...mine.map((value) => Math.abs(value - pos)));
      const aligned = delta <= 0.75;
      if (featureIndex === 0 || delta <= 8) addLine(false, pos, spanX[0], spanX[1], aligned);
    });
    const overlapY = Math.min(n.bottom, s.bottom) - Math.max(n.top, s.top);
    const overlapX = Math.min(n.right, s.right) - Math.max(n.left, s.left);
    if (overlapY > 0) {
      const gap = n.left > s.right ? n.left - s.right : s.left > n.right ? s.left - n.right : 0;
      if (gap > 0.5) {
        const y = (Math.max(n.top, s.top) + Math.min(n.bottom, s.bottom)) / 2;
        const lo = n.left > s.right ? s.right : n.right;
        addLine(false, y, lo, lo + gap, false);
        addBadge(lo + gap / 2, y, `${Math.round(gap)}`);
      }
    }
    if (overlapX > 0) {
      const gap = n.top > s.bottom ? n.top - s.bottom : s.top > n.bottom ? s.top - n.bottom : 0;
      if (gap > 0.5) {
        const x = (Math.max(n.left, s.left) + Math.min(n.right, s.right)) / 2;
        const lo = n.top > s.bottom ? s.bottom : n.bottom;
        addLine(true, x, lo, lo + gap, false);
        addBadge(x, lo + gap / 2, `${Math.round(gap)}`);
      }
    }
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
  const pad = isCoarsePointer() ? 18 : 4;
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
  return BI.expandGroupedIndices(state.records, indices, isolatedGroupId());
}

function isolatedGroupId() {
  return state.groupIsolate?.group || "";
}

function recordBelongsToIsolatedGroup(index) {
  const group = isolatedGroupId();
  return !!(group && state.records[index]?.group === group);
}

function rememberGroupIsolate(indices) {
  if (!indices.length) {
    state.groupIsolate = null;
    return;
  }
  const group = state.records[indices[0]]?.group;
  if (!group || !indices.every((index) => state.records[index]?.group === group)) {
    state.groupIsolate = null;
    return;
  }
  state.groupIsolate = { group, index: indices[0] };
}

/** 画布双击 / Alt+点击：选中成组里的单件。Ctrl/Cmd 继续加选单件微调。 */
function wantsIsolateGroupMember(event, hit) {
  if (hit < 0 || !state.records[hit]?.group) return false;
  if (recordBelongsToIsolatedGroup(hit)) return true;
  return Number(event.detail) >= 2 || !!event.altKey;
}

function canvasHitChunk(hit, { isolate = false, member = false } = {}) {
  if (hit < 0) return [];
  if (member || isolate || recordBelongsToIsolatedGroup(hit) || !state.records[hit]?.group) return [hit];
  return expandGroupSelection([hit]);
}

function canvasUsesAdditiveSelect(event, hit, baseSelection) {
  if (event.ctrlKey || event.metaKey) return true;
  if (!layerListUsesMultiSelect() || hit < 0) return false;
  return baseSelection.length > 0 && !baseSelection.includes(hit);
}

function toggleCanvasHitSelection(baseSelection, hit, { isolate = false, member = false } = {}) {
  const chunk = canvasHitChunk(hit, { isolate, member });
  const next = new Set(baseSelection);
  const allIn = chunk.length && chunk.every((index) => next.has(index));
  if (allIn) chunk.forEach((index) => next.delete(index));
  else chunk.forEach((index) => next.add(index));
  return [...next];
}

function isolateCanvasGroupMember(clientX, clientY) {
  if (state.phase !== "design") return false;
  const transform = viewportTransform(layoutContentOffset());
  const scene = transform.clientToScene(clientX, clientY);
  const hit = hitRecord(scene.x, scene.y, {
    solid: !isCoarsePointer(),
    includeLocked: true,
  });
  if (hit < 0 || !state.records[hit]?.group) return false;
  setSelection([hit], { expandGroup: false, isolate: true });
  updateSelectionCaption();
  renderBuilding();
  return true;
}

function setSelection(indices, { expandGroup = false, layers = true, isolate = false } = {}) {
  let next = [...new Set(indices)].filter((index) => index >= 0 && index < state.records.length);
  if (expandGroup) next = expandGroupSelection(next);
  state.selected = next;
  if (isolate) rememberGroupIsolate(next);
  else if (expandGroup || next.length !== 1 || !recordBelongsToIsolatedGroup(next[0])) {
    state.groupIsolate = null;
  }
  updateSelectionCaption();
  updateAlignBar();
  syncViewportOverlays();
  if (layers) fillLayers();
}

function clearSelection({ layers = true } = {}) {
  state.selected = [];
  state.groupIsolate = null;
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
  const frames = normalizeBrushState();
  const text = `${state.brushState + 1}/${frames}`;
  if (label) label.textContent = text;
  const mobileLabel = document.getElementById("mobileFacingLabel");
  if (mobileLabel) mobileLabel.textContent = text;
  applyHoverTip(
    document.getElementById("facingLabel"),
    `朝向 ${text}`,
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
  if (!drag.active && dist > (isCoarsePointer() ? 22 : 6)) {
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

function paperPackKey(record, fallback = "") {
  if (typeof record?.packKey === "string" && record.packKey) return record.packKey;
  if (typeof record?.pack?.key === "string" && record.pack.key) return record.pack.key;
  if (record?.localPackUnknown) return "";
  return typeof fallback === "string" ? fallback : "";
}

function serializeSessionRecords() {
  return state.records.map((record) => ({
    mode: record.mode || "desk",
    x: record.x,
    y: record.y,
    mat: record.mat,
    state: record.state ?? record.flip ?? 0,
    packKey: paperPackKey(record, state.pack?.key || ""),
    localPackUnknown: !!record.localPackUnknown,
    group: record.group || null,
    groupName: record.groupName || null,
    groupParents: Array.isArray(record.groupParents) ? record.groupParents : undefined,
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
    designName: state.designName || "",
    sourcePaper: state.sourcePaper ? { ...state.sourcePaper } : null,
    smartBuilder: smartBuilderSnapshot(),
  };
}

function readLocalBuildingSession() {
  try {
    const raw = deskGet(SESSION_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap && snap.v === 1 ? snap : null;
  } catch {
    return null;
  }
}

function pickNewerBuildingSnap(a, b) {
  const ok = (snap) => snap && snap.v === 1;
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  return Number(b.savedAt) > Number(a.savedAt) ? b : a;
}

function saveBuildingSession() {
  const snap = buildingSessionSnapshot();
  try {
    deskSet(SESSION_KEY, JSON.stringify(snap));
    state.sessionDirty = false;
  } catch (error) {
    console.warn("建筑会话保存失败", error);
  }
  putBuildingSaves({ session: snap }, true).catch((error) => console.warn(error));
}

async function saveBuildingSessionForSwitch() {
  const snap = buildingSessionSnapshot();
  try {
    deskSet(SESSION_KEY, JSON.stringify(snap));
    state.sessionDirty = false;
  } catch (error) {
    console.warn("建筑会话保存失败", error);
  }
  putBuildingSaves({ session: snap }, false).catch((error) => console.warn(error));
}

function flashSaveDesignButton(ok) {
  const btn = document.getElementById("btnSaveDesign");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = ok ? "已保存" : "保存失败";
  btn.classList.toggle("danger", !ok);
  setTimeout(() => {
    btn.textContent = "保存设计";
    btn.classList.remove("danger");
  }, 1600);
}

function openSaveDesignDialog() {
  const originalId = sourcePaperId();
  const originalName = paperLibraryFileName(state.sourcePaper?.name || state.designName);
  const hint = document.getElementById("saveDesignHint");
  if (hint) {
    hint.textContent = originalId
      ? `当前从图纸库打开「${originalName}」。可写回这张图纸，或另存一份新图纸。`
      : "保存到图纸库。可自己取名。";
  }
  const originalBtn = document.getElementById("btnSaveDesignOriginal");
  if (originalBtn) {
    originalBtn.hidden = !originalId;
    originalBtn.textContent = originalId ? "保存到原图纸" : "保存到原图纸";
  }
  const input = document.getElementById("saveDesignName");
  if (input) {
    input.value = paperFileStem() || originalName.replace(/\.txt$/i, "") || "未命名建筑";
  }
  setModalVisible("dlgSaveDesign", true);
}

async function saveDesignNow() {
  openSaveDesignDialog();
}

async function formatCurrentPaperBytes(records = buildExportRecords(), source = state.source) {
  const payload = {
    kind: "desk",
    records,
    _source: source,
  };
  const response = await fetch("/api/format-building", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("建筑图纸生成失败 (" + response.status + ")");
  return new Uint8Array(await response.arrayBuffer());
}

async function commitDesignToPaperLibrary(mode) {
  const originalId = sourcePaperId();
  if (mode === "original" && !originalId) {
    await appAlert("当前设计不是从图纸库打开的，请保存为新图纸。", { title: "保存设计" });
    return;
  }
  const input = document.getElementById("saveDesignName");
  const name = paperLibraryFileName(input?.value || paperFileStem() || state.sourcePaper?.name);
  const newBtn = document.getElementById("btnSaveDesignNew");
  const originalBtn = document.getElementById("btnSaveDesignOriginal");
  if (newBtn) newBtn.disabled = true;
  if (originalBtn) originalBtn.disabled = true;
  try {
    const paperSavedAt = Date.now();
    const deskDocument = serializeDeskDocument();
    const paperRecords = exportRecordList(deskDocument.records);
    const exportRecords = paperRecords.map(serializeExportRecord);
    const source = state.source ? { ...state.source } : null;
    const canvasEl = document.getElementById("buildingView");
    const thumbPromise = canvasEl
      ? PaperLibraryCore.canvasToJpegBlob(canvasEl)
      : Promise.resolve(null);
    const bytes = await formatCurrentPaperBytes(exportRecords, null);
    const data = bytesToBase64(bytes);
    const ident = mode === "original" ? originalId : newPaperLibraryId();
    const report = buildingMaterialReport(state.records);
    const upload = {
      id: ident,
      revision: newPaperLibraryId(),
      savedAt: paperSavedAt,
      name,
      data,
      kind: "desk",
      group: state.sourcePaper?.groupId || "",
      count: report.visible,
      meta: `${report.visible} 件素材 · ${report.totals.size} 种材料`,
      unresolved: report.unresolved,
      force: true,
      deskLayers: serializeDeskLayers(deskDocument.records),
      deskDocument,
    };
    await PaperLibraryCore.persist([upload], { replace: false, requireSaved: true });
    state.designName = name;
    rememberSourcePaper({ id: ident, name, groupId: upload.group });
    updatePaperFileLabel();
    const file = PaperLibraryCore.createPaperFile(bytes, name, {
      id: ident,
      revision: upload.revision,
      kind: "desk",
      group: upload.group,
      data,
      deskLayers: upload.deskLayers,
      deskDocument: upload.deskDocument,
    });
    const savedEntry = syncSavedPaperIntoLibrary(upload, file);
    const blob = await thumbPromise;
    if (blob) {
      await PaperLibraryCore.putThumb(ident, blob, upload.revision);
      refreshSavedPaperThumb(savedEntry, blob);
    }
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }
    saveBuildingSession();
    setModalVisible("dlgSaveDesign", false);
    flashSaveDesignButton(true);
  } catch (error) {
    console.warn("保存到图纸库失败", error);
    flashSaveDesignButton(false);
    await appAlert(error.message || String(error), { title: "保存失败" });
  } finally {
    if (newBtn) newBtn.disabled = false;
    if (originalBtn) originalBtn.disabled = false;
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

function restoreBuildingSession(remoteSnap) {
  let snap = remoteSnap && typeof remoteSnap === "object" ? remoteSnap : null;
  if (!snap) {
    try {
      const raw = deskGet(SESSION_KEY);
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
    state.designName = String(snap.designName || "");
    state.sourcePaper = snap.sourcePaper?.id
      ? {
          id: String(snap.sourcePaper.id),
          name: String(snap.sourcePaper.name || ""),
          groupId: String(snap.sourcePaper.groupId || ""),
        }
      : null;
    updatePaperFileLabel();
    state.layerFilter = snap.layerFilter || "";
    state.railWidth = Math.max(300, Math.min(520, Number(snap.railWidth) || 340));
    state.railCollapsed = !!snap.railCollapsed;
    applyRailState();
    state.layerCollapsed = new Set(Array.isArray(snap.layerCollapsed) ? snap.layerCollapsed : []);
    restoreSmartBuilder(snap.smartBuilder);
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
      if (link.dataset.switching === "1") {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      link.dataset.switching = "1";
      const href = link.getAttribute("href");
      Promise.resolve(saveFn())
        .catch(() => {})
        .finally(() => {
          window.location.assign(href);
        });
    });
  });
}

function warmOtherDesk(htmlHref, extraUrls = []) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 700));
  idle(() => {
    [htmlHref, ...extraUrls].filter(Boolean).forEach((url) => {
      fetch(url, { credentials: "same-origin" }).catch(() => {});
    });
  });
}

function hydrateRecord(record) {
  const localPackUnknown = !!record.localPackUnknown;
  const packKey = paperPackKey(record, localPackUnknown ? "" : state.pack?.key || "");
  const pack = packByKey(packKey) || (localPackUnknown ? null : state.pack);
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
    groupParents: Array.isArray(record.groupParents) ? record.groupParents : undefined,
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

function decorateSnapGuides(guides, bounds, dx, dy, targets) {
  // 原始 guide 只有一个坐标值，画出来是贯穿全屏的细线，看不出到底和谁
  // 对齐。这里回查命中的目标盒，补上对齐区段（from/to）和两盒间距（gap），
  // 渲染层据此画出高亮段和距离标注。
  const moved = {
    left: bounds.left + dx,
    right: bounds.right + dx,
    top: bounds.top + dy,
    bottom: bounds.bottom + dy,
  };
  return guides.map((guide) => {
    if (guide.type !== "v" && guide.type !== "h") return guide;
    const vertical = guide.type === "v";
    let best = null;
    (targets || []).forEach((target) => {
      const box = BI.normalizeRect(target.rect || target);
      const features = vertical
        ? [box.left, (box.left + box.right) / 2, box.right]
        : [box.top, (box.top + box.bottom) / 2, box.bottom];
      if (!features.some((value) => Math.abs(value - guide.pos) <= 0.75)) return;
      const gap = vertical
        ? Math.max(box.top - moved.bottom, moved.top - box.bottom, 0)
        : Math.max(box.left - moved.right, moved.left - box.right, 0);
      if (!best || gap < best.gap) best = { box, gap };
    });
    if (!best) return guide;
    const box = best.box;
    const from = vertical ? Math.min(moved.top, box.top) : Math.min(moved.left, box.left);
    const to = vertical ? Math.max(moved.bottom, box.bottom) : Math.max(moved.right, box.right);
    const gapLo = vertical ? Math.min(moved.bottom, box.bottom) : Math.min(moved.right, box.right);
    const gapHi = vertical ? Math.max(moved.top, box.top) : Math.max(moved.left, box.left);
    const gap = best.gap > 0.5 ? Math.round(best.gap) : 0;
    return { ...guide, from, to, gap, gapAt: gap ? (gapLo + gapHi) / 2 : null };
  });
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
    state.guides = decorateSnapGuides(snapped.guides, drag.bounds, dx, dy, targets);
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

function syncLayerInsert() {
  const insert = state.layerInsert;
  if (insert?.kind === "before" && !state.records.includes(insert.record)) {
    state.layerInsert = null;
  }
}

function layerInsertIndex() {
  syncLayerInsert();
  return BI.resolveLayerInsertIndex(state.records, state.layerInsert);
}

function applyLayerInsertGroup(record) {
  if (!record || record.group) return record;
  const hint = BI.layerInsertGroupHint(state.records, state.layerInsert);
  if (!hint) return record;
  writeGroupStack(record, [...(hint.groupParents || []), { id: hint.group, name: hint.groupName || "" }]);
  return record;
}

function insertDeskRecords(rows) {
  if (!rows.length) return [];
  const at = layerInsertIndex();
  state.records.splice(at, 0, ...rows);
  return rows.map((_, offset) => at + offset);
}

function layerInsertSpecInFrontOf(index) {
  if (!Number.isInteger(index) || index >= state.records.length - 1) return { kind: "front" };
  return { kind: "before", record: state.records[index + 1] };
}

function layerInsertSpecForItem(item) {
  if (item?.kind === "row") {
    const record = state.records[item.index];
    return record ? { kind: "before", record } : null;
  }
  if (item?.kind === "group") {
    const members = (item.members || []).filter((index) => state.records[index]);
    if (!members.length) return null;
    if (state.layerCollapsed.has(item.groupId)) {
      return { kind: "before", record: state.records[Math.min(...members)] };
    }
    return null;
  }
  return null;
}

function setLayerInsert(spec, { toggle = true } = {}) {
  if (toggle && spec && BI.insertSpecsEqual(state.layerInsert, spec)) spec = null;
  state.layerInsert = spec || null;
  syncLayerInsertBanner();
  updateToolHint();
  fillLayers();
}

function clearLayerInsert() {
  if (!state.layerInsert) return;
  state.layerInsert = null;
  syncLayerInsertBanner();
  updateToolHint();
  fillLayers();
}

function syncLayerInsertBanner() {
  const banner = document.getElementById("layerInsertBanner");
  const text = document.getElementById("layerInsertBannerText");
  if (!banner) return;
  const insert = state.layerInsert;
  banner.hidden = !insert;
  if (!text || !insert) return;
  text.textContent =
    insert.kind === "front" ? "下次放置将加到最前" : "下次放置将插入到标记的图层之间";
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
  const world = state.snap.enabled ? snapGridPoint(x, y) : { x, y };
  const foot = stampFootOffset(state.component, state.brushState);
  const pos = clampRecordPos(world.x - foot.x, world.y - foot.y);
  pushHistory();
  const indices = insertDeskRecords([
    applyLayerInsertGroup({
      mode: "desk",
      x: pos.x,
      y: pos.y,
      mat: uid,
      state: facingAbsolute(state.component),
      component: state.component,
      pack,
      packKey: pack?.key,
    }),
  ]);
  setSelection(indices);
  renderBuilding();
}

function appendSpriteStamp(component, pack, face, cx, cy, seen, { occupied } = {}) {
  const usePack = pack || component?._pack || state.pack;
  const uid = componentUid(component?.id, usePack);
  if (uid == null || !component) return -1;
  const foot = stampFootOffset(component, face);
  const pos = clampRecordPos(cx - foot.x, cy - foot.y);
  const key = `${pos.x},${pos.y},${uid},${face}`;
  if (seen.has(key)) return -1;
  if (occupied) {
    const cell = isoCellKey(cx, cy, occupied.step);
    if (occupied.cells.has(cell)) return -1;
    occupied.cells.add(cell);
  }
  seen.add(key);
  const [index] = insertDeskRecords([
    applyLayerInsertGroup({
      mode: "desk",
      x: pos.x,
      y: pos.y,
      mat: uid,
      state: face,
      component,
      pack: pack || component._pack || state.pack,
      packKey: (pack || component._pack || state.pack)?.key,
    }),
  ]);
  return index;
}

function placeStampBatch(points, tool = state.tool) {
  const template = stampTemplate();
  if (!template || !points.length) return;
  pushHistory();
  const seen = new Set();
  const indices = [];
  const historyLen = state.history.length;
  const ground = stampGroundSize(template.component, facingAbsolute(template.component || recordComponent(template.record)));
  const occupied = { cells: new Set(), step: Math.max(1, ground.width / 4) };
  depthSortedStampPoints(points).forEach((point) => {
    if (template.type === "sprite") {
      const index = appendSpriteStamp(
        template.component,
        template.pack,
        facingAbsolute(template.component),
        point.x,
        point.y,
        seen,
        { occupied }
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
        seen,
        { occupied }
      );
      if (index >= 0) indices.push(index);
      return;
    }
    if (template.type === "custom") {
      const cell = isoCellKey(point.x, point.y, occupied.step);
      if (occupied.cells.has(cell)) return;
      occupied.cells.add(cell);
      const added = placeCustomBrush(point.x, point.y, {
        history: false,
        select: false,
        render: false,
        custom: template.custom,
      });
      if (added?.length) indices.push(...added);
    }
  });
  if (!indices.length) {
    if (state.history.length === historyLen) return;
    state.history.pop();
    return;
  }
  // 铺放完成后选中刚放下的素材，方便立刻微调或对齐。
  setSelection(indices);
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
  records.forEach((record) => {
    const pos = clampRecordPos(record.x + dx, record.y + dy);
    record.x = pos.x;
    record.y = pos.y;
    record.group = group;
  });
  const newIndices = insertDeskRecords(records);
  setSelection(newIndices);
  renderBuilding();
}

function placeCustomBrush(x, y, options = {}) {
  const custom = options.custom || state.customBrush;
  if (!custom?.records?.length) return [];
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
  const rows = [];
  custom.records.forEach((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    if (!component) return;
    const pos = clampRecordPos(originX + row.dx, originY + row.dy);
    rows.push({
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
  });
  const newIndices = insertDeskRecords(rows);
  if (!newIndices.length) {
    if (options.select !== false) appAlert("自定义组件没有可用素材。");
    return [];
  }
  if (options.select !== false) setSelection(newIndices);
  if (options.render !== false) renderBuilding();
  return newIndices;
}

function selectedUnlockedIndices() {
  return state.selected.filter((index) => state.records[index] && !state.records[index].locked);
}

function pruneCollapsedLayerGroups() {
  const live = new Set();
  state.records.forEach((record) => {
    BI.recordGroupStack(record).forEach((entry) => live.add(entry.id));
  });
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

function reorderSelectionIndices() {
  const unlocked = selectedUnlockedIndices();
  if (!unlocked.length) return [];
  const selected = new Set(
    (state.selected || []).filter((index) => Number.isInteger(index) && state.records[index])
  );
  unlocked.forEach((index) => selected.add(index));
  BI.outermostFullySelectedGroups(state.records, [...selected]).forEach((groupId) => {
    BI.groupMemberIndices(state.records, groupId).forEach((index) => selected.add(index));
  });
  return [...selected].sort((a, b) => a - b);
}

function reorderSelected(command) {
  const indices = reorderSelectionIndices();
  if (!indices.length) return;
  if (command !== "bottom" && command !== "top" && command !== "down" && command !== "up") return;
  pushHistory();
  const moving = indices.map((index) => state.records[index]);
  state.records = BI.reorderRecordsByCommand(state.records, indices, command);
  const idSet = new Set(moving);
  const newSelected = [];
  state.records.forEach((record, index) => {
    if (idSet.has(record)) newSelected.push(index);
  });
  setSelection(newSelected);
  renderBuilding();
}

function selectionInLayerOrder(indices) {
  // 图层顺序 = records 下标。框选/点选顺序不能决定粘贴后的前后遮挡。
  return [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && state.records[index])
    .sort((a, b) => a - b);
}

function duplicateSelected() {
  const indices = selectionInLayerOrder(selectedUnlockedIndices());
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
      groupParents: Array.isArray(record.groupParents) ? record.groupParents : undefined,
      label: record.label || null,
    };
  });
}

function copySelected() {
  const indices = selectionInLayerOrder(state.selected);
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
  const rows = [];
  state.clipboard.forEach((row) => {
    const pack = packByKey(row.packKey) || state.pack;
    const component = componentByUid(row.mat, pack);
    if (!component) return;
    const pos = clampRecordPos(row.x + originX, row.y + originY);
    rows.push({
      mode: "desk",
      x: pos.x,
      y: pos.y,
      mat: row.mat,
      state: facingOffset(row.state ?? 0, component),
      component,
      pack: component._pack || pack,
      packKey: (component._pack || pack)?.key || row.packKey,
      group: row.group || undefined,
      groupName: row.groupName || undefined,
      groupParents: Array.isArray(row.groupParents) ? row.groupParents : undefined,
      label: row.label || undefined,
    });
  });
  const remapped = BI.remapImportedDeskGroups(rows, `${Date.now()}-paste`);
  const newIndices = insertDeskRecords(remapped);
  if (!newIndices.length) return;
  state.clipboard = serializeClipboardRecords(newIndices);
  setSelection(newIndices);
  updateFacingControl();
  renderBuilding();
}

async function groupSelected() {
  const indices = selectedUnlockedIndices();
  if (indices.length < 2) {
    await appAlert("请先框选至少两个素材。点组标题一次选中整组，点组内素材仍可选中单件；圈选后已经可以一起移动。");
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
  const wrapped = BI.wrapRecordsInGroup(state.records, indices, group, name.trim());
  wrapped.forEach((next, index) => {
    if (next === state.records[index]) return;
    writeGroupStack(state.records[index], BI.recordGroupStack(next));
  });
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
  const outer = BI.outermostFullySelectedGroups(state.records, indices);
  const groups = outer.length
    ? outer
    : [...new Set(indices.map((index) => state.records[index].group).filter(Boolean))];
  if (!groups.length) {
    await appAlert("当前选择里没有已分组的素材。");
    return;
  }
  pushHistory();
  const peeled = BI.peelGroupsFromRecords(state.records, groups);
  peeled.forEach((next, index) => {
    writeGroupStack(state.records[index], BI.recordGroupStack(next));
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

function nudgeSelected(dx, dy, { history = true } = {}) {
  const indices = selectedUnlockedIndices().filter(
    (index) => state.records[index] && !state.records[index].locked
  );
  if (!indices.length) return;
  if (history) pushHistory();
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

const NUDGE_HOLD_DELAY = 320;
const NUDGE_HOLD_MS = 55;
const NUDGE_STEP_KEY = "manor-building-nudge-step";
let nudgeRepeatTimer = 0;
let nudgeRepeatInterval = 0;
let nudgePadStep = 1;

function stopNudgeRepeat() {
  if (nudgeRepeatTimer) {
    clearTimeout(nudgeRepeatTimer);
    nudgeRepeatTimer = 0;
  }
  if (nudgeRepeatInterval) {
    clearInterval(nudgeRepeatInterval);
    nudgeRepeatInterval = 0;
  }
}

function bindNudgePad() {
  const pad = document.getElementById("nudgePad");
  if (!pad) return;
  const stepBtn = document.getElementById("btnNudgeStep");
  try {
    const stored = Number(deskGet(NUDGE_STEP_KEY));
    if (Number.isFinite(stored) && stored >= 1) nudgePadStep = Math.min(128, Math.max(1, Math.round(stored)));
  } catch (error) {}
  const updateStepLabel = () => {
    if (!stepBtn) return;
    const value = `${nudgePadStep}px`;
    let kicker = stepBtn.querySelector(".nudge-step-kicker");
    let valueEl = stepBtn.querySelector(".nudge-step-value");
    if (!kicker || !valueEl) {
      stepBtn.replaceChildren();
      kicker = document.createElement("span");
      kicker.className = "nudge-step-kicker";
      kicker.textContent = "步长";
      valueEl = document.createElement("span");
      valueEl.className = "nudge-step-value";
      stepBtn.append(kicker, valueEl);
    }
    valueEl.textContent = value;
    stepBtn.classList.toggle("is-coarse", nudgePadStep >= 10);
    stepBtn.setAttribute("aria-label", `步长 ${nudgePadStep} 像素，点按设置`);
    stepBtn.title = `当前步长 ${nudgePadStep} 像素，点按设置`;
  };
  updateStepLabel();
  window.MobileWorkspace?.bindNudgeStepControl?.({
    pad,
    button: stepBtn,
    unit: "px",
    min: 1,
    max: 128,
    presets: [1, 2, 4, 5, 8, 10, 16],
    fallback: 1,
    getValue: () => nudgePadStep,
    setValue: (value) => {
      nudgePadStep = value;
      try { deskSet(NUDGE_STEP_KEY, String(nudgePadStep)); } catch (error) {}
      updateStepLabel();
    },
  });
  pad.addEventListener("contextmenu", (event) => event.preventDefault());
  pad.addEventListener("pointerdown", (event) => {
    const btn = event.target.closest("[data-nudge]");
    if (!btn || !pad.contains(btn)) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = Number(btn.dataset.nudgeX) || 0;
    const dy = Number(btn.dataset.nudgeY) || 0;
    if (!dx && !dy) return;
    btn.setPointerCapture?.(event.pointerId);
    stopNudgeRepeat();
    nudgeSelected(dx * nudgePadStep, dy * nudgePadStep);
    nudgeRepeatTimer = setTimeout(() => {
      nudgeRepeatInterval = setInterval(() => {
        nudgeSelected(dx * nudgePadStep, dy * nudgePadStep, { history: false });
      }, NUDGE_HOLD_MS);
    }, NUDGE_HOLD_DELAY);
  });
  const endHold = () => stopNudgeRepeat();
  pad.addEventListener("pointerup", endHold);
  pad.addEventListener("pointercancel", endHold);
  pad.addEventListener("lostpointercapture", endHold);
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
  const chunk = state.groupIsolate ? hits : expandGroupSelection(hits);
  setSelection(BI.applySelection(marquee.baseSelection || [], chunk, marquee.operation));
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

function useSelectionAsBrush() {
  const custom = selectionAsCustomBrush();
  if (!custom) {
    const index = selectedUnlockedIndices()[0];
    if (index != null) pickRecordAsBrush(state.records[index]);
    return;
  }
  state.customBrush = {
    ...custom,
    id: `selection-${Date.now().toString(36)}`,
  };
  state.component = null;
  setActiveTool(state.lastPlaceTool && isPlaceTool(state.lastPlaceTool) ? state.lastPlaceTool : "stamp");
  updateSelectionCaption();
  updateFacingControl();
  fillComponents();
  fillCustoms();
  fillLayers();
  renderBuilding();
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
  rememberCanvasClient(event.clientX, event.clientY);
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
    const skipTouchHold = isPlaceTool() || state.mobilePan || state.selected.length > 0 || isSmartTool();
    if (!state._touchArmed && !skipTouchHold) {
      if (state.pointerGesture) return;
      const armedEvent = {
        pointerId: event.pointerId,
        pointerType: "touch",
        button: 0,
        clientX: event.clientX,
        clientY: event.clientY,
        detail: Number(event.detail) || 0,
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

  if (event.button === 1 || state.mobilePan) {
    interaction.mode = "pan";
    interaction.startScroll = { x: shell.scrollLeft, y: shell.scrollTop };
    shell.classList.add("is-panning");
    return;
  }

  if (state.spacePan) {
    // Space + 左键拖动 = 平移画布（与中键拖动画板相同）。
    interaction.mode = "pan";
    interaction.startScroll = { x: shell.scrollLeft, y: shell.scrollTop };
    shell.classList.add("is-panning");
    return;
  }

  if (isSmartTool()) {
    if (state.smartBuilder.mode === "wall") {
      interaction.mode = "shape";
      const origin = state.snap.enabled !== false ? snapGridPoint(startScene.x, startScene.y) : startScene;
      state.shapeStroke = {
        tool: "smart-wall",
        start: origin,
        end: origin,
        points: [origin],
        transform,
        aligned: true,
      };
      syncShapeOverlay();
      renderBuilding();
    } else {
      interaction.mode = "smart-point";
    }
    return;
  }

  const hit = hitRecord(startScene.x, startScene.y, {
    solid: !isCoarsePointer(),
    includeLocked: true,
  });
  if (isPlaceTool()) {
    const onSelection =
      (hit >= 0 && state.selected.includes(hit)) ||
      pointInSelectionUnion(startScene.x, startScene.y);
    if (onSelection) {
      const movable = state.selected.filter((index) => !state.records[index]?.locked);
      interaction.mode = beginRecordDrag(startScene.x, startScene.y, movable, transform)
        ? "move"
        : "select";
      updateSelectionCaption();
      renderBuilding();
      return;
    }
    if (stampTemplate()) {
      interaction.mode = "shape";
      const origin =
        state.snap.enabled !== false ? snapGridPoint(startScene.x, startScene.y) : startScene;
      const points = [{ x: origin.x, y: origin.y }];
      state.shapeStroke = {
        tool: state.tool,
        start: origin,
        end: origin,
        points,
        transform,
        aligned: !!event.shiftKey,
      };
      updateToolHint();
      syncShapeOverlay();
      renderBuilding();
      return;
    }
  }
  // 单击整组；双击/Alt 拆成单件；Ctrl/Cmd 加选单件。手机/平板点到未选中的组仍叠加整组。
  const isolate = hit >= 0 ? wantsIsolateGroupMember(event, hit) : false;
  const additiveMember = !!(event.ctrlKey || event.metaKey);
  const operation = canvasUsesAdditiveSelect(event, hit, baseSelection) ? "add" : "replace";
  if (hit >= 0) {
    clearBrushHighlight();
    if (operation !== "replace") {
      setSelection(
        toggleCanvasHitSelection(baseSelection, hit, { isolate, member: additiveMember }),
        { isolate: isolate || additiveMember }
      );
      interaction.mode = "select";
    } else {
      if (isolate || !baseSelection.includes(hit)) {
        setSelection([hit], { expandGroup: !isolate, isolate });
      }
      const dragIndices = isolate
        ? [hit]
        : state.selected.filter((index) => !state.records[index]?.locked);
      interaction.mode = beginRecordDrag(startScene.x, startScene.y, dragIndices, transform)
        ? "move"
        : "select";
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
  rememberCanvasClient(event.clientX, event.clientY);
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
      if (pendingZoomAnchor) {
        pendingZoomAnchor.scene = clientToContent(midX, midY);
        pendingZoomAnchor.clientX = midX;
        pendingZoomAnchor.clientY = midY;
      }
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
      const raw = interaction.transform.clientToScene(event.clientX, event.clientY);
      const point = state.snap.enabled !== false ? snapGridPoint(raw.x, raw.y) : raw;
      const last = state.shapeStroke.points[state.shapeStroke.points.length - 1] || state.shapeStroke.start;
      const pitch = stampPitch(false);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= Math.min(pitch.x, pitch.y) * 0.72) {
        if (state.shapeStroke.points.length < STAMP_CAP) state.shapeStroke.points.push(point);
      }
      state.shapeStroke.end = point;
    } else if (state.shapeStroke.tool === "smart-wall") {
      const raw = interaction.transform.clientToScene(event.clientX, event.clientY);
      state.shapeStroke.end = smartConstrainEnd(state.shapeStroke.start, raw);
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
    if (stroke?.tool === "smart-wall") addSmartWall(stroke.start, stroke.end);
    else if (stroke) placeStampBatch(shapeStampPoints(stroke), stroke.tool);
  } else if (interaction.mode === "smart-point") {
    addSmartMarker(interaction.startScene);
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
    const raw = deskGet(CUSTOMS_KEY);
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
  deskSet(CUSTOMS_KEY, JSON.stringify(customs));
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
      const card = document.createElement("div");
      card.className = "custom-card" + (state.customBrush?.id === item.id ? " on" : "");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
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
        if (isCoarsePointer()) return;
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
        if (window.MobileWorkspace?.modeForViewport().mobile) closeBuildingRailOnPick();
      };
      card.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectCustom();
      };
      list.appendChild(card);
    });
}

async function openPresetDialog() {
  const indices = selectionInLayerOrder(state.selected);
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
  const indices = selectionInLayerOrder(state.selected);
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

function writeGroupStack(record, stack) {
  const next = BI.applyGroupStack(record, stack);
  if (next.group) record.group = next.group;
  else delete record.group;
  if (next.groupName) record.groupName = next.groupName;
  else delete record.groupName;
  if (next.groupParents) record.groupParents = next.groupParents;
  else delete record.groupParents;
  delete record.groups;
  return record;
}

function groupMemberIndices(groupId) {
  return BI.groupMemberIndices(state.records, groupId);
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
  // Layer-list clicks always target this row. Group expansion is only for the
  // group header and for canvas single-clicks — canvas double-click / Alt+click
  // isolates one grouped member (same as picking a child row here).
  applyLayerListSelection([index], event, { isolate: !!record.group });
}

function applyLayerListSelection(indices, event, { isolate = false } = {}) {
  const rows = (indices || []).filter((index) => state.records[index]);
  if (!rows.length) return;
  const additive = !!(event?.ctrlKey || event?.metaKey || layerListUsesMultiSelect());
  if (additive) {
    const set = new Set(state.selected);
    const allIn = rows.every((index) => set.has(index));
    if (allIn) rows.forEach((index) => set.delete(index));
    else rows.forEach((index) => set.add(index));
    setSelection([...set]);
  } else if (event?.shiftKey && rows.length === 1 && state.selected.length) {
    const anchor = state.selected[state.selected.length - 1];
    const lo = Math.min(anchor, rows[0]);
    const hi = Math.max(anchor, rows[0]);
    const range = [];
    for (let i = lo; i <= hi; i++) {
      if (!state.records[i]?.hidden) range.push(i);
    }
    setSelection(range);
  } else if (rows.length === 1) {
    setSelection(rows, { isolate });
  } else {
    setSelection(rows);
  }
  state.component = null;
  state.customBrush = null;
  fillComponents();
  fillCustoms();
  renderBuilding();
  revealSelection();
}

function createLayerSelectControl({ checked, partial, label, onChange }) {
  const wrap = document.createElement("label");
  wrap.className = "layer-select" + (partial ? " is-partial" : "");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "layer-select-input";
  input.checked = !!checked;
  input.indeterminate = !!partial && !checked;
  input.setAttribute("aria-label", label);
  const mark = document.createElement("span");
  mark.className = "layer-select-mark";
  mark.setAttribute("aria-hidden", "true");
  const stop = (event) => event.stopPropagation();
  wrap.addEventListener("click", stop);
  wrap.addEventListener("pointerdown", stop);
  input.addEventListener("change", (event) => {
    event.stopPropagation();
    if (typeof onChange === "function") onChange(!!input.checked);
  });
  wrap.append(input, mark);
  return wrap;
}

function appendLayerSelectControl(row, { checked, partial, label, indices }) {
  if (!layerListUsesMultiSelect()) return;
  row.classList.add("has-select");
  const control = createLayerSelectControl({
    checked,
    partial,
    label,
    onChange: () => applyLayerListSelection(indices, { ctrlKey: true }),
  });
  const indent = row.querySelector(".layer-indent");
  if (indent) indent.after(control);
  else row.prepend(control);
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

function groupDisplayName(groupId, memberIndices) {
  for (const index of memberIndices || []) {
    const entry = BI.recordGroupStack(state.records[index]).find((item) => item.id === groupId);
    if (entry?.name) return entry.name;
  }
  return "未命名组";
}

function groupChildSummary(groupId, memberIndices) {
  const childGroups = new Set();
  (memberIndices || []).forEach((index) => {
    const stack = BI.recordGroupStack(state.records[index]);
    const at = stack.findIndex((entry) => entry.id === groupId);
    if (at >= 0 && stack[at + 1]) childGroups.add(stack[at + 1].id);
  });
  if (childGroups.size) return `${childGroups.size} 个组 · ${memberIndices.length} 个图层`;
  return `${memberIndices.length} 个图层`;
}

function applyLayerDepth(row, depth, extraColumns) {
  row.style.setProperty("--layer-depth", String(Math.max(0, depth)));
  if (depth > 0) {
    row.classList.add("is-nested");
    const indent = document.createElement("span");
    indent.className = "layer-indent";
    row.appendChild(indent);
  }
  if (extraColumns) row.style.gridTemplateColumns = extraColumns;
}

function appendGroupHeader(list, groupId, memberIndices, selectedSet, filterText, depth = 0) {
  const groupName = groupDisplayName(groupId, memberIndices);
  const collapsed = state.layerCollapsed.has(groupId);
  const allHidden = memberIndices.every((index) => state.records[index].hidden);
  const allLocked = memberIndices.every((index) => state.records[index].locked);
  const allSelected = memberIndices.length > 0 && memberIndices.every((index) => selectedSet.has(index));
  const someSelected = !allSelected && memberIndices.some((index) => selectedSet.has(index));
  const row = document.createElement("div");
  row.className =
    "layer-row is-group" +
    (allSelected ? " on" : someSelected ? " is-partial" : "") +
    (allHidden ? " is-hidden" : "");
  row.dataset.group = groupId;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", allSelected ? "true" : "false");
  row.title = layerListUsesMultiSelect()
    ? "点选可加减整组 · 点下面的素材可选中单件"
    : "点击选中整组 · 点下面的素材可选中单件";

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
  name.innerHTML = `${groupName}<small>${groupChildSummary(groupId, memberIndices)}</small>`;
  const lock = createLayerLockButton(allLocked, () => toggleGroupLock(groupId));

  applyLayerDepth(
    row,
    depth,
    layerListUsesMultiSelect()
      ? (depth ? "14px 44px 44px 44px 40px minmax(0,1fr) 44px" : "44px 44px 44px 40px minmax(0,1fr) 44px")
      : isCoarsePointer()
        ? (depth ? "14px 44px 44px 40px minmax(0,1fr) 44px" : "44px 44px 40px minmax(0,1fr) 44px")
        : (depth ? "16px 22px 24px 36px minmax(0,1fr) 28px" : "22px 24px 36px minmax(0,1fr) 28px")
  );
  row.append(twist, eye, thumb, name, lock);
  appendLayerSelectControl(row, {
    checked: allSelected,
    partial: someSelected,
    label: allSelected ? `取消选择 ${groupName}` : `加选 ${groupName}`,
    indices: memberIndices,
  });

  row.onclick = (event) => {
    if (event.target.closest("button, .layer-select")) return;
    applyLayerListSelection(memberIndices, event);
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
      const stack = BI.recordGroupStack(state.records[index]).map((entry) =>
        entry.id === groupId ? { ...entry, name: trimmed } : entry
      );
      writeGroupStack(state.records[index], stack);
    });
    fillLayers();
    updateSelectionCaption();
  };
  list.appendChild(row);
  return { shown: true, forceChildren: !!filterText };
}

function appendLayerRow(list, index, selectedSet, filterText, asChild, depth = 0) {
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
    (asChild || depth ? " is-child" : "") +
    (selectedSet.has(index) ? " on" : "") +
    (record.locked ? " locked" : "") +
    (record.hidden ? " is-hidden" : "");
  row.dataset.index = String(index);
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", selectedSet.has(index) ? "true" : "false");

  if (asChild || depth) applyLayerDepth(row, Math.max(depth, asChild ? 1 : 0));

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
  appendLayerSelectControl(row, {
    checked: selectedSet.has(index),
    label: selectedSet.has(index) ? `取消选择 ${label}` : `加选 ${label}`,
    indices: [index],
  });
  row.title = layerListUsesMultiSelect()
    ? "点选可加减图层 · 再点取消 · 方向键微调"
    : "点击选中并定位到画布 · 方向键微调（Shift 大步 10px）· Ctrl+点击多选";
  row.onclick = (event) => {
    if (event.target.closest("button, .layer-select")) return;
    event.stopPropagation();
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

function appendLayerInsertSlot(list, spec, label) {
  if (!spec) return;
  const wrap = document.createElement("div");
  wrap.className = "layer-insert" + (BI.insertSpecsEqual(state.layerInsert, spec) ? " is-on" : "");
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "layer-insert-hit";
  hit.title = label;
  hit.setAttribute("aria-label", label);
  hit.setAttribute("aria-pressed", wrap.classList.contains("is-on") ? "true" : "false");
  hit.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setLayerInsert(spec);
  };
  wrap.appendChild(hit);
  list.appendChild(wrap);
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
  const collapsedSkip = new Set();
  for (let index = state.records.length - 1; index >= 0; index--) {
    if (state.layerSelectedOnly && !selectedSet.has(index)) continue;
    const record = state.records[index];
    if (Number(record.mat) === 0 || isNativeDeskHiddenComponent(recordComponent(record))) continue;
    const stack = BI.recordGroupStack(record);
    if (!stack.length) {
      if (layerRowVisible(index, filterText)) {
        items.push({ kind: "row", index, depth: 0, asChild: false, filterText });
      }
      continue;
    }
    let skipped = false;
    for (let depth = 0; depth < stack.length; depth++) {
      const entry = stack[depth];
      if (collapsedSkip.has(entry.id)) {
        skipped = true;
        break;
      }
      if (!shownGroups.has(entry.id)) {
        shownGroups.add(entry.id);
        const members = groupMemberIndices(entry.id).filter(
          (memberIndex) => !state.layerSelectedOnly || selectedSet.has(memberIndex)
        );
        const header = measureGroupHeader(entry.id, members, filterText);
        forceGroupChildren.set(entry.id, header.forceChildren);
        if (header.shown) {
          items.push({ kind: "group", groupId: entry.id, members, depth, filterText });
        }
        if (state.layerCollapsed.has(entry.id)) {
          collapsedSkip.add(entry.id);
          skipped = true;
          break;
        }
      }
    }
    if (skipped) continue;
    const childFilter = stack.some((entry) => forceGroupChildren.get(entry.id)) ? "" : filterText;
    if (layerRowVisible(index, childFilter)) {
      items.push({ kind: "row", index, depth: stack.length, asChild: true, filterText: childFilter });
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
  const groupNames = BI.recordGroupStack(record).map((entry) => entry.name || "").join(" ");
  const hay = `${label} ${packName} ${record.groupName || ""} ${groupNames}`.toLowerCase();
  return hay.includes(filterText);
}

function measureGroupHeader(groupId, memberIndices, filterText) {
  const groupName = groupDisplayName(groupId, memberIndices);
  const nestedNames = (memberIndices || [])
    .flatMap((index) => BI.recordGroupStack(state.records[index]).map((entry) => entry.name || ""))
    .join(" ");
  const groupHit = !filterText || `${groupName} ${nestedNames}`.toLowerCase().includes(filterText);
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

function layerRowHeight() {
  return document.documentElement.classList.contains("is-mobile-workspace") ? 56 : LAYER_ROW_H;
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

  const rowH = layerRowHeight();
  const viewH = Math.max(1, list.clientHeight || 400);
  const maxScroll = Math.max(0, items.length * rowH - viewH);
  const scrollTop = Math.min(list.scrollTop, maxScroll);
  if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
  const virtual = items.length > 60;
  let start = 0;
  let end = items.length;
  if (virtual) {
    start = Math.max(0, Math.floor(scrollTop / rowH) - LAYER_WINDOW_PAD);
    end = Math.min(items.length, start + Math.ceil(viewH / rowH) + LAYER_WINDOW_PAD * 2);
  }

  const fragment = document.createDocumentFragment();
  if (virtual) {
    const topPad = document.createElement("div");
    topPad.className = "layer-pad";
    topPad.style.height = `${start * rowH}px`;
    fragment.appendChild(topPad);
  }
  if (start === 0) {
    appendLayerInsertSlot(fragment, { kind: "front" }, "在最前插入");
  } else {
    appendLayerInsertSlot(
      fragment,
      layerInsertSpecForItem(items[start - 1]),
      "在此之间插入"
    );
  }
  for (let i = start; i < end; i++) {
    const item = items[i];
    if (item.kind === "group") {
      appendGroupHeader(fragment, item.groupId, item.members, selectedSet, item.filterText, item.depth || 0);
    } else {
      appendLayerRow(fragment, item.index, selectedSet, item.filterText, item.asChild, item.depth || 0);
    }
    appendLayerInsertSlot(fragment, layerInsertSpecForItem(item), "在此层下方插入");
  }
  if (virtual) {
    const botPad = document.createElement("div");
    botPad.className = "layer-pad";
    botPad.style.height = `${(items.length - end) * rowH}px`;
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
  syncLayerInsert();
  const selectedSet = new Set(state.selected);
  const filterText = (state.layerFilter || "").trim().toLowerCase();
  layerItemsCache = state.records.length ? collectLayerItems(selectedSet, filterText) : [];
  syncLayerInsertBanner();
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
      const top = itemIndex * layerRowHeight();
      if (top < list.scrollTop || top + layerRowHeight() > list.scrollTop + list.clientHeight) {
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

function revealSelection() {
  const bounds = unionBox(selectionHitBoxes(state.selected));
  const shell = document.getElementById("canvasShell");
  if (!bounds || !shell) return;
  const { w: sw, h: sh } = shellViewSize();
  const fit = houseFitScale(sw, sh);
  const pad = 72;
  const fitZoom = Math.min(
    ZOOM_MAX,
    Math.max(
      ZOOM_MIN,
      Math.min(sw / ((bounds.width + pad) * fit), sh / ((bounds.height + pad) * fit))
    )
  );
  if (fitZoom < state.zoom - 0.02) setZoom(fitZoom, null, null, { pin: false });
  requestAnimationFrame(() => {
    const transform = viewportTransform();
    const center = transform.sceneToClient(
      (bounds.left + bounds.right) / 2,
      (bounds.top + bounds.bottom) / 2
    );
    const shellRect = shell.getBoundingClientRect();
    shell.scrollLeft += center.x - shellRect.left - shell.clientWidth / 2;
    shell.scrollTop += center.y - shellRect.top - shell.clientHeight / 2;
    syncViewportOverlays();
  });
}

function focusSelection() {
  revealSelection();
}

function zoomActualSize() {
  const { w: sw, h: sh } = shellViewSize();
  const fit = houseFitScale(sw, sh);
  setZoom(fit > 0.001 ? 1 / fit : 1);
}

function setActiveTool(tool) {
  if (tool === "diamond") tool = "rect";
  if (HIDDEN_TOOLS.has(tool)) tool = SMART_TOOLS.has(tool) ? "select" : "stamp";
  const next = PLACE_TOOLS.has(tool) || SMART_TOOLS.has(tool) || tool === "select" ? tool : "select";
  state.tool = next;
  if (!isPlaceTool() && !isSmartTool()) state.shapeStroke = null;
  if (isPlaceTool()) state.lastPlaceTool = state.tool;
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
  setMobileToolFamily(isPlaceTool() || isSmartTool() ? "brush" : "select", { activate: false });
  updateToolHint();
  syncShapeOverlay();
  syncSmartBuildingUi();
}

const COMMANDS = [
  { id: "selectTool", label: "选择工具", shortcut: "V", run: () => setActiveTool("select") },
  { id: "paintTool", label: "纯笔刷", shortcut: "N", run: () => setActiveTool("paint") },
  { id: "stampTool", label: "点刷铺放", shortcut: "B", run: () => setActiveTool("stamp") },
  { id: "tileTool", label: "平铺铺放", shortcut: "T", hidden: true, run: () => setActiveTool("tile") },
  { id: "rectTool", label: "矩形铺放", shortcut: "U", hidden: true, run: () => setActiveTool("rect") },
  { id: "lineTool", label: "直线 / 斜线铺放", shortcut: "L", hidden: true, run: () => setActiveTool("line") },
  { id: "circleTool", label: "圆形铺放", shortcut: "O", hidden: true, run: () => setActiveTool("circle") },
  { id: "triangleTool", label: "三角形铺放", shortcut: "I", hidden: true, run: () => setActiveTool("triangle") },
  { id: "ringTool", label: "一圈描边", shortcut: "G", hidden: true, run: () => setActiveTool("ring") },
  { id: "brushFromSelection", label: "选中项用作笔刷", shortcut: "Shift+B", run: useSelectionAsBrush },
  { id: "undo", label: "撤销", shortcut: "Ctrl+Z", run: undo },
  { id: "redo", label: "重做", shortcut: "Ctrl+Y / Ctrl+Shift+Z", run: redo },
  { id: "selectAll", label: "全选素材", shortcut: "Ctrl+A", run: selectAllRecords },
  { id: "clearSelection", label: "清除选择", shortcut: "Ctrl+Shift+A", run: () => { clearSelection(); renderBuilding(); } },
  { id: "duplicate", label: "复制选中", shortcut: "Ctrl+D", run: duplicateSelected },
  { id: "delete", label: "删除选中", shortcut: "Delete / Backspace", run: deleteSelected },
  { id: "flip", label: "转向", shortcut: "R", run: flipSelectedOrBrush },
  { id: "lock", label: "锁定/解锁", shortcut: "Ctrl+L", run: toggleLockSelected },
  { id: "group", label: "成组", shortcut: "C", run: groupSelected },
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
  { id: "fit", label: "适应画布", shortcut: "0", run: () => setZoom(1, null, null, { recenter: true }) },
  { id: "actual", label: "画布 100%", shortcut: "1", run: zoomActualSize },
  { id: "marqueeTouch", label: "圈选：碰到就选", shortcut: "M", run: () => setMarqueeMode("touch") },
  { id: "marqueeContain", label: "圈选：完整包含", shortcut: "Shift+M", run: () => setMarqueeMode("contain") },
  { id: "zoomIn", label: "放大", shortcut: "+", run: () => zoomBy(ZOOM_STEP) },
  { id: "zoomOut", label: "缩小", shortcut: "-", run: () => zoomBy(-ZOOM_STEP) },
  { id: "copy", label: "复制到剪贴工作集", shortcut: "Ctrl+C", run: copySelected },
  { id: "paste", label: "粘贴工作集", shortcut: "Ctrl+V", run: pasteClipboard },
  { id: "batchPreview", label: "打开图纸库", shortcut: "", run: () => togglePaperLibrary() },
  {
    id: "saveDesign",
    label: "保存到图纸库",
    shortcut: "Ctrl+S",
    run: () => saveDesignNow().catch((error) => console.warn(error)),
  },
  { id: "imageBuilding", label: "图片转建筑", shortcut: "", run: () => pickImageBuilding() },
];
const SHORTCUT_NOTES = [
  { label: "多选 / 取消多选", shortcut: "Ctrl+点击" },
  { label: "选中后看邻近参考线", shortcut: "按住 Ctrl" },
  { label: "选中素材微移", shortcut: "方向键" },
  { label: "大步微移", shortcut: "Shift+方向键" },
  { label: "拖动素材", shortcut: "左键拖" },
  { label: "选中成组里的单件", shortcut: "双击 / Alt+点击" },
  { label: "右键拖：平移画布；单击：菜单", shortcut: "右键" },
  { label: "平移画布", shortcut: "Space+左键 / 中键" },
  { label: "圈选碰到 / 完整包含", shortcut: "M / Shift+M" },
  { label: "点刷 / 纯笔刷", shortcut: "B / N" },
  { label: "成组 / 拆组", shortcut: "C / Ctrl+Shift+G" },
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
  applyHoverTip(document.getElementById("materialsDockGrip"), "拖动材料清单", "双击复位");
  applyHoverTip(document.getElementById("btnZoomIn"), "放大", "+");
  applyHoverTip(document.getElementById("btnZoomOut"), "缩小", "-");
  applyHoverTip(document.getElementById("btnZoomReset"), "适应画布", "0");
  applyHoverTip(document.getElementById("btnNudgeStep"), "设置微调步长", "点按输入");
  document.querySelectorAll("#nudgePad [data-nudge]").forEach((button) => {
    const dx = Number(button.dataset.nudgeX) || 0;
    const dy = Number(button.dataset.nudgeY) || 0;
    const label = dy < 0 ? "上移" : dy > 0 ? "下移" : dx < 0 ? "左移" : "右移";
    applyHoverTip(button, label, "方向键");
  });
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
  const hoverTipsAllowed = (event) => {
    if (workspaceMode().mobile || isCoarsePointer()) return false;
    if (event && event.pointerType && event.pointerType !== "mouse") return false;
    if (window.matchMedia && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;
    return true;
  };
  const showFor = (el, event) => {
    if (!el) return;
    if (!hoverTipsAllowed(event)) {
      hide();
      return;
    }
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
    showFor(el, event);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!hoverTipsAllowed(event)) hide();
  }, true);
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
  if (unlocked.length >= 2) {
    items.push({ label: "选中项用作笔刷", run: useSelectionAsBrush });
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
    items.push({ label: "成组", shortcut: "C", disabled: unlocked.length < 2, run: () => executeCommand("group") });
    items.push({ label: "拆组", shortcut: "Ctrl+Shift+G", disabled: !grouped, run: () => executeCommand("ungroup") });
    items.push({ label: "存为组件", shortcut: "P", disabled: !unlocked.length, run: () => executeCommand("savePreset") });
    items.push("sep");
    items.push({ label: "下移一层", shortcut: "S", disabled: !unlocked.length, run: () => executeCommand("down") });
    items.push({ label: "上移一层", shortcut: "W", disabled: !unlocked.length, run: () => executeCommand("up") });
    items.push({ label: "到底层", shortcut: "A", disabled: !unlocked.length, run: () => executeCommand("bottom") });
    items.push({ label: "到顶层", shortcut: "D", disabled: !unlocked.length, run: () => executeCommand("top") });
    items.push({
      label: "在此层上方插入",
      run: () => setLayerInsert(layerInsertSpecInFrontOf(selected[selected.length - 1]), { toggle: false }),
    });
    items.push({
      label: "在此层下方插入",
      run: () => setLayerInsert({ kind: "before", record: state.records[selected[selected.length - 1]] }, { toggle: false }),
    });
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
  COMMANDS.filter((command) => !command.hidden && (!query || `${command.label} ${command.shortcut}`.toLowerCase().includes(query)))
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
  [...COMMANDS.filter((command) => command.shortcut && !command.hidden), ...SHORTCUT_NOTES].forEach((command) => {
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
  const mode = workspaceMode();
  const useFloatingHud = buildingFloatingHud();
  if (mode.mobile && !useFloatingHud) {
    if (open && window.MobileWorkspace.activeSheet() !== "building-tools") {
      window.MobileWorkspace.openSheet("building-tools", {
        trigger: document.getElementById("btnBuildingMobileTools"),
        resetScroll: false,
      });
    } else if (!open && window.MobileWorkspace.activeSheet() === "building-tools") {
      window.MobileWorkspace.closeSheet("building-tools", { restoreFocus: false });
    }
  } else if (window.MobileWorkspace?.activeSheet() === "building-tools") {
    window.MobileWorkspace.closeSheet("building-tools", { restoreFocus: false });
  }
  const dock = document.getElementById("canvasToolDock");
  dock?.setAttribute("aria-hidden", String(mode.mobile && !useFloatingHud && !open));
  const button = document.getElementById("btnBuildingMobileTools");
  button?.classList.toggle("on", !!open);
  button?.setAttribute("aria-pressed", String(!!open));
  syncBuildingBackdrop();
}

function setMobileToolFamily(family, { activate = true } = {}) {
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
  if (!activate) return;
  if (state.mobileToolFamily === "brush" && !isPlaceTool()) {
    setActiveTool(state.lastPlaceTool || "stamp");
  } else if (state.mobileToolFamily === "select" && isPlaceTool()) {
    setActiveTool("select");
  }
}

function syncBuildingBackdrop() {
  const backdrop = document.getElementById("buildingRailBackdrop");
  if (!backdrop) return;
  const mode = workspaceMode();
  if (!mode.mobile || buildingFloatingHud()) {
    backdrop.hidden = true;
    return;
  }
  const railOpen = !state.railCollapsed;
  backdrop.hidden = !railOpen;
}

function closeBuildingRail() {
  state.railCollapsed = true;
  applyRailState();
}

function closeBuildingRailOnPick() {
  if (state.sheetPinned && workspaceMode().tablet) return;
  closeBuildingRail();
}

function buildingSheetRail() {
  return document.querySelector(".building-rail");
}

function loadSheetLayout() {
  try {
    const saved = JSON.parse(deskGet(SHEET_LAYOUT_KEY) || "{}") || {};
    state.sheetPinned = !!saved.pinned;
    const box = saved.layout;
    state.sheetLayout =
      box &&
      Number.isFinite(box.left) &&
      Number.isFinite(box.top) &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height)
        ? { left: box.left, top: box.top, width: box.width, height: box.height }
        : null;
  } catch {
    state.sheetPinned = false;
    state.sheetLayout = null;
  }
}

function saveSheetLayout() {
  deskSet(
    SHEET_LAYOUT_KEY,
    JSON.stringify({
      pinned: !!state.sheetPinned,
      layout: state.sheetLayout,
    })
  );
}

function sheetViewportBox() {
  const mode = workspaceMode();
  const pad = 8;
  return {
    left: pad,
    top: Math.max(pad, 44),
    width: Math.max(SHEET_MIN_W, (mode.width || window.innerWidth || 1024) - pad * 2),
    height: Math.max(SHEET_MIN_H, (mode.height || window.innerHeight || 768) - pad * 2 - 44),
  };
}

function clampSheetBox(box) {
  const view = sheetViewportBox();
  const width = Math.min(view.width, Math.max(SHEET_MIN_W, Math.round(box.width)));
  const height = Math.min(view.height, Math.max(SHEET_MIN_H, Math.round(box.height)));
  const maxLeft = view.left + view.width - width;
  const maxTop = view.top + view.height - height;
  return {
    left: Math.min(maxLeft, Math.max(view.left, Math.round(box.left))),
    top: Math.min(maxTop, Math.max(view.top, Math.round(box.top))),
    width,
    height,
  };
}

function currentSheetBox(rail = buildingSheetRail()) {
  if (!rail) return null;
  const rect = rail.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return state.sheetLayout;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function applySheetBox(rail, box) {
  if (!rail || !box) return;
  const next = clampSheetBox(box);
  state.sheetLayout = next;
  rail.classList.add("is-sheet-placed");
  rail.style.setProperty("--sheet-left", `${next.left}px`);
  rail.style.setProperty("--sheet-top", `${next.top}px`);
  rail.style.setProperty("--sheet-width", `${next.width}px`);
  rail.style.setProperty("--sheet-height", `${next.height}px`);
}

function clearSheetBox(rail = buildingSheetRail()) {
  if (!rail) return;
  rail.classList.remove("is-sheet-placed");
  rail.style.removeProperty("--sheet-left");
  rail.style.removeProperty("--sheet-top");
  rail.style.removeProperty("--sheet-width");
  rail.style.removeProperty("--sheet-height");
}

function syncSheetPinButton() {
  const button = document.getElementById("btnBuildingSheetPin");
  if (!button) return;
  const pinned = !!state.sheetPinned && workspaceMode().tablet;
  button.setAttribute("aria-pressed", String(pinned));
  button.classList.toggle("on", pinned);
  button.title = pinned ? "取消固定，选素材后收起面板" : "固定后选素材不会收起";
  button.setAttribute("aria-label", pinned ? "取消固定面板" : "固定面板");
}

function syncBuildingSheetLayout() {
  const rail = buildingSheetRail();
  if (!rail) return;
  if (!workspaceMode().tablet) {
    rail.classList.remove("is-sheet-pinned", "is-sheet-resizing", "is-sheet-dragging");
    clearSheetBox(rail);
    syncSheetPinButton();
    return;
  }
  rail.classList.toggle("is-sheet-pinned", !!state.sheetPinned);
  if (state.sheetLayout) applySheetBox(rail, state.sheetLayout);
  else clearSheetBox(rail);
  syncSheetPinButton();
}

function setSheetPinned(pinned) {
  state.sheetPinned = !!pinned;
  const rail = buildingSheetRail();
  if (pinned && rail && !state.sheetLayout) {
    const box = currentSheetBox(rail);
    if (box) applySheetBox(rail, box);
  }
  saveSheetLayout();
  syncBuildingSheetLayout();
}

function bindBuildingSheetChrome() {
  loadSheetLayout();
  const rail = buildingSheetRail();
  const pin = document.getElementById("btnBuildingSheetPin");
  pin?.addEventListener("click", () => setSheetPinned(!state.sheetPinned));
  if (!rail || rail.dataset.sheetChromeBound) return;
  rail.dataset.sheetChromeBound = "1";

  const startGesture = (event, kind, edge) => {
    if (!workspaceMode().tablet) return false;
    if (event.pointerType === "mouse" && event.button !== 0) return false;
    const origin = currentSheetBox(rail);
    if (!origin) return false;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    rail.classList.add(kind === "resize" ? "is-sheet-resizing" : "is-sheet-dragging");
    try {
      event.currentTarget.setPointerCapture?.(pointerId);
    } catch {
      // Capture may fail for synthetic events.
    }
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && dx * dx + dy * dy < 16) return;
      moved = true;
      let next = { ...origin };
      if (kind === "move") {
        next.left = origin.left + dx;
        next.top = origin.top + dy;
      } else {
        if (edge.includes("e")) next.width = origin.width + dx;
        if (edge.includes("s")) next.height = origin.height + dy;
        if (edge.includes("w")) {
          next.left = origin.left + dx;
          next.width = origin.width - dx;
        }
        if (edge.includes("n")) {
          next.top = origin.top + dy;
          next.height = origin.height - dy;
        }
      }
      applySheetBox(rail, next);
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      rail.classList.remove("is-sheet-resizing", "is-sheet-dragging");
      try {
        event.currentTarget.releasePointerCapture?.(pointerId);
      } catch {
        // Already released.
      }
      if (moved) {
        saveSheetLayout();
        paintAssetWindow?.();
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return true;
  };

  rail.querySelectorAll(".sheet-resize").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      startGesture(event, "resize", handle.dataset.resize || "");
    });
  });
  rail.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".sheet-resize, button, input, select, textarea, a, .component-list, .layer-list, .base-icon-grid")) {
      return;
    }
    if (!event.target.closest(".drawer-cap, .mobile-sheet-handle")) return;
    startGesture(event, "move", "");
  });
  syncBuildingSheetLayout();
}

function openBuildingRail(mode = state.phase === "select" ? "base" : state.railTab || "assets") {
  if (!buildingFloatingHud()) setMobileToolsOpen(false);
  state.mobilePan = false;
  syncMobilePanUi();
  if (state.phase !== "design") mode = "base";
  if (!["base", "assets", "layers", "materials", "project"].includes(mode)) mode = "assets";
  state.mobileSheetMode = mode;
  if (mode === "assets" || mode === "layers" || mode === "materials") setRailTab(mode);
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
  const mode = workspaceMode();
  const mobile = mode.mobile;
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
  window.MobileWorkspace?.setInert(stage, open && !buildingFloatingHud());
  syncBuildingBackdrop();
  syncMobileBuildingPanels();
  syncMobileBuildingChrome();
  const assets = document.getElementById("btnBuildingMobileAssets");
  const project = document.getElementById("btnBuildingMobileProject");
  const sheetMode = state.phase === "select" ? "base" : state.mobileSheetMode;
  assets?.setAttribute("aria-expanded", String(open && sheetMode !== "project"));
  project?.setAttribute("aria-expanded", String(open && sheetMode === "project"));
  assets?.classList.toggle("on", open && sheetMode !== "project");
  project?.classList.toggle("on", open && sheetMode === "project");
  if (open && !buildingFloatingHud()) setMobileToolsOpen(false);
}

function syncMobileBuildingChrome() {
  const label = document.getElementById("buildingMobileAssetsLabel");
  if (label) label.textContent = state.phase === "design" ? "素材" : "户型";
  const title = document.getElementById("buildingSheetTitle");
  if (!title) return;
  const mode = state.phase === "select" ? "base" : state.mobileSheetMode;
  title.textContent = mode === "base" ? "户型" : mode === "layers" ? "图层" : mode === "materials" ? "材料" : mode === "project" ? "项目" : "素材";
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
  syncBuildingSheetLayout();
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

async function parseBuildingFile(file, existingBuffer) {
  const buffer = existingBuffer || await file.arrayBuffer();
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
  const groups = new Set(
    state.records.flatMap((record) => BI.recordGroupStack(record).map((entry) => entry.id))
  ).size;
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
    const paperName = paperFileStem();
    summary.textContent =
      (paperName ? `图纸：${paperName}.txt\n` : "") +
      `户型：${state.base?.name || "当前户型"}\n` +
      `占地：${footprintText}\n` +
      `素材：${visible} 件\n` +
      `未解析：${unresolved} 件\n` +
      (reasonText ? `${reasonText}\n` : "") +
      `分组：${groups} 组\n` +
      `地基：${state.keepFoundation ? "保留" : "不保留"}\n\n` +
      "确认画面和遮挡关系后再下载。";
  }
  const title = document.getElementById("paperPreviewTitle");
  if (title) title.textContent = paperFileStem() ? `建筑图纸预览 · ${paperFileStem()}.txt` : "建筑图纸预览";
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
    anchor.download = currentPaperDownloadName("png");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  }, "image/png");
}

function previewPackForMat(mat) {
  if (mat >= 1000) return packForPaperUid(Math.floor(mat / 1000));
  return state.pack;
}

function previewPackForRecord(record, fallbackKey) {
  const mat = Number(record?.mat) || 0;
  if (record?.pack) return record.pack;
  const key = paperPackKey(record, fallbackKey || "");
  if (key) {
    const pack = packByKey(key);
    if (pack) return pack;
  }
  return previewPackForMat(mat);
}

// Same visibility rule as the design canvas (isCanvasRecord) minus the viewport
// clip: paper coordinates live on the 1690×1030 native layer, so no bounds check.
function libraryPreviewRecords(records, fallbackKey) {
  return BI.visiblePaperRecords(records).filter((record) => {
    const component = componentByUid(Number(record.mat) || 0, previewPackForRecord(record, fallbackKey));
    return !!component && !isNativeDeskHiddenComponent(component);
  });
}

// Server thumbnails painted before this moment were rendered with a preview
// rule that drew native-hidden try*.ale sprites; repaint and re-upload them.
const PAPER_THUMB_MIN_AT = Date.UTC(2026, 8, 6, 14, 0, 0);

function paperThumbIsStale(entry) {
  const at = Number(entry?.thumbAt) || 0;
  return at > 0 && at < PAPER_THUMB_MIN_AT;
}

const previewImageCache = new Map();

function loadPreviewImage(url) {
  if (!url) return Promise.resolve(null);
  const cached = previewImageCache.get(url);
  if (cached) return cached;
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
  previewImageCache.set(url, pending);
  return pending;
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

  const fallbackKey = documentData.packKey || "";
  const rows = libraryPreviewRecords(documentData.records, fallbackKey)
    .map((record) => {
      const mat = Number(record.mat) || 0;
      const pack = previewPackForRecord(record, fallbackKey);
      const component = componentByUid(mat, pack);
      const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
      return {
        record,
        component,
        pack,
        width: geometry.width || 16,
        height: geometry.height || 16,
      };
    })
    .filter((row) => row.component);
  if (documentData.kind === "terrain") {
    const stamps = documentData.stamps || [];
    const size = Math.max(1, Number(documentData.size) || 1);
    const pad = Math.max(8, Math.round(Math.min(width, height) * 0.06));
    const fit = Math.min((width - pad * 2) / size, (height - pad * 2) / size);
    const mw = size * fit;
    const mh = size * fit;
    const ox = (width - mw) / 2;
    const oy = (height - mh) / 2;
    c.fillStyle = Number(documentData.mapflag) ? "#7a5a28" : "#1a2a18";
    c.fillRect(0, 0, width, height);
    stamps.slice(0, 1200).forEach((stamp) => {
      const x = ox + (Number(stamp.x) || 0) * fit;
      const y = oy + (Number(stamp.y) || 0) * fit;
      c.fillStyle = "rgba(238, 245, 234, 0.88)";
      c.fillRect(x, y, Math.max(1.5, fit * 3), Math.max(1.5, fit * 1.5));
    });
    c.strokeStyle = "rgba(201,234,236,0.85)";
    c.strokeRect(ox + 0.5, oy + 0.5, mw - 1, mh - 1);
    return;
  }
  if (!rows.length) {
    c.fillStyle = "#eef5ea";
    c.font = "12px sans-serif";
    c.textAlign = "center";
    c.fillText(documentData.kind === "manor" ? "庄园摆放图" : "没有可预览素材", width / 2, height / 2);
    return;
  }
  const left = Math.min(...rows.map((row) => Number(row.record.x) || 0));
  const top = Math.min(...rows.map((row) => Number(row.record.y) || 0));
  const right = Math.max(...rows.map((row) => (Number(row.record.x) || 0) + row.width));
  const bottom = Math.max(...rows.map((row) => (Number(row.record.y) || 0) + row.height));
  const scale = Math.min((width - 18) / Math.max(1, right - left), (height - 18) / Math.max(1, bottom - top), 1);
  const ox = (width - (right - left) * scale) / 2 - left * scale;
  const oy = (height - (bottom - top) * scale) / 2 - top * scale;
  const imagesByUrl = new Map();
  rows.forEach((row) => {
    const url = spriteUrl(row.component, row.pack, row.record.state ?? row.record.flip ?? 0);
    row.url = url;
    if (url && !imagesByUrl.has(url)) imagesByUrl.set(url, loadPreviewImage(url));
  });
  const loaded = new Map();
  await Promise.all([...imagesByUrl].map(async ([url, pending]) => {
    loaded.set(url, await pending);
  }));
  rows.forEach((row) => {
    const x = ox + (Number(row.record.x) || 0) * scale;
    const y = oy + (Number(row.record.y) || 0) * scale;
    const drawW = Math.max(1, row.width * scale);
    const drawH = Math.max(1, row.height * scale);
    if (drawW < 0.6 && drawH < 0.6) return;
    const image = loaded.get(row.url);
    if (image) c.drawImage(image, x, y, drawW, drawH);
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
  kindFilter: "all",
  groupFilter: "all",
  groups: [],
  entries: [],
  failed: 0,
  skippedDup: 0,
  skippedKind: 0,
  selectedIds: new Set(),
  archiveView: false,
};

const PAPER_LIBRARY_DESK = "building";
const PAPER_LIBRARY_DB = "manor-paper-library";
const PAPER_LIBRARY_STORE = "papers";

function openPaperLibraryDb() {
  return new Promise((resolve, reject) => {
    const user = String(window.deskUser || "").trim();
    const dbName = user ? `${PAPER_LIBRARY_DB}-${encodeURIComponent(user)}` : PAPER_LIBRARY_DB;
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PAPER_LIBRARY_STORE)) {
        db.createObjectStore(PAPER_LIBRARY_STORE, { keyPath: "fingerprint" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function paperFingerprint(name, bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(view.length / 96) || 1);
  for (let i = 0; i < view.length; i += step) {
    hash ^= view[i];
    hash = Math.imul(hash, 16777619);
  }
  const head = Math.min(32, view.length);
  for (let i = 0; i < head; i++) {
    hash ^= view[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${String(name || "")}::${view.length}::${hash >>> 0}`;
}

function paperContentIdFromBase64(data) {
  return PaperLibraryCore.contentIdFromBase64(data);
}

function sniffPaperKind(bytes) {
  return PaperLibraryCore.sniffKind(bytes);
}

function paperKindLabel(kind) {
  return PaperLibraryCore.kindLabel(kind);
}

function libraryAcceptsKind(kind) {
  return kind === "desk" || kind === "terrain" || kind === "manor";
}

async function loadPaperLibraryCacheMap() {
  try {
    const db = await openPaperLibraryDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PAPER_LIBRARY_STORE, "readonly");
      const req = tx.objectStore(PAPER_LIBRARY_STORE).getAll();
      req.onsuccess = () => {
        const map = new Map();
        (req.result || []).forEach((row) => {
          if (row?.fingerprint) map.set(row.fingerprint, row);
          if (row?.contentId) map.set(`id:${row.contentId}`, row);
        });
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.warn("图纸库缓存不可用", error);
    return new Map();
  }
}

async function putPaperLibraryCache(rows) {
  if (!rows.length) return;
  try {
    const db = await openPaperLibraryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PAPER_LIBRARY_STORE, "readwrite");
      const store = tx.objectStore(PAPER_LIBRARY_STORE);
      rows.forEach((row) => store.put(row));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("图纸库缓存写入失败", error);
  }
}

async function clearPaperLibraryCache() {
  try {
    const db = await openPaperLibraryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PAPER_LIBRARY_STORE, "readwrite");
      const req = tx.objectStore(PAPER_LIBRARY_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.warn("图纸库缓存清空失败", error);
  }
}

function serializePaperLibraryCache(entry, fingerprint, thumb) {
  return {
    fingerprint,
    contentId: entry.contentId || "",
    name: entry.name,
    search: entry.search,
    kind: entry.kind,
    groupId: entry.groupId || "",
    count: entry.count,
    meta: entry.meta,
    unresolved: entry.unresolved || 0,
    materials: [...(entry.materials || [])],
    documentData: entry.documentData,
    thumb: thumb || "",
  };
}

function entryFromPaperCache(cached, file, id) {
  return {
    id,
    contentId: cached.contentId || "",
    file,
    documentData: cached.documentData,
    serverHydrated: false,
    name: cached.name,
    search: cached.search || String(cached.name || "").toLowerCase(),
    kind: cached.kind,
    groupId: cached.groupId || "",
    count: cached.count,
    meta: cached.meta,
    materials: new Map(cached.materials || []),
    unresolved: cached.unresolved || 0,
    savedAt: Number(cached.savedAt) || Date.now(),
  };
}

function canvasThumbDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
}

async function paintCachedPaperThumbnail(canvas, dataUrl) {
  if (!dataUrl) return false;
  const image = await loadPreviewImage(dataUrl);
  if (!image?.naturalWidth) return false;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return true;
}

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
  drawQueued: false,
  canvasCssW: 0,
  canvasCssH: 0,
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
    btn.title = "打开图纸库";
  }
  btn.classList.toggle("on", isPaperLibraryOpen());
}

function paperLibraryVisibleEntries() {
  return batchLibrary.entries.filter((entry) => (
    PaperLibraryCore.paperMatchesArchiveView(entry, batchLibrary.archiveView)
  ));
}

function syncPaperArchiveUi() {
  const count = PaperLibraryCore.countArchivedPapers(batchLibrary.entries);
  PaperLibraryCore.syncPaperArchiveDoor({
    archiveView: batchLibrary.archiveView,
    count,
  });
  const title = document.getElementById("paperLibraryTitle");
  if (title) title.textContent = batchLibrary.archiveView ? "归档柜" : "图纸库";
  const empty = document.getElementById("paperLibraryEmpty");
  if (empty) {
    const heading = empty.querySelector("strong");
    const copy = empty.querySelector("p");
    if (batchLibrary.archiveView) {
      if (heading) heading.textContent = "归档柜是空的";
      if (copy) copy.textContent = "主列表里点「归档」的图纸会出现在这里，可以随时恢复。";
    } else {
      if (heading) heading.textContent = "还没有图纸";
      if (copy) copy.textContent = "导入文件夹或文件。建筑图纸可在本桌打开，地形图纸会收入库并转到地形桌查看；已有图纸会按内容去重后叠加。";
    }
  }
}

function syncPaperLibraryEmpty() {
  const empty = document.getElementById("paperLibraryEmpty");
  const grid = document.getElementById("paperPreviewGrid");
  const visible = paperLibraryVisibleEntries().length;
  const hasCards = visible > 0 || batchLibrary.loading;
  if (empty) empty.hidden = hasCards;
  if (grid) grid.hidden = !visible && !batchLibrary.loading;
  syncPaperArchiveUi();
}

function setPaperLibraryOpen(open) {
  const panel = document.getElementById("paperLibrary");
  if (!panel) return;
  if (!open) {
    closePaperInspect();
    batchLibrary.archiveView = false;
  }
  panel.hidden = !open;
  window.MobileWorkspace?.setInert(document.querySelector(".building-stage"), open);
  window.MobileWorkspace?.setInert(document.querySelector(".building-app .topbar"), open);
  window.MobileWorkspace?.setInert(document.querySelector(".building-rail"), open || (window.MobileWorkspace.modeForViewport().mobile && state.railCollapsed));
  window.MobileWorkspace?.setInert(document.getElementById("buildingMobileDock"), open);
  document.getElementById("buildingApp")?.classList.toggle("library-open", open);
  if (open) {
    syncPaperLibraryEmpty();
    applyPaperLibraryFilter();
    syncPaperLibraryBatchBar();
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
  openServerPaperLibrary().catch((error) => console.warn(error));
}

async function clearServerPaperLibrary() {
  const ok = await appConfirm("清空图纸库里的全部图纸？", {
    title: "清空图纸库",
    okLabel: "清空",
    danger: true,
  });
  if (!ok) return;
  try {
    await fetch("/api/saves/building/papers", { method: "DELETE", credentials: "same-origin" });
  } catch (error) {
    console.warn(error);
  }
  batchLibrary.generation += 1;
  batchLibrary.loading = false;
  batchLibrary.entries = [];
  batchLibrary.failed = 0;
  batchLibrary.skippedDup = 0;
  batchLibrary.skippedKind = 0;
  batchLibrary.folderLabel = "";
  batchLibrary.groups = [];
  batchLibrary.kindFilter = "all";
  batchLibrary.groupFilter = "all";
  batchLibrary.selectedIds.clear();
  document.querySelectorAll("[data-paper-kind]").forEach((tab) => {
    const on = tab.dataset.paperKind === "all";
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("paperPreviewGrid")?.replaceChildren();
  renderPaperGroupTabs();
  syncPaperLibraryEmpty();
  syncPaperLibraryBatchBar();
  updatePaperLibraryStatus("已清空图纸库。");
  updateBatchPreviewButton();
  clearPaperLibraryCache().catch((error) => console.warn(error));
}

function folderLabelFromFiles(files) {
  const rel = String(files[0]?.webkitRelativePath || files[0]?.name || "").replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "本地图纸";
}

function paperLibraryMaterials(records) {
  const materialTotals = new Map();
  let unresolved = 0;
  BI.visiblePaperRecords(records).forEach((record) => {
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

function paperLibrarySkipNote() {
  const notes = [];
  if (batchLibrary.skippedDup) notes.push(`跳过 ${batchLibrary.skippedDup} 张重复`);
  if (batchLibrary.skippedKind) notes.push(`跳过 ${batchLibrary.skippedKind} 张无法识别的图纸`);
  if (batchLibrary.failed) notes.push(`${batchLibrary.failed} 张无法读取`);
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

function updatePaperLibraryStatus(message = "") {
  const status = document.getElementById("paperBatchStatus");
  syncPaperArchiveUi();
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  const visible = paperLibraryVisibleEntries();
  const total = visible.length;
  const unresolved = visible.reduce((sum, entry) => sum + Number(entry.unresolved || 0), 0);
  const shown = [...(document.getElementById("paperPreviewGrid")?.children || [])].filter((card) => !card.hidden).length;
  if (batchLibrary.loading) {
    status.textContent = `正在载入… 已载入 ${batchLibrary.entries.length} 张`
      + (unresolved ? ` · ${unresolved} 件素材未解析` : "")
      + paperLibrarySkipNote();
    return;
  }
  if (!total) {
    status.textContent = paperLibrarySkipNote().replace(/^ · /, "")
      || (batchLibrary.archiveView ? "归档柜是空的。" : "还没有图纸。导入文件夹或文件即可叠加。");
    return;
  }
  const filtered = batchLibrary.query || batchLibrary.kindFilter !== "all" || batchLibrary.groupFilter !== "all";
  const filterNote = filtered && shown !== total ? ` · 显示 ${shown} 张` : "";
  status.textContent = `${total} 张${batchLibrary.archiveView ? "归档" : "图纸"}${filterNote}`
    + (unresolved ? ` · ${unresolved} 件素材未解析` : "")
    + paperLibrarySkipNote();
}

function paperEntryVisible(entry, query) {
  const queryOk = !query || String(entry.search || "").includes(query);
  const kind = PaperLibraryCore.resolvePaperKind(entry);
  const kindOk = PaperLibraryCore.kindMatchesFilter(kind, batchLibrary.kindFilter);
  const groupOk = batchLibrary.groupFilter === "all" || String(entry.groupId || "") === batchLibrary.groupFilter;
  return queryOk && kindOk && groupOk && PaperLibraryCore.paperMatchesArchiveView(entry, batchLibrary.archiveView);
}

function paperCardKindFromDom(card) {
  const meta = card.querySelector(".paper-preview-copy small")?.textContent || "";
  return PaperLibraryCore.resolvePaperKind({ kind: card.dataset.kind, meta });
}

function applyPaperLibraryFilter() {
  const query = (document.getElementById("paperBatchSearch")?.value || "").trim().toLowerCase();
  batchLibrary.query = query;
  const grid = document.getElementById("paperPreviewGrid");
  if (!grid) return;
  const byId = new Map(batchLibrary.entries.map((entry) => [String(entry.id), entry]));
  grid.querySelectorAll(".paper-preview-item").forEach((card) => {
    const entry = byId.get(String(card.dataset.id || ""));
    if (entry) {
      card.hidden = !paperEntryVisible(entry, query);
      return;
    }
    const queryOk = !query || String(card.dataset.search || "").includes(query);
    const kindOk = PaperLibraryCore.kindMatchesFilter(paperCardKindFromDom(card), batchLibrary.kindFilter);
    const groupOk = batchLibrary.groupFilter === "all" || String(card.dataset.group || "") === batchLibrary.groupFilter;
    const archiveOk = PaperLibraryCore.paperMatchesArchiveView({ archived: card.dataset.archived === "1" }, batchLibrary.archiveView);
    card.hidden = !(queryOk && kindOk && groupOk && archiveOk);
  });
  PaperLibraryCore.reorderPaperCards(grid, batchLibrary.entries, PaperLibraryCore.loadPaperSort());
  syncPaperLibraryEmpty();
  updatePaperLibraryStatus();
}

function renderPaperGroupTabs() {
  const host = document.getElementById("paperGroupTabs");
  if (!host) return;
  host.replaceChildren();
  const tabs = [{ id: "all", name: "全部分组" }, ...batchLibrary.groups];
  tabs.forEach((tab) => {
    const button = document.createElement("button");
    PaperLibraryCore.bindPaperGroupTab(button, tab, {
      selected: batchLibrary.groupFilter === tab.id,
      onSelect: (id) => {
        batchLibrary.groupFilter = id;
        renderPaperGroupTabs();
        applyPaperLibraryFilter();
      },
      onRename: (id) => {
        renamePaperLibraryGroup(id).catch((error) => console.warn(error));
      },
    });
    host.appendChild(button);
  });
  PaperLibraryCore.syncPaperGroupRenameButton(batchLibrary.groupFilter, batchLibrary.groups);
}

function fillPaperGroupSelect(select, value) {
  if (!select) return;
  const current = value == null ? select.value : value;
  select.replaceChildren(new Option("未分组", ""));
  batchLibrary.groups.forEach((group) => {
    select.appendChild(new Option(group.name, group.id));
  });
  select.value = current || "";
}

function paperLibrarySelectKey(entry) {
  return PaperLibraryCore.paperSelectKey(entry);
}

function paperLibrarySelectedEntries() {
  return batchLibrary.entries.filter((entry) => batchLibrary.selectedIds.has(paperLibrarySelectKey(entry)));
}

function syncPaperCardSelected(card, selected) {
  if (!card) return;
  card.classList.toggle("is-selected", !!selected);
  const input = card.querySelector(".paper-card-select-input");
  if (input) input.checked = !!selected;
}

function setPaperLibrarySelected(entry, selected) {
  const key = paperLibrarySelectKey(entry);
  if (!key) return;
  if (selected) batchLibrary.selectedIds.add(key);
  else batchLibrary.selectedIds.delete(key);
  syncPaperCardSelected(entry.card, selected);
  syncPaperLibraryBatchBar();
}

function prunePaperLibrarySelection() {
  const valid = new Set(batchLibrary.entries.map(paperLibrarySelectKey).filter(Boolean));
  for (const id of [...batchLibrary.selectedIds]) {
    if (!valid.has(id)) batchLibrary.selectedIds.delete(id);
  }
}

function clearPaperLibrarySelection() {
  batchLibrary.selectedIds.clear();
  document.querySelectorAll("#paperPreviewGrid .paper-preview-item").forEach((card) => {
    syncPaperCardSelected(card, false);
  });
  syncPaperLibraryBatchBar();
}

function selectVisiblePaperLibraryCards() {
  const grid = document.getElementById("paperPreviewGrid");
  if (!grid) return;
  const byId = new Map(batchLibrary.entries.map((entry) => [String(entry.id), entry]));
  grid.querySelectorAll(".paper-preview-item").forEach((card) => {
    if (card.hidden) return;
    const entry = byId.get(String(card.dataset.id || ""));
    if (!entry) return;
    const key = paperLibrarySelectKey(entry);
    if (!key) return;
    batchLibrary.selectedIds.add(key);
    syncPaperCardSelected(card, true);
  });
  syncPaperLibraryBatchBar();
}

function syncPaperLibraryBatchBar() {
  const bar = document.getElementById("paperLibraryBatch");
  const count = document.getElementById("paperLibraryBatchCount");
  const n = batchLibrary.selectedIds.size;
  if (bar) bar.hidden = n < 1;
  if (count) count.textContent = n ? `已选 ${n} 张` : "已选 0 张";
  fillPaperGroupSelect(document.getElementById("paperLibraryBatchGroup"));
}

async function applyPaperLibraryBatchGroup() {
  const groupId = String(document.getElementById("paperLibraryBatchGroup")?.value || "");
  const selected = paperLibrarySelectedEntries();
  if (!selected.length) return;
  const uploads = [];
  selected.forEach((entry) => {
    entry.groupId = groupId;
    const card = entry.card;
    if (card) {
      card.dataset.group = groupId;
      const select = card.querySelector(".paper-card-group");
      if (select) select.value = groupId;
    }
    if (entry.contentId) {
      uploads.push({
        id: entry.contentId,
        name: entry.name,
        kind: entry.kind,
        group: groupId,
      });
    }
  });
  applyPaperLibraryFilter();
  if (paperInspectView.entry && selected.includes(paperInspectView.entry)) {
    fillPaperGroupSelect(document.getElementById("paperInspectGroup"), groupId);
  }
  try {
    if (uploads.length) await persistPaperLibrary(uploads, false);
  } catch (error) {
    console.warn(error);
  }
}

function refreshPaperGroupControls() {
  renderPaperGroupTabs();
  document.querySelectorAll(".paper-card-group").forEach((select) => {
    fillPaperGroupSelect(select);
  });
  fillPaperGroupSelect(document.getElementById("paperInspectGroup"), paperInspectView.entry?.groupId || "");
  fillPaperGroupSelect(document.getElementById("paperLibraryBatchGroup"));
}

async function persistPaperLibraryGroups() {
  await persistPaperLibrary([], false);
}

async function createPaperLibraryGroup() {
  const name = await appPrompt("给这组图纸起个名字。", {
    title: "新建分组",
    fieldLabel: "分组名称",
    placeholder: "例如 咖啡馆",
    maxLength: 40,
  });
  if (name == null) return;
  const trimmed = PaperLibraryCore.sanitizePaperGroupName(name);
  if (!trimmed) return;
  const id = `g${Date.now().toString(36)}`;
  batchLibrary.groups = [...batchLibrary.groups, { id, name: trimmed }];
  try {
    await persistPaperLibraryGroups();
  } catch (error) {
    console.warn(error);
  }
  refreshPaperGroupControls();
}

async function renamePaperLibraryGroup(groupId) {
  const current = PaperLibraryCore.paperGroupById(batchLibrary.groups, groupId || batchLibrary.groupFilter);
  if (!current) {
    await appAlert("请先点一个要改名的分组。", { title: "重命名分组" });
    return;
  }
  const name = await appPrompt("修改这个分组的名字。图纸还在原来的组里。", {
    title: "重命名分组",
    fieldLabel: "分组名称",
    value: current.name,
    placeholder: current.name,
    maxLength: 40,
    okLabel: "保存",
  });
  if (name == null) return;
  const next = PaperLibraryCore.renamePaperGroup(batchLibrary.groups, current.id, name);
  const renamed = PaperLibraryCore.paperGroupById(next, current.id);
  if (!renamed || renamed.name === current.name) return;
  batchLibrary.groups = next;
  try {
    await persistPaperLibraryGroups();
  } catch (error) {
    console.warn(error);
  }
  refreshPaperGroupControls();
}

function applyPaperLibraryName(entry, rawName) {
  const next = PaperLibraryCore.sanitizePaperFileName(rawName);
  if (!entry || !next || next === entry.name) return false;
  entry.name = next;
  entry.search = next.toLowerCase();
  refreshPaperLibraryCard(entry);
  if (paperInspectView.entry === entry) {
    const title = document.getElementById("paperInspectName");
    if (title) title.textContent = next;
  }
  if (state.sourcePaper?.id && state.sourcePaper.id === entry.contentId) {
    state.sourcePaper.name = next;
  }
  applyPaperLibraryFilter();
  return true;
}

async function renamePaperLibraryEntry(entry) {
  if (!entry) return;
  const next = await appPrompt("给这张图纸起个新文件名。可以写 2026/8/30 这样的日期。", {
    title: "修改文件名",
    fieldLabel: "文件名",
    value: PaperLibraryCore.paperNameStem(entry.name),
    maxLength: 220,
    okLabel: "保存",
  });
  if (next == null) return;
  if (!applyPaperLibraryName(entry, next)) return;
  if (!entry.contentId) return;
  try {
    await persistPaperLibrary([{
      id: entry.contentId,
      name: entry.name,
      kind: entry.kind,
      group: entry.groupId || "",
    }], false);
  } catch (error) {
    console.warn(error);
    await appAlert("文件名已改，但同步失败，可稍后再试。", { title: "同步失败" });
  }
}

function setPaperLibraryArchiveView(open) {
  batchLibrary.archiveView = !!open;
  applyPaperLibraryFilter();
}

function persistPaperArchivePayload(entry) {
  return {
    id: entry.contentId,
    name: entry.name,
    kind: entry.kind,
    group: entry.groupId || "",
    archived: !!entry.archived,
    archivedAt: Number(entry.archivedAt) || 0,
  };
}

async function setPaperLibraryArchived(entry, archived) {
  if (!entry) return;
  const next = !!archived;
  if (!!entry.archived === next) return;
  entry.archived = next;
  entry.archivedAt = next ? Date.now() : 0;
  if (entry.card) entry.card.dataset.archived = next ? "1" : "0";
  PaperLibraryCore.syncPaperArchiveButton(entry.card?.querySelector(".paper-card-archive"), entry);
  const inspectBtn = document.getElementById("btnPaperInspectArchive");
  if (paperInspectView.entry === entry && inspectBtn) {
    PaperLibraryCore.syncPaperArchiveButton(inspectBtn, entry);
  }
  if (paperInspectView.entry === entry && next && !batchLibrary.archiveView) {
    closePaperInspect();
  }
  applyPaperLibraryFilter();
  if (!entry.contentId) return;
  try {
    await persistPaperLibrary([persistPaperArchivePayload(entry)], false);
  } catch (error) {
    console.warn(error);
    await appAlert("归档状态已改，但同步失败，可稍后再试。", { title: "同步失败" });
  }
}

async function togglePaperLibraryArchived(entry) {
  await setPaperLibraryArchived(entry, !entry?.archived);
}

async function applyPaperLibraryBatchArchive() {
  const selected = paperLibrarySelectedEntries();
  if (!selected.length) return;
  const archived = !batchLibrary.archiveView;
  for (const entry of selected) {
    await setPaperLibraryArchived(entry, archived);
  }
  clearPaperLibrarySelection();
}

async function assignPaperGroup(entry, groupId) {
  if (!entry) return;
  entry.groupId = String(groupId || "");
  const card = document.querySelector(`.paper-preview-item[data-id="${CSS.escape(String(entry.id))}"]`);
  if (card) {
    card.dataset.group = entry.groupId;
    const select = card.querySelector(".paper-card-group");
    if (select) select.value = entry.groupId;
  }
  applyPaperLibraryFilter();
  if (!entry.contentId) return;
  try {
    await persistPaperLibrary([{
      id: entry.contentId,
      name: entry.name,
      kind: entry.kind,
      group: entry.groupId,
    }], false);
  } catch (error) {
    console.warn(error);
  }
}

function fillPaperCardMaterials(host, materials, unresolved, kind, onDetail, { hydrated = true } = {}) {
  host.replaceChildren();
  if (!materials.size) {
    const empty = document.createElement("small");
    empty.textContent = kind === "desk"
      ? (hydrated ? "没有可统计的材料" : "点开查看材料")
      : kind === "terrain"
        ? "地形图纸不含装修材料"
        : "庄园摆放图不含装修材料";
    host.appendChild(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "paper-preview-item-materials-list";
  fillMaterialList(list, materials, 0);
  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "paper-preview-materials-detail";
  detail.textContent = "明细";
  detail.title = "查看完整材料清单";
  detail.setAttribute("aria-label", "查看完整材料清单");
  detail.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDetail?.();
  };
  host.append(list, detail);
  if (unresolved) host.title = `${unresolved} 件素材未解析`;
}

function syncPaperCardMaterialOverflow(card) {
  const list = card.querySelector(".paper-preview-item-materials-list");
  const detail = card.querySelector(".paper-preview-materials-detail");
  if (!list || !detail) return;
  const overflowed = list.scrollHeight > list.clientHeight + 1;
  list.classList.toggle("has-overflow", overflowed);
  detail.textContent = overflowed ? "… 明细" : "明细";
}

function renderPaperLibraryCard(entry) {
  const card = document.createElement("article");
  card.className = "paper-preview-item" + (entry.unresolved ? " has-unresolved" : "");
  card.dataset.search = entry.search;
  card.dataset.id = String(entry.id);
  card.dataset.kind = entry.kind || "";
  card.dataset.group = entry.groupId || "";
  card.dataset.archived = entry.archived ? "1" : "0";
  const selected = batchLibrary.selectedIds.has(paperLibrarySelectKey(entry));
  if (selected) card.classList.add("is-selected");
  const { label: selectCtrl } = PaperLibraryCore.createPaperSelectControl(entry, {
    checked: selected,
    onChange: (on) => setPaperLibrarySelected(entry, on),
  });
  const visual = document.createElement("button");
  visual.type = "button";
  visual.className = "paper-preview-visual";
  visual.title = "点击放大，查看明细并缩放";
  const img = document.createElement("img");
  img.className = "paper-preview-thumb";
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  const kindBadge = document.createElement("span");
  kindBadge.className = "paper-kind-badge" + (entry.kind === "terrain" ? " is-terrain" : entry.kind === "manor" ? " is-manor" : "");
  kindBadge.textContent = paperKindLabel(entry.kind);
  const badge = document.createElement("span");
  badge.className = "paper-preview-badge" + (entry.unresolved ? " is-warning" : "");
  badge.textContent = entry.kind === "desk"
    ? (entry.unresolved ? `${entry.unresolved} 件未解析` : (entry.documentData ? "素材已解析" : "待解析"))
    : paperKindLabel(entry.kind);
  const hint = document.createElement("span");
  hint.className = "paper-preview-zoom-hint";
  hint.textContent = "点击放大";
  visual.append(img, kindBadge, badge, hint);
  visual.onclick = () => openPaperInspect(entry);
  const copy = document.createElement("div");
  copy.className = "paper-preview-copy";
  const { row: nameRow, name } = PaperLibraryCore.createPaperNameRow(entry, {
    onRename: (row) => renamePaperLibraryEntry(row).catch((error) => console.warn(error)),
    onArchive: (row) => togglePaperLibraryArchived(row).catch((error) => console.warn(error)),
  });
  name.onclick = () => openPaperInspect(entry);
  const meta = document.createElement("small");
  meta.textContent = entry.meta;
  const group = document.createElement("select");
  group.className = "input paper-card-group";
  group.title = "把图纸放到分组";
  fillPaperGroupSelect(group, entry.groupId || "");
  group.addEventListener("click", (event) => event.stopPropagation());
  group.addEventListener("change", () => {
    assignPaperGroup(entry, group.value).catch((error) => console.warn(error));
  });
  copy.append(nameRow, meta, group);
  const materials = document.createElement("div");
  materials.className = "paper-preview-item-materials";
  fillPaperCardMaterials(materials, entry.materials, entry.unresolved, entry.kind, () => {
    openPaperInspect(entry, { focusMaterials: true });
  }, { hydrated: !!entry.documentData });
  const actions = document.createElement("div");
  actions.className = "paper-preview-item-actions";
  if (entry.kind === "desk") {
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "btn";
    replace.innerHTML = '<span class="btn-label-full">覆盖打开</span><span class="btn-label-short">覆盖</span>';
    replace.onclick = () => importLibraryPaper(entry, "replace");
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "btn btn-primary";
    merge.innerHTML = '<span class="btn-label-full">合并到当前</span><span class="btn-label-short">合并</span>';
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
  card.append(selectCtrl, visual, copy, materials, actions);
  entry.card = card;
  entry.thumbImg = img;
  return { card, img };
}

function refreshPaperLibraryCard(entry) {
  const card = entry?.card;
  if (!card) return;
  card.classList.toggle("has-unresolved", !!entry.unresolved);
  card.dataset.kind = entry.kind || "";
  card.dataset.search = entry.search || String(entry.name || "").toLowerCase();
  card.dataset.group = entry.groupId || "";
  card.dataset.archived = entry.archived ? "1" : "0";
  const title = card.querySelector(".paper-preview-copy strong");
  if (title) {
    title.textContent = entry.name;
    title.title = entry.name;
  }
  const rename = card.querySelector(".paper-card-rename");
  if (rename) rename.setAttribute("aria-label", `重命名 ${entry.name}`);
  PaperLibraryCore.syncPaperArchiveButton(card.querySelector(".paper-card-archive"), entry);
  const meta = card.querySelector(".paper-preview-copy small");
  if (meta) meta.textContent = entry.meta;
  const badge = card.querySelector(".paper-preview-badge");
  if (badge) {
    badge.classList.toggle("is-warning", !!entry.unresolved);
    badge.textContent = entry.kind === "desk"
      ? (entry.unresolved ? `${entry.unresolved} 件未解析` : (entry.documentData ? "素材已解析" : "待解析"))
      : paperKindLabel(entry.kind);
  }
  const materials = card.querySelector(".paper-preview-item-materials");
  if (materials) {
    fillPaperCardMaterials(materials, entry.materials, entry.unresolved, entry.kind, () => {
      openPaperInspect(entry, { focusMaterials: true });
    }, { hydrated: !!entry.documentData });
    syncPaperCardMaterialOverflow(card);
  }
}

async function importLibraryPaper(entry, mode) {
  try {
    await hydratePaperEntry(entry);
  } catch (error) {
    await appAlert(error.message || String(error), { title: "导入失败" });
    return;
  }
  if (entry?.kind && entry.kind !== "desk") {
    closePaperInspect();
    setPaperLibraryOpen(false);
    const bytes = entry.file ? new Uint8Array(await entry.file.arrayBuffer()) : null;
    if (!bytes?.length) {
      await appAlert("这张图纸无法带到地形桌。", { title: "导入失败" });
      return;
    }
    const expect = entry.kind === "terrain" ? "terrain" : "build";
    sessionStorage.setItem(
      expect === "terrain" ? "manor-pending-terrain-import" : "manor-pending-building-import",
      JSON.stringify({
        name: entry.name || entry.file?.name || "图纸.txt",
        encoding: entry.documentData?._source?.encoding || "gbk",
        base64: PaperLibraryCore.bytesToBase64(bytes),
        at: Date.now(),
      })
    );
    location.href = expect === "terrain" ? "/web/index.html?importTerrain=1" : "/web/index.html?importBuilding=1";
    return;
  }
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
  const view = inspectViewportSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(view.width * dpr));
  const pxH = Math.max(1, Math.round(view.height * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
    paperInspectView.canvasCssW = view.width;
    paperInspectView.canvasCssH = view.height;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#163522";
  ctx.fillRect(0, 0, view.width, view.height);
  if (!bitmap) return;
  ctx.save();
  ctx.translate(paperInspectView.panX, paperInspectView.panY);
  ctx.scale(paperInspectView.zoom, paperInspectView.zoom);
  ctx.imageSmoothingEnabled = !paperInspectView.dragging && paperInspectView.zoom < 1.6;
  ctx.imageSmoothingQuality = paperInspectView.dragging ? "low" : "medium";
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  updatePaperInspectZoomLabel();
}

function requestPaperInspectDraw() {
  if (paperInspectView.drawQueued) return;
  paperInspectView.drawQueued = true;
  requestAnimationFrame(() => {
    paperInspectView.drawQueued = false;
    drawPaperInspect();
  });
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
  requestPaperInspectDraw();
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
  paperInspectView.canvasCssW = 0;
  paperInspectView.canvasCssH = 0;
  document.getElementById("paperInspectViewport")?.classList.remove("is-panning");
  paperInspectView.resizeObserver?.disconnect();
  setPaperInspectChrome(false);
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
      requestPaperInspectDraw();
      return;
    }
    if (!paperInspectView.dragging) return;
    paperInspectView.panX += event.clientX - paperInspectView.lastX;
    paperInspectView.panY += event.clientY - paperInspectView.lastY;
    paperInspectView.lastX = event.clientX;
    paperInspectView.lastY = event.clientY;
    requestPaperInspectDraw();
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
    drawPaperInspect();
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);
  viewport.addEventListener("dblclick", (event) => {
    event.preventDefault();
    fitPaperInspect();
  });
}

function paperLibraryPreviewDocument(entry) {
  if (entry?.kind === "terrain" || entry?.documentData?.kind === "terrain") {
    return { ...(entry.documentData || {}), kind: "terrain" };
  }
  const desk = entry?.deskDocument;
  const fallbackKey = desk?.packKey || "";
  if (Array.isArray(desk?.records) && desk.records.length) {
    return {
      ...(entry.documentData || {}),
      kind: "desk",
      packKey: fallbackKey,
      records: libraryPreviewRecords(desk.records, fallbackKey),
    };
  }
  const documentData = entry?.documentData || { records: [] };
  return {
    ...documentData,
    packKey: documentData.packKey || fallbackKey,
    records: libraryPreviewRecords(documentData.records, documentData.packKey || fallbackKey),
  };
}

function applyVisibleDeskLibraryStats(entry) {
  if (!entry) return entry;
  const records = paperLibraryPreviewDocument(entry).records || [];
  const { materialTotals, unresolved } = paperLibraryMaterials(records);
  entry.count = records.length;
  entry.meta = `${records.length} 件素材 · ${materialTotals.size} 种材料`;
  entry.materials = materialTotals;
  entry.unresolved = unresolved;
  return entry;
}

async function paintPaperInspectBitmap(documentData) {
  const fallbackKey = documentData.packKey || "";
  const rows = libraryPreviewRecords(documentData.records, fallbackKey);
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
    const pack = previewPackForRecord(record, fallbackKey);
    const component = componentByUid(mat, pack);
    const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
    const x = Number(record.x) || 0;
    const y = Number(record.y) || 0;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + (geometry.width || 16));
    bottom = Math.max(bottom, y + (geometry.height || 16));
  });
  const view = inspectViewportSize();
  const cap = Math.min(1400, Math.max(720, Math.round(Math.max(view.width, view.height) * 1.6)));
  const contentW = Math.max(1, right - left);
  const contentH = Math.max(1, bottom - top);
  const scale = Math.min(1, cap / contentW, cap / contentH);
  const width = Math.max(80, Math.ceil(contentW * scale) + 24);
  const height = Math.max(60, Math.ceil(contentH * scale) + 24);
  const bitmap = document.createElement("canvas");
  await paintPaperThumbnail(bitmap, documentData, { width, height });
  return bitmap;
}

function clonePaperCardThumb(entry) {
  const img = entry?.thumbImg;
  if (img?.naturalWidth) {
    const copy = document.createElement("canvas");
    copy.width = img.naturalWidth;
    copy.height = img.naturalHeight;
    copy.getContext("2d").drawImage(img, 0, 0);
    return copy;
  }
  const canvas = entry?.card?.querySelector("canvas");
  if (!canvas?.width) return null;
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  return copy;
}

function fillInspectMaterialList(host, materials, unresolved) {
  if (!host) return;
  host.replaceChildren();
  if (Number(unresolved) > 0) {
    const warning = document.createElement("span");
    warning.className = "material-warning";
    warning.textContent = `部分统计：${unresolved} 件素材未解析`;
    host.appendChild(warning);
  }
  [...materials].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh")).forEach(([name, count]) => {
    const row = document.createElement("div");
    row.className = "inspect-mat-row";
    const url = materialIconUrl(name);
    if (url) {
      const icon = document.createElement("img");
      icon.className = "mat-icon";
      icon.src = url;
      icon.alt = "";
      icon.draggable = false;
      row.appendChild(icon);
    } else {
      const slot = document.createElement("span");
      slot.className = "mat-icon-slot";
      row.appendChild(slot);
    }
    const label = document.createElement("span");
    label.className = "inspect-mat-name";
    label.textContent = name;
    const em = document.createElement("em");
    em.textContent = `×${count}`;
    row.append(label, em);
    host.appendChild(row);
  });
}

function setPaperInspectChrome(open) {
  document.getElementById("buildingApp")?.classList.toggle("inspect-open", open);
}

async function openPaperInspect(entry, { focusMaterials = false } = {}) {
  if (!entry) return;
  bindPaperInspectControls();
  paperInspectView.entry = entry;
  const name = document.getElementById("paperInspectName");
  const summary = document.getElementById("paperInspectSummary");
  if (name) name.textContent = entry.name;
  PaperLibraryCore.syncPaperArchiveButton(document.getElementById("btnPaperInspectArchive"), entry);
  if (summary) {
    summary.textContent = [
      paperKindLabel(entry.kind),
      entry.meta,
      entry.kind === "desk"
        ? (entry.unresolved ? `${entry.unresolved} 件未解析` : "已全部解析")
        : entry.kind === "terrain"
          ? "在地形桌打开"
          : "请到地形桌查看",
    ].filter(Boolean).join(" · ");
  }
  const materialsHeading = document.getElementById("paperInspectMaterialsHeading");
  if (materialsHeading) {
    materialsHeading.textContent = entry.materials.size
      ? `所需材料 · ${entry.materials.size} 种`
      : "所需材料";
  }
  fillInspectMaterialList(document.getElementById("paperInspectMaterials"), entry.materials, entry.unresolved);
  if (!entry.materials.size) {
    const host = document.getElementById("paperInspectMaterials");
    if (host && !host.childElementCount) {
      const empty = document.createElement("small");
      empty.textContent = entry.kind === "desk"
        ? "没有可统计的材料"
        : entry.kind === "terrain"
          ? "地形图纸不含装修材料"
          : "庄园摆放图不含装修材料";
      host.appendChild(empty);
    }
  }
  fillPaperGroupSelect(document.getElementById("paperInspectGroup"), entry.groupId || "");
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
  setPaperInspectChrome(true);
  window.MobileWorkspace?.openLayer(panel, document.activeElement);
  if (!paperInspectView.resizeObserver) {
    paperInspectView.resizeObserver = new ResizeObserver(() => {
      const view = inspectViewportSize();
      if (view.width === paperInspectView.canvasCssW && view.height === paperInspectView.canvasCssH) return;
      requestPaperInspectDraw();
    });
  }
  paperInspectView.resizeObserver.disconnect();
  paperInspectView.resizeObserver.observe(document.getElementById("paperInspectViewport"));
  const thumb = entry.inspectBitmap || clonePaperCardThumb(entry);
  if (thumb && paperInspectView.entry === entry) {
    paperInspectView.bitmap = thumb;
    requestAnimationFrame(() => fitPaperInspect());
  }
  try {
    await hydratePaperEntry(entry);
  } catch (error) {
    if (paperInspectView.entry === entry) {
      await appAlert(error.message || String(error), { title: "无法打开图纸" });
    }
    return;
  }
  if (paperInspectView.entry !== entry) return;
  applyVisibleDeskLibraryStats(entry);
  if (materialsHeading) {
    materialsHeading.textContent = entry.materials.size
      ? `所需材料 · ${entry.materials.size} 种`
      : "所需材料";
  }
  fillInspectMaterialList(document.getElementById("paperInspectMaterials"), entry.materials, entry.unresolved);
  const bitmap = entry.kind === "desk"
    ? await paintPaperInspectBitmap(paperLibraryPreviewDocument(entry))
    : (entry.inspectBitmap || clonePaperCardThumb(entry));
  if (paperInspectView.entry !== entry) return;
  entry.inspectBitmap = bitmap;
  paperInspectView.bitmap = bitmap;
  requestAnimationFrame(() => {
    fitPaperInspect();
    if (focusMaterials) {
      document.getElementById("paperInspectMaterials")?.scrollTo({ top: 0 });
    } else {
      document.getElementById("paperInspectViewport")?.focus();
    }
  });
}

function bytesToBase64(bytes) {
  return PaperLibraryCore.bytesToBase64(bytes);
}

function base64ToBytes(text) {
  return PaperLibraryCore.base64ToBytes(text);
}

async function persistPaperLibrary(uploads, replace) {
  return PaperLibraryCore.persist(uploads, { replace: !!replace, groups: batchLibrary.groups });
}

function refreshSavedPaperThumb(entry, blob) {
  if (!entry || !blob) return;
  entry.inspectBitmap = null;
  entry.hasThumb = true;
  entry.thumbReady = true;
  entry.thumbAt = Date.now();
  if (!entry.thumbImg) return;
  const url = URL.createObjectURL(blob);
  entry.thumbImg.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  entry.thumbImg.src = url;
}

function syncSavedPaperIntoLibrary(payload, file) {
  const ident = String(payload?.id || "");
  if (!ident) return;
  let entry = batchLibrary.entries.find((row) => row.id === ident || row.contentId === ident);
  if (entry) {
    entry.name = payload.name;
    entry.search = String(payload.name || "").toLowerCase();
    entry.groupId = payload.group || "";
    entry.revision = payload.revision || entry.revision || "";
    entry.count = payload.count || 0;
    entry.meta = payload.meta || "";
    entry.unresolved = payload.unresolved || 0;
    entry.savedAt = Date.now();
    entry.hasThumb = false;
    entry.thumbReady = false;
    entry.file = file || entry.file;
    entry.serverHydrated = true;
    entry.deskLayers = Array.isArray(payload.deskLayers) ? payload.deskLayers : [];
    entry.deskDocument = payload.deskDocument || null;
    if (entry.file?.paperMeta) {
      entry.file.paperMeta.deskLayers = entry.deskLayers;
      entry.file.paperMeta.deskDocument = entry.deskDocument;
    }
    entry.documentData = null;
    entry.inspectBitmap = null;
    entry._hydrate = null;
    refreshPaperLibraryCard(entry);
    return entry;
  }
  if (!batchLibrary.entries.length) return;
  entry = PaperLibraryCore.entryFromIndex({
    id: ident,
    name: payload.name,
    kind: "desk",
    group: payload.group || "",
    revision: payload.revision || "",
    count: payload.count || 0,
    meta: payload.meta || "",
    unresolved: payload.unresolved || 0,
    savedAt: Date.now(),
  });
  entry.file = file || null;
  entry.serverHydrated = true;
  entry.deskLayers = Array.isArray(payload.deskLayers) ? payload.deskLayers : [];
  entry.deskDocument = payload.deskDocument || null;
  if (entry.file?.paperMeta) {
    entry.file.paperMeta.deskLayers = entry.deskLayers;
    entry.file.paperMeta.deskDocument = entry.deskDocument;
  }
  batchLibrary.entries.unshift(entry);
  const grid = document.getElementById("paperPreviewGrid");
  if (!grid) return;
  const { card } = renderPaperLibraryCard(entry);
  grid.prepend(card);
  grid.hidden = false;
  const empty = document.getElementById("paperLibraryEmpty");
  if (empty) empty.hidden = true;
  applyPaperLibraryFilter();
  updatePaperLibraryStatus();
  updateBatchPreviewButton();
  return entry;
}

function paperSummaryPayload(entry) {
  const payload = {
    id: entry.contentId,
    name: entry.name,
    kind: entry.kind,
    group: entry.groupId || "",
    count: entry.count || 0,
    meta: entry.meta || "",
    unresolved: entry.unresolved || 0,
    archived: !!entry.archived,
    archivedAt: Number(entry.archivedAt) || 0,
  };
  if (Array.isArray(entry.deskLayers)) payload.deskLayers = entry.deskLayers;
  if (entry.deskDocument) payload.deskDocument = entry.deskDocument;
  return payload;
}

async function hydratePaperEntry(entry) {
  if (!entry) return entry;
  // Parsed V1 data in IndexedDB does not contain desk-only groups or the full
  // design snapshot. Entries with a server id must fetch once before opening.
  if (entry.file && entry.documentData && (!entry.contentId || entry.serverHydrated)) return entry;
  if (entry._hydrate) return entry._hydrate;
  const contentId = entry.contentId || entry.id;
  entry._hydrate = (async () => {
    const paper = await PaperLibraryCore.fetchPaper(contentId);
    const { file, bytes } = PaperLibraryCore.fileFromPaper(paper);
    const parsed = await parsePaperLibraryFile(file, bytes.buffer);
    const rebuilt = buildPaperLibraryEntry(file, parsed.documentData, {
      id: entry.id,
      contentId,
      name: paper.name || entry.name,
      groupId: entry.groupId || paper.group || "",
    });
    entry.name = rebuilt.name;
    entry.search = String(rebuilt.name || "").toLowerCase();
    entry.deskLayers = Array.isArray(paper.deskLayers) ? paper.deskLayers : [];
    entry.deskDocument = paper.deskDocument && typeof paper.deskDocument === "object" ? paper.deskDocument : null;
    entry.revision = paper.revision || "";
    if (rebuilt.file?.paperMeta) {
      rebuilt.file.paperMeta.deskLayers = entry.deskLayers;
      rebuilt.file.paperMeta.deskDocument = entry.deskDocument;
    }
    entry.file = rebuilt.file;
    entry.documentData = rebuilt.documentData;
    entry.inspectBitmap = null;
    entry.serverHydrated = true;
    entry.kind = rebuilt.kind;
    entry.count = rebuilt.count;
    entry.meta = rebuilt.meta;
    entry.materials = rebuilt.materials;
    entry.unresolved = rebuilt.unresolved;
    if (entry.kind === "desk") applyVisibleDeskLibraryStats(entry);
    refreshPaperLibraryCard(entry);
    persistPaperLibrary([paperSummaryPayload(entry)], false).catch((error) => console.warn(error));
    return entry;
  })();
  try {
    return await entry._hydrate;
  } catch (error) {
    entry._hydrate = null;
    throw error;
  }
}

async function uploadPaperThumb(entry, canvas) {
  if (!entry?.contentId) return;
  try {
    let blob = canvas ? await PaperLibraryCore.canvasToJpegBlob(canvas) : null;
    if (!blob && entry.thumbImg?.src) {
      blob = await fetch(entry.thumbImg.src).then((response) => response.blob()).catch(() => null);
    }
    if (!blob) return;
    if (await PaperLibraryCore.putThumb(entry.contentId, blob, entry.revision || "")) {
      entry.hasThumb = true;
      entry.thumbAt = Date.now();
    }
  } catch (error) {
    console.warn("图纸缩略图同步失败", error);
  }
}

async function fillMissingPaperThumb(entry) {
  if (!entry?.thumbImg || entry.thumbReady) return;
  await hydratePaperEntry(entry);
  const canvas = document.createElement("canvas");
  await paintPaperThumbnail(canvas, paperLibraryPreviewDocument(entry));
  if (entry.thumbImg) entry.thumbImg.src = canvas.toDataURL("image/jpeg", 0.72);
  entry.thumbReady = true;
  uploadPaperThumb(entry, canvas);
}

function bindPaperCardThumb(entry, loader) {
  const img = entry?.thumbImg;
  if (!img) return;
  const rebuild = () => {
    entry.hasThumb = false;
    entry.thumbReady = false;
    loader?.watch(img, () => fillMissingPaperThumb(entry));
  };
  if (entry.hasThumb && entry.kind === "desk" && paperThumbIsStale(entry)) {
    rebuild();
    return;
  }
  if (entry.hasThumb) {
    img.addEventListener("load", () => {
      if (PaperLibraryCore.thumbLooksLikePlaceholder(img)) {
        rebuild();
        return;
      }
      entry.thumbReady = true;
    }, { once: true });
    img.addEventListener("error", () => {
      if (entry.thumbReady) return;
      rebuild();
    }, { once: true });
    img.src = PaperLibraryCore.thumbUrl(entry.contentId, entry.thumbAt || entry.savedAt);
    return;
  }
  loader?.watch(img, () => fillMissingPaperThumb(entry));
}

function showPaperLibraryIndex(papers) {
  const grid = document.getElementById("paperPreviewGrid");
  if (!grid) return;
  batchLibrary.thumbLoader?.disconnect();
  batchLibrary.generation += 1;
  batchLibrary.loading = false;
  batchLibrary.failed = 0;
  batchLibrary.skippedDup = 0;
  batchLibrary.skippedKind = 0;
  batchLibrary.entries = PaperLibraryCore.sortedPaperEntries(
    papers.map((paper) => PaperLibraryCore.entryFromIndex(paper)),
    PaperLibraryCore.loadPaperSort()
  );
  grid.replaceChildren();
  const loader = PaperLibraryCore.createLazyLoader({ root: grid, concurrency: 2 });
  batchLibrary.thumbLoader = loader;
  batchLibrary.entries.forEach((entry) => {
    const { card } = renderPaperLibraryCard(entry);
    grid.appendChild(card);
    bindPaperCardThumb(entry, loader);
  });
  grid.hidden = !batchLibrary.entries.length;
  const empty = document.getElementById("paperLibraryEmpty");
  if (empty) empty.hidden = !!batchLibrary.entries.length;
  prunePaperLibrarySelection();
  applyPaperLibraryFilter();
  syncPaperLibraryBatchBar();
  updatePaperLibraryStatus();
  updateBatchPreviewButton();
}

async function parsePaperLibraryFile(file, existingBuffer) {
  const buffer = existingBuffer || await file.arrayBuffer();
  const documentData = await PaperLibraryCore.parseFile(buffer);
  return { buffer, documentData };
}

function paperLibraryEntryMeta(documentData, materials) {
  const kind = documentData.kind;
  if (kind === "desk") {
    const paperRows = BI.visiblePaperRecords(documentData.records);
    return `${paperRows.length} 件素材 · ${materials.size} 种材料`;
  }
  if (kind === "terrain") {
    const stamps = documentData.stamps || [];
    return `${documentData.size || "?"} 格 · ${stamps.length} 个地块`;
  }
  return `${(documentData.records || []).length} 个庄园建筑点`;
}

function buildPaperLibraryEntry(file, documentData, { id, contentId, name, groupId }) {
  const records = documentData.records || [];
  const { materialTotals, unresolved } = documentData.kind === "desk"
    ? paperLibraryMaterials(records)
    : { materialTotals: new Map(), unresolved: 0 };
  const relative = name || String(file.webkitRelativePath || file.name);
  return {
    id,
    contentId: contentId || "",
    file,
    documentData,
    serverHydrated: false,
    name: relative,
    search: relative.toLowerCase(),
    kind: documentData.kind,
    groupId: groupId || "",
    count: records.filter((record) => Number(record.mat)).length,
    meta: paperLibraryEntryMeta(documentData, materialTotals),
    materials: materialTotals,
    unresolved,
    savedAt: Date.now(),
  };
}

async function openBatchPaperPreview(files) {
  const candidates = [...files].filter((file) => /\.txt$/i.test(file.name));
  await loadPaperLibraryFiles(candidates, { persist: true, append: true });
}

async function openServerPaperLibrary() {
  setPaperLibraryOpen(true);
  updatePaperLibraryStatus("正在读取图纸库…");
  let papers = [];
  try {
    const data = await PaperLibraryCore.fetchLibrary();
    papers = data.papers;
    batchLibrary.groups = data.groups || [];
    refreshPaperGroupControls();
  } catch (error) {
    console.warn("读取图纸库失败", error);
  }
  if (batchLibrary.entries.length || batchLibrary.loading) return;
  if (!papers.length) {
    updatePaperLibraryStatus("还没有图纸。导入文件夹或文件即可叠加。");
    return;
  }
  showPaperLibraryIndex(papers);
}

async function loadPaperLibraryFiles(candidates, { persist = false, append = true, sourceLabel = "" } = {}) {
  const grid = document.getElementById("paperPreviewGrid");
  const search = document.getElementById("paperBatchSearch");
  if (!grid) return;
  if (!append && search) search.value = "";
  if (!append) batchLibrary.query = "";
  batchLibrary.generation += 1;
  const gen = batchLibrary.generation;
  batchLibrary.loading = true;
  batchLibrary.failed = 0;
  batchLibrary.skippedDup = 0;
  batchLibrary.skippedKind = 0;
  if (!append) {
    batchLibrary.thumbLoader?.disconnect();
    batchLibrary.entries = [];
    grid.replaceChildren();
  }
  batchLibrary.folderLabel = sourceLabel || (candidates.length ? folderLabelFromFiles(candidates) : batchLibrary.folderLabel);
  setPaperLibraryOpen(true);
  syncPaperLibraryEmpty();
  if (!candidates.length) {
    batchLibrary.loading = false;
    updatePaperLibraryStatus("所选文件里没有 .txt 图纸。");
    updateBatchPreviewButton();
    return;
  }
  updatePaperLibraryStatus(`正在载入 ${candidates.length} 张图纸…`);
  updateBatchPreviewButton();
  const cacheMap = await loadPaperLibraryCacheMap();
  if (gen !== batchLibrary.generation) return;
  let unresolvedTotal = 0;
  const uploads = [];
  const pendingCache = [];
  const knownIds = new Set(batchLibrary.entries.map((entry) => entry.contentId).filter(Boolean));
  const flushCache = async () => {
    if (!pendingCache.length) return;
    const rows = pendingCache.splice(0, pendingCache.length);
    await putPaperLibraryCache(rows);
  };
  for (const [index, file] of candidates.entries()) {
    try {
      const meta = file.paperMeta || {};
      const relative = PaperLibraryCore.paperNameFromFile(file, meta.name);
      const buffer = meta.data ? base64ToBytes(meta.data).buffer : await file.arrayBuffer();
      if (gen !== batchLibrary.generation) return;
      const bytes = new Uint8Array(buffer);
      const data = meta.data || bytesToBase64(bytes);
      const contentId = meta.id || await paperContentIdFromBase64(data);
      if (knownIds.has(contentId)) {
        batchLibrary.skippedDup += 1;
        continue;
      }
      const sniff = sniffPaperKind(bytes);
      if (persist && sniff === "terrain" && !libraryAcceptsKind("terrain")) {
        batchLibrary.skippedKind += 1;
        continue;
      }
      const fingerprint = paperFingerprint(relative, bytes);
      const cached = cacheMap.get(`id:${contentId}`) || cacheMap.get(fingerprint);
      const cachedKind = cached?.documentData
        ? PaperLibraryCore.resolvePaperKind(cached.documentData)
        : "";
      const cacheMatches = !!(cached?.documentData && (
        sniff === "unknown"
        || (sniff === "terrain" && cachedKind === "terrain")
        || (sniff === "v1" && cachedKind !== "terrain")
      ));
      let entry;
      if (cacheMatches) {
        entry = entryFromPaperCache(cached, file, `${gen}-${index}`);
        entry.contentId = contentId;
        entry.groupId = meta.group || cached.groupId || entry.groupId || "";
        if (meta.kind) entry.kind = meta.kind;
      if (meta.revision) entry.revision = meta.revision;
      } else {
        const parsed = await parsePaperLibraryFile(file, bytes.buffer);
        if (gen !== batchLibrary.generation) return;
        entry = buildPaperLibraryEntry(file, parsed.documentData, {
          id: `${gen}-${index}`,
          contentId,
          name: relative,
          groupId: meta.group || "",
        });
      }
      if (sniff === "terrain") entry.kind = "terrain";
      if (meta.revision) entry.revision = meta.revision;
      if (meta.deskDocument) entry.deskDocument = meta.deskDocument;
      if (Array.isArray(meta.deskLayers)) entry.deskLayers = meta.deskLayers;
      if (entry.kind === "desk") applyVisibleDeskLibraryStats(entry);
      if (persist && !libraryAcceptsKind(entry.kind)) {
        batchLibrary.skippedKind += 1;
        continue;
      }
      knownIds.add(contentId);
      if (persist) {
        uploads.push({
          id: contentId,
          name: relative,
          data,
          kind: entry.kind,
          group: entry.groupId || "",
          count: entry.count || 0,
          meta: entry.meta || "",
          unresolved: entry.unresolved || 0,
        });
      }
      unresolvedTotal += Number(entry.unresolved || 0);
      batchLibrary.entries.push(entry);
      const { card, img } = renderPaperLibraryCard(entry);
      grid.appendChild(card);
      syncPaperCardMaterialOverflow(card);
      requestAnimationFrame(() => syncPaperCardMaterialOverflow(card));
      grid.hidden = false;
      const empty = document.getElementById("paperLibraryEmpty");
      if (empty) empty.hidden = true;
      if (cached?.thumb) {
        img.src = cached.thumb;
        entry.thumbReady = true;
        if (!entry.hasThumb) uploadPaperThumb(entry);
      } else {
        const canvas = document.createElement("canvas");
        await paintPaperThumbnail(canvas, paperLibraryPreviewDocument(entry));
        img.src = canvas.toDataURL("image/jpeg", 0.72);
        entry.thumbReady = true;
        pendingCache.push(serializePaperLibraryCache(entry, fingerprint, canvasThumbDataUrl(canvas)));
        uploadPaperThumb(entry, canvas);
      }
      if (gen !== batchLibrary.generation) return;
      if (pendingCache.length >= 8) await flushCache();
    } catch (error) {
      if (gen !== batchLibrary.generation) return;
      batchLibrary.failed += 1;
      console.warn(`图纸预览失败：${file.name}`, error);
    }
    applyPaperLibraryFilter();
    updatePaperLibraryStatus(
      `正在载入 ${index + 1} / ${candidates.length} 张图纸`
      + (unresolvedTotal ? ` · ${unresolvedTotal} 件素材未解析` : "")
      + paperLibrarySkipNote()
    );
    if (index % 8 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (gen !== batchLibrary.generation) return;
  await flushCache();
  batchLibrary.loading = false;
  syncPaperLibraryEmpty();
  updatePaperLibraryStatus();
  updateBatchPreviewButton();
  if (persist && (uploads.length || batchLibrary.groups.length)) {
    try {
      await persistPaperLibrary(uploads, false);
      if (gen === batchLibrary.generation) {
        updatePaperLibraryStatus();
      }
    } catch (error) {
      console.warn(error);
      if (gen === batchLibrary.generation) {
        updatePaperLibraryStatus("图纸已载入，但同步失败，可稍后再导入一次。");
      }
    }
  }
}

function importedPaperRows(records, layers) {
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
  return { rows: BI.applyDeskLayers(rows, layers), lastTheme };
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
        name: PaperLibraryCore.paperNameFromFile(file),
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
  const deskDocument = options.deskDocument || file.paperMeta?.deskDocument;
  const layers = options.deskLayers || file.paperMeta?.deskLayers;
  const imported = importedPaperRows(records, layers);
  const deskRows = Array.isArray(deskDocument?.records) && deskDocument.records.length
    ? deskDocument.records.map(hydrateRecord)
    : imported.rows;
  if (mode === "merge") {
    const body = deskRows.filter((record) => Number(record.mat) !== 0 && !record.hidden);
    if (!body.length) throw new Error("这张图纸没有可合并的建筑素材。");
    const stamp = Date.now();
    const remapped = BI.remapImportedDeskGroups(body, stamp);
    const hasSavedGroups = remapped.some((record) => record.group);
    const fallbackGroup = `${stamp}-import`;
    const groupName = file.name.replace(/\.[^.]+$/, "") || "合并图纸";
    pushHistory();
    const first = state.records.length;
    remapped.forEach((record) => {
      state.records.push({
        ...record,
        group: record.group || (hasSavedGroups ? null : fallbackGroup),
        groupName: record.groupName || (hasSavedGroups ? record.groupName : groupName),
      });
    });
    if (!hasSavedGroups) state.layerCollapsed.add(fallbackGroup);
    setSelection(remapped.map((_, index) => first + index), { expandGroup: true });
    if (!state.designName) {
      state.designName = PaperLibraryCore.paperNameFromFile(file);
      updatePaperFileLabel();
    }
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
  rememberSourcePaper(file.paperMeta?.id ? { id: file.paperMeta.id, name: PaperLibraryCore.paperNameFromFile(file), groupId: file.paperMeta.group } : null);
  if (deskDocument?.records) applyDeskDocumentMeta(deskDocument);
  else {
    state.paperLayout = true;
    state.paperOrigin = null;
  }
  // 左上角显示打开的是哪张图纸，防止忘记当前文件。
  state.designName = PaperLibraryCore.paperNameFromFile(file);
  updatePaperFileLabel();
  state.records = deskRows;
  state.baseAnchor = null;
  invalidateBaseLayout();
  if (!deskDocument?.packKey && imported.lastTheme) state.pack = imported.lastTheme;
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

function exportRecordList(records = state.records) {
  const refs = records.filter((record) => Number(record.mat) === 0);
  return [...refs, ...BI.visiblePaperRecords(records)];
}

function serializeDeskLayers(records = serializeSessionRecords()) {
  return records.map((record) => ({
    mat: Math.max(0, Math.round(Number(record.mat) || 0)),
    packKey: paperPackKey(record),
    localPackUnknown: !!record.localPackUnknown,
    group: record.group || "",
    groupName: record.groupName || "",
    groupParents: Array.isArray(record.groupParents) ? record.groupParents : undefined,
    label: record.label || "",
    locked: !!record.locked,
    hidden: !!record.hidden,
  }));
}

function serializeDeskDocument() {
  return {
    v: 1,
    records: serializeSessionRecords(),
    baseNo: state.base?.no ?? null,
    baseMap: state.base?.map || "",
    baseName: state.base?.name || "",
    baseKind: state.baseKind,
    packKey: state.pack?.key || "",
    themeFilter: state.themeFilter || "",
    keepFoundation: !!state.keepFoundation,
    paperLayout: !!state.paperLayout,
    paperOrigin: state.paperOrigin ? { ...state.paperOrigin } : null,
    layerCollapsed: [...state.layerCollapsed],
    smartBuilder: smartBuilderSnapshot(),
  };
}

function applyDeskDocumentMeta(doc) {
  if (!doc || typeof doc !== "object") return;
  const base = findBaseFromSession(doc);
  if (base) {
    state.base = base;
    state.baseKind = base.kind ?? doc.baseKind ?? state.baseKind;
    state.basePicked = true;
    state.baseOverridden = false;
  }
  if (doc.packKey && packByKey(doc.packKey)) state.pack = packByKey(doc.packKey);
  if (doc.themeFilter === THEME_ALL || packByKey(doc.themeFilter)) {
    state.themeFilter = doc.themeFilter || state.themeFilter;
  }
  if (doc.keepFoundation != null) {
    state.keepFoundation = !!doc.keepFoundation;
    const keep = document.getElementById("keepFoundation");
    if (keep) keep.checked = state.keepFoundation;
  }
  state.paperLayout = !!doc.paperLayout;
  state.paperOrigin =
    doc.paperOrigin && Number.isFinite(Number(doc.paperOrigin.x)) && Number.isFinite(Number(doc.paperOrigin.y))
      ? { x: Number(doc.paperOrigin.x), y: Number(doc.paperOrigin.y) }
      : null;
  state.layerCollapsed = new Set(Array.isArray(doc.layerCollapsed) ? doc.layerCollapsed : []);
  restoreSmartBuilder(doc.smartBuilder);
  syncSmartBuildingUi();
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
  return exportRecordList().map(serializeExportRecord);
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
    name: paperFileStem() || state.base?.name || "设计建筑",
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
  const bytes = await formatCurrentPaperBytes();
  const blob = new Blob([bytes], { type: "text/plain" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = currentPaperDownloadName("txt");
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

let imageBuildingDraft = null;
let imageBuildingIndexPromise = null;
const IMAGE_BUILDING_DEBUG = false;

function imageBuildingClusterPalette() {
  return [];
}

function imageBuildingNearestMaterial() {
  return -1;
}

function imageBuildingTargetRect() {
  const layout = state.baseLayout || {};
  const offset = layoutContentOffset();
  const dx = Number(offset.dx) || 0;
  const dy = Number(offset.dy) || 0;
  if (layout.maskW && layout.maskH) {
    return { x: layout.maskX - dx, y: layout.maskY - dy, w: layout.maskW, h: layout.maskH };
  }
  if (layout.floorW && layout.floorH) {
    return { x: layout.floorX - dx, y: layout.floorY - dy, w: layout.floorW, h: layout.floorH };
  }
  return { x: 48, y: 48, w: DESIGN_W - 96, h: DESIGN_H - 96 };
}

function imageBuildingPackKeys() {
  const scope = document.getElementById("imageBuildingScope")?.value || "current";
  const packs = scope === "all" ? indexedPacks() : activeThemePacks();
  return packs.map((pack) => pack.key).filter(Boolean);
}

function loadSpriteIndex() {
  if (imageBuildingIndexPromise) return imageBuildingIndexPromise;
  imageBuildingIndexPromise = fetch("/data/building_sprite_index.json")
    .then((response) => (response.ok ? response.json() : { entries: [] }))
    .catch(() => ({ entries: [] }));
  return imageBuildingIndexPromise;
}

function imageBuildingSourcePixels(image) {
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data, pixels: imageData.data };
}

function imageBuildingConvertApi() {
  return window.BuildingImageConvert;
}

function pickImageBuilding() {
  if (state.phase !== "design" || !state.base) {
    appAlert("先选好户型并进入设计，再把图片转成建筑。");
    return;
  }
  document.getElementById("fileImageBuilding")?.click();
}

async function openImageBuilding(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("图片读取失败"));
      next.src = url;
    });
    imageBuildingDraft = {
      image,
      name: file.name,
      source: imageBuildingSourcePixels(image),
      spec: null,
      structure: null,
      mode: "auto",
      selected: -1,
      sketchTool: "select",
      wallDraft: null,
      _scopeTouched: false,
    };
    const mode = document.getElementById("imageBuildingMode");
    if (mode) mode.value = "auto";
    const scope = document.getElementById("imageBuildingScope");
    if (scope) scope.value = "all";
    const threshold = document.getElementById("imageBuildingThreshold");
    if (threshold) threshold.value = "medium";
    const fit = document.getElementById("imageBuildingFit");
    if (fit) fit.value = "contain";
    const replace = document.getElementById("imageBuildingReplace");
    if (replace) replace.checked = false;
    const overlay = document.getElementById("imageBuildingOverlay");
    if (overlay) overlay.checked = false;
    setImageBuildingSketchTool("select");
    setModalVisible("dlgImageBuilding", true);
    await rebuildImageBuilding();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rebuildImageBuilding(structure) {
  const draft = imageBuildingDraft;
  const status = document.getElementById("imageBuildingStatus");
  const Convert = imageBuildingConvertApi();
  if (!draft?.source || !Convert) {
    if (status) status.textContent = "转换器未加载。";
    return;
  }
  if (status) status.textContent = "正在认结构和选件…";
  const index = await loadSpriteIndex();
  const requested = document.getElementById("imageBuildingMode")?.value || "auto";
  const scope = document.getElementById("imageBuildingScope");
  if (scope && !draft._scopeTouched && (!scope.value || scope.value === "current")) {
    // Screenshots often use another theme; default search to all locked packs.
    scope.value = "all";
  }
  const result = Convert.convertPrepared(draft.source, index, {
    mode: requested,
    threshold: document.getElementById("imageBuildingThreshold")?.value || "medium",
    fit: document.getElementById("imageBuildingFit")?.value || "contain",
    packKeys: imageBuildingPackKeys(),
    target: imageBuildingTargetRect(),
    name: draft.name,
    structure: structure || undefined,
  });
  draft.spec = result.spec;
  draft.structure = result.structure || result.spec?.structure || draft.structure;
  draft.fitted = result.fitted || result.structure?.fitted || draft.fitted;
  draft.mode = result.mode;
  draft.selected = -1;
  if (status) {
    const emptyIndex = !(index.entries || []).length;
    status.textContent = emptyIndex
      ? `${result.status} 素材指纹库未就绪时按结构选件。`
      : result.status;
  }
  updateImageBuildingApplyState();
  paintImageBuildingSource();
  renderImageBuildingPieces();
  await paintImageBuildingPreview();
}

function setImageBuildingSketchTool(tool) {
  if (imageBuildingDraft) imageBuildingDraft.sketchTool = tool;
  document.querySelectorAll("#imageBuildingSketchTools [data-sketch-tool]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.sketchTool === tool ? "true" : "false");
  });
}

function paintImageBuildingSource() {
  const canvas = document.getElementById("imageBuildingSource");
  const draft = imageBuildingDraft;
  if (!canvas || !draft?.image) return;
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d7e2d4";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / draft.image.naturalWidth, height / draft.image.naturalHeight);
  const dw = draft.image.naturalWidth * scale;
  const dh = draft.image.naturalHeight * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  draft.sourceView = { dx, dy, dw, dh, scale };
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(draft.image, dx, dy, dw, dh);
  const structure = draft.structure;
  if (!structure) return;
  const Convert = imageBuildingConvertApi();
  const target = imageBuildingTargetRect();
  const fit = document.getElementById("imageBuildingFit")?.value || "contain";
  const mapper = Convert?.makePaperMapper?.(draft.image.naturalWidth, draft.image.naturalHeight, target, fit);
  const useImageSpace = !!(structure.imageFloor && !structure.__userEdited);
  const toCanvas = (pt) => {
    if (useImageSpace) {
      return {
        x: dx + (pt.x / Math.max(1, draft.image.naturalWidth)) * dw,
        y: dy + (pt.y / Math.max(1, draft.image.naturalHeight)) * dh,
      };
    }
    if (mapper) {
      const img = mapper.toImage(pt.x, pt.y);
      return {
        x: dx + (img.x / Math.max(1, draft.image.naturalWidth)) * dw,
        y: dy + (img.y / Math.max(1, draft.image.naturalHeight)) * dh,
      };
    }
    return {
      x: dx + ((pt.x - target.x) / Math.max(1, target.w)) * dw,
      y: dy + ((pt.y - target.y) / Math.max(1, target.h)) * dh,
    };
  };
  const overlayFloor = useImageSpace ? structure.imageFloor : structure.floor;
  const overlayWalls = useImageSpace ? structure.imageWalls || [] : structure.walls || [];
  if (overlayFloor) {
    ctx.beginPath();
    [overlayFloor.left, overlayFloor.back, overlayFloor.right, overlayFloor.front].forEach((pt, index) => {
      const p = toCanvas(pt);
      if (index) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(180, 190, 200, 0.28)";
    ctx.strokeStyle = "#4a5d6a";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  overlayWalls.forEach((wall, index) => {
    const a = toCanvas(wall.a);
    const b = toCanvas(wall.b);
    ctx.strokeStyle = index === draft.selected ? "#c45c26" : "#2f6f4a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    (wall.openings || []).forEach((opening) => {
      const x = a.x + (b.x - a.x) * opening.t;
      const y = a.y + (b.y - a.y) * opening.t;
      ctx.fillStyle = "#8a4b2a";
      ctx.fillRect(x - 6, y - 10, 12, 20);
    });
  });
}

async function paintImageBuildingPreview() {
  const canvas = document.getElementById("imageBuildingPreview");
  const draft = imageBuildingDraft;
  if (!canvas || !draft) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2a4a34";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const records = (draft.spec?.records || []).filter((row) => Number(row.mat) > 0);
  if (!records.length || !window.BuildingPreview?.renderPaper || !state.base) return;
  try {
    const rendered = await window.BuildingPreview.renderPaper({
      documentData: { kind: "desk", records },
      baseNo: state.base.no,
      coordinateSpace: "editor",
    });
    const bitmap = rendered?.bitmap;
    if (!bitmap?.width) return;
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    if (document.getElementById("imageBuildingOverlay")?.checked && draft.image) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(draft.image, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (draft.selected >= 0 && records[draft.selected]) {
      const row = records[draft.selected];
      ctx.strokeStyle = "#ffd36a";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        dx + ((row.x - 80) / 400) * dw,
        dy + ((row.y - 90) / 360) * dh,
        18,
        18
      );
    }
  } catch (error) {
    const status = document.getElementById("imageBuildingStatus");
    if (status) status.textContent = error.message || String(error);
  }
}

function renderImageBuildingPieces() {
  const list = document.getElementById("imageBuildingPieces");
  const draft = imageBuildingDraft;
  if (!list) return;
  list.replaceChildren();
  const records = draft?.spec?.records || [];
  records.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "image-building-piece" + (index === draft.selected ? " on" : "");
    item.setAttribute("role", "listitem");
    const thumb = document.createElement("img");
    const pack = packByKey(row.pack);
    const component = pack ? findSpriteInPack(pack, row.local) : null;
    thumb.alt = "";
    thumb.width = 36;
    thumb.height = 36;
    if (component) bindSpriteThumb(thumb, spriteUrl(component, pack, row.state || 0, true));
    const meta = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = row.label || `${row.category || row.group} #${row.local}`;
    const detail = document.createElement("small");
    const face = Number(row.state) ? "朝向 B" : "朝向 A";
    const conf = row.confidence != null ? ` · ${Math.round(row.confidence * 100)}%` : "";
    detail.textContent = `${row.group || row.category} · ${face}${conf}`;
    meta.append(title, detail);
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "btn";
    replace.textContent = "替换";
    replace.addEventListener("click", (event) => {
      event.stopPropagation();
      cycleImageBuildingPiece(index);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn";
    remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      draft.spec.records.splice(index, 1);
      draft.selected = -1;
      renderImageBuildingPieces();
      paintImageBuildingPreview();
      updateImageBuildingApplyState();
      const Convert = imageBuildingConvertApi();
      const status = document.getElementById("imageBuildingStatus");
      if (status && Convert) status.textContent = Convert.statusText(Convert.summarizeSpec(draft.spec), draft.mode);
    });
    item.append(thumb, meta, replace, remove);
    item.addEventListener("click", () => {
      draft.selected = index;
      renderImageBuildingPieces();
      paintImageBuildingPreview();
    });
    list.appendChild(item);
  });
}

async function cycleImageBuildingPiece(index) {
  const draft = imageBuildingDraft;
  const row = draft?.spec?.records?.[index];
  if (!row) return;
  const Convert = imageBuildingConvertApi();
  const indexDoc = await loadSpriteIndex();
  const pool = Convert.filterEntries(indexDoc, { packKeys: imageBuildingPackKeys(), category: row.category });
  if (pool.length < 2) return;
  const current = pool.findIndex((entry) => entry.pack === row.pack && entry.local === row.local && (entry.frame || 0) === (row.state || 0));
  const next = pool[(current + 1) % pool.length];
  const rebuilt = Convert.recordFromFoot(next, row.footX || row.x, row.footY || row.y, {
    state: next.frame || 0,
    group: row.group,
    confidence: row.confidence,
  });
  draft.spec.records[index] = rebuilt;
  renderImageBuildingPieces();
  await paintImageBuildingPreview();
}

function imageBuildingCanvasPoint(event) {
  const canvas = document.getElementById("imageBuildingSource");
  const draft = imageBuildingDraft;
  if (!canvas || !draft?.sourceView || !draft?.image) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * canvas.width) / Math.max(1, rect.width);
  const y = ((event.clientY - rect.top) * canvas.height) / Math.max(1, rect.height);
  const view = draft.sourceView;
  const imgX = ((x - view.dx) / Math.max(1, view.dw)) * draft.image.naturalWidth;
  const imgY = ((y - view.dy) / Math.max(1, view.dh)) * draft.image.naturalHeight;
  const Convert = imageBuildingConvertApi();
  const target = imageBuildingTargetRect();
  const fit = document.getElementById("imageBuildingFit")?.value || "contain";
  if (Convert?.makePaperMapper) {
    return Convert.makePaperMapper(draft.image.naturalWidth, draft.image.naturalHeight, target, fit).toPaper(imgX, imgY);
  }
  return {
    x: target.x + (imgX / Math.max(1, draft.image.naturalWidth)) * target.w,
    y: target.y + (imgY / Math.max(1, draft.image.naturalHeight)) * target.h,
  };
}

function markImageBuildingStructureEdited() {
  if (!imageBuildingDraft?.structure) return;
  imageBuildingDraft.structure.__userEdited = true;
}

function nearestWall(structure, point) {
  let best = -1;
  let dist = 28;
  (structure.walls || []).forEach((wall, index) => {
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy) / (len * len)));
    const px = wall.a.x + dx * t;
    const py = wall.a.y + dy * t;
    const d = Math.hypot(point.x - px, point.y - py);
    if (d < dist) {
      dist = d;
      best = index;
    }
  });
  return best;
}

function handleImageBuildingPointer(event) {
  const draft = imageBuildingDraft;
  if (!draft?.structure) return;
  const point = imageBuildingCanvasPoint(event);
  if (!point) return;
  const tool = draft.sketchTool || "select";
  if (tool === "wall") {
    if (!draft.wallDraft) {
      draft.wallDraft = { x: point.x, y: point.y };
      paintImageBuildingSource();
      return;
    }
    draft.structure.walls.push({ a: draft.wallDraft, b: point, openings: [], state: draft.structure.walls.length % 2 });
    draft.wallDraft = null;
    markImageBuildingStructureEdited();
    rebuildImageBuilding(draft.structure);
    return;
  }
  if (tool === "opening") {
    const index = nearestWall(draft.structure, point);
    if (index < 0) return;
    const wall = draft.structure.walls[index];
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0.12, Math.min(0.88, ((point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy) / (len * len)));
    wall.openings.push({ t, w: 22 });
    markImageBuildingStructureEdited();
    rebuildImageBuilding(draft.structure);
    return;
  }
  if (tool === "prop") {
    draft.structure.props = draft.structure.props || [];
    draft.structure.props.push({ x: point.x, y: point.y, kind: "decor" });
    markImageBuildingStructureEdited();
    rebuildImageBuilding(draft.structure);
    return;
  }
  if (tool === "erase") {
    const index = nearestWall(draft.structure, point);
    if (index >= 0) draft.structure.walls.splice(index, 1);
    else draft.structure.props = (draft.structure.props || []).filter((row) => Math.hypot(row.x - point.x, row.y - point.y) > 18);
    markImageBuildingStructureEdited();
    rebuildImageBuilding(draft.structure);
    return;
  }
  const index = nearestWall(draft.structure, point);
  if (index < 0) return;
  const wall = draft.structure.walls[index];
  const grabA = Math.hypot(point.x - wall.a.x, point.y - wall.a.y) < Math.hypot(point.x - wall.b.x, point.y - wall.b.y);
  const move = (moveEvent) => {
    const next = imageBuildingCanvasPoint(moveEvent);
    if (!next) return;
    if (grabA) wall.a = next;
    else wall.b = next;
    paintImageBuildingSource();
  };
  const up = (upEvent) => {
    canvas.releasePointerCapture?.(upEvent.pointerId);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    markImageBuildingStructureEdited();
    rebuildImageBuilding(draft.structure);
  };
  const canvas = event.currentTarget;
  canvas.setPointerCapture?.(event.pointerId);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
}

function updateImageBuildingApplyState() {
  const button = document.getElementById("btnApplyImageBuilding");
  const status = document.getElementById("imageBuildingStatus");
  const draft = imageBuildingDraft;
  const Convert = imageBuildingConvertApi();
  if (!button) return;
  const gate = Convert?.canAutoApply?.(draft?.spec, {
    userEdited: !!draft?.structure?.__userEdited,
    mode: draft?.mode,
  }) || { ok: false, reason: Convert?.UNRESOLVED_STATUS || "未识别" };
  button.disabled = !gate.ok || state.phase !== "design";
  if (!gate.ok && status && draft) status.textContent = gate.reason;
}

function applyImageBuilding() {
  const draft = imageBuildingDraft;
  const Convert = imageBuildingConvertApi();
  const status = document.getElementById("imageBuildingStatus");
  if (state.phase !== "design") {
    if (status) status.textContent = "先选好户型并进入设计。";
    return;
  }
  const gate = Convert?.canAutoApply?.(draft?.spec, {
    userEdited: !!draft?.structure?.__userEdited,
    mode: draft?.mode,
  }) || { ok: false, reason: "还没有可写入的真实素材。先改墙线或换一张图。" };
  if (!gate.ok) {
    if (status) status.textContent = gate.reason;
    updateImageBuildingApplyState();
    return;
  }
  const errors = Convert?.validateSpec(draft.spec, state.packUids) || [];
  if (errors.length) {
    if (status) status.textContent = errors[0];
    return;
  }
  const sorted = Convert.depthSortRecords(draft.spec.records);
  pushHistory();
  if (document.getElementById("imageBuildingReplace")?.checked) {
    state.records = state.records.filter((record) => Number(record.mat) === 0);
    state.sourcePaper = null;
  }
  const start = state.records.length;
  const seen = new Set();
  sorted.forEach((row) => {
    const pack = packByKey(row.pack) || state.pack;
    const component = findSpriteInPack(pack, row.local);
    if (!component) return;
    const face = Number(row.state) || 0;
    const foot = stampFootOffset(component, face);
    const footX = row.footX != null ? row.footX : row.x + foot.x;
    const footY = row.footY != null ? row.footY : row.y + foot.y;
    const index = appendSpriteStamp(component, pack, face, footX, footY, seen);
    if (index < 0) return;
    const record = state.records[index];
    const packUid = packUidOf(pack);
    if (packUid != null && Number(record.mat) < 1000) record.mat = packUid * 1000 + row.local;
    const pos = record;
    pos.x = Math.max(0, Math.min(2047, pos.x));
    pos.y = Math.max(0, Math.min(2047, pos.y));
    if (Number(record.mat) === 0) state.records.splice(index, 1);
  });
  if (state.records.length <= start) {
    if (status) status.textContent = "这些件无法写入当前户型。";
    return;
  }
  setSelection(Array.from({ length: state.records.length - start }, (_, index) => start + index));
  markBuildingDirty();
  renderBuilding();
  setModalVisible("dlgImageBuilding", false);
}

function bindImageBuilding() {
  const open = () => pickImageBuilding();
  document.getElementById("btnImageBuilding")?.addEventListener("click", open);
  document.getElementById("btnProjectImageBuilding")?.addEventListener("click", open);
  const file = document.getElementById("fileImageBuilding");
  if (file) {
    file.addEventListener("change", async (event) => {
      const picked = event.target.files?.[0];
      event.target.value = "";
      if (!picked) return;
      try {
        await openImageBuilding(picked);
      } catch (error) {
        await appAlert(error.message || String(error), { title: "图片导入失败" });
      }
    });
  }
  ["imageBuildingMode", "imageBuildingScope", "imageBuildingThreshold", "imageBuildingFit"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "imageBuildingScope" && imageBuildingDraft) imageBuildingDraft._scopeTouched = true;
      if (imageBuildingDraft) rebuildImageBuilding(imageBuildingDraft.structure?.__userEdited ? imageBuildingDraft.structure : undefined);
    });
  });
  document.getElementById("imageBuildingOverlay")?.addEventListener("change", () => paintImageBuildingPreview());
  document.getElementById("btnApplyImageBuilding")?.addEventListener("click", () => applyImageBuilding());
  document.getElementById("btnImageBuildingRebuild")?.addEventListener("click", () => {
    if (imageBuildingDraft) rebuildImageBuilding(imageBuildingDraft.structure);
  });
  document.querySelectorAll("#imageBuildingSketchTools [data-sketch-tool]").forEach((button) => {
    button.addEventListener("click", () => setImageBuildingSketchTool(button.dataset.sketchTool));
  });
  const source = document.getElementById("imageBuildingSource");
  source?.addEventListener("pointerdown", handleImageBuildingPointer);
  if (IMAGE_BUILDING_DEBUG) {
    imageBuildingClusterPalette();
    imageBuildingNearestMaterial();
  }
}

function bindBuilding() {
  bindBuildingSheetChrome();
  bindImageBuilding();
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
    backdrop: null,
    inert: [".stage-bar", ".building-app .topbar"],
    initialFocus: "#btnBuildingToolsClose",
    mutex: "building-workspace",
    resetScroll: false,
  });
  document.getElementById("btnChooseBase").onclick = () => enterHouseSelect();
  document.getElementById("btnNextBase").onclick = () => beginDesign();
  const btnClearDesign = document.getElementById("btnClearDesign");
  if (btnClearDesign) btnClearDesign.onclick = () => clearCurrentDesign({ ask: true });
  document.getElementById("btnBackBase").onclick = () => cancelHouseSelect();
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
  if (btnZoomReset) btnZoomReset.onclick = () => setZoom(1, null, null, { recenter: true });
  bindNudgePad();
  const canvasShell = document.getElementById("canvasShell");
  if (canvasShell) {
    canvasShell.addEventListener(
      "wheel",
      (event) => {
        if (event.target.closest(".stage-bar, .base-meta, .zoom-control, .nudge-pad, .stage-commandbar")) return;
        if (state.interaction) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        rememberCanvasClient(event.clientX, event.clientY);
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
  document.getElementById("btnPaperLibraryClear")?.addEventListener("click", () => {
    clearServerPaperLibrary().catch((error) => console.warn(error));
  });
  document.getElementById("btnPaperLibraryFolder")?.addEventListener("click", () => {
    document.getElementById("buildingFolder")?.click();
  });
  document.getElementById("btnPaperLibraryFiles")?.addEventListener("click", () => {
    document.getElementById("paperLibraryFilePick")?.click();
  });
  document.getElementById("btnPaperLibraryPick")?.addEventListener("click", () => {
    document.getElementById("buildingFolder")?.click();
  });
  document.getElementById("btnPaperLibraryNewGroup")?.addEventListener("click", () => {
    createPaperLibraryGroup().catch((error) => console.warn(error));
  });
  document.getElementById("btnPaperLibraryRenameGroup")?.addEventListener("click", () => {
    renamePaperLibraryGroup(batchLibrary.groupFilter).catch((error) => console.warn(error));
  });
  document.getElementById("btnPaperLibrarySelectVisible")?.addEventListener("click", () => {
    selectVisiblePaperLibraryCards();
  });
  document.getElementById("btnPaperLibraryBatchApply")?.addEventListener("click", () => {
    applyPaperLibraryBatchGroup().catch((error) => console.warn(error));
  });
  document.getElementById("btnPaperLibraryBatchClear")?.addEventListener("click", () => {
    clearPaperLibrarySelection();
  });
  document.getElementById("btnPaperLibraryBatchArchive")?.addEventListener("click", () => {
    applyPaperLibraryBatchArchive().catch((error) => console.warn(error));
  });
  document.getElementById("btnPaperLibraryArchive")?.addEventListener("click", () => {
    setPaperLibraryArchiveView(!batchLibrary.archiveView);
  });
  document.querySelectorAll("[data-paper-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      batchLibrary.kindFilter = button.dataset.paperKind || "all";
      document.querySelectorAll("[data-paper-kind]").forEach((tab) => {
        const on = tab.dataset.paperKind === batchLibrary.kindFilter;
        tab.classList.toggle("on", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      });
      applyPaperLibraryFilter();
    });
  });
  document.getElementById("paperBatchSearch")?.addEventListener("input", () => applyPaperLibraryFilter());
  PaperLibraryCore.bindPaperSortSelect(() => applyPaperLibraryFilter());
  document.getElementById("paperInspectGroup")?.addEventListener("change", (event) => {
    if (paperInspectView.entry) {
      assignPaperGroup(paperInspectView.entry, event.target.value).catch((error) => console.warn(error));
    }
  });
  document.getElementById("btnPaperInspectRename")?.addEventListener("click", () => {
    if (paperInspectView.entry) {
      renamePaperLibraryEntry(paperInspectView.entry).catch((error) => console.warn(error));
    }
  });
  document.getElementById("btnPaperInspectArchive")?.addEventListener("click", () => {
    if (paperInspectView.entry) {
      togglePaperLibraryArchived(paperInspectView.entry).catch((error) => console.warn(error));
    }
  });
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
  document.getElementById("paperLibraryFilePick")?.addEventListener("change", async (event) => {
    await openBatchPaperPreview(event.target.files || []);
    event.target.value = "";
  });
  document.getElementById("btnDownloadPaper").onclick = () => {
    exportDesign().catch((error) => appAlert(error.message || String(error), { title: "导出失败" }));
  };
  document.getElementById("btnSavePaperPreview").onclick = saveCurrentPaperPreview;
  document.getElementById("btnAllMaterials").onclick = () => openBuildingMaterialLedger();
  document.getElementById("btnMaterialsDockToggle")?.addEventListener("click", () => {
    setMaterialsDockCollapsed(!document.getElementById("materialsDock")?.classList.contains("is-collapsed"));
  });
  document.getElementById("btnDesignMaterials")?.addEventListener("click", () => openBuildingMaterialLedger());
  document.getElementById("btnProjectMaterials")?.addEventListener("click", () => openBuildingMaterialLedger());
  document.getElementById("btnProjectMaterialsTab")?.addEventListener("click", () => openBuildingRail("materials"));
  document.getElementById("btnPieceMaterials")?.addEventListener("click", () => openPieceMaterialLedger());
  document.getElementById("currentMaterials")?.addEventListener("click", () => {
    if (pieceMaterialPayload?.groups?.[0]?.rows?.length) openPieceMaterialLedger();
  });
  document.getElementById("allMaterials")?.addEventListener("click", () => openBuildingMaterialLedger());
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
  document.getElementById("btnSaveDesign")?.addEventListener("click", () => {
    saveDesignNow().catch((error) => console.warn(error));
  });
  document.getElementById("btnSaveDesignNew")?.addEventListener("click", () => {
    commitDesignToPaperLibrary("new").catch((error) => console.warn(error));
  });
  document.getElementById("btnSaveDesignOriginal")?.addEventListener("click", () => {
    commitDesignToPaperLibrary("original").catch((error) => console.warn(error));
  });
  document.getElementById("saveDesignName")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const mode = sourcePaperId() ? "original" : "new";
    commitDesignToPaperLibrary(mode).catch((error) => console.warn(error));
  });
  document.getElementById("btnMakeBuilding").onclick = () => {
    openCurrentPaperPreview();
  };
  document.getElementById("btnPlaceOnTerrain").onclick = () => {
    placeCurrentBuildingOnTerrain().catch((error) => {
      appAlert(error.message || String(error), { title: "放置失败" });
    });
  };
  document.getElementById("smartBuildingStyle")?.addEventListener("change", (event) => {
    state.smartBuilder.styleId = String(event.target.value || "");
    state.smartBuilder.warnings = [];
    markBuildingDirty();
    syncSmartBuildingUi();
  });
  document.querySelectorAll("[data-smart-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.smartBuilder.mode = button.dataset.smartMode || "wall";
      openSmartBuilder();
    });
  });
  document.getElementById("btnSmartBuildingClose")?.addEventListener("click", closeSmartBuilder);
  document.getElementById("btnSmartBuildingApply")?.addEventListener("click", applySmartBuilding);
  document.getElementById("btnSmartSaveRole")?.addEventListener("click", saveCurrentMaterialToSmartStyle);
  document.getElementById("btnSmartBuildingClear")?.addEventListener("click", () => {
    state.smartBuilder.walls = [];
    state.smartBuilder.props = [];
    state.smartBuilder.warnings = [];
    markBuildingDirty();
    syncSmartBuildingUi();
  });
  document.getElementById("btnSmartBuildingUndo")?.addEventListener("click", () => {
    if (state.smartBuilder.props.length) state.smartBuilder.props.pop();
    else {
      const wall = state.smartBuilder.walls[state.smartBuilder.walls.length - 1];
      if (wall?.openings?.length) wall.openings.pop();
      else state.smartBuilder.walls.pop();
    }
    markBuildingDirty();
    syncSmartBuildingUi();
  });
  document.querySelectorAll("button[data-command]").forEach((button) => {
    button.onclick = () => {
      executeCommand(button.dataset.command);
      if (isCoarsePointer()) button.blur();
    };
  });
  document.getElementById("designDock")?.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    event.target.closest("button")?.blur();
  });
  document.getElementById("buildingMobileDock")?.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    const button = event.target.closest("button");
    if (button && button.getAttribute("aria-pressed") !== "true" && button.getAttribute("aria-expanded") !== "true") {
      button.blur();
    }
  });
  document.querySelectorAll("button[data-tool]").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.tool === "smart-wall") openSmartBuilder();
      else setActiveTool(button.dataset.tool);
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
  const btnClearLayerInsert = document.getElementById("btnClearLayerInsert");
  if (btnClearLayerInsert) btnClearLayerInsert.onclick = () => clearLayerInsert();
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
    if (!buildingFloatingHud()) setMobileToolsOpen(false);
    const mode = state.phase === "select" ? "base" : "assets";
    if (!state.railCollapsed && state.mobileSheetMode === mode) {
      closeBuildingRail();
    } else openBuildingRail(mode);
  });
  document.getElementById("btnBuildingMobileTools")?.addEventListener("click", () => {
    if (buildingFloatingHud()) {
      setMobileToolsOpen(true);
      return;
    }
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
    if (!buildingFloatingHud()) setMobileToolsOpen(false);
    if (!state.railCollapsed && state.mobileSheetMode === "project") closeBuildingRail();
    else openBuildingRail("project");
  });
  document.getElementById("btnBuildingMobileUndo")?.addEventListener("click", undo);
  document.getElementById("btnBuildingMobilePan")?.addEventListener("click", (event) => {
    if (!(state.sheetPinned && workspaceMode().tablet)) closeBuildingRail();
    if (!buildingFloatingHud()) setMobileToolsOpen(false);
    state.mobilePan = !state.mobilePan;
    syncMobilePanUi();
  });
  document.getElementById("btnProjectChooseBase")?.addEventListener("click", () => {
    enterHouseSelect();
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
  ["dlgCommands", "dlgShortcuts", "dlgSaveDesign", "dlgImageBuilding"].forEach((id) => {
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
    canvasShell.addEventListener("dblclick", (event) => {
      if (event.button !== 0 || state.spacePan || state.mobilePan) return;
      if (isolateCanvasGroupMember(event.clientX, event.clientY)) event.preventDefault();
    });
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
    setRefGuidesActive(false);
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Control") setRefGuidesActive(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Control" && !event.repeat && state.phase === "design" && state.selected.length) {
      setRefGuidesActive(true);
    }
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
    } else if (key === "b" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("brushFromSelection");
    } else if (key === "b" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("stampTool");
    } else if (key === "c" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      executeCommand("group");
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
    } else if ((event.ctrlKey || event.metaKey) && key === "s") {
      event.preventDefault();
      executeCommand("saveDesign");
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
      if (state.layerInsert) {
        clearLayerInsert();
        return;
      }
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

  wireDeskSwitchSave(saveBuildingSessionForSwitch);
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
