(function boardDesk() {
  "use strict";

  const SESSION_KEY = "manor-board-session-v1";
  const DESIGNS_KEY = "manor-board-designs-v1";
  const KIND = "billboard-hd";
  const COLS = 36;
  const ROWS = 24;
  const CELL = 18;
  const MAX_PAGES = 10;
  const DARK = 50;
  const Mosaic = window.BoardMosaic;
  let gridCols = COLS, gridRows = ROWS, cellPx = CELL;
  let mosaicUi = null;
  const SHEET_COLS = 5;
  const SHEET_ROWS = 11;
  const HIGHLIGHT_URL = "/data/board_highlight.png";
  const GBOX_ALPHA = (() => {
    let out = "";
    for (let i = 0; i < 64; i += 1) {
      out += String.fromCharCode(i < 10 ? i + 0x30 : i < 0x24 ? i + 0x37 : i + 0x3b);
    }
    return out;
  })();
  const TOOLS = [
    { id: "pencil", label: "细笔", glyph: "·" },
    { id: "round", label: "圆笔", glyph: "●" },
    { id: "spray", label: "喷点", glyph: "◌" },
    { id: "eraser", label: "关灯", glyph: "⌫" },
    { id: "line", label: "直线", glyph: "/" },
    { id: "fill", label: "填充", glyph: "▣" },
    { id: "eyedrop", label: "吸色", glyph: "◎" },
    { id: "pan", label: "画布", glyph: "✥" },
  ];
  const TOOL_KEYS = { 1: "pencil", 2: "round", 3: "spray", 4: "eraser", 5: "line", 6: "fill", 7: "eyedrop", 8: "pan" };

  const canvas = document.getElementById("paintCanvas");
  const view = document.getElementById("paintView");
  const board = document.getElementById("paintBoard");
  const ctx = canvas.getContext("2d", { alpha: false });
  const previewCanvas = document.getElementById("previewCanvas");
  const previewCtx = previewCanvas?.getContext("2d", { alpha: false });
  const highlight = new Image();
  let highlightReady = false;

  const state = {
    tool: "round",
    color: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    history: [],
    redo: [],
    designs: [],
    designId: "",
    designName: "",
    pages: [blankPage()],
    page: 0,
    interval: 1000,
    layout: Mosaic.normalize(),
    tile: 0,
    palette: defaultPalette(),
    mask: new Uint8Array(COLS * ROWS),
  };

  const pointers = new Map();
  let painting = false;
  let strokeBefore = null;
  let pendingHistory = null;
  let lastCell = null;
  let lineStart = null;
  let gesture = null;
  let pageClipboard = null;
  let playing = false;
  let playTimer = 0;
  let previewTimer = 0;
  let previewPage = 0;
  let previewPlaying = false;
  let saveDesignBusy = false;
  let designEditOn = false;
  let smartPage = null;
  let smartLayout = Mosaic.normalize();
  let smartImage = null;
  let smartAnimation = null;
  let smartPages = null;
  let smartFrame = 0;
  let smartPreviewTimer = 0;
  let smartStaticOptions = null;
  let smartFileState = "idle";
  let smartRequest = 0;
  let importPalette = null;

  function defaultPalette() {
    return [
      "#bb9393", "#d57676", "#ff9797", "#ffcbcb", "#ffe4e4",
      "#c0ab9e", "#d6a685", "#ffcaa6", "#ffe5d2", "#fff1e8",
      "#b7b787", "#d3d365", "#ffff86", "#ffffc3", "#ffffe0",
      "#abbb92", "#afd574", "#d5ff95", "#eaffcb", "#f4ffe4",
      "#9bbfaa", "#83d6a5", "#a3ffc9", "#d2ffe4", "#e7fff2",
      "#a7b8c4", "#91bcd8", "#b2e0ff", "#daefff", "#ebf7ff",
      "#a190ba", "#9a71d5", "#be91ff", "#dfc9ff", "#efe3ff",
      "#b79abf", "#c280d7", "#e9a1ff", "#f5d1ff", "#f9e7ff",
      "#b583a4", "#d259ad", "#ff7dd6", "#ffbeea", "#ffddf4",
      "#8e8e8e", "#acacac", "#dbdbdb", "#f9f9f9", "#ffffff",
    ];
  }

  function blankPage(cols = gridCols, rows = gridRows) {
    return new Uint8Array(cols * rows).fill(DARK);
  }

  function installLayout(layout, tile = 0) {
    state.layout = Mosaic.normalize(layout);
    gridCols = state.layout.cols * COLS;
    gridRows = state.layout.rows * ROWS;
    cellPx = Math.min(CELL, Math.max(2, Math.floor(2304 / Math.max(gridCols, gridRows))));
    state.mask = new Uint8Array(gridCols * gridRows);
    state.tile = state.layout.mask[tile] ? tile : state.layout.mask.findIndex(Boolean);
    mosaicUi?.sync();
  }

  function selectedTile(page = currentPage()) {
    return Mosaic.extract(page, state.layout, state.tile);
  }

  function clonePage(page) {
    return new Uint8Array(page);
  }

  function currentPage() {
    return state.pages[state.page] || state.pages[0];
  }

  function cellIndex(x, y) {
    return y * gridCols + x;
  }

  function hexToRgb(hex) {
    const value = String(hex || "#000000").replace("#", "");
    const n = parseInt(value.length === 3 ? value.split("").map((ch) => ch + ch).join("") : value, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function gboxItoa(value) {
    if (value < 0) return "";
    let number = value >>> 0;
    let out = "";
    do {
      out = GBOX_ALPHA.charAt(number & 63) + out;
      number >>>= 6;
    } while (number);
    return out;
  }

  function gboxAtoi(text) {
    const raw = String(text || "").trim();
    if (!raw) return -1;
    let acc = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const index = GBOX_ALPHA.indexOf(raw.charAt(i));
      if (index < 0) return -1;
      acc = (acc << 6) + index;
    }
    return acc;
  }

  function encodePageClip(page) {
    const cells = page || selectedTile();
    const parts = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (i) parts.push(",");
      if (cells[i] >= 0) parts.push(gboxItoa(cells[i]));
    }
    return parts.join("");
  }

  function decodePageClip(text) {
    const page = blankPage(COLS, ROWS);
    const tokens = String(text || "").split(",");
    for (let i = 0; i < Math.min(page.length, tokens.length); i += 1) {
      const value = gboxAtoi(tokens[i]);
      page[i] = value < 0 || value > DARK ? DARK : value;
    }
    return page;
  }

  function encodeAllClip(pages) {
    const rows = (pages || state.pages.map(selectedTile)).slice(0, MAX_PAGES);
    const inner = (rows.length ? rows : [blankPage()]).map((page) => `'${encodePageClip(page)}'`).join(",");
    return `(${inner})`;
  }

  function decodeBoardClip(text) {
    const raw = String(text || "").trim();
    if (raw.startsWith("(") && raw.endsWith(")")) {
      const inner = raw.slice(1, -1);
      const pages = [];
      let i = 0;
      while (i < inner.length && pages.length < MAX_PAGES) {
        while (i < inner.length && /\s/.test(inner.charAt(i))) i += 1;
        if (i >= inner.length) break;
        if (inner.charAt(i) !== "'") return [decodePageClip(raw)];
        const close = inner.indexOf("'", i + 1);
        if (close < 0) break;
        pages.push(decodePageClip(inner.slice(i + 1, close)));
        i = close + 1;
        if (inner.charAt(i) === ",") i += 1;
      }
      return pages.length ? pages : [decodePageClip(raw)];
    }
    return [decodePageClip(raw)];
  }

  async function writeClipText(text) {
    const value = String(text || "");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* fall through to execCommand, which still works on http */
    }
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.setAttribute("aria-hidden", "true");
      field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(field);
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      const ok = document.execCommand("copy");
      field.remove();
      if (ok) return true;
    } catch {
      /* fall through */
    }
    return false;
  }

  function teachGamePaste(kind) {
    const all = kind === "all";
    const message = all
      ? "已复制全部页。打开游戏「高清电子广告牌设计」，点「全部粘贴」。游戏没有文件导入。"
      : "已复制当前页。打开游戏「高清电子广告牌设计」，按 Ctrl+V 或点「粘贴」。多页请用「复制全部页」，再到游戏里全部粘贴。";
    if (typeof appAlert === "function") appAlert(message, { title: "复制", okLabel: "去游戏粘贴" });
  }

  function showClipFallback(text, kind) {
    const field = document.getElementById("boardClipText");
    const hint = document.getElementById("boardClipHint");
    if (field) {
      field.value = text;
      field.focus();
      field.select();
    }
    if (hint) {
      hint.textContent = kind === "all"
        ? "浏览器没写入剪贴板。全选下面文本，Ctrl+C 复制，再到游戏里点「全部粘贴」。"
        : "浏览器没写入剪贴板。全选下面文本，Ctrl+C 复制，再到游戏里 Ctrl+V 或点「粘贴」。";
    }
    setModalVisible("dlgBoardClip", true);
  }

  async function copyPage(options = {}) {
    const text = encodePageClip(selectedTile());
    pageClipboard = selectedTile();
    const ok = await writeClipText(text);
    setSaveStatus(ok ? "已复制当前页，到游戏里粘贴" : "复制被浏览器拦住，请手动全选复制");
    if (ok) {
      if (options.teach !== false) teachGamePaste("page");
    } else showClipFallback(text, "page");
    return ok;
  }

  async function pastePage(text) {
    const clip = text != null ? String(text) : await readClipText();
    const pages = clip.trim() ? decodeBoardClip(clip) : [];
    const page = pages[0] || pageClipboard;
    if (!page) {
      if (typeof appAlert === "function") appAlert("剪贴板里没有灯珠页。先在本桌点「复制」，或在游戏里复制。", { title: "无法粘贴" });
      return;
    }
    commitHistory();
    applyPage(page);
  }

  async function copyAllPages(options = {}) {
    const text = encodeAllClip(state.pages.map(page => selectedTile(page)));
    pageClipboard = selectedTile();
    const ok = await writeClipText(text);
    setSaveStatus(ok ? "已复制全部页，到游戏里全部粘贴" : "复制被浏览器拦住，请手动全选复制");
    if (ok) {
      if (options.teach !== false) teachGamePaste("all");
    } else showClipFallback(text, "all");
    return ok;
  }

  async function readClipText() {
    try {
      if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
    } catch {
      /* fall through */
    }
    return "";
  }

  function applyPage(page) {
    Mosaic.insert(currentPage(), state.layout, state.tile, page);
    markDirty();
    drawBoard();
    renderPages();
  }

  function colorOf(frame) {
    if (frame === DARK || frame < 0 || frame >= state.palette.length) return [0x75, 0x75, 0x75];
    return hexToRgb(state.palette[frame]);
  }

  function spriteOrigin(frame) {
    const index = Math.max(0, Math.min(SHEET_COLS * SHEET_ROWS - 1, frame | 0));
    return {
      sx: (index % SHEET_COLS) * CELL,
      sy: Math.floor(index / SHEET_COLS) * CELL,
    };
  }

  function paintSwatch(button, frame) {
    const index = Math.max(0, Math.min(SHEET_COLS * SHEET_ROWS - 1, frame | 0));
    const col = index % SHEET_COLS;
    const row = Math.floor(index / SHEET_COLS);
    const px = SHEET_COLS === 1 ? 0 : (col / (SHEET_COLS - 1)) * 100;
    const py = SHEET_ROWS === 1 ? 0 : (row / (SHEET_ROWS - 1)) * 100;
    button.style.backgroundImage = `url("${HIGHLIGHT_URL}")`;
    button.style.backgroundRepeat = "no-repeat";
    button.style.backgroundSize = `${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%`;
    button.style.backgroundPosition = `${px}% ${py}%`;
  }

  function onHighlightReady() {
    highlightReady = highlight.naturalWidth >= SHEET_COLS * CELL && highlight.naturalHeight >= SHEET_ROWS * CELL;
    if (!highlightReady) return;
    if (window.BoardImage?.paletteFromSprite) {
      importPalette = window.BoardImage.paletteFromSprite(rasterizeImage(highlight), state.palette.length, CELL, SHEET_COLS);
    }
    fillPalette();
    drawBoard();
    renderPages();
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function setSaveStatus(text) {
    const node = document.getElementById("saveStatus");
    if (node) node.textContent = text;
  }

  function markDirty() {
    state.pages.forEach(page => Mosaic.clean(page, state.layout));
    if (pendingHistory) {
      pendingHistory.after = historySnapshot();
      pendingHistory = null;
    }
    state.dirty = true;
    setSaveStatus("未保存");
  }

  function pageSnapshot() {
    return state.pages.map((page) => Array.from(page));
  }

  function historySnapshot() {
    return {
      pages: pageSnapshot(),
      page: state.page,
      interval: state.interval,
      designId: state.designId,
      designName: state.designName,
      layout: Mosaic.normalize(state.layout),
      tile: state.tile,
    };
  }

  function syncHistoryButtons() {
    document.getElementById("btnUndo")?.toggleAttribute("disabled", !state.history.length);
    document.getElementById("btnRedo")?.toggleAttribute("disabled", !state.redo.length);
  }

  function commitHistory(before = historySnapshot()) {
    stopPlay();
    pendingHistory = { before, after: null };
    state.history.push(pendingHistory);
    const limit = Math.max(2, Math.min(80, Math.floor(4000000 / (gridCols * gridRows * state.pages.length * 2))));
    while (state.history.length > limit) state.history.shift();
    state.redo = [];
    syncHistoryButtons();
  }

  function restoreHistory(entry, direction) {
    const snapshot = entry[direction];
    const resized = state.layout.cols !== snapshot.layout.cols || state.layout.rows !== snapshot.layout.rows;
    stopPlay();
    installLayout(snapshot.layout, snapshot.tile);
    state.page = snapshot.page;
    state.interval = snapshot.interval;
    // Only a new-design operation changes identity. Undoing a stroke after saving
    // must keep the saved work's ID and name.
    if (entry.before.designId !== entry.after.designId || entry.before.designName !== entry.after.designName) {
      state.designId = snapshot.designId;
      state.designName = snapshot.designName;
    }
    restorePages(snapshot.pages);
    const name = document.getElementById("boardSaveName");
    if (name) name.value = state.designName;
    const interval = document.getElementById("previewInterval");
    if (interval) interval.value = String(state.interval);
    renderDesigns();
    markDirty();
    syncHistoryButtons();
    if (resized) fitCamera();
  }

  function restorePages(pages) {
    state.pages = (pages || []).map((page) => {
      const next = blankPage();
      const src = page || [];
      for (let i = 0; i < Math.min(next.length, src.length); i += 1) {
        const value = Number(src[i]);
        next[i] = Number.isFinite(value) ? Math.max(0, Math.min(DARK, value | 0)) : DARK;
      }
      return Mosaic.clean(next, state.layout);
    });
    if (!state.pages.length) state.pages = [blankPage()];
    if (state.pages.length > MAX_PAGES) state.pages = state.pages.slice(0, MAX_PAGES);
    state.page = Math.max(0, Math.min(state.page, state.pages.length - 1));
    drawBoard();
    renderPages();
  }

  function undo() {
    finishStroke();
    if (!state.history.length) return;
    const entry = state.history.pop();
    state.redo.push(entry);
    restoreHistory(entry, "before");
  }

  function redo() {
    finishStroke();
    if (!state.redo.length) return;
    const entry = state.redo.pop();
    state.history.push(entry);
    restoreHistory(entry, "after");
  }

  function fitCamera() {
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const zoom = Math.max(0.02, Math.min(rect.width / canvas.width, rect.height / canvas.height) * 0.92);
    state.zoom = zoom;
    state.panX = (rect.width - canvas.width * zoom) / 2;
    state.panY = (rect.height - canvas.height * zoom) / 2;
    applyCamera();
  }

  function applyCamera() {
    if (!view) return;
    view.style.width = `${canvas.width}px`;
    view.style.height = `${canvas.height}px`;
    view.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    const label = document.getElementById("boardZoomLabel");
    if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function boardPoint(event) {
    const rect = board.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.panX) / state.zoom,
      y: (event.clientY - rect.top - state.panY) / state.zoom,
    };
  }

  function cellFromPoint(point) {
    const x = Math.floor(point.x / cellPx);
    const y = Math.floor(point.y / cellPx);
    if (!Mosaic.hasCell(state.layout, x, y)) return null;
    return { x, y };
  }

  function drawBulb(target, x, y, frame, masked, px = cellPx) {
    if (frame < 0) return;
    const dx = x * px;
    const dy = y * px;
    if (highlightReady) {
      const { sx, sy } = spriteOrigin(frame);
      target.drawImage(highlight, sx, sy, CELL, CELL, dx, dy, px, px);
    } else {
      const [r, g, b] = colorOf(frame);
      target.fillStyle = `rgb(${r},${g},${b})`;
      target.fillRect(dx, dy, px, px);
    }
    if (masked) {
      target.fillStyle = "rgba(226, 72, 128, 0.45)";
      target.fillRect(dx, dy, px, px);
    }
  }

  function drawGrid(target, page, mask, layout = state.layout, px = cellPx) {
    const cols = layout.cols * COLS, rows = layout.rows * ROWS;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!Mosaic.hasCell(layout, x, y)) continue;
        const index = y * cols + x;
        target.fillStyle = "#000000";
        target.fillRect(x * px, y * px, px, px);
        drawBulb(target, x, y, page[index], mask && mask[index], px);
      }
    }
  }

  function drawBoard() {
    canvas.width = gridCols * cellPx;
    canvas.height = gridRows * cellPx;
    drawGrid(ctx, currentPage(), state.mask);
    const label = document.getElementById("canvasSizeLabel");
    if (label) label.textContent = `${gridCols}×${gridRows}`;
    const pageLabel = document.getElementById("designerLabel");
    if (pageLabel && state.tool !== "patch") {
      pageLabel.textContent = `第 ${state.page + 1}/${state.pages.length} 页`;
    }
    mosaicUi?.drawGuide();
  }

  function snapshotJpg(page, maxEdge = 648) {
    const scratch = document.createElement("canvas");
    const px = Math.max(1, Math.min(CELL, Math.floor(maxEdge / Math.max(gridCols, gridRows))));
    scratch.width = gridCols * px;
    scratch.height = gridRows * px;
    const sctx = scratch.getContext("2d", { alpha: false });
    sctx.imageSmoothingEnabled = false;
    drawGrid(sctx, page || currentPage(), null, state.layout, px);
    return scratch.toDataURL("image/jpeg", 0.86);
  }

  function setColor(frame) {
    state.color = Math.max(0, Math.min(DARK, frame | 0));
    document.querySelectorAll("#paletteGrid .palette-swatch").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.frame) === state.color);
    });
  }

  function fillPalette() {
    const grid = document.getElementById("paletteGrid");
    if (!grid) return;
    grid.replaceChildren();
    state.palette.forEach((hex, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-swatch" + (index === state.color ? " on" : "");
      button.style.backgroundColor = hex;
      paintSwatch(button, index);
      button.dataset.frame = String(index);
      button.title = `灯色 ${index + 1}`;
      button.addEventListener("click", () => setColor(index));
      grid.append(button);
    });
    const off = document.createElement("button");
    off.type = "button";
    off.className = "palette-swatch is-off" + (state.color === DARK ? " on" : "");
    off.dataset.frame = String(DARK);
    off.title = "关灯";
    paintSwatch(off, DARK);
    off.addEventListener("click", () => setColor(DARK));
    grid.append(off);
  }

  function setTool(id) {
    state.tool = id;
    if (board) board.dataset.tool = id;
    document.querySelectorAll("#toolGrid .tool").forEach((button) => {
      button.classList.toggle("on", button.dataset.tool === id);
    });
    const panBtn = document.getElementById("btnBoardMobilePan");
    panBtn?.classList.toggle("on", id === "pan");
    panBtn?.setAttribute("aria-pressed", String(id === "pan"));
    syncMaskChrome();
  }

  function fillTools() {
    const grid = document.getElementById("toolGrid");
    if (!grid) return;
    grid.replaceChildren();
    TOOLS.forEach((tool, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool brush-tool" + (tool.id === state.tool ? " on" : "");
      button.dataset.tool = tool.id;
      button.title = tool.label + "（" + (index + 1) + "）";
      const glyph = document.createElement("span");
      glyph.className = "brush-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = tool.glyph;
      const label = document.createElement("span");
      label.textContent = tool.label;
      button.append(glyph, label);
      button.addEventListener("click", () => setTool(tool.id));
      grid.append(button);
    });
    if (board) board.dataset.tool = state.tool;
  }

  function maskHasInk() {
    return state.mask.some((value) => value);
  }

  function clearMask() {
    state.mask.fill(0);
    drawBoard();
    syncMaskChrome();
  }

  function syncMaskChrome() {
    const ink = maskHasInk();
    const clear = document.getElementById("btnClearMask");
    if (clear) clear.hidden = !ink;
    const label = document.getElementById("designerLabel");
    if (label) {
      if (state.tool === "patch") label.textContent = ink ? "涂要改的灯珠 · Shift 擦掉" : "涂要改的灯珠";
      else label.textContent = `第 ${state.page + 1}/${state.pages.length} 页`;
    }

  }

  function stampCell(x, y, frame, maskOnly, eraseMask) {
    if (!Mosaic.hasCell(state.layout, x, y)) return;
    const index = cellIndex(x, y);
    if (maskOnly) state.mask[index] = eraseMask ? 0 : 1;
    else currentPage()[index] = frame;
  }

  function sprayCell(x, y, frame) {
    const page = currentPage();
    for (let i = 0; i < 6; i += 1) {
      const cx = x + Math.round(Math.random() * 2 - 1);
      const cy = y + Math.round(Math.random() * 2 - 1);
      if (!Mosaic.hasCell(state.layout, cx, cy)) continue;
      page[cellIndex(cx, cy)] = frame;
    }
  }

  function floodFill(x, y, frame) {
    const page = currentPage();
    const start = cellIndex(x, y);
    const target = page[start];
    if (target === frame) return;
    const stack = [x, y];
    const seen = new Uint8Array(gridCols * gridRows);
    while (stack.length) {
      const cy = stack.pop();
      const cx = stack.pop();
      const id = cellIndex(cx, cy);
      if (!Mosaic.hasCell(state.layout, cx, cy) || seen[id] || page[id] !== target) continue;
      seen[id] = 1;
      page[id] = frame;
      if (cx > 0) stack.push(cx - 1, cy);
      if (cx + 1 < gridCols) stack.push(cx + 1, cy);
      if (cy > 0) stack.push(cx, cy - 1);
      if (cy + 1 < gridRows) stack.push(cx, cy + 1);
    }
  }

  function drawLineCells(a, b, frame, maskOnly, eraseMask) {
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (state.tool === "spray" && !maskOnly) sprayCell(x0, y0, frame);
      else stampCell(x0, y0, frame, maskOnly, eraseMask);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function paintAt(cell, event) {
    if (!cell) return;
    const erase = state.tool === "eraser" || event.button === 2 || event.buttons === 2;
    const frame = erase ? DARK : state.color;
    if (state.tool === "eyedrop") {
      setColor(currentPage()[cellIndex(cell.x, cell.y)]);
      return;
    }
    if (state.tool === "fill") {
      floodFill(cell.x, cell.y, frame);
      return;
    }
    if (state.tool === "spray") {
      sprayCell(cell.x, cell.y, frame);
      return;
    }
    stampCell(cell.x, cell.y, frame, state.tool === "patch", event.shiftKey);
  }

  function beginPaint(event) {
    const cell = cellFromPoint(boardPoint(event));
    if (state.tool === "pan") return;
    if (!cell) return;
    if (state.tool === "eyedrop") {
      painting = true;
      paintAt(cell, event);
      return;
    }
    stopPlay();
    strokeBefore = historySnapshot();
    if (state.tool === "fill") {
      paintAt(cell, event);
      finishStroke();
      drawBoard();
      return;
    }
    if (state.tool === "line") {
      lineStart = cell;
      painting = true;
      return;
    }
    painting = true;
    lastCell = cell;
    paintAt(cell, event);
    drawBoard();
  }

  function movePaint(event) {
    if (!painting || state.tool === "pan" || state.tool === "fill") return;
    const cell = cellFromPoint(boardPoint(event));
    if (!cell) return;
    if (state.tool === "eyedrop") {
      paintAt(cell, event);
      return;
    }
    if (state.tool === "line") return;
    if (lastCell) drawLineCells(lastCell, cell, state.tool === "eraser" || event.buttons === 2 ? DARK : state.color, state.tool === "patch", event.shiftKey);
    else paintAt(cell, event);
    lastCell = cell;
    drawBoard();
  }

  function finishStroke() {
    const before = strokeBefore;
    strokeBefore = null;
    painting = false;
    lastCell = null;
    lineStart = null;
    if (!before || !before.pages.some((page, p) => page.some((value, i) => value !== state.pages[p]?.[i]))) return;
    commitHistory(before);
    markDirty();
    renderPages();
  }

  function endPaint(event) {
    if (event.type !== "pointercancel" && state.tool === "line" && painting && lineStart) {
      const cell = cellFromPoint(boardPoint(event));
      if (cell) {
        drawLineCells(lineStart, cell, state.tool === "eraser" || event.button === 2 ? DARK : state.color, false, false);
        drawBoard();
      }
    }
    finishStroke();
    if (state.tool === "patch") syncMaskChrome();
  }

  function pointerCount() {
    return pointers.size;
  }

  function beginGesture() {
    const pts = [...pointers.values()];
    // A second finger starts camera control, so discard the tentative touch stroke.
    if (strokeBefore) restorePages(strokeBefore.pages);
    strokeBefore = null;
    finishStroke();
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    gesture = {
      dist: Math.hypot(dx, dy) || 1,
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
    };
  }

  function moveGesture() {
    if (!gesture || gesture.pan) return;
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const nextZoom = Math.min(12, Math.max(0.02, gesture.zoom * (dist / gesture.dist)));
    const rect = board.getBoundingClientRect();
    const cx = midX - rect.left;
    const cy = midY - rect.top;
    const canvasX = (cx - gesture.panX) / gesture.zoom;
    const canvasY = (cy - gesture.panY) / gesture.zoom;
    state.zoom = nextZoom;
    state.panX = cx - canvasX * nextZoom;
    state.panY = cy - canvasY * nextZoom;
    applyCamera();
  }

  function onPointerDown(event) {
    if (event.button === 1 || event.button === 2) event.preventDefault();
    board.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerCount() >= 2) {
      beginGesture();
      return;
    }
    if (event.button === 1 || state.tool === "pan") {
      gesture = { pan: true, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      return;
    }
    if (event.altKey) {
      const cell = cellFromPoint(boardPoint(event));
      if (cell) {
        state.tile = Math.floor(cell.y / ROWS) * state.layout.cols + Math.floor(cell.x / COLS);
        mosaicUi?.sync();
        drawBoard();
      }
      return;
    }
    beginPaint(event);
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerCount() >= 2) {
      moveGesture();
      return;
    }
    if (gesture?.pan) {
      state.panX = gesture.panX + (event.clientX - gesture.x);
      state.panY = gesture.panY + (event.clientY - gesture.y);
      applyCamera();
      return;
    }
    movePaint(event);
  }

  function onPointerUp(event) {
    if (pointers.has(event.pointerId) && pointerCount() === 1) endPaint(event);
    pointers.delete(event.pointerId);
    if (pointerCount() < 2) gesture = pointerCount() ? gesture : null;
  }

  function goToPage(index) {
    stopPlay();
    state.page = Math.max(0, Math.min(state.pages.length - 1, index));
    drawBoard();
    renderPages();
  }

  function addPage() {
    if (state.pages.length >= MAX_PAGES) {
      if (typeof appAlert === "function") appAlert("最多 10 页，和游戏里一样。", { title: "不能再加页" });
      else window.alert("最多 10 页");
      return;
    }
    commitHistory();
    state.pages.splice(state.page + 1, 0, blankPage());
    state.page += 1;
    markDirty();
    drawBoard();
    renderPages();
  }

  function deletePage() {
    if (state.pages.length <= 1) {
      clearPage();
      return;
    }
    commitHistory();
    state.pages.splice(state.page, 1);
    state.page = Math.min(state.page, state.pages.length - 1);
    markDirty();
    drawBoard();
    renderPages();
  }

  async function pasteAllPages(text) {
    const clip = text != null ? String(text) : await readClipText();
    const pages = clip.trim() ? decodeBoardClip(clip) : [];
    if (!pages.length) {
      if (typeof appAlert === "function") appAlert("剪贴板里没有灯珠页。先在本桌或游戏里全部复制。", { title: "无法粘贴" });
      return;
    }
    commitHistory();
    importTilePages(pages);
    if (!state.pages.length) state.pages = [blankPage()];
    state.page = 0;
    markDirty();
    drawBoard();
    renderPages();
  }

  function importTilePages(pages) {
    const incoming = Math.max(1, Math.min(MAX_PAGES, pages.length));
    const count = Mosaic.tiles(state.layout).length === 1 ? incoming : Math.max(state.pages.length, incoming);
    const next = Array.from({ length: count }, (_, i) => state.pages[i] ? clonePage(state.pages[i]) : blankPage());
    next.forEach((page, i) => Mosaic.insert(page, state.layout, state.tile, pages[i] || blankPage(COLS, ROWS)));
    state.pages = next;
    state.page = Math.min(state.page, count - 1);
  }

  function fillPage() {
    if (currentPage().every((value) => value === state.color)) return;
    commitHistory();
    currentPage().fill(state.color);
    markDirty();
    drawBoard();
    renderPages();
  }

  function clearPage() {
    if (currentPage().every((value) => value === DARK)) return;
    commitHistory();
    currentPage().fill(DARK);
    markDirty();
    drawBoard();
    renderPages();
  }

  function renderPages() {
    const strip = document.getElementById("pageStrip");
    const count = document.getElementById("pageCount");
    if (count) count.textContent = String(state.pages.length);
    if (!strip) return;
    strip.replaceChildren();
    state.pages.forEach((page, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "page-card" + (index === state.page ? " on" : "");
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(index === state.page));
      const img = document.createElement("img");
      img.alt = `第 ${index + 1} 页`;
      img.src = snapshotJpg(page);
      const label = document.createElement("b");
      label.textContent = `第 ${index + 1} 页`;
      card.append(img, label);
      card.addEventListener("click", () => goToPage(index));
      strip.append(card);
    });
    const interval = document.getElementById("pageInterval");
    if (interval && Number(interval.value) !== state.interval) interval.value = String(state.interval);
  }

  function stopPlay() {
    playing = false;
    window.clearInterval(playTimer);
    playTimer = 0;
    const btn = document.getElementById("btnPlayPages");
    btn?.classList.remove("on");
    btn?.setAttribute("aria-pressed", "false");
    if (btn) btn.textContent = "播放";
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    if (state.pages.length < 2) return;
    playing = true;
    const btn = document.getElementById("btnPlayPages");
    btn?.classList.add("on");
    btn?.setAttribute("aria-pressed", "true");
    if (btn) btn.textContent = "停止";
    playTimer = window.setInterval(() => {
      state.page = (state.page + 1) % state.pages.length;
      drawBoard();
      renderPages();
    }, Math.max(50, state.interval));
  }

  function nearestFrame(r, g, b, a) {
    if (a < 24) return DARK;
    const dark = [0x75, 0x75, 0x75];
    let best = DARK;
    let dist = (r - dark[0]) ** 2 + (g - dark[1]) ** 2 + (b - dark[2]) ** 2;
    for (let i = 0; i < state.palette.length; i += 1) {
      const [pr, pg, pb] = hexToRgb(state.palette[i]);
      const d = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  }

  function quantizeImage(image) {
    const scratch = document.createElement("canvas");
    scratch.width = COLS;
    scratch.height = ROWS;
    const sctx = scratch.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(image, 0, 0, COLS, ROWS);
    const data = sctx.getImageData(0, 0, COLS, ROWS).data;
    const page = blankPage();
    for (let i = 0; i < page.length; i += 1) {
      const o = i * 4;
      page[i] = nearestFrame(data[o], data[o + 1], data[o + 2], data[o + 3]);
    }
    return page;
  }

  function rasterizeImage(image, maxEdge = 1400) {
    const scale = Math.min(1, maxEdge / Math.max(1, image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (window.BoardImage?.sourceFromCanvas) return window.BoardImage.sourceFromCanvas(canvas);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: imageData.width, height: imageData.height, data: imageData.data };
  }

  function analyzeImage(image, options = {}) {
    const source = rasterizeImage(image, 1800);
    if (window.BoardImage?.analyze) {
      const layout = options.layout || state.layout;
      const result = window.BoardImage.analyze(source, importPalette || state.palette, { ...options, cols: layout.cols * COLS, rows: layout.rows * ROWS, dark: DARK });
      result.page = Mosaic.clean(result.page, layout);
      return result;
    }
    return { page: Array.from(quantizeImage(image)), mode: "photo", message: "已按灯珠取样。" };
  }

  function drawSmartPreview(page) {
    const canvas = document.getElementById("smartPreview");
    if (!canvas || !page) return;
    const px = Math.min(CELL, Math.max(1, Math.floor(1400 / Math.max(smartLayout.cols * COLS, smartLayout.rows * ROWS))));
    canvas.width = smartLayout.cols * COLS * px;
    canvas.height = smartLayout.rows * ROWS * px;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = false;
    drawGrid(context, page, null, smartLayout, px);
    mosaicUi?.drawTileLines(context, smartLayout, px);
    canvas.hidden = false;
  }

  function setSmartStatus(text) {
    const node = document.getElementById("boardSmartStatus");
    if (node) node.textContent = text || "";
  }

  function stopSmartPreview() {
    clearInterval(smartPreviewTimer);
    smartPreviewTimer = 0;
    const button = document.getElementById("btnSmartFramePlay");
    button.textContent = "播放";
    button.setAttribute("aria-pressed", "false");
  }

  function showSmartFrame(index) {
    if (!smartPages?.length) return;
    smartFrame = (index + smartPages.length) % smartPages.length;
    smartPage = smartPages[smartFrame];
    drawSmartPreview(smartPage);
    document.getElementById("smartFrameLabel").textContent = `${smartFrame + 1} / ${smartPages.length} 帧`;
  }

  function setSmartAnimation(animation) {
    stopSmartPreview();
    const mode = document.getElementById("smartMode"), crop = document.getElementById("smartCrop"), background = document.getElementById("smartBackground");
    if (animation) {
      if (!smartStaticOptions) smartStaticOptions = { mode: mode.value, crop: crop.checked, background: background.checked };
      mode.value = "photo"; crop.checked = false; background.checked = true;
    } else if (smartStaticOptions) {
      mode.value = smartStaticOptions.mode; crop.checked = smartStaticOptions.crop; background.checked = smartStaticOptions.background;
      smartStaticOptions = null;
    }
    for (const field of [mode, crop, background]) field.disabled = !!animation;
    smartAnimation = animation;
    smartPages = null;
    smartFrame = 0;
    document.getElementById("boardSmartFrames").hidden = true;
  }

  async function loadGifFile(file) {
    const response = await fetch("/api/board/import-ani", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: await fileToBase64(file), name: file.name, sourceFrames: true }),
    });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.frames) || !result.frames.length) throw new Error(result.error || "GIF 帧读取失败");
    const frames = await Promise.all(result.frames.slice(0, MAX_PAGES).map(frame => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("GIF 帧打不开"));
      image.src = frame.png;
    })));
    return { frames, frameCount: result.frameCount, interval: Math.max(50, Math.min(99999, Number(result.interval) || 100)) };
  }

  function openSmartDialog() {
    closeBoardSheets();
    smartLayout = Mosaic.normalize(state.layout);
    mosaicUi?.setDraft(smartLayout);
    setModalVisible("dlgBoardSmart", true);
    refreshSmartResult();
  }

  function applySmartResult(result, options = {}) {
    const page = result?.page;
    if (!page) throw new Error("没有识别出灯珠");
    smartPage = Array.from(page);
    drawSmartPreview(smartPage);
    const apply = document.getElementById("btnBoardSmartApply");
    if (apply) apply.disabled = false;
    setSmartStatus(result.message || "已分析出色系。");
    if (options.commit) commitSmartPage(result.message);
    return result;
  }

  function commitSmartPage(message) {
    if (!smartPage) return;
    commitHistory();
    const pages = smartPages ? smartPages.map(page => new Uint8Array(page))
      : state.pages.map(page => Mosaic.remap(page, state.layout, smartLayout));
    installLayout(smartLayout);
    state.pages = pages;
    if (smartPages) {
      state.page = 0;
      state.interval = smartAnimation.interval;
      for (const id of ["pageInterval", "previewInterval"]) document.getElementById(id).value = String(state.interval);
    } else currentPage().set(smartPage);
    markDirty();
    drawBoard();
    renderPages();
    fitCamera();
    setSaveStatus(message || "已生成");
    setModalVisible("dlgBoardSmart", false);
  }

  async function analyzeSmartFile(file) {
    if (!file) return;
    const request = ++smartRequest;
    smartImage = null;
    setSmartAnimation(null);
    smartFileState = "loading";
    resetSmartResult();
    const name = String(file.name || "").toLowerCase();
    const gif = name.endsWith(".gif") || file.type === "image/gif";
    if (!/\.(png|jpe?g|webp|gif)$/.test(name) && !/^image\/(png|jpeg|webp|gif)$/.test(file.type || "")) {
      smartFileState = "error";
      setSmartStatus("请选择 PNG、JPG、WebP 或 GIF。");
      return;
    }
    setSmartStatus(gif ? "正在读取 GIF 动画帧…" : "正在认格子和色系…");
    try {
      const source = gif ? await loadGifFile(file) : await loadImageFile(file);
      if (request !== smartRequest) return;
      if (gif) setSmartAnimation(source);
      else smartImage = source;
      smartFileState = "idle";
      await refreshSmartResult();
    } catch (error) {
      if (request === smartRequest) {
        smartFileState = "error";
        setSmartStatus(String(error.message || error));
      }
    }
  }

  function resetSmartResult() {
    stopSmartPreview();
    smartPage = null;
    smartPages = null;
    document.getElementById("boardSmartFrames").hidden = true;
    document.getElementById("btnBoardSmartApply").disabled = true;
    document.getElementById("smartPreview").hidden = true;
  }

  async function refreshSmartResult() {
    if (!smartImage && !smartAnimation) {
      if (smartFileState !== "idle") return;
      applySmartResult({ page: Mosaic.remap(currentPage(), state.layout, smartLayout), message: `布局 ${smartLayout.cols}×${smartLayout.rows}，共 ${Mosaic.tiles(smartLayout).length} 块。可选图导入，也可直接应用布局。` });
      return;
    }
    const request = ++smartRequest;
    resetSmartResult();
    setSmartStatus("正在识别…");
    await nextPaint();
    if (request !== smartRequest) return;
    try {
      const options = {
        layout: smartLayout,
        mode: document.getElementById("smartMode").value,
        sampling: document.getElementById("smartSampling").value,
        background: document.getElementById("smartBackground").checked ? "keep" : "auto",
        crop: document.getElementById("smartCrop").checked,
      };
      if (smartAnimation) {
        const animation = smartAnimation, pages = [];
        for (const [index, frame] of animation.frames.entries()) {
          setSmartStatus(`正在生成 GIF 拼接动画 ${index + 1}/${animation.frames.length}…`);
          await nextPaint();
          if (request !== smartRequest) return;
          // Use the same full-frame bounds and background for every frame.
          pages.push(analyzeImage(frame, { ...options, mode: "photo", crop: false, background: "keep" }).page);
        }
        const count = Mosaic.tiles(smartLayout).length;
        const source = animation.frameCount > MAX_PAGES ? `原 GIF ${animation.frameCount} 帧，取前 ${pages.length} 帧` : `GIF ${pages.length} 帧`;
        applySmartResult({ page: pages[0], message: `${source} · ${count} 块 · 每帧 ${smartLayout.cols * COLS}×${smartLayout.rows * ROWS} 灯珠。保留完整画面和背景，避免抖动；按 ${animation.interval} 毫秒等间隔播放。` });
        smartPages = pages;
        document.getElementById("boardSmartFrames").hidden = false;
        document.getElementById("btnSmartFramePlay").disabled = pages.length < 2;
        showSmartFrame(0);
      } else applySmartResult(analyzeImage(smartImage, options));
    } catch (error) {
      setSmartStatus(String(error.message || error));
    }
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片打不开"));
      };
      image.src = url;
    });
  }

  async function importImageFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".ale") || name.endsWith(".json")) {
      await importGameFile(file);
      return;
    }
    openSmartDialog();
    await analyzeSmartFile(file);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        resolve(text.includes(",") ? text.split(",", 2)[1] : text);
      };
      reader.onerror = () => reject(new Error("文件读不出"));
      reader.readAsDataURL(file);
    });
  }

  async function importGameFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".json")) {
      const text = await file.text();
      const payload = JSON.parse(text);
      const pages = payload?.pages;
      if (!Array.isArray(pages) || !pages.length) throw new Error("不是灯牌图纸");
      const layout = Mosaic.normalize(payload.layout || {});
      commitHistory();
      installLayout(layout, payload.tile);
      restorePages(pages);
      if (Number(payload.interval)) state.interval = Math.max(50, Math.min(60000, Number(payload.interval)));
      const interval = document.getElementById("pageInterval");
      if (interval) interval.value = String(state.interval);
      markDirty();
      fitCamera();
      return;
    }
    const data = await fileToBase64(file);
    const res = await fetch("/api/board/import-ani", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, name: file.name }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || payload.message || "ALE 导入失败");
    const pages = payload.pages;
    if (!Array.isArray(pages) || !pages.length) throw new Error("ALE 里没有灯珠页");
    commitHistory();
    importTilePages(pages);
    markDirty();
    drawBoard();
    renderPages();
  }

  function exportJpg(name) {
    const a = document.createElement("a");
    a.href = snapshotJpg(currentPage(), 2304);
    a.download = (name || state.designName || "广告") + ".jpg";
    a.click();
  }

  async function exportFinalize() {
    if (Mosaic.tiles(state.layout).length > 1) {
      await mosaicUi.exportBundle();
      return;
    }
    const button = document.getElementById("btnFinalize");
    if (button?.dataset.busy === "1") return;
    if (button) {
      button.dataset.busy = "1";
      button.dataset.prev = button.textContent || "";
      button.textContent = "定稿中";
    }
    try {
      const res = await fetch("/api/board/export-ani", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.designName || "高清电子广告牌",
          interval: state.interval,
          pages: state.pages.map(page => Array.from(selectedTile(page))),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || payload.message || "定稿失败");
      const raw = atob(String(payload.ale || ""));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = payload.filename || ((state.designName || "高清电子广告牌") + ".ale");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      if (typeof appAlert === "function") appAlert(String(error.message || error), { title: "定稿失败" });
    } finally {
      if (button) {
        button.dataset.busy = "0";
        button.textContent = button.dataset.prev || "定稿";
      }
    }
  }

  function setModalVisible(id, visible) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (visible) window.MobileWorkspace?.openLayer(modal, document.activeElement);
    else window.MobileWorkspace?.closeLayer(modal);
    if (id === "dlgBoardPreview" || id === "dlgBoardSmart" || id === "dlgBoardClip") {
      document.querySelector(".board-workspace")?.toggleAttribute("inert", !!visible);
      document.querySelector(".board-app .topbar")?.toggleAttribute("inert", !!visible);
    }
    if (id === "dlgBoardPreview" && !visible) stopPreview();
    if (id === "dlgBoardSmart" && !visible) stopSmartPreview();
  }

  function stopPreview() {
    previewPlaying = false;
    window.clearInterval(previewTimer);
    previewTimer = 0;
    const btn = document.getElementById("btnPreviewPlay");
    if (btn) {
      btn.textContent = "播放";
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function previewTick() {
    if (!previewCtx) return;
    if (previewCanvas) {
      previewCanvas.width = gridCols * cellPx;
      previewCanvas.height = gridRows * cellPx;
    }
    drawGrid(previewCtx, state.pages[previewPage] || currentPage(), null);
    mosaicUi?.drawGamePreview(state.pages[previewPage] || currentPage());
    const cur = document.getElementById("previewCur");
    const max = document.getElementById("previewMax");
    if (cur) cur.textContent = String(previewPage + 1);
    if (max) max.textContent = String(state.pages.length);
    const prev = document.getElementById("btnPreviewPrev");
    const next = document.getElementById("btnPreviewNext");
    prev?.toggleAttribute("disabled", previewPage <= 0);
    next?.toggleAttribute("disabled", previewPage >= state.pages.length - 1);
  }

  function previewIntervalMs() {
    const input = document.getElementById("previewInterval");
    const value = Math.max(50, Number(input?.value) || state.interval || 1000);
    if (input && Number(input.value) !== value) input.value = String(value);
    return value;
  }

  function showPreview() {
    if (!previewCtx) return;
    closeBoardSheets();
    setModalVisible("dlgBoardPreview", true);
    previewPage = state.page;
    const interval = document.getElementById("previewInterval");
    if (interval) interval.value = String(state.interval);
    stopPreview();
    previewTick();
  }

  function previewPrev() {
    stopPreview();
    previewPage = Math.max(0, previewPage - 1);
    previewTick();
  }

  function previewNext() {
    stopPreview();
    previewPage = Math.min(state.pages.length - 1, previewPage + 1);
    previewTick();
  }

  function togglePreviewPlay() {
    if (previewPlaying) {
      stopPreview();
      return;
    }
    if (state.pages.length < 2) return;
    previewPlaying = true;
    const btn = document.getElementById("btnPreviewPlay");
    if (btn) {
      btn.textContent = "停止";
      btn.setAttribute("aria-pressed", "true");
    }
    previewTimer = window.setInterval(() => {
      previewPage = (previewPage + 1) % state.pages.length;
      previewTick();
    }, previewIntervalMs());
  }

  function putBoardSaves(payload) {
    return fetch("/api/saves/board", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json().catch(() => ({}));
    });
  }

  async function fetchBoardSaves() {
    try {
      const res = await fetch("/api/saves/board", { credentials: "same-origin" });
      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  function designsBundle() {
    return { v: 1, savedAt: Date.now(), items: state.designs };
  }

  function sessionSnapshot() {
    return {
      v: 1,
      kind: KIND,
      layout: Mosaic.normalize(state.layout),
      tile: state.tile,
      tool: state.tool,
      color: state.color,
      page: state.page,
      interval: state.interval,
      designId: state.designId,
      designName: state.designName,
      pages: pageSnapshot(),
      savedAt: Date.now(),
    };
  }

  function persistSessionLocal(snap) {
    try {
      deskSet(SESSION_KEY, JSON.stringify(snap));
    } catch (error) {
      console.warn(error);
    }
  }

  function persistDesignsLocal(bundle) {
    try {
      const slim = {
        v: 1,
        savedAt: bundle.savedAt,
        items: (bundle.items || []).map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          pageCount: row.pageCount,
          layout: row.layout,
          savedAt: row.savedAt,
          png: row.png,
        })),
      };
      deskSet(DESIGNS_KEY, JSON.stringify(slim));
    } catch (error) {
      console.warn(error);
    }
  }

  function saveSession() {
    const snap = sessionSnapshot();
    persistSessionLocal(snap);
    putBoardSaves({ session: snap }).catch((error) => console.warn(error));
    state.dirty = false;
    setSaveStatus("已保存");
  }

  async function saveDesign() {
    if (saveDesignBusy) return;
    const okBtn = document.getElementById("btnBoardSaveOk");
    const name = String(document.getElementById("boardSaveName")?.value || "").trim() || "未命名广告";
    saveDesignBusy = true;
    if (okBtn) {
      okBtn.disabled = true;
      okBtn.textContent = "保存中";
    }
    setModalVisible("dlgBoardSave", false);
    setSaveStatus("保存中…");
    await nextPaint();
    state.designName = name;
    const now = Date.now();
    const item = {
      id: state.designId && !state.designId.startsWith("__") ? state.designId : `b${now.toString(36)}`,
      name,
      kind: KIND,
      pageCount: state.pages.length,
      interval: state.interval,
      pages: pageSnapshot(),
      layout: Mosaic.normalize(state.layout),
      png: snapshotJpg(),
      savedAt: now,
    };
    state.designs = [item, ...state.designs.filter((row) => row.id !== item.id)].slice(0, 80);
    state.designId = item.id;
    persistDesignsLocal(designsBundle());
    renderDesigns();
    try {
      await putBoardSaves({ designs: { v: 1, savedAt: now, items: [item] } });
      state.dirty = false;
      setSaveStatus("已保存 " + name);
    } catch (error) {
      console.warn(error);
      setSaveStatus("本机已保存");
    } finally {
      saveDesignBusy = false;
      if (okBtn) {
        okBtn.disabled = false;
        okBtn.textContent = "保存";
      }
    }
  }

  function mergeDesigns(local, remote) {
    const localItems = Array.isArray(local?.items) ? local.items : [];
    const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
    if (!remoteItems.length) return { items: localItems, savedAt: Number(local?.savedAt) || Date.now() };
    if (!localItems.length) return { items: remoteItems, savedAt: Number(remote?.savedAt) || Date.now() };
    const byId = new Map();
    [...remoteItems, ...localItems].forEach((item) => {
      if (!item?.id) return;
      const prev = byId.get(item.id);
      if (!prev) {
        byId.set(item.id, item);
        return;
      }
      const itemNewer = Number(item.savedAt) >= Number(prev.savedAt);
      const newer = { ...(itemNewer ? item : prev) };
      const older = itemNewer ? prev : item;
      if (!newer.png && older.png) newer.png = older.png;
      if ((!newer.pages || !newer.pages.length) && older.pages) newer.pages = older.pages;
      byId.set(item.id, newer);
    });
    return { items: [...byId.values()], savedAt: Math.max(Number(local?.savedAt) || 0, Number(remote?.savedAt) || 0) };
  }

  function visibleDesigns() {
    const q = String(document.getElementById("designSearch")?.value || "").trim().toLowerCase();
    return (state.designs || []).filter((item) => !q || String(item.name || "").toLowerCase().includes(q));
  }

  function renderDesigns() {
    const list = document.getElementById("designList");
    if (!list) return;
    const items = visibleDesigns();
    const count = document.getElementById("designCount");
    if (count) count.textContent = String(items.length);
    list.replaceChildren();
    if (!(state.designs || []).length) {
      const empty = document.createElement("p");
      empty.className = "kind-meta";
      empty.textContent = "还没有保存的广告。";
      list.append(empty);
      return;
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "kind-meta";
      empty.textContent = "没有符合条件的作品。";
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "design-card" + (item.id && item.id === state.designId ? " on" : "");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const img = document.createElement("img");
      img.alt = item.name || "";
      img.src = item.png || "";
      const meta = document.createElement("span");
      meta.className = "design-card-meta";
      const label = document.createElement("span");
      label.className = "design-card-name";
      label.textContent = item.name || "未命名";
      const kind = document.createElement("span");
      kind.className = "design-card-kind";
      kind.textContent = `${item.layout ? item.layout.mask.filter(Boolean).length + " 块 · " : ""}${item.pageCount || (item.pages || []).length || 1} 页`;
      meta.append(label, kind);
      card.append(img, meta);
      card.addEventListener("click", () => openDesign(item));
      if (designEditOn) {
        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "design-card-rename";
        rename.textContent = "改";
        rename.addEventListener("click", (event) => {
          event.stopPropagation();
          renameDesign(item);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "design-card-del";
        del.textContent = "删";
        del.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteDesign(item);
        });
        card.append(rename, del);
      }
      list.append(card);
    });
  }

  function openDesign(item) {
    if (!item) return;
    stopPlay();
    strokeBefore = null;
    finishStroke();
    state.history = [];
    state.redo = [];
    pendingHistory = null;
    syncHistoryButtons();
    state.designId = item.id || "";
    state.designName = item.name || "";
    state.interval = Math.max(50, Number(item.interval) || state.interval);
    installLayout(item.layout || Mosaic.normalize());
    restorePages(item.pages || []);
    fitCamera();
    const input = document.getElementById("boardSaveName");
    if (input) input.value = item.name || "";
    state.dirty = false;
    setSaveStatus("已打开");
    renderDesigns();
  }

  async function renameDesign(item) {
    const typed = typeof appPrompt === "function"
      ? await appPrompt("只改名字，灯珠页不动。", { title: "重命名", fieldLabel: "作品名称", value: item.name || "", okLabel: "保存" })
      : window.prompt("作品名称", item.name || "");
    if (typed == null) return;
    const next = String(typed).trim() || item.name;
    const now = Date.now();
    item.name = next;
    item.savedAt = now;
    if (state.designId === item.id) state.designName = next;
    persistDesignsLocal(designsBundle());
    renderDesigns();
    putBoardSaves({ designs: { v: 1, savedAt: now, items: [{ id: item.id, name: next, savedAt: now }] } }).catch((error) => console.warn(error));
  }

  async function deleteDesign(item) {
    const ok = typeof appConfirm === "function"
      ? await appConfirm("从本桌作品里删掉「" + (item.name || "未命名") + "」。", { title: "删除作品", okLabel: "删除" })
      : window.confirm("删除作品？");
    if (!ok) return;
    state.designs = state.designs.filter((row) => row.id !== item.id);
    if (state.designId === item.id) state.designId = "";
    persistDesignsLocal(designsBundle());
    renderDesigns();
    putBoardSaves({ designs: { v: 1, savedAt: Date.now(), items: [], removeIds: [item.id] } }).catch((error) => console.warn(error));
  }

  async function startNewDesign() {
    if (state.dirty) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("当前灯牌还没保存。新建会清空画布。", { title: "新建", okLabel: "新建" })
        : window.confirm("清空当前灯牌？");
      if (!ok) return;
    }
    stopPlay();
    commitHistory();
    installLayout(Mosaic.normalize());
    state.pages = [blankPage()];
    state.page = 0;
    state.designId = "";
    state.designName = "";
    state.mask.fill(0);
    const input = document.getElementById("boardSaveName");
    if (input) input.value = "";
    markDirty();
    drawBoard();
    renderPages();
    renderDesigns();
    fitCamera();
    setSaveStatus("未保存");
  }

  function setDesignEditOn(on) {
    designEditOn = Boolean(on);
    const btn = document.getElementById("btnDesignEdit");
    if (btn) {
      btn.classList.toggle("on", designEditOn);
      btn.setAttribute("aria-pressed", String(designEditOn));
      btn.textContent = designEditOn ? "完成" : "编辑";
    }
    renderDesigns();
  }

  function closeBoardSheets() {
    window.MobileWorkspace?.closeSheet("board-pages");
    window.MobileWorkspace?.closeSheet("board-tools");
  }

  function setBoardPageSheetMode(mode) {
    const sheet = document.getElementById("boardPageSheet");
    if (sheet) sheet.setAttribute("data-sheet-mode", mode);
    const pagesBtn = document.getElementById("btnBoardMobilePages");
    const filesBtn = document.getElementById("btnBoardMobileFiles");
    const open = sheet?.classList.contains("open");
    const works = mode === "works";
    pagesBtn?.classList.toggle("on", Boolean(open && !works));
    filesBtn?.classList.toggle("on", Boolean(open && works));
    pagesBtn?.setAttribute("aria-expanded", String(Boolean(open && !works)));
    filesBtn?.setAttribute("aria-expanded", String(Boolean(open && works)));
  }

  function bindSheets() {
    const pageSheet = window.MobileWorkspace?.registerSheet({
      id: "board-pages",
      root: "#boardPageSheet",
      backdrop: "#boardSheetBackdrop",
      inert: [".board-stage", ".board-app .topbar"],
      mutex: "board-workspace",
      onOpen() {
        setBoardPageSheetMode(document.getElementById("boardPageSheet")?.getAttribute("data-sheet-mode") || "pages");
      },
      onClose() {
        setBoardPageSheetMode(document.getElementById("boardPageSheet")?.getAttribute("data-sheet-mode") || "pages");
      },
    });
    window.MobileWorkspace?.registerSheet({
      id: "board-tools",
      root: "#boardToolSheet",
      trigger: "#btnBoardMobileTools",
      backdrop: "#boardSheetBackdrop",
      inert: [".board-stage", ".board-app .topbar"],
      mutex: "board-workspace",
    });
    [["btnBoardMobilePages", "pages"], ["btnBoardMobileFiles", "works"]].forEach(([id, mode]) => {
      document.getElementById(id)?.addEventListener("click", (event) => {
        const sheet = document.getElementById("boardPageSheet");
        const open = sheet?.classList.contains("open");
        if (open && sheet.getAttribute("data-sheet-mode") === mode) {
          window.MobileWorkspace?.closeSheet("board-pages", { trigger: event.currentTarget });
          return;
        }
        setBoardPageSheetMode(mode);
        if (pageSheet) pageSheet.trigger = event.currentTarget;
        if (!open) window.MobileWorkspace?.openSheet("board-pages", { trigger: event.currentTarget });
        else sheet.querySelector(".board-rail-scroll").scrollTop = 0;
      });
    });
    document.getElementById("btnBoardMobileTools")?.addEventListener("click", () => {
      window.MobileWorkspace?.toggleSheet("board-tools");
    });
    document.getElementById("boardSheetBackdrop")?.addEventListener("click", () => closeBoardSheets());
  }

  function bindUi() {
    document.getElementById("btnUndo")?.addEventListener("click", () => undo());
    document.getElementById("btnRedo")?.addEventListener("click", () => redo());
    document.getElementById("btnBoardMobilePan")?.addEventListener("click", () => setTool(state.tool === "pan" ? "round" : "pan"));
    document.getElementById("btnNewDesign")?.addEventListener("click", () => startNewDesign());
    document.getElementById("btnSaveDesign")?.addEventListener("click", () => {
      const input = document.getElementById("boardSaveName");
      if (input && !input.value) input.value = state.designName || "";
      setModalVisible("dlgBoardSave", true);
      input?.focus();
    });
    document.getElementById("btnBoardSaveOk")?.addEventListener("click", () => saveDesign());
    document.getElementById("btnImportPng")?.addEventListener("click", () => document.getElementById("fileBoardImage")?.click());
    document.getElementById("btnExportPng")?.addEventListener("click", () => exportJpg());
    document.getElementById("btnPreview")?.addEventListener("click", () => showPreview());
    document.getElementById("btnBoardCopy")?.addEventListener("click", () => copyPage());
    document.getElementById("btnBoardClipSelect")?.addEventListener("click", () => {
      const field = document.getElementById("boardClipText");
      if (!field) return;
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      const ok = document.execCommand("copy");
      setSaveStatus(ok ? "已复制，到游戏里粘贴" : "请手动 Ctrl+C");
    });
    document.getElementById("btnPreviewPrev")?.addEventListener("click", () => previewPrev());
    document.getElementById("btnPreviewNext")?.addEventListener("click", () => previewNext());
    document.getElementById("btnPreviewPlay")?.addEventListener("click", () => togglePreviewPlay());
    document.getElementById("previewInterval")?.addEventListener("change", (event) => {
      const next = Math.max(50, Math.min(99999, Number(event.target.value) || state.interval));
      if (next !== state.interval) {
        commitHistory();
        state.interval = next;
        markDirty();
      }
      const pageInterval = document.getElementById("pageInterval");
      if (pageInterval) pageInterval.value = String(state.interval);
      if (previewPlaying) {
        stopPreview();
        togglePreviewPlay();
      }
    });
    document.getElementById("btnFinalize")?.addEventListener("click", () => exportFinalize());
    document.getElementById("btnBoardSmart")?.addEventListener("click", () => openSmartDialog());
    document.getElementById("btnBoardSmartPick")?.addEventListener("click", () => document.getElementById("fileBoardSmart")?.click());
    document.getElementById("btnBoardSmartApply")?.addEventListener("click", async () => {
      if (!smartPage) {
        setSmartStatus("先选择图片或 GIF。");
        return;
      }
      const blank = (smartPages ? state.pages : [currentPage()]).every(page => page.every(value => value === DARK));
      if (!blank) {
        const message = smartPages ? "会用这段 GIF 替换整个拼接作品的动画页，可以撤销恢复。" : "会盖住当前页灯珠。未保存的笔触会被盖住。";
        const ok = typeof appConfirm === "function"
          ? await appConfirm(message, { title: "生成到灯牌", okLabel: "生成" })
          : window.confirm(message);
        if (!ok) return;
      }
      commitSmartPage(document.getElementById("boardSmartStatus")?.textContent || "已生成");
    });
    document.getElementById("fileBoardSmart")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await analyzeSmartFile(file);
    });
    ["smartMode", "smartSampling", "smartBackground", "smartCrop"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => refreshSmartResult());
    });
    document.getElementById("btnSmartFramePrev").addEventListener("click", () => { stopSmartPreview(); showSmartFrame(smartFrame - 1); });
    document.getElementById("btnSmartFrameNext").addEventListener("click", () => { stopSmartPreview(); showSmartFrame(smartFrame + 1); });
    document.getElementById("btnSmartFramePlay").addEventListener("click", event => {
      if (smartPreviewTimer) { stopSmartPreview(); return; }
      if (!smartPages || smartPages.length < 2) return;
      event.currentTarget.textContent = "暂停";
      event.currentTarget.setAttribute("aria-pressed", "true");
      smartPreviewTimer = setInterval(() => {
        if (document.getElementById("dlgBoardSmart").hidden) { stopSmartPreview(); return; }
        showSmartFrame(smartFrame + 1);
      }, smartAnimation.interval);
    });
    document.getElementById("btnDesignEdit")?.addEventListener("click", () => setDesignEditOn(!designEditOn));
    document.getElementById("btnPlayPages")?.addEventListener("click", () => togglePlay());
    document.getElementById("btnPrevPage")?.addEventListener("click", () => goToPage(state.page - 1));
    document.getElementById("btnNextPage")?.addEventListener("click", () => goToPage(state.page + 1));
    document.getElementById("pageInterval")?.addEventListener("change", (event) => {
      const next = Math.max(50, Math.min(99999, Number(event.target.value) || 1000));
      if (next === state.interval) return;
      const wasPlaying = playing;
      commitHistory();
      state.interval = next;
      event.target.value = String(next);
      markDirty();
      if (wasPlaying) {
        togglePlay();
      }
    });
    document.querySelectorAll("[data-board-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.boardPage;
        if (action === "add") addPage();
        if (action === "copy") copyPage({ teach: false });
        if (action === "paste") pastePage();
        if (action === "copy-all") copyAllPages();
        if (action === "paste-all") pasteAllPages();
        if (action === "del") deletePage();
        if (action === "fill") fillPage();
        if (action === "clear") clearPage();
      });
    });
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => setModalVisible(button.dataset.closeModal, false));
    });
    document.getElementById("designSearch")?.addEventListener("input", () => renderDesigns());
    document.getElementById("fileBoardImage")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        try {
          await importImageFile(file);
        } catch (error) {
          if (typeof appAlert === "function") appAlert(String(error.message || error), { title: "导入失败" });
        }
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (event.shiftKey) copyAllPages();
        else copyPage({ teach: false });
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteAllPages();
      }
      if (event.key === "Delete") deletePage();
      if (TOOL_KEYS[event.key]) setTool(TOOL_KEYS[event.key]);
    });
    document.addEventListener("paste", (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      const text = event.clipboardData?.getData("text");
      if (!text) return;
      event.preventDefault();
      pastePage(text);
    });
    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", onPointerUp);
    board.addEventListener("pointercancel", onPointerUp);
    board.addEventListener("contextmenu", (event) => event.preventDefault());
    board.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });
    board.addEventListener("lostpointercapture", onPointerUp);
    window.addEventListener("resize", () => fitCamera());
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
        Promise.resolve(saveSession()).catch(() => {}).finally(() => window.location.assign(href));
      });
    });
  }

  async function boot() {
    window.MobileWorkspace?.init();
    window.MobileWorkspace?.enhanceModals?.();
    mosaicUi = window.BoardMosaicUI({
      state, canvas, board, view, currentPage, drawGrid, drawBoard, renderPages, fitCamera, applyCamera, closeBoardSheets,
      openSmartDialog, encodePageClip, encodeAllClip, setSaveStatus, setModalVisible, sessionSnapshot,
      setDraftLayout(layout) { smartLayout = Mosaic.normalize(layout); return refreshSmartResult(); },
      editLayout() { smartRequest++; smartFileState = "idle"; smartImage = null; setSmartAnimation(null); openSmartDialog(); },
    });
    bindSheets();
    bindUi();
    fillTools();
    fillPalette();
    syncHistoryButtons();
    setTool("round");
    const [spec, remote] = await Promise.all([
      fetch("/data/board_native.json", { credentials: "same-origin", cache: "no-store" }).then((res) => res.ok ? res.json() : null).catch(() => null),
      fetchBoardSaves(),
    ]);
    if (Array.isArray(spec?.palette) && spec.palette.length) state.palette = spec.palette;
    if (Number(spec?.defaultIntervalMs)) state.interval = Number(spec.defaultIntervalMs);
    fillPalette();
    let localDesigns = { items: [] };
    try {
      localDesigns = JSON.parse(deskGet(DESIGNS_KEY) || "null") || { items: [] };
    } catch {
      localDesigns = { items: [] };
    }
    const merged = mergeDesigns(localDesigns, remote?.designs);
    state.designs = merged.items || [];
    persistDesignsLocal({ v: 1, savedAt: merged.savedAt || Date.now(), items: state.designs });
    let localSession = null;
    try {
      localSession = JSON.parse(deskGet(SESSION_KEY) || "null");
    } catch {
      localSession = null;
    }
    const session = ((Number(localSession?.savedAt) || 0) >= (Number(remote?.session?.savedAt) || 0) ? localSession : remote?.session) || localSession;
    if (session && Array.isArray(session.pages) && session.pages.length) {
      state.tool = TOOLS.some((tool) => tool.id === session.tool) ? session.tool : state.tool;
      state.color = Number.isFinite(session.color) ? session.color : state.color;
      state.interval = Math.max(50, Number(session.interval) || state.interval);
      state.designId = session.designId || "";
      state.designName = session.designName || "";
      state.page = Number(session.page) || 0;
      installLayout(session.layout || Mosaic.normalize(), session.tile);
      restorePages(session.pages);
      setTool(state.tool);
      setColor(state.color);
      const nameInput = document.getElementById("boardSaveName");
      if (nameInput) nameInput.value = state.designName || "";
      state.dirty = false;
      setSaveStatus("已打开");
    } else {
      drawBoard();
      renderPages();
    }
    renderDesigns();
    fitCamera();
    const push = {};
    const remoteIds = new Set((remote?.designs?.items || []).map((row) => row?.id).filter(Boolean));
    const extra = (merged.items || []).filter((row) => row?.id && (row.pages || row.png) && !remoteIds.has(row.id));
    if (extra.length) push.designs = { v: 1, savedAt: merged.savedAt || Date.now(), items: extra };
    if (Object.keys(push).length) putBoardSaves(push).catch((error) => console.warn(error));
    window.MobileWorkspace?.onModeChange(() => fitCamera());
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
  }

  highlight.decoding = "async";
  highlight.onload = onHighlightReady;
  highlight.src = HIGHLIGHT_URL;
  if (highlight.complete && highlight.naturalWidth) onHighlightReady();

  boot().catch((error) => {
    console.error(error);
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
  });
})();
