(function boardDesk() {
  "use strict";

  const SESSION_KEY = "manor-board-session-v1";
  const DESIGNS_KEY = "manor-board-designs-v1";
  const AI_KEY = "manor-board-ai-v1";
  const PROMPTS_KEY = "manor-board-prompts-v1";
  const KIND = "billboard-hd";
  const COLS = 36;
  const ROWS = 24;
  const CELL = 18;
  const MAX_PAGES = 10;
  const DARK = 50;
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
  const SIZE_MAX = 6;
  const AI_SIZE = [720, 480];
  const OPENROUTEX = "https://api.openroutex.top/v1";
  const TOOLS = [
    { id: "pencil", label: "细笔", glyph: "·" },
    { id: "round", label: "圆笔", glyph: "●" },
    { id: "spray", label: "喷点", glyph: "◌" },
    { id: "eraser", label: "关灯", glyph: "⌫" },
    { id: "line", label: "直线", glyph: "/" },
    { id: "fill", label: "填充", glyph: "▣" },
    { id: "eyedrop", label: "吸色", glyph: "◎" },
    { id: "patch", label: "圈选", glyph: "◍" },
    { id: "pan", label: "画布", glyph: "✥" },
  ];
  const TOOL_KEYS = { 1: "pencil", 2: "round", 3: "spray", 4: "eraser", 5: "line", 6: "fill", 7: "eyedrop", 8: "patch", 9: "pan" };

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
    size: 1,
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
    palette: defaultPalette(),
    mask: new Uint8Array(COLS * ROWS),
    aiKey: "",
    aiModel: "",
    aiModels: [],
    aiPromptId: "",
    promptDefaults: [],
    prompts: [],
    promptDeletedIds: [],
    aiRefs: [],
    aiRefMode: "none",
    aiRefId: "",
    aiRefUploadName: "",
  };

  const pointers = new Map();
  let painting = false;
  let strokeDirty = false;
  let lastCell = null;
  let lineStart = null;
  let aiRefUploadPng = null;
  let gesture = null;
  let pageClipboard = null;
  let playing = false;
  let playTimer = 0;
  let previewTimer = 0;
  let previewPage = 0;
  let previewPlaying = false;
  let generateBusy = false;
  let saveDesignBusy = false;
  let designEditOn = false;
  let nativeSpec = null;
  let smartPage = null;

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

  function blankPage() {
    return new Uint8Array(COLS * ROWS).fill(DARK);
  }

  function clonePage(page) {
    return new Uint8Array(page);
  }

  function currentPage() {
    return state.pages[state.page] || state.pages[0];
  }

  function cellIndex(x, y) {
    return y * COLS + x;
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
    const cells = page || currentPage();
    const parts = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (i) parts.push(",");
      if (cells[i] >= 0) parts.push(gboxItoa(cells[i]));
    }
    return parts.join("");
  }

  function decodePageClip(text) {
    const page = blankPage();
    const tokens = String(text || "").split(",");
    for (let i = 0; i < Math.min(page.length, tokens.length); i += 1) {
      const value = gboxAtoi(tokens[i]);
      page[i] = value < 0 || value > DARK ? DARK : value;
    }
    return page;
  }

  function encodeAllClip(pages) {
    const rows = (pages || state.pages).slice(0, MAX_PAGES);
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
    if (typeof appAlert === "function") appAlert(message, { title: "复制到游戏", okLabel: "去游戏粘贴" });
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
    const text = encodePageClip(currentPage());
    pageClipboard = clonePage(currentPage());
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
      if (typeof appAlert === "function") appAlert("剪贴板里没有灯珠页。先在本桌点「复制到游戏」，或在游戏里复制。", { title: "无法粘贴" });
      return;
    }
    commitHistory();
    applyPage(page);
  }

  async function copyAllPages(options = {}) {
    const text = encodeAllClip(state.pages);
    pageClipboard = clonePage(currentPage());
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
    currentPage().set(page);
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
    state.dirty = true;
    setSaveStatus("未保存");
  }

  function pageSnapshot() {
    return state.pages.map((page) => Array.from(page));
  }

  function commitHistory() {
    state.history.push(pageSnapshot());
    if (state.history.length > 80) state.history.shift();
    state.redo = [];
  }

  function restorePages(pages) {
    state.pages = (pages || []).map((page) => {
      const next = blankPage();
      const src = page || [];
      for (let i = 0; i < Math.min(next.length, src.length); i += 1) {
        const value = Number(src[i]);
        next[i] = Number.isFinite(value) ? Math.max(0, Math.min(DARK, value | 0)) : DARK;
      }
      return next;
    });
    if (!state.pages.length) state.pages = [blankPage()];
    if (state.pages.length > MAX_PAGES) state.pages = state.pages.slice(0, MAX_PAGES);
    state.page = Math.max(0, Math.min(state.page, state.pages.length - 1));
    drawBoard();
    renderPages();
  }

  function undo() {
    if (!state.history.length) return;
    state.redo.push(pageSnapshot());
    restorePages(state.history.pop());
    markDirty();
  }

  function redo() {
    if (!state.redo.length) return;
    state.history.push(pageSnapshot());
    restorePages(state.redo.pop());
    markDirty();
  }

  function fitCamera() {
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const zoom = Math.max(0.2, Math.min(rect.width / canvas.width, rect.height / canvas.height) * 0.92);
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
  }

  function boardPoint(event) {
    const rect = board.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.panX) / state.zoom,
      y: (event.clientY - rect.top - state.panY) / state.zoom,
    };
  }

  function cellFromPoint(point) {
    const x = Math.floor(point.x / CELL);
    const y = Math.floor(point.y / CELL);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x, y };
  }

  function drawBulb(target, x, y, frame, masked) {
    if (frame < 0) return;
    const dx = x * CELL;
    const dy = y * CELL;
    if (highlightReady) {
      const { sx, sy } = spriteOrigin(frame);
      target.drawImage(highlight, sx, sy, CELL, CELL, dx, dy, CELL, CELL);
    } else {
      const [r, g, b] = colorOf(frame);
      target.fillStyle = `rgb(${r},${g},${b})`;
      target.fillRect(dx + 2, dy + 2, CELL - 4, CELL - 4);
    }
    if (masked) {
      target.fillStyle = "rgba(226, 72, 128, 0.45)";
      target.fillRect(dx, dy, CELL, CELL);
    }
  }

  function drawGrid(target, page, mask) {
    target.imageSmoothingEnabled = false;
    target.fillStyle = "#000000";
    target.fillRect(0, 0, COLS * CELL, ROWS * CELL);
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const index = cellIndex(x, y);
        drawBulb(target, x, y, page[index], mask && mask[index]);
      }
    }
  }

  function drawBoard() {
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    drawGrid(ctx, currentPage(), state.mask);
    const label = document.getElementById("canvasSizeLabel");
    if (label) label.textContent = `${COLS}×${ROWS}`;
    const pageLabel = document.getElementById("designerLabel");
    if (pageLabel && state.tool !== "patch") {
      pageLabel.textContent = `第 ${state.page + 1}/${state.pages.length} 页`;
    }
  }

  function snapshotJpg(page) {
    const scratch = document.createElement("canvas");
    scratch.width = COLS * CELL;
    scratch.height = ROWS * CELL;
    const sctx = scratch.getContext("2d", { alpha: false });
    sctx.imageSmoothingEnabled = false;
    drawGrid(sctx, page || currentPage(), null);
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

  function setBrushSize(size) {
    state.size = Math.max(1, Math.min(SIZE_MAX, Math.round(Number(size) || 1)));
    const input = document.getElementById("brushSize");
    if (input) input.value = String(state.size);
    const label = document.getElementById("brushSizeLabel");
    if (label) label.textContent = String(state.size);
    document.querySelectorAll("#sizePresets [data-size]").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.size) === state.size);
    });
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
    const patch = document.getElementById("boardAiPatch");
    if (patch && ink && document.getElementById("dlgBoardAi") && !document.getElementById("dlgBoardAi").hidden) {
      patch.checked = true;
    }
    const label = document.getElementById("designerLabel");
    if (label) {
      if (state.tool === "patch") label.textContent = ink ? "涂要改的灯珠 · Shift 擦掉" : "涂要改的灯珠";
      else label.textContent = `第 ${state.page + 1}/${state.pages.length} 页`;
    }
    const generate = document.getElementById("btnBoardAiGenerate");
    if (generate && !generateBusy && generate.getAttribute("aria-busy") !== "true") {
      generate.textContent = patch?.checked && ink ? "只改圈选" : "生成到灯牌";
    }
  }

  function stampCell(x, y, frame, maskOnly, eraseMask) {
    const radius = state.tool === "pencil" ? 0 : Math.max(0, state.size - 1);
    const page = currentPage();
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius + 0.2) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
        const index = cellIndex(cx, cy);
        if (maskOnly) state.mask[index] = eraseMask ? 0 : 1;
        else page[index] = frame;
      }
    }
  }

  function sprayCell(x, y, frame) {
    const page = currentPage();
    const dots = Math.max(4, state.size * 6);
    for (let i = 0; i < dots; i += 1) {
      const cx = x + Math.round((Math.random() * 2 - 1) * state.size);
      const cy = y + Math.round((Math.random() * 2 - 1) * state.size);
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
      page[cellIndex(cx, cy)] = frame;
    }
  }

  function floodFill(x, y, frame) {
    const page = currentPage();
    const start = cellIndex(x, y);
    const target = page[start];
    if (target === frame) return;
    const stack = [x, y];
    const seen = new Uint8Array(COLS * ROWS);
    while (stack.length) {
      const cy = stack.pop();
      const cx = stack.pop();
      const id = cellIndex(cx, cy);
      if (seen[id] || page[id] !== target) continue;
      seen[id] = 1;
      page[id] = frame;
      if (cx > 0) stack.push(cx - 1, cy);
      if (cx + 1 < COLS) stack.push(cx + 1, cy);
      if (cy > 0) stack.push(cx, cy - 1);
      if (cy + 1 < ROWS) stack.push(cx, cy + 1);
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
    if (state.tool === "fill") {
      paintAt(cell, event);
      commitHistory();
      markDirty();
      drawBoard();
      return;
    }
    if (state.tool === "line") {
      lineStart = cell;
      painting = true;
      strokeDirty = true;
      return;
    }
    painting = true;
    lastCell = cell;
    strokeDirty = true;
    paintAt(cell, event);
    markDirty();
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
    markDirty();
    drawBoard();
  }

  function endPaint(event) {
    if (state.tool === "line" && painting && lineStart) {
      const cell = cellFromPoint(boardPoint(event));
      if (cell) {
        drawLineCells(lineStart, cell, state.tool === "eraser" || event.button === 2 ? DARK : state.color, false, false);
        markDirty();
        drawBoard();
      }
    }
    if (strokeDirty) commitHistory();
    strokeDirty = false;
    painting = false;
    lastCell = null;
    lineStart = null;
    if (state.tool === "patch") syncMaskChrome();
  }

  function pointerCount() {
    return pointers.size;
  }

  function beginGesture() {
    const pts = [...pointers.values()];
    if (strokeDirty) commitHistory();
    strokeDirty = false;
    painting = false;
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
    const nextZoom = Math.min(12, Math.max(0.2, gesture.zoom * (dist / gesture.dist)));
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
    if (event.button === 2) event.preventDefault();
    board.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerCount() >= 2) {
      beginGesture();
      return;
    }
    if (state.tool === "pan") {
      gesture = { pan: true, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
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
      commitHistory();
      state.pages[0] = blankPage();
      markDirty();
      drawBoard();
      renderPages();
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
    state.pages = pages.slice(0, MAX_PAGES).map((page) => {
      const next = blankPage();
      next.set(page);
      return next;
    });
    if (!state.pages.length) state.pages = [blankPage()];
    state.page = 0;
    markDirty();
    drawBoard();
    renderPages();
  }

  function fillPage() {
    commitHistory();
    currentPage().fill(state.color);
    markDirty();
    drawBoard();
    renderPages();
  }

  function clearPage() {
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

  function analyzeImage(image) {
    const source = rasterizeImage(image);
    if (window.BoardImage?.analyze) {
      return window.BoardImage.analyze(source, state.palette, { cols: COLS, rows: ROWS, dark: DARK });
    }
    return { page: Array.from(quantizeImage(image)), mode: "photo", message: "已按灯珠取样。" };
  }

  function drawSmartPreview(page) {
    const canvas = document.getElementById("smartPreview");
    if (!canvas || !page) return;
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = false;
    drawGrid(context, page, null);
    canvas.hidden = false;
  }

  function setSmartStatus(text) {
    const node = document.getElementById("boardSmartStatus");
    if (node) node.textContent = text || "";
  }

  function openSmartDialog() {
    closeBoardSheets();
    setModalVisible("dlgBoardAi", false);
    setModalVisible("dlgBoardSmart", true);
    if (!smartPage) setSmartStatus("还没选图");
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
    currentPage().set(smartPage);
    markDirty();
    drawBoard();
    renderPages();
    setSaveStatus(message || "已生成");
    setModalVisible("dlgBoardSmart", false);
  }

  async function analyzeSmartFile(file) {
    if (!file) return;
    const name = String(file.name || "").toLowerCase();
    if (!/\.(png|jpe?g)$/.test(name) && !/^image\/(png|jpeg)$/.test(file.type || "")) {
      setSmartStatus("只接受 PNG 或 JPG。");
      return;
    }
    setSmartStatus("正在认格子和色系…");
    try {
      const image = await loadImageFile(file);
      applySmartResult(analyzeImage(image));
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

  function loadDataUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片打不开"));
      image.src = url;
    });
  }

  async function importImageFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".ale") || name.endsWith(".json") || name.endsWith(".gif")) {
      await importGameFile(file);
      return;
    }
    const image = await loadImageFile(file);
    applySmartResult(analyzeImage(image), { commit: true });
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
      commitHistory();
      restorePages(pages);
      if (Number(payload.interval)) state.interval = Math.max(50, Math.min(60000, Number(payload.interval)));
      const interval = document.getElementById("pageInterval");
      if (interval) interval.value = String(state.interval);
      markDirty();
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
    restorePages(pages);
    markDirty();
  }

  function exportJpg(name) {
    const a = document.createElement("a");
    a.href = snapshotJpg();
    a.download = (name || state.designName || "广告牌") + ".jpg";
    a.click();
  }

  async function exportFinalize() {
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
          pages: pageSnapshot(),
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
    if (id === "dlgBoardAi" || id === "dlgBoardPreview" || id === "dlgBoardSmart" || id === "dlgBoardClip") {
      document.querySelector(".board-workspace")?.toggleAttribute("inert", !!visible);
      document.querySelector(".board-app .topbar")?.toggleAttribute("inert", !!visible);
    }
    if (id === "dlgBoardPreview" && !visible) stopPreview();
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
      previewCanvas.width = COLS * CELL;
      previewCanvas.height = ROWS * CELL;
    }
    drawGrid(previewCtx, state.pages[previewPage] || currentPage(), null);
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

  function sanitizeAiPrompt(text) {
    return String(text || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/20\d{12,}[A-Za-z0-9_-]*(?:\.(?:jpe?g|png|webp|gif))?[)\]\}]*/gi, "")
      .replace(/\b[A-Za-z0-9_-]{16,}\.(?:jpe?g|png|webp|gif)[)\]\}]*/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[)\]\}]+$/g, "")
      .trim();
  }

  function readAiPrompt() {
    const textarea = document.getElementById("boardAiPrompt");
    const cleaned = sanitizeAiPrompt(textarea?.value || "");
    if (textarea && textarea.value !== cleaned) textarea.value = cleaned;
    return cleaned;
  }

  function setAiPrompt(text) {
    const textarea = document.getElementById("boardAiPrompt");
    if (textarea) textarea.value = sanitizeAiPrompt(text);
  }

  function setGenerateBusy(busy) {
    generateBusy = Boolean(busy);
    const button = document.getElementById("btnBoardAiGenerate");
    if (!button) return;
    button.disabled = generateBusy;
    button.setAttribute("aria-busy", generateBusy ? "true" : "false");
    button.classList.toggle("is-generating", generateBusy);
    if (generateBusy) button.textContent = "生成中";
    else syncMaskChrome();
  }

  function friendlyAiStatus(text) {
    const cleaned = sanitizeAiPrompt(String(text || ""));
    if (!cleaned) return "";
    if (/quota|not enough/i.test(cleaned)) return "额度不足，换 Key 或稍后再试。";
    if (/timeout|timed?\s*out|ECONN|network/i.test(cleaned)) return "网络超时，稍后再试。";
    if (/api\s*key|unauthorized|401|invalid.+key/i.test(cleaned)) return "API Key 无效，去设置里检查。";
    return cleaned.length > 160 ? cleaned.slice(0, 157) + "…" : cleaned;
  }

  function setAiStatus(text) {
    document.querySelectorAll("[data-ai-status]").forEach((node) => {
      node.textContent = friendlyAiStatus(text);
    });
  }

  function setAiTab(tab) {
    document.querySelectorAll("[data-ai-tab]").forEach((button) => {
      const on = button.dataset.aiTab === tab;
      button.classList.toggle("on", on);
      button.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll("[data-ai-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.aiPane !== tab;
    });
  }

  function selectedPrompt() {
    return kindPrompts().find((row) => row.id === state.aiPromptId) || kindPrompts()[0] || null;
  }

  function kindPrompts() {
    const deleted = new Set(state.promptDeletedIds || []);
    const byId = new Map();
    (state.promptDefaults || []).forEach((row) => {
      if (row.kind !== KIND || deleted.has(row.id)) return;
      byId.set(row.id, { ...row, builtin: true });
    });
    (state.prompts || []).forEach((row) => {
      if (!row || row.kind !== KIND) return;
      if (row.deleted || deleted.has(row.id)) {
        byId.delete(row.id);
        return;
      }
      byId.set(row.id, { ...row, builtin: false });
    });
    return [...byId.values()];
  }

  function fillAiPromptPick() {
    const pick = document.getElementById("boardAiPromptPick");
    if (!pick) return;
    const rows = kindPrompts();
    pick.replaceChildren();
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.name;
      pick.append(option);
    });
    if (!rows.some((row) => row.id === state.aiPromptId)) state.aiPromptId = rows[0]?.id || "";
    pick.value = state.aiPromptId;
    const current = selectedPrompt();
    if (current && !readAiPrompt()) setAiPrompt(current.prompt);
  }

  function fillAiModels() {
    const select = document.getElementById("boardAiModel");
    if (!select) return;
    const models = state.aiModels.length ? state.aiModels : (state.aiModel ? [state.aiModel] : []);
    select.replaceChildren();
    models.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      select.append(option);
    });
    if (state.aiModel) select.value = state.aiModel;
  }

  function currentAiRef() {
    return (state.aiRefs || []).find((row) => row.id === state.aiRefId) || state.aiRefs[0] || null;
  }

  function fillAiRefGrid() {
    const grid = document.getElementById("boardAiRefGrid");
    if (!grid) return;
    grid.replaceChildren();
    const selected = currentAiRef();
    if (selected) state.aiRefId = selected.id;
    (state.aiRefs || []).forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-ai-ref-card" + (row.id === state.aiRefId ? " on" : "");
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(row.id === state.aiRefId));
      const img = document.createElement("img");
      img.alt = row.name;
      img.src = row.url;
      const label = document.createElement("span");
      label.textContent = row.name;
      button.append(img, label);
      button.addEventListener("click", () => {
        state.aiRefId = row.id;
        if (row.promptId && !readAiPrompt()) {
          const prompt = kindPrompts().find((item) => item.id === row.promptId);
          if (prompt) {
            state.aiPromptId = prompt.id;
            setAiPrompt(prompt.prompt);
            fillAiPromptPick();
          }
        }
        fillAiRefGrid();
        saveAiSettings();
      });
      grid.append(button);
    });
  }

  function syncAiRefChrome() {
    const mode = state.aiRefMode === "template" || state.aiRefMode === "upload" ? state.aiRefMode : "none";
    state.aiRefMode = mode;
    document.querySelectorAll("[data-ai-ref]").forEach((button) => {
      const on = button.dataset.aiRef === mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    const grid = document.getElementById("boardAiRefGrid");
    const upload = document.getElementById("boardAiRefUpload");
    if (grid) grid.hidden = mode !== "template";
    if (upload) upload.hidden = mode !== "upload";
    const preview = document.getElementById("boardAiRefPreview");
    const name = document.getElementById("boardAiRefUploadName");
    const clear = document.getElementById("btnBoardAiRefClear");
    if (name) name.textContent = aiRefUploadPng ? (state.aiRefUploadName || "已选参考图") : "还没选图";
    if (preview) {
      preview.hidden = !aiRefUploadPng;
      if (aiRefUploadPng) preview.src = aiRefUploadPng;
    }
    if (clear) clear.hidden = !aiRefUploadPng;
    fillAiRefGrid();
  }

  function setAiRefMode(mode) {
    state.aiRefMode = mode === "template" || mode === "upload" ? mode : "none";
    syncAiRefChrome();
    saveAiSettings();
  }

  function imageToAiPng(image) {
    const scratch = document.createElement("canvas");
    scratch.width = AI_SIZE[0];
    scratch.height = AI_SIZE[1];
    const sctx = scratch.getContext("2d", { alpha: false });
    sctx.fillStyle = "#0c0f14";
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    const scale = Math.min(scratch.width / image.width, scratch.height / image.height);
    const dw = Math.max(1, Math.round(image.width * scale));
    const dh = Math.max(1, Math.round(image.height * scale));
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(image, Math.round((scratch.width - dw) / 2), Math.round((scratch.height - dh) / 2), dw, dh);
    return scratch.toDataURL("image/png");
  }

  async function urlToAiPng(url) {
    const image = await loadDataUrl(url);
    return imageToAiPng(image);
  }

  async function setAiRefUpload(file) {
    if (!file) return;
    const name = String(file.name || "").toLowerCase();
    if (!/\.(png|jpe?g)$/.test(name) && !/^image\/(png|jpeg)$/.test(file.type || "")) {
      setAiStatus("只接受 PNG 或 JPG。");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setAiStatus("图片超过 8MB，换一张小一点的。");
      return;
    }
    const image = await loadImageFile(file);
    aiRefUploadPng = imageToAiPng(image);
    state.aiRefUploadName = String(file.name || "参考图");
    state.aiRefMode = "upload";
    syncAiRefChrome();
    setAiStatus("已选「" + state.aiRefUploadName + "」，生成时会带上。");
  }

  function clearAiRefUpload() {
    aiRefUploadPng = null;
    state.aiRefUploadName = "";
    const input = document.getElementById("fileBoardAiRef");
    if (input) input.value = "";
    syncAiRefChrome();
    saveAiSettings();
  }

  async function aiReferencePng() {
    if (state.aiRefMode === "upload") return aiRefUploadPng || null;
    if (state.aiRefMode === "template") {
      const row = currentAiRef();
      if (!row?.url) return null;
      return urlToAiPng(row.url);
    }
    return null;
  }

  function syncAiDialog() {
    const key = document.getElementById("boardAiKey");
    if (key) key.value = state.aiKey || "";
    const custom = document.getElementById("boardAiModelCustom");
    if (custom && !state.aiModels.includes(state.aiModel)) custom.value = state.aiModel || "";
    fillAiModels();
    fillAiPromptPick();
    syncAiRefChrome();
    syncMaskChrome();
  }

  function openAiDialog() {
    closeBoardSheets();
    setModalVisible("dlgBoardSmart", false);
    setAiTab("prompt");
    syncAiDialog();
    readAiPrompt();
    setAiStatus("");
    setModalVisible("dlgBoardAi", true);
  }

  async function refreshAiModels() {
    const key = String(document.getElementById("boardAiKey")?.value || "").trim();
    if (!key) {
      setAiTab("settings");
      setAiStatus("先填 API Key，再刷新模型。");
      return;
    }
    state.aiKey = key;
    saveAiSettings();
    setAiStatus("正在拉取图片模型…");
    try {
      const res = await fetch("/api/board-ai/models", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, baseUrl: OPENROUTEX }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ("HTTP " + res.status));
      state.aiModels = payload.models || [];
      if (state.aiModel && state.aiModels.includes(state.aiModel)) {
        /* keep */
      } else if (state.aiModels.includes("gpt-image-2")) {
        state.aiModel = "gpt-image-2";
      } else {
        state.aiModel = state.aiModels[0] || "";
      }
      fillAiModels();
      saveAiSettings();
      setAiStatus(state.aiModels.length ? "已列出 " + state.aiModels.length + " 个图片模型。" : "没有图片模型，可手填。");
    } catch (error) {
      setAiStatus(String(error.message || error));
    }
  }

  async function saveCurrentPrompt() {
    const text = readAiPrompt();
    if (!text) {
      setAiStatus("编辑框是空的，没法保存。");
      return;
    }
    const current = selectedPrompt();
    let name = current?.name || "广告牌模板";
    if (!current || current.builtin) {
      const typed = typeof appPrompt === "function"
        ? await appPrompt("会保存到广告牌提示词列表。选中只填进编辑框。", {
          title: current ? "另存提示词模板" : "新建提示词模板",
          fieldLabel: "模板名称",
          value: name,
          okLabel: "保存",
        })
        : window.prompt("模板名称", name);
      if (typed == null) return;
      name = String(typed).trim() || name;
    }
    const item = {
      id: current && !current.builtin ? current.id : `p${Date.now().toString(36)}`,
      kind: KIND,
      name,
      prompt: text,
      savedAt: Date.now(),
    };
    state.prompts = [...(state.prompts || []).filter((row) => row.id !== item.id), item];
    state.aiPromptId = item.id;
    savePrompts();
    fillAiPromptPick();
    setAiStatus("已保存「" + name + "」。");
  }

  async function createPromptTemplate() {
    const typed = typeof appPrompt === "function"
      ? await appPrompt("新建后出现在下拉框里。选中只填入编辑框。", {
        title: "新建提示词模板",
        fieldLabel: "模板名称",
        value: "广告牌模板",
        okLabel: "新建",
      })
      : window.prompt("模板名称", "广告牌模板");
    if (typed == null) return;
    state.aiPromptId = "";
    setAiPrompt("");
    const item = {
      id: `p${Date.now().toString(36)}`,
      kind: KIND,
      name: String(typed).trim() || "广告牌模板",
      prompt: "",
      savedAt: Date.now(),
    };
    state.prompts = [...(state.prompts || []), item];
    state.aiPromptId = item.id;
    savePrompts();
    fillAiPromptPick();
    setAiStatus("已新建「" + item.name + "」。");
  }

  async function deletePromptTemplate() {
    const current = selectedPrompt();
    if (!current) return;
    const ok = typeof appConfirm === "function"
      ? await appConfirm(current.builtin ? "会从列表里藏起这份默认模板。" : "删除这份提示词模板？", { title: "删除模板", okLabel: "删除" })
      : window.confirm("删除模板？");
    if (!ok) return;
    if (current.builtin) {
      state.promptDeletedIds = [...new Set([...(state.promptDeletedIds || []), current.id])];
    } else {
      state.prompts = (state.prompts || []).filter((row) => row.id !== current.id);
    }
    state.aiPromptId = "";
    savePrompts();
    fillAiPromptPick();
    const next = selectedPrompt();
    setAiPrompt(next?.prompt || "");
    setAiStatus("已删除。");
  }

  function resetKindPrompts() {
    state.promptDeletedIds = (state.promptDeletedIds || []).filter((id) => !String(id).includes("billboard-hd"));
    state.prompts = (state.prompts || []).filter((row) => row.kind !== KIND);
    state.aiPromptId = "";
    savePrompts();
    fillAiPromptPick();
    const next = selectedPrompt();
    setAiPrompt(next?.prompt || "");
    setAiStatus("已恢复默认模板。");
  }

  function exportMaskPng() {
    if (!maskHasInk()) return null;
    const scratch = document.createElement("canvas");
    scratch.width = AI_SIZE[0];
    scratch.height = AI_SIZE[1];
    const sctx = scratch.getContext("2d");
    const cellW = AI_SIZE[0] / COLS;
    const cellH = AI_SIZE[1] / ROWS;
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    sctx.fillStyle = "#fff";
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!state.mask[cellIndex(x, y)]) continue;
        sctx.fillRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
    return scratch.toDataURL("image/png");
  }

  function referencePng() {
    const scratch = document.createElement("canvas");
    scratch.width = AI_SIZE[0];
    scratch.height = AI_SIZE[1];
    const sctx = scratch.getContext("2d", { alpha: false });
    sctx.imageSmoothingEnabled = false;
    const led = document.createElement("canvas");
    led.width = COLS * CELL;
    led.height = ROWS * CELL;
    drawGrid(led.getContext("2d", { alpha: false }), currentPage(), null);
    sctx.drawImage(led, 0, 0, AI_SIZE[0], AI_SIZE[1]);
    return scratch.toDataURL("image/png");
  }

  async function generateAiDesign() {
    if (generateBusy) return;
    setGenerateBusy(true);
    setAiStatus("生成中…");
    readAiPrompt();
    await nextPaint();
    try {
      const key = String(document.getElementById("boardAiKey")?.value || "").trim();
      const custom = String(document.getElementById("boardAiModelCustom")?.value || "").trim();
      const model = custom || String(document.getElementById("boardAiModel")?.value || "").trim();
      const prompt = readAiPrompt();
      if (!key) {
        setAiTab("settings");
        setAiStatus("先填 API Key。");
        return;
      }
      if (!model) {
        setAiTab("settings");
        setAiStatus("先选或手填一个图片模型。");
        return;
      }
      if (!prompt) {
        setAiStatus("提示词是空的。可以先选一份模板再改。");
        return;
      }
      const patchOn = Boolean(document.getElementById("boardAiPatch")?.checked);
      const maskPng = patchOn ? exportMaskPng() : null;
      if (patchOn && !maskPng) {
        setAiStatus("先用笔触里的「圈选」涂要改的灯珠，再勾「只改圈选灯珠」。");
        return;
      }
      if (state.dirty && !maskPng) {
        const ok = typeof appConfirm === "function"
          ? await appConfirm("生成结果会压到当前页灯珠上。未保存的笔触会被盖住。", { title: "生成到灯牌", okLabel: "生成" })
          : window.confirm("生成会盖住当前页，继续？");
        if (!ok) {
          setAiStatus("");
          return;
        }
        setGenerateBusy(true);
        setAiStatus("生成中…");
        await nextPaint();
      }
      state.aiKey = key;
      state.aiModel = model;
      saveAiSettings();
      setGenerateBusy(true);
      setAiStatus("正在生成，可能要等一会儿…");
      let refPng = null;
      if (maskPng) {
        refPng = referencePng();
      } else {
        try {
          refPng = await aiReferencePng();
        } catch (error) {
          console.warn(error);
        }
        if (state.aiRefMode === "upload" && !refPng) {
          setAiStatus("先选一张 PNG 或 JPG。");
          return;
        }
        if (state.aiRefMode === "template" && !refPng) {
          setAiStatus("参考模板没加载到。");
          return;
        }
      }
      const res = await fetch("/api/board-ai/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key,
          model,
          prompt,
          kind: KIND,
          width: AI_SIZE[0],
          height: AI_SIZE[1],
          referencePng: refPng,
          maskPng,
          baseUrl: OPENROUTEX,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ("HTTP " + res.status));
      if (!payload.png) throw new Error("没有返回图片");
      const image = await loadDataUrl(payload.png);
      const quantized = quantizeImage(image);
      commitHistory();
      if (maskPng) {
        const page = currentPage();
        for (let i = 0; i < page.length; i += 1) {
          if (state.mask[i]) page[i] = quantized[i];
        }
      } else {
        currentPage().set(quantized);
      }
      markDirty();
      drawBoard();
      renderPages();
      setAiStatus(maskPng ? "圈选已改，圈外灯珠锁在原页上。" : (refPng ? "已按参考图压成 36×24 灯珠。" : "已压成 36×24 灯珠，可继续改提示词再生成。"));
    } catch (error) {
      setAiStatus(String(error.message || error));
    } finally {
      setGenerateBusy(false);
    }
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
      tool: state.tool,
      color: state.color,
      size: state.size,
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
          savedAt: row.savedAt,
          png: row.png,
        })),
      };
      deskSet(DESIGNS_KEY, JSON.stringify(slim));
    } catch (error) {
      console.warn(error);
    }
  }

  function persistAiLocal(bundle) {
    try {
      deskSet(AI_KEY, JSON.stringify(bundle));
    } catch (error) {
      console.warn(error);
    }
  }

  function persistPromptsLocal(bundle) {
    try {
      deskSet(PROMPTS_KEY, JSON.stringify(bundle));
    } catch (error) {
      console.warn(error);
    }
  }

  function aiSettingsBundle() {
    return { v: 1, savedAt: Date.now(), apiKey: state.aiKey || "", model: state.aiModel || "", aiRefMode: state.aiRefMode || "none", aiRefId: state.aiRefId || "" };
  }

  function promptsBundle() {
    return { v: 1, savedAt: Date.now(), items: state.prompts || [], deletedIds: state.promptDeletedIds || [] };
  }

  function saveAiSettings() {
    const bundle = aiSettingsBundle();
    persistAiLocal(bundle);
    putBoardSaves({ ai: bundle }).catch((error) => console.warn(error));
  }

  function savePrompts() {
    const bundle = promptsBundle();
    persistPromptsLocal(bundle);
    putBoardSaves({ prompts: bundle }).catch((error) => console.warn(error));
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
    const name = String(document.getElementById("boardSaveName")?.value || "").trim() || "未命名广告牌";
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
      empty.textContent = "还没有保存的广告牌。";
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
      kind.textContent = `${item.pageCount || (item.pages || []).length || 1} 页`;
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
    state.designId = item.id || "";
    state.designName = item.name || "";
    state.interval = Math.max(50, Number(item.interval) || state.interval);
    restorePages(item.pages || []);
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

  function setBoardToolSheetMode(mode) {
    const sheet = document.getElementById("boardToolSheet");
    if (sheet) sheet.setAttribute("data-sheet-mode", mode);
    const toolsBtn = document.getElementById("btnBoardMobileTools");
    const filesBtn = document.getElementById("btnBoardMobileFiles");
    const open = sheet?.classList.contains("open");
    const works = mode === "works";
    toolsBtn?.classList.toggle("on", Boolean(open && !works));
    filesBtn?.classList.toggle("on", Boolean(open && works));
    toolsBtn?.setAttribute("aria-expanded", String(Boolean(open && !works)));
    filesBtn?.setAttribute("aria-expanded", String(Boolean(open && works)));
  }

  function bindSheets() {
    window.MobileWorkspace?.registerSheet({
      id: "board-pages",
      root: "#boardPageSheet",
      trigger: "#btnBoardMobilePages",
      backdrop: "#boardSheetBackdrop",
      inert: [".board-stage", ".board-app .topbar"],
      mutex: "board-workspace",
    });
    window.MobileWorkspace?.registerSheet({
      id: "board-tools",
      root: "#boardToolSheet",
      backdrop: "#boardSheetBackdrop",
      inert: [".board-stage", ".board-app .topbar"],
      mutex: "board-workspace",
      onOpen() {
        setBoardToolSheetMode(document.getElementById("boardToolSheet")?.getAttribute("data-sheet-mode") || "draw");
      },
      onClose() {
        ["btnBoardMobileTools", "btnBoardMobileFiles"].forEach((id) => {
          const button = document.getElementById(id);
          button?.classList.remove("on");
          button?.setAttribute("aria-expanded", "false");
        });
      },
    });
    document.getElementById("btnBoardMobilePages")?.addEventListener("click", () => {
      window.MobileWorkspace?.toggleSheet("board-pages");
    });
    document.getElementById("btnBoardMobileTools")?.addEventListener("click", () => {
      const sheet = document.getElementById("boardToolSheet");
      const open = sheet?.classList.contains("open");
      const works = sheet?.getAttribute("data-sheet-mode") === "works";
      if (open && !works) {
        window.MobileWorkspace?.closeSheet("board-tools");
        return;
      }
      setBoardToolSheetMode("draw");
      if (!open) window.MobileWorkspace?.openSheet("board-tools");
    });
    document.getElementById("btnBoardMobileFiles")?.addEventListener("click", () => {
      const sheet = document.getElementById("boardToolSheet");
      const open = sheet?.classList.contains("open");
      const works = sheet?.getAttribute("data-sheet-mode") === "works";
      if (open && works) {
        window.MobileWorkspace?.closeSheet("board-tools");
        return;
      }
      setBoardToolSheetMode("works");
      if (!open) window.MobileWorkspace?.openSheet("board-tools");
    });
    document.getElementById("boardSheetBackdrop")?.addEventListener("click", () => closeBoardSheets());
  }

  function bindUi() {
    document.getElementById("btnUndo")?.addEventListener("click", () => undo());
    document.getElementById("btnRedo")?.addEventListener("click", () => redo());
    document.getElementById("btnBoardMobileUndo")?.addEventListener("click", () => undo());
    document.getElementById("btnBoardMobileRedo")?.addEventListener("click", () => redo());
    document.getElementById("btnBoardMobilePan")?.addEventListener("click", () => setTool(state.tool === "pan" ? "round" : "pan"));
    document.getElementById("btnNewDesign")?.addEventListener("click", () => startNewDesign());
    document.getElementById("btnBoardMobileNew")?.addEventListener("click", () => startNewDesign());
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
    document.getElementById("btnBoardCopyHud")?.addEventListener("click", () => copyPage());
    document.getElementById("btnBoardCopyRail")?.addEventListener("click", () => copyPage());
    document.getElementById("btnBoardMobileCopy")?.addEventListener("click", () => copyPage());
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
      state.interval = Math.max(50, Number(event.target.value) || state.interval);
      const pageInterval = document.getElementById("pageInterval");
      if (pageInterval) pageInterval.value = String(state.interval);
      if (previewPlaying) {
        stopPreview();
        togglePreviewPlay();
      }
    });
    document.getElementById("btnFinalize")?.addEventListener("click", () => exportFinalize());
    document.getElementById("btnBoardAi")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnBoardAiHud")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnBoardAiRail")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnBoardMobileAi")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnBoardSmart")?.addEventListener("click", () => openSmartDialog());
    document.getElementById("btnBoardSmartHud")?.addEventListener("click", () => openSmartDialog());
    document.getElementById("btnBoardSmartRail")?.addEventListener("click", () => openSmartDialog());
    document.getElementById("btnBoardMobileSmart")?.addEventListener("click", () => openSmartDialog());
    document.getElementById("btnBoardSmartPick")?.addEventListener("click", () => document.getElementById("fileBoardSmart")?.click());
    document.getElementById("btnBoardSmartApply")?.addEventListener("click", async () => {
      if (!smartPage) {
        setSmartStatus("先选一张 PNG 或 JPG。");
        return;
      }
      const blank = currentPage().every((value) => value === DARK);
      if (!blank) {
        const ok = typeof appConfirm === "function"
          ? await appConfirm("会盖住当前页灯珠。未保存的笔触会被盖住。", { title: "生成到灯牌", okLabel: "生成" })
          : window.confirm("会盖住当前页，继续？");
        if (!ok) return;
      }
      commitSmartPage(document.getElementById("boardSmartStatus")?.textContent || "已生成");
    });
    document.getElementById("fileBoardSmart")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await analyzeSmartFile(file);
    });
    document.getElementById("btnBoardAiModels")?.addEventListener("click", () => refreshAiModels());
    document.getElementById("btnBoardAiPromptNew")?.addEventListener("click", () => createPromptTemplate());
    document.getElementById("btnBoardAiPromptSave")?.addEventListener("click", () => saveCurrentPrompt());
    document.getElementById("btnBoardAiPromptDel")?.addEventListener("click", () => deletePromptTemplate());
    document.getElementById("btnBoardAiPromptReset")?.addEventListener("click", () => resetKindPrompts());
    document.getElementById("btnBoardAiGenerate")?.addEventListener("click", () => generateAiDesign());
    document.querySelectorAll("[data-ai-ref]").forEach((button) => {
      button.addEventListener("click", () => setAiRefMode(button.dataset.aiRef));
    });
    document.getElementById("btnBoardAiRefPick")?.addEventListener("click", () => document.getElementById("fileBoardAiRef")?.click());
    document.getElementById("btnBoardAiRefClear")?.addEventListener("click", () => clearAiRefUpload());
    document.getElementById("fileBoardAiRef")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await setAiRefUpload(file);
      } catch (error) {
        setAiStatus(String(error.message || error));
      }
    });
    document.getElementById("btnClearMask")?.addEventListener("click", () => clearMask());
    document.getElementById("btnDesignEdit")?.addEventListener("click", () => setDesignEditOn(!designEditOn));
    document.getElementById("btnPlayPages")?.addEventListener("click", () => togglePlay());
    document.getElementById("btnPrevPage")?.addEventListener("click", () => goToPage(state.page - 1));
    document.getElementById("btnNextPage")?.addEventListener("click", () => goToPage(state.page + 1));
    document.getElementById("pageInterval")?.addEventListener("change", (event) => {
      state.interval = Math.max(50, Math.min(99999, Number(event.target.value) || 1000));
      markDirty();
      if (playing) {
        stopPlay();
        togglePlay();
      }
    });
    document.querySelectorAll("[data-board-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.boardPage;
        if (action === "add") addPage();
        if (action === "copy") copyPage();
        if (action === "paste") pastePage();
        if (action === "copy-all") copyAllPages();
        if (action === "paste-all") pasteAllPages();
        if (action === "del") deletePage();
        if (action === "fill") fillPage();
        if (action === "clear") clearPage();
      });
    });
    document.querySelectorAll("[data-board-io]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.boardIo;
        if (action === "copy") copyPage();
        if (action === "copy-all") copyAllPages();
        if (action === "new") startNewDesign();
        if (action === "finalize") exportFinalize();
        if (action === "import") document.getElementById("fileBoardImage")?.click();
        if (action === "export") exportJpg();
        if (action === "preview") showPreview();
        if (action === "finalize") exportFinalize();
      });
    });
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => setModalVisible(button.dataset.closeModal, false));
    });
    document.querySelectorAll("[data-ai-tab]").forEach((button) => {
      button.addEventListener("click", () => setAiTab(button.dataset.aiTab));
    });
    document.getElementById("boardAiPromptPick")?.addEventListener("change", (event) => {
      state.aiPromptId = event.target.value;
      const current = selectedPrompt();
      if (current) setAiPrompt(current.prompt);
    });
    document.getElementById("designSearch")?.addEventListener("input", () => renderDesigns());
    document.getElementById("brushSize")?.addEventListener("input", (event) => setBrushSize(event.target.value));
    document.querySelectorAll("#sizePresets [data-size]").forEach((button) => {
      button.addEventListener("click", () => setBrushSize(button.dataset.size));
    });
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
    bindSheets();
    bindUi();
    fillTools();
    fillPalette();
    setBrushSize(1);
    setTool("round");
    const [spec, remote, promptDoc, refDoc] = await Promise.all([
      fetch("/data/board_native.json", { credentials: "same-origin", cache: "no-store" }).then((res) => res.ok ? res.json() : null).catch(() => null),
      fetchBoardSaves(),
      fetch("/data/board_ai_prompts.json", { credentials: "same-origin", cache: "no-store" }).then((res) => res.ok ? res.json() : { templates: [] }).catch(() => ({ templates: [] })),
      fetch("/data/board_ai_refs.json", { credentials: "same-origin", cache: "no-store" }).then((res) => res.ok ? res.json() : { templates: [] }).catch(() => ({ templates: [] })),
    ]);
    nativeSpec = spec;
    if (Array.isArray(spec?.palette) && spec.palette.length) state.palette = spec.palette;
    if (Number(spec?.defaultIntervalMs)) state.interval = Number(spec.defaultIntervalMs);
    fillPalette();
    state.promptDefaults = Array.isArray(promptDoc?.templates) ? promptDoc.templates : [];
    state.aiRefs = Array.isArray(refDoc?.templates) ? refDoc.templates : [];
    let localDesigns = { items: [] };
    try {
      localDesigns = JSON.parse(deskGet(DESIGNS_KEY) || "null") || { items: [] };
    } catch {
      localDesigns = { items: [] };
    }
    const merged = mergeDesigns(localDesigns, remote?.designs);
    state.designs = merged.items || [];
    persistDesignsLocal({ v: 1, savedAt: merged.savedAt || Date.now(), items: state.designs });
    let localAi = {};
    try {
      localAi = JSON.parse(deskGet(AI_KEY) || "null") || {};
    } catch {
      localAi = {};
    }
    const ai = ((Number(localAi.savedAt) || 0) >= (Number(remote?.ai?.savedAt) || 0) ? localAi : remote?.ai) || {};
    state.aiKey = String(ai.apiKey || "");
    state.aiModel = String(ai.model || "");
    state.aiRefMode = ai.aiRefMode === "template" || ai.aiRefMode === "upload" ? ai.aiRefMode : "none";
    state.aiRefId = String(ai.aiRefId || "");
    let localPrompts = { items: [], deletedIds: [] };
    try {
      localPrompts = JSON.parse(deskGet(PROMPTS_KEY) || "null") || localPrompts;
    } catch {
      localPrompts = { items: [], deletedIds: [] };
    }
    const promptState = (Number(localPrompts.savedAt) || 0) >= (Number(remote?.prompts?.savedAt) || 0) ? localPrompts : (remote?.prompts || localPrompts);
    state.prompts = Array.isArray(promptState.items) ? promptState.items : [];
    state.promptDeletedIds = Array.isArray(promptState.deletedIds) ? promptState.deletedIds : [];
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
      state.size = Math.max(1, Number(session.size) || state.size);
      state.interval = Math.max(50, Number(session.interval) || state.interval);
      state.designId = session.designId || "";
      state.designName = session.designName || "";
      state.page = Number(session.page) || 0;
      restorePages(session.pages);
      setTool(state.tool);
      setColor(state.color);
      setBrushSize(state.size);
      const nameInput = document.getElementById("boardSaveName");
      if (nameInput) nameInput.value = state.designName || "";
      state.dirty = false;
      setSaveStatus("已打开");
    } else {
      drawBoard();
      renderPages();
    }
    renderDesigns();
    fillAiPromptPick();
    fitCamera();
    const push = {};
    const remoteIds = new Set((remote?.designs?.items || []).map((row) => row?.id).filter(Boolean));
    const extra = (merged.items || []).filter((row) => row?.id && (row.pages || row.png) && !remoteIds.has(row.id));
    if (extra.length) push.designs = { v: 1, savedAt: merged.savedAt || Date.now(), items: extra };
    if ((state.prompts.length || (state.promptDeletedIds || []).length) && (!remote?.prompts?.items || !remote.prompts.items.length)) {
      push.prompts = promptsBundle();
    }
    if (state.aiKey && !remote?.ai?.apiKey) push.ai = aiSettingsBundle();
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
