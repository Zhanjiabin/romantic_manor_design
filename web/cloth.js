(function clothDesk() {
  "use strict";

  const SESSION_KEY = "manor-cloth-session-v1";
  const DESIGNS_KEY = "manor-cloth-designs-v1";
  const BOARDS_KEY = "manor-cloth-boards-v1";
  const AI_KEY = "manor-cloth-ai-v1";
  const PROMPTS_KEY = "manor-cloth-prompts-v1";
  const BLANK_ID = "__blank__";
  const PAPER = "#f4f0ea";
  const FAIR_SIZE = [512, 256];
  const CLOTH_SIZE = [256, 256];
  const SWATCHES = ["#000000", "#ffffff", "#3a2a24", "#c45c6a", "#e8a0b0", "#f2d38a", "#d98a3a", "#7bb38a", "#5a8fbf", "#6b4f3a", "#7a6aa8", "#ece6dc"];
  const SIZE_MAX = 40;
  const TOOLS = [
    { id: "pencil", label: "细笔", glyph: "·" },
    { id: "round", label: "圆笔", glyph: "●" },
    { id: "spray", label: "喷点", glyph: "◌" },
    { id: "eraser", label: "橡皮", glyph: "⌫" },
    { id: "line", label: "直线", glyph: "/" },
    { id: "fill", label: "填充", glyph: "▣" },
    { id: "eyedrop", label: "吸色", glyph: "◎" },
    { id: "patch", label: "圈选", glyph: "◍" },
    { id: "pan", label: "移动", glyph: "✥" },
  ];
  const TOOL_KEYS = { 1: "pencil", 2: "round", 3: "spray", 4: "eraser", 5: "line", 6: "fill", 7: "eyedrop", 8: "patch", 9: "pan" };

  const canvas = document.getElementById("paintCanvas");
  const view = document.getElementById("paintView");
  const board = document.getElementById("paintBoard");
  const templateCanvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const templateCtx = templateCanvas.getContext("2d", { willReadFrequently: true });

  const state = {
    catalog: null,
    gender: "female",
    kindId: "female-short",
    templateId: "",
    tool: "round",
    color: "#000000",
    size: 4,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    history: [],
    redo: [],
    designs: [],
    boards: [],
    savedAt: 0,
    designName: "",
    aiKey: "",
    aiModel: "",
    aiModels: [],
    aiPromptId: "",
    promptDefaults: [],
    prompts: [],
    promptDeletedIds: [],
    outfit: { bodyKind: "", cloth: {}, hair: "", expression: "", face: "" },
  };

  const BODY_SHORT = {
    "female-short": "女短",
    "female-long": "女长",
    "female-skirt": "女裙",
    "male-short": "男短",
    "male-long": "男长",
  };

  const pointers = new Map();
  let painting = false;
  let lineStart = null;
  let lastPoint = null;
  let strokeOrigin = null;
  let smoothPoint = null;
  let gesture = null;
  let spacePan = false;
  let toolBeforePan = "";
  let sessionTimer = 0;
  let fitTimer = 0;
  let historyBusy = false;
  let strokeDirty = false;
  let previewBodyKind = "";

  function kindById(id) {
    return (state.catalog?.kinds || []).find((kind) => kind.id === id) || null;
  }

  function currentKind() {
    return kindById(state.kindId) || state.catalog?.kinds?.[0] || null;
  }

  function kindsForGender(gender) {
    return (state.catalog?.kinds || []).filter((kind) => kind.gender === gender || kind.gender === "both");
  }

  function stockTemplate() {
    return currentKind()?.templates?.[0] || null;
  }

  function customBoards() {
    return (state.boards || []).filter((row) => row.kind === state.kindId);
  }

  function currentTemplates() {
    const stock = stockTemplate();
    const boards = customBoards();
    return [
      { id: BLANK_ID, name: "空白", blank: true },
      ...(stock ? [{ ...stock, name: stock.name || "默认 UV", stock: true }] : []),
      ...boards.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.png,
        custom: true,
        kind: row.kind,
      })),
    ];
  }

  function findBoard(id) {
    if (!id || id === BLANK_ID) return { id: BLANK_ID, blank: true, name: "空白" };
    const stock = (currentKind()?.templates || []).find((row) => row.id === id);
    if (stock) return { ...stock, stock: true };
    const custom = (state.boards || []).find((row) => row.id === id);
    if (custom) return { id: custom.id, name: custom.name, url: custom.png, custom: true };
    return null;
  }

  function currentTemplate() {
    return findBoard(state.templateId);
  }

  function setSaveStatus(text) {
    const node = document.getElementById("saveStatus");
    if (node) node.textContent = text;
  }

  function canvasSize() {
    const kind = currentKind();
    if (kind?.diyType === "fair") {
      return {
        width: Number(kind.width) || FAIR_SIZE[0],
        height: Number(kind.height) || FAIR_SIZE[1],
      };
    }
    return {
      width: Number(kind?.width) || CLOTH_SIZE[0],
      height: Number(kind?.height) || CLOTH_SIZE[1],
    };
  }

  function resizeWorking(width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (templateCanvas.width !== width) templateCanvas.width = width;
    if (templateCanvas.height !== height) templateCanvas.height = height;
    const ghost = document.getElementById("paintGhost");
    if (ghost) {
      if (ghost.width !== width) ghost.width = width;
      if (ghost.height !== height) ghost.height = height;
    }
    const mask = document.getElementById("paintMask");
    if (mask) {
      if (mask.width !== width) mask.width = width;
      if (mask.height !== height) mask.height = height;
    }
    ctx.imageSmoothingEnabled = false;
    templateCtx.imageSmoothingEnabled = false;
    document.getElementById("canvasSizeLabel").textContent = `${width}×${height}`;
  }

  function templateSrc(url) {
    try {
      return encodeURI(decodeURI(String(url || "")));
    } catch {
      return String(url || "");
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image"));
      image.src = templateSrc(url);
    });
  }

  function fillPaper(target, width, height) {
    target.fillStyle = PAPER;
    target.fillRect(0, 0, width, height);
  }

  function drawImageCover(target, image, width, height) {
    target.clearRect(0, 0, width, height);
    target.drawImage(image, 0, 0, width, height);
  }

  async function applyTemplate(template, options = {}) {
    const { width, height } = canvasSize();
    resizeWorking(width, height);
    const blank = !template || template.blank || template.id === BLANK_ID;
    if (blank) {
      fillPaper(ctx, width, height);
      fillPaper(templateCtx, width, height);
      state.templateId = BLANK_ID;
    } else {
      try {
        const image = await loadImage(template.url || template.png);
        drawImageCover(templateCtx, image, width, height);
        if (options.png) {
          const overlay = await loadImage(options.png);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(overlay, 0, 0, width, height);
        } else {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(templateCanvas, 0, 0);
        }
      } catch (error) {
        console.warn(error);
        fillPaper(ctx, width, height);
        fillPaper(templateCtx, width, height);
      }
      state.templateId = template.id || "";
    }
    if (options.png && blank) {
      try {
        const overlay = await loadImage(options.png);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(overlay, 0, 0, width, height);
      } catch (error) {
        console.warn(error);
      }
    }
    if (!options.keepHistory) {
      state.history = [];
      state.redo = [];
      commitHistory();
    }
    if (!options.keepDirty) state.dirty = false;
    if (options.fit !== false) fitCanvas();
    if (!options.keepMask) clearMask();
    renderTemplates();
  }

  function snapshotPng() {
    return canvas.toDataURL("image/png");
  }

  function commitHistory() {
    const png = snapshotPng();
    if (state.history[state.history.length - 1] === png) {
      syncHistoryButtons();
      return;
    }
    state.history.push(png);
    while (state.history.length > 24) state.history.shift();
    state.redo = [];
    syncHistoryButtons();
  }

  function rememberCurrentHistory() {
    const png = snapshotPng();
    if (state.history[state.history.length - 1] === png) return;
    state.history.push(png);
    while (state.history.length > 24) state.history.shift();
  }

  function syncHistoryButtons() {
    const undoable = state.history.length >= 2;
    const redoable = state.redo.length > 0;
    ["btnUndo", "btnClothMobileUndo", "btnClothHudUndo"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = !undoable;
    });
    ["btnRedo", "btnClothMobileRedo", "btnClothHudRedo"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = !redoable;
    });
  }

  async function restorePng(png) {
    if (!png) return;
    const image = await loadImage(png);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }

  async function undo() {
    if (historyBusy) return;
    historyBusy = true;
    try {
      rememberCurrentHistory();
      if (state.history.length < 2) return;
      state.redo.push(state.history.pop());
      await restorePng(state.history[state.history.length - 1]);
      markDirty();
      syncHistoryButtons();
    } finally {
      historyBusy = false;
    }
  }

  async function redo() {
    if (historyBusy) return;
    const next = state.redo.pop();
    if (!next) {
      syncHistoryButtons();
      return;
    }
    historyBusy = true;
    try {
      state.history.push(next);
      await restorePng(next);
      markDirty();
      syncHistoryButtons();
    } finally {
      historyBusy = false;
    }
  }

  function markDirty() {
    state.dirty = true;
    setSaveStatus("未保存");
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => saveSession(), 400);
  }

  function fitCanvas() {
    if (!board) return;
    const width = canvas.width || 256;
    const height = canvas.height || 256;
    const pad = 24;
    const zoom = Math.max(0.25, Math.min((board.clientWidth - pad) / width, (board.clientHeight - pad) / height));
    state.zoom = zoom;
    state.panX = (board.clientWidth - width * zoom) / 2;
    state.panY = (board.clientHeight - height * zoom) / 2;
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

  function pressureOf(event) {
    if (!event || event.pointerType === "mouse") return 1;
    if (typeof event.pressure !== "number") return 1;
    return Math.max(0.18, Math.min(1, event.pressure || 0.5));
  }

  function toolRadius(event) {
    const size = Math.max(1, Number(state.size) || 4);
    let radius = size;
    if (state.tool === "pencil") radius = Math.max(0.6, size * 0.42);
    if (state.tool === "spray") radius = size * 1.35;
    return radius * pressureOf(event);
  }

  function hexToRgb(hex) {
    const value = String(hex || "#000000").replace("#", "");
    const full = value.length === 3 ? value.split("").map((ch) => ch + ch).join("") : value;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  function stamp(x, y, event) {
    if (state.tool === "patch") {
      stampMask(x, y, event, event.shiftKey);
      return;
    }
    const radius = toolRadius(event);
    if (state.tool === "eraser") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(templateCanvas, 0, 0);
      ctx.restore();
      return;
    }
    if (state.tool === "spray") {
      ctx.fillStyle = state.color;
      const dots = Math.max(10, Math.round(radius * 7));
      for (let i = 0; i < dots; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        const px = x + Math.cos(angle) * dist;
        const py = y + Math.sin(angle) * dist;
        ctx.fillRect(px, py, 1, 1);
      }
      return;
    }
    ctx.fillStyle = state.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function stroke(from, to, event) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.6, toolRadius(event) * 0.32)));
    for (let i = 0; i <= steps; i += 1) {
      stamp(from.x + (dx * i) / steps, from.y + (dy * i) / steps, event);
    }
  }

  function lockAxis(point) {
    if (!strokeOrigin) return point;
    if (Math.abs(point.x - strokeOrigin.x) >= Math.abs(point.y - strokeOrigin.y)) {
      return { x: point.x, y: strokeOrigin.y };
    }
    return { x: strokeOrigin.x, y: point.y };
  }

  function ghostCanvas() {
    return document.getElementById("paintGhost");
  }

  function clearGhost() {
    const ghost = ghostCanvas();
    const gtx = ghost?.getContext("2d");
    if (gtx) gtx.clearRect(0, 0, ghost.width, ghost.height);
  }

  function maskNode() {
    return document.getElementById("paintMask");
  }

  function maskContext() {
    const node = maskNode();
    return node ? node.getContext("2d") : null;
  }

  function clearMask() {
    const node = maskNode();
    const context = maskContext();
    if (node && context) context.clearRect(0, 0, node.width, node.height);
    const patch = document.getElementById("clothAiPatch");
    if (patch) patch.checked = false;
    syncMaskChrome();
  }

  function maskHasInk() {
    const node = maskNode();
    const context = maskContext();
    if (!node || !context || !node.width) return false;
    const data = context.getImageData(0, 0, node.width, node.height).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 18) return true;
    }
    return false;
  }

  function exportMaskPng() {
    const node = maskNode();
    return node && maskHasInk() ? node.toDataURL("image/png") : null;
  }

  function stampMask(x, y, event, erase) {
    const node = maskNode();
    const context = maskContext();
    if (!node || !context) return;
    const radius = Math.max(3, toolRadius(event) * 1.15);
    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    if (erase) {
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "rgba(0,0,0,1)";
    } else {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "rgba(226, 72, 128, 0.55)";
    }
    context.fill();
    context.restore();
  }

  function syncMaskChrome() {
    const ink = maskHasInk();
    const clear = document.getElementById("btnClearMask");
    if (clear) clear.hidden = !ink;
    const patch = document.getElementById("clothAiPatch");
    if (patch && ink && document.getElementById("dlgClothAi") && !document.getElementById("dlgClothAi").hidden) {
      patch.checked = true;
    }
    const label = document.getElementById("designerLabel");
    if (label) label.textContent = state.tool === "patch" ? (ink ? "涂要改的区域 · Shift 擦掉" : "涂要改的区域") : "图案设计";
    const generate = document.getElementById("btnClothAiGenerate");
    if (generate) generate.textContent = patch?.checked && ink ? "只改圈选" : "生成到画布";
  }

  function drawLineGhost(from, to, event) {
    const ghost = ghostCanvas();
    const gtx = ghost?.getContext("2d");
    if (!gtx || !from || !to) return;
    gtx.clearRect(0, 0, ghost.width, ghost.height);
    gtx.strokeStyle = state.color;
    gtx.lineWidth = Math.max(1, toolRadius(event) * 2);
    gtx.lineCap = "round";
    gtx.beginPath();
    gtx.moveTo(from.x, from.y);
    gtx.lineTo(to.x, to.y);
    gtx.stroke();
  }

  function pickColor(x, y) {
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = `#${[pixel[0], pixel[1], pixel[2]].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    state.color = hex;
    const input = document.getElementById("paintColor");
    if (input) input.value = hex;
  }

  function floodFill(x, y) {
    const width = canvas.width;
    const height = canvas.height;
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const target = (py * width + px) * 4;
    const tr = data[target];
    const tg = data[target + 1];
    const tb = data[target + 2];
    const ta = data[target + 3];
    const [fr, fg, fb] = hexToRgb(state.color);
    if (tr === fr && tg === fg && tb === fb && ta === 255) return;
    const stack = [px, py];
    const seen = new Uint8Array(width * height);
    while (stack.length) {
      const cy = stack.pop();
      const cx = stack.pop();
      const id = cy * width + cx;
      if (seen[id]) continue;
      seen[id] = 1;
      const index = id * 4;
      if (Math.abs(data[index] - tr) > 8 || Math.abs(data[index + 1] - tg) > 8 || Math.abs(data[index + 2] - tb) > 8 || Math.abs(data[index + 3] - ta) > 8) {
        continue;
      }
      data[index] = fr;
      data[index + 1] = fg;
      data[index + 2] = fb;
      data[index + 3] = 255;
      if (cx > 0) stack.push(cx - 1, cy);
      if (cx + 1 < width) stack.push(cx + 1, cy);
      if (cy > 0) stack.push(cx, cy - 1);
      if (cy + 1 < height) stack.push(cx, cy + 1);
    }
    ctx.putImageData(image, 0, 0);
  }

  function setBrushSize(size) {
    state.size = Math.max(1, Math.min(SIZE_MAX, Math.round(Number(size) || 4)));
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
    const panBtn = document.getElementById("btnClothMobilePan");
    panBtn?.classList.toggle("on", id === "pan");
    panBtn?.setAttribute("aria-pressed", String(id === "pan"));
    clearGhost();
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

  function fillSwatches() {
    const row = document.getElementById("swatchRow");
    if (!row) return;
    row.replaceChildren();
    SWATCHES.forEach((hex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.background = hex;
      button.title = hex;
      button.addEventListener("click", () => {
        state.color = hex;
        const input = document.getElementById("paintColor");
        if (input) input.value = hex;
      });
      row.append(button);
    });
  }

  function renderKinds() {
    const grid = document.getElementById("kindGrid");
    if (!grid) return;
    const kinds = kindsForGender(state.gender);
    const ids = kinds.map((kind) => kind.id).join(",");
    if (grid.dataset.kindIds !== ids) {
      grid.dataset.kindIds = ids;
      grid.replaceChildren();
      kinds.forEach((kind) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tool";
        button.dataset.kind = kind.id;
        button.textContent = kind.label;
        button.addEventListener("click", () => selectKind(kind.id));
        grid.append(button);
      });
    }
    grid.querySelectorAll("[data-kind]").forEach((button) => {
      const on = button.dataset.kind === state.kindId;
      button.classList.toggle("on", on);
      button.setAttribute("aria-selected", String(on));
    });
    const kind = currentKind();
    const meta = document.getElementById("kindMeta");
    if (meta && kind) {
      meta.textContent = `${kind.shop} · ${kind.width}×${kind.height}`;
    }
  }

  function sheetListScroller(node) {
    return node?.closest("[data-mobile-sheet-scroll]") || node?.closest(".rail-block") || node;
  }

  function preserveListScroll(scroller, rebuild) {
    if (!scroller) {
      rebuild();
      return;
    }
    const top = scroller.scrollTop;
    const left = scroller.scrollLeft;
    const active = document.activeElement;
    if (active && scroller.contains(active) && typeof active.blur === "function") active.blur();
    rebuild();
    const restore = () => {
      scroller.scrollTop = top;
      scroller.scrollLeft = left;
    };
    restore();
    requestAnimationFrame(restore);
  }

  function renderTemplates() {
    const grid = document.getElementById("templateGrid");
    const count = document.getElementById("templateCount");
    const templates = currentTemplates();
    if (count) count.textContent = String(Math.max(0, templates.length - 1));
    if (!grid) return;
    preserveListScroll(sheetListScroller(grid), () => {
      grid.replaceChildren();
      templates.forEach((template) => {
      const button = document.createElement("div");
      button.className = "template-card" + (template.id === (state.templateId || BLANK_ID) ? " on" : "");
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      if (template.blank) {
        const blank = document.createElement("div");
        blank.className = "template-blank";
        blank.textContent = "空画布";
        button.append(blank);
      } else {
        const img = document.createElement("img");
        img.alt = template.name;
        img.loading = "lazy";
        img.src = templateSrc(template.url);
        button.append(img);
      }
      const cap = document.createElement("span");
      cap.className = "template-card-cap";
      const label = document.createElement("span");
      label.textContent = template.name;
      cap.append(label);
      if (template.custom) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "template-del";
        del.setAttribute("aria-label", "删除底板 " + template.name);
        del.textContent = "×";
        del.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteBoard(template);
        });
        cap.append(del);
      }
      button.append(cap);
      button.addEventListener("click", () => selectTemplate(template));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTemplate(template);
        }
      });
      grid.append(button);
      });
    });
  }

  function renderDesigns() {
    const list = document.getElementById("designList");
    if (!list) return;
    list.replaceChildren();
    if (!state.designs.length) {
      const empty = document.createElement("p");
      empty.className = "kind-meta";
      empty.textContent = "还没有保存的衣服作品。";
      list.append(empty);
      return;
    }
    state.designs.slice().reverse().forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "design-card";
      const img = document.createElement("img");
      img.alt = item.name;
      img.src = item.png;
      const label = document.createElement("span");
      label.textContent = item.name;
      button.append(img, label);
      button.addEventListener("click", () => openDesign(item));
      list.append(button);
    });
  }

  function outfitSlotFor(kind) {
    if (!kind) return "";
    if (kind.diyType === "fair" || kind.id === "hair") return "hair";
    if (kind.diyType === "biaoqing" || kind.id === "expression") return "expression";
    if (kind.diyType === "face" || kind.id === "face") return "face";
    if (kind.diyType === "cloth") return "cloth";
    return "";
  }

  function ensureOutfit() {
    if (!state.outfit || typeof state.outfit !== "object") {
      state.outfit = { bodyKind: "", cloth: {}, hair: "", expression: "", face: "" };
    }
    if (!state.outfit.cloth || typeof state.outfit.cloth !== "object") state.outfit.cloth = {};
    return state.outfit;
  }

  function snapshotCurrentSlot() {
    const kind = currentKind();
    if (!kind || !canvas.width) return;
    const slot = outfitSlotFor(kind);
    if (!slot) return;
    const outfit = ensureOutfit();
    let url = "";
    try {
      url = canvas.toDataURL(slot === "cloth" ? "image/jpeg" : "image/png", 0.88);
    } catch (error) {
      console.warn(error);
      return;
    }
    if (slot === "cloth") {
      outfit.bodyKind = kind.id;
      outfit.cloth[kind.id] = url;
    } else {
      outfit[slot] = url;
    }
  }

  function bodyKindsForPreview() {
    return (state.catalog?.kinds || []).filter((kind) => kind.diyType === "cloth");
  }

  function previewGender() {
    return (previewBodyKind || "").startsWith("male") ? "male" : "female";
  }

  function designsForSlot(slot) {
    return (state.designs || []).filter((item) => outfitSlotFor(kindById(item.kind)) === slot);
  }

  function fillSlotSelect(select, slot) {
    if (!select) return;
    const outfit = ensureOutfit();
    const options = [
      { value: "default", label: "默认" },
      { value: "canvas", label: "当前画布" },
    ];
    if (slot === "cloth") {
      Object.keys(outfit.cloth).forEach((kindId) => {
        if (!outfit.cloth[kindId]) return;
        const kind = kindById(kindId);
        options.push({ value: "outfit:" + kindId, label: "刚才画的 · " + (kind?.label || kindId) });
      });
    } else if (outfit[slot]) {
      options.push({ value: "outfit", label: "刚才画的" });
    }
    designsForSlot(slot).forEach((item) => {
      options.push({ value: "design:" + item.id, label: "已存 · " + (item.name || "作品") });
    });
    const prev = select.value;
    select.replaceChildren();
    options.forEach((row) => {
      const opt = document.createElement("option");
      opt.value = row.value;
      opt.textContent = row.label;
      select.append(opt);
    });
    let pick = "default";
    if (outfitSlotFor(currentKind()) === slot) pick = "canvas";
    else if (slot === "cloth") {
      if (outfit.cloth[previewBodyKind]) pick = "outfit:" + previewBodyKind;
      else {
        const any = Object.keys(outfit.cloth).find((id) => outfit.cloth[id]);
        if (any) pick = "outfit:" + any;
      }
    } else if (outfit[slot]) pick = "outfit";
    if (prev && options.some((row) => row.value === prev)) pick = prev;
    select.value = pick;
  }

  function srcFromPick(select, slot) {
    const value = select?.value || "default";
    if (value === "canvas") return snapshotPng();
    if (value === "outfit") return ensureOutfit()[slot] || "";
    if (value.startsWith("outfit:")) return ensureOutfit().cloth[value.slice(7)] || "";
    if (value.startsWith("design:")) {
      const id = value.slice(7);
      return (state.designs || []).find((item) => item.id === id)?.png || "";
    }
    return "";
  }

  function fillBodyPicks() {
    const row = document.getElementById("previewBodyPicks");
    if (!row) return;
    const bodies = bodyKindsForPreview();
    row.replaceChildren();
    bodies.forEach((kind) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preview-body-pick" + (kind.id === previewBodyKind ? " on" : "");
      button.dataset.bodyKind = kind.id;
      button.setAttribute("aria-pressed", String(kind.id === previewBodyKind));
      button.textContent = BODY_SHORT[kind.id] || kind.label;
      button.addEventListener("click", async () => {
        if (previewBodyKind === kind.id) return;
        previewBodyKind = kind.id;
        ensureOutfit().bodyKind = kind.id;
        fillBodyPicks();
        await applyPreviewSlots({ bodyOnly: true });
      });
      row.append(button);
    });
  }

  function fillPreviewOutfit() {
    const bodies = bodyKindsForPreview();
    const outfit = ensureOutfit();
    const cur = currentKind();
    if (!bodies.some((kind) => kind.id === previewBodyKind)) {
      if (cur && cur.diyType === "cloth") previewBodyKind = cur.id;
      else if (bodies.some((kind) => kind.id === outfit.bodyKind)) previewBodyKind = outfit.bodyKind;
      else previewBodyKind = bodies[0]?.id || "";
    }
    fillBodyPicks();
    fillSlotSelect(document.getElementById("previewClothPick"), "cloth");
    fillSlotSelect(document.getElementById("previewHairPick"), "hair");
    fillSlotSelect(document.getElementById("previewExprPick"), "expression");
    fillSlotSelect(document.getElementById("previewFacePick"), "face");
  }

  async function applyPreviewSlots(options = {}) {
    if (!window.ClothTryOn) throw new Error("试穿还没加载");
    const slots = {
      cloth: srcFromPick(document.getElementById("previewClothPick"), "cloth"),
      hair: srcFromPick(document.getElementById("previewHairPick"), "hair"),
      expression: srcFromPick(document.getElementById("previewExprPick"), "expression"),
      face: srcFromPick(document.getElementById("previewFacePick"), "face"),
    };
    const gender = previewGender();
    if (options.bodyOnly) {
      await window.ClothTryOn.setBodyKind(previewBodyKind, gender);
      await window.ClothTryOn.setSlot("cloth", slots.cloth || null);
      return;
    }
    if (options.update) {
      await window.ClothTryOn.setSlot("cloth", slots.cloth || null);
      await window.ClothTryOn.setSlot("hair", slots.hair || null);
      await window.ClothTryOn.setSlot("expression", slots.expression || null);
      await window.ClothTryOn.setSlot("face", slots.face || null);
      return;
    }
    await window.ClothTryOn.open({
      kindId: previewBodyKind,
      bodyKind: previewBodyKind,
      gender,
      slots,
    });
  }

  async function selectKind(id, options = {}) {
    const kind = kindById(id);
    if (!kind) return;
    if (!options.silent) snapshotCurrentSlot();
    if (kind.id === state.kindId && !options.png && options.templateId == null && !options.clear) {
      renderKinds();
      return;
    }
    const nextW = kind.diyType === "fair" ? FAIR_SIZE[0] : Number(kind.width) || CLOTH_SIZE[0];
    const nextH = kind.diyType === "fair" ? FAIR_SIZE[1] : Number(kind.height) || CLOTH_SIZE[1];
    const sizeChanged = canvas.width !== nextW || canvas.height !== nextH;
    if (state.dirty && sizeChanged && !options.png && !options.clear) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("这个种类画布尺寸不同，换过去会清空正在画的内容。", { title: "切换种类", okLabel: "切换" })
        : window.confirm("切换种类会清空画布，继续？");
      if (!ok) return;
    }
    state.kindId = kind.id;
    if (kind.gender !== "both") state.gender = kind.gender;
    renderKinds();
    if (!document.getElementById("dlgClothAi")?.hidden) syncAiDialog({ keepPrompt: true });
    if (options.png || options.templateId) {
      await applyTemplate(findBoard(options.templateId), { png: options.png, keepHistory: options.keepHistory, fit: options.fit });
    } else if (options.clear || sizeChanged) {
      await applyTemplate({ id: BLANK_ID, blank: true }, { keepHistory: options.keepHistory, fit: true });
    } else {
      state.templateId = BLANK_ID;
      renderTemplates();
    }
  }

  async function selectTemplate(template) {
    if (!template) return;
    if (template.id === (state.templateId || BLANK_ID) && !state.dirty) return;
    if (state.dirty) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("画布上已经动过笔。换成这块底板会盖掉正在画的内容。", { title: "更换底板", okLabel: "更换" })
        : window.confirm("更换底板？未保存的绘制会丢掉。");
      if (!ok) return;
    }
    await applyTemplate(template);
  }

  async function restoreDefault() {
    if (state.dirty) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("画布上已经动过笔。恢复默认 UV 会盖掉正在画的内容。", { title: "恢复默认", okLabel: "恢复" })
        : window.confirm("恢复默认 UV？未保存的绘制会丢掉。");
      if (!ok) return;
    }
    await applyTemplate(stockTemplate() || { id: BLANK_ID, blank: true });
  }

  async function startNewDesign() {
    if (state.dirty) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("画布上已经动过笔。新建设计会盖掉正在画的内容。", { title: "新建设计", okLabel: "新建" })
        : window.confirm("新建设计？未保存的绘制会丢掉。");
      if (!ok) return;
    }
    state.designName = "";
    const nameInput = document.getElementById("clothSaveName");
    if (nameInput) nameInput.value = "";
    await applyTemplate({ id: BLANK_ID, blank: true });
    setSaveStatus("未保存");
    closeClothSheets();
  }

  function importImageFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadImage(url)
      .then((image) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        commitHistory();
        markDirty();
      })
      .catch(() => URL.revokeObjectURL(url));
  }

  function exportJpg() {
    const kind = currentKind();
    const name = `${state.designName || kind?.label || "衣服设计"}.jpg`;
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const sctx = scratch.getContext("2d", { alpha: false });
    sctx.fillStyle = PAPER;
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(canvas, 0, 0);
    scratch.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, "image/jpeg", 0.92);
  }

  function setModalVisible(id, visible) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (visible) window.MobileWorkspace?.openLayer(modal, document.activeElement);
    else window.MobileWorkspace?.closeLayer(modal);
    if (id === "dlgClothAi" || id === "dlgClothPreview") {
      document.querySelector(".cloth-workspace")?.toggleAttribute("inert", !!visible);
      document.querySelector(".cloth-app .topbar")?.toggleAttribute("inert", !!visible);
    }
    if (id === "dlgClothPreview" && !visible) window.ClothTryOn?.close();
  }

  async function showPreview() {
    const preview = document.getElementById("previewCanvas");
    if (!preview) return;
    snapshotCurrentSlot();
    setModalVisible("dlgClothPreview", true);
    fillPreviewOutfit();
    try {
      await applyPreviewSlots();
      const hint = document.getElementById("previewHint");
      if (hint) hint.textContent = "拖动看正反面。衣服、头巾、表情和面饰都可以一起选。";
    } catch (error) {
      const hint = document.getElementById("previewHint");
      if (hint) hint.textContent = "试穿预览打不开：" + (error?.message || error);
      console.warn(error);
    }
  }

  function sessionSnapshot() {
    return {
      v: 1,
      savedAt: Date.now(),
      gender: state.gender,
      kindId: state.kindId,
      templateId: state.templateId,
      tool: state.tool,
      color: state.color,
      size: state.size,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      designName: state.designName,
      png: snapshotPng(),
      outfit: state.outfit || null,
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
      deskSet(DESIGNS_KEY, JSON.stringify(bundle));
    } catch (error) {
      console.warn(error);
    }
  }

  function persistBoardsLocal(bundle) {
    try {
      deskSet(BOARDS_KEY, JSON.stringify(bundle));
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
    return {
      v: 1,
      savedAt: Date.now(),
      apiKey: state.aiKey || "",
      model: state.aiModel || "",
    };
  }

  function promptsBundle() {
    return {
      v: 1,
      savedAt: Date.now(),
      items: state.prompts || [],
      deletedIds: state.promptDeletedIds || [],
    };
  }

  function saveAiSettings() {
    const bundle = aiSettingsBundle();
    persistAiLocal(bundle);
    putClothSaves({ ai: bundle }).catch((error) => console.warn(error));
  }

  function savePrompts() {
    const bundle = promptsBundle();
    persistPromptsLocal(bundle);
    putClothSaves({ prompts: bundle }).catch((error) => console.warn(error));
  }

  function kindPrompts() {
    const kindId = state.kindId;
    const deleted = new Set(state.promptDeletedIds || []);
    const byId = new Map();
    (state.promptDefaults || []).forEach((row) => {
      if (row.kind !== kindId || deleted.has(row.id)) return;
      byId.set(row.id, { ...row, builtin: true });
    });
    (state.prompts || []).forEach((row) => {
      if (!row || row.kind !== kindId) return;
      if (row.deleted || deleted.has(row.id)) {
        byId.delete(row.id);
        return;
      }
      byId.set(row.id, { ...row, builtin: false });
    });
    return [...byId.values()];
  }

  function selectedPrompt() {
    return kindPrompts().find((row) => row.id === state.aiPromptId) || null;
  }

  function setAiStatus(text) {
    const node = document.getElementById("clothAiStatus");
    if (node) node.textContent = text || "";
  }

  function aiContractText() {
    const { width, height } = canvasSize();
    const kind = currentKind();
    const parts = [
      `输出必须是 ${width}×${height} 的游戏 UV 贴图，铺满画布，不要黑边、白边、水印。`,
      "这是换装网格贴图，不要画完整人物试穿。",
    ];
    if (kind?.id === "hair") parts.push("头巾必须是 512×256 横图：左头发或布料，右饰品展开。");
    if (document.getElementById("clothAiPatch")?.checked) {
      parts.push("局部重绘时只改圈选，圈外像素由本桌锁在当前画布上。");
    } else {
      parts.push("若勾选了参考图，必须沿用参考图里每个 UV 岛的位置和轮廓，只改花色。");
    }
    return parts.join("");
  }

  function fillAiModels() {
    const select = document.getElementById("clothAiModel");
    if (!select) return;
    const models = state.aiModels || [];
    const current = state.aiModel || "";
    select.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = models.length ? "请选择图片模型" : "先刷新模型列表";
    select.append(blank);
    models.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      select.append(option);
    });
    if (current && !models.includes(current)) {
      const extra = document.createElement("option");
      extra.value = current;
      extra.textContent = current;
      select.append(extra);
    }
    select.value = current;
  }

  function fillAiPromptPick() {
    const select = document.getElementById("clothAiPromptPick");
    const label = document.getElementById("clothAiKindLabel");
    if (label) label.textContent = currentKind()?.label || state.kindId;
    if (!select) return;
    const rows = kindPrompts();
    select.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = rows.length ? "选一份填入编辑框（不会发送）" : "本类还没有模板";
    select.append(blank);
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.name + (row.builtin ? "" : " · 自建");
      select.append(option);
    });
    if (state.aiPromptId && rows.some((row) => row.id === state.aiPromptId)) {
      select.value = state.aiPromptId;
    } else {
      state.aiPromptId = "";
      select.value = "";
    }
  }

  function fillAiRefs() {
    const select = document.getElementById("clothAiRef");
    if (!select) return;
    const boards = customBoards();
    const stock = stockTemplate();
    select.replaceChildren();
    const options = [
      { value: "none", label: "不参考，只按提示词" },
      ...(stock ? [{ value: "stock", label: "参考默认 UV（布局）" }] : []),
      { value: "canvas", label: "参考当前画布" },
      ...boards.map((row) => ({ value: "board:" + row.id, label: "底板 · " + row.name })),
    ];
    options.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.value;
      option.textContent = row.label;
      select.append(option);
    });
    const current = state.templateId || BLANK_ID;
    if (current !== BLANK_ID && stock && current === stock.id) select.value = "stock";
    else if (boards.some((row) => row.id === current)) select.value = "board:" + current;
    else select.value = "none";
  }

  function syncAiDialog(options = {}) {
    const keyInput = document.getElementById("clothAiKey");
    const custom = document.getElementById("clothAiModelCustom");
    if (keyInput && keyInput.value !== state.aiKey) keyInput.value = state.aiKey || "";
    fillAiModels();
    fillAiPromptPick();
    fillAiRefs();
    const contract = document.getElementById("clothAiContract");
    if (contract) contract.textContent = aiContractText();
    const patch = document.getElementById("clothAiPatch");
    if (patch && maskHasInk()) patch.checked = true;
    syncMaskChrome();
    if (!options.keepPrompt) {
      const textarea = document.getElementById("clothAiPrompt");
      if (textarea && !textarea.value.trim()) {
        const first = kindPrompts()[0];
        if (first) {
          state.aiPromptId = first.id;
          textarea.value = first.prompt;
          const pick = document.getElementById("clothAiPromptPick");
          if (pick) pick.value = first.id;
        }
      }
    }
    if (custom && state.aiModel && !(state.aiModels || []).includes(state.aiModel)) {
      custom.value = state.aiModel;
    }
  }

  function openAiDialog() {
    closeClothSheets();
    syncAiDialog();
    setAiStatus("");
    setModalVisible("dlgClothAi", true);
  }

  function closeAiDialog() {
    setModalVisible("dlgClothAi", false);
  }

  async function refreshAiModels() {
    const key = String(document.getElementById("clothAiKey")?.value || "").trim();
    if (!key) {
      setAiStatus("先填 API Key，再刷新模型。");
      return;
    }
    state.aiKey = key;
    saveAiSettings();
    setAiStatus("正在拉取图片模型…");
    try {
      const res = await fetch("/api/cloth-ai/models", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, baseUrl: "https://ai.qiaojiangapp.cn/v1" }),
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
    const textarea = document.getElementById("clothAiPrompt");
    const text = String(textarea?.value || "").trim();
    if (!text) {
      setAiStatus("编辑框是空的，没法保存。");
      return;
    }
    const current = selectedPrompt();
    let name = current?.name || (currentKind()?.label || "提示词") + "模板";
    if (!current || current.builtin) {
      const typed = typeof appPrompt === "function"
        ? await appPrompt("会保存到当前种类。选中它只会填进编辑框，不会自动出图。", {
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
      kind: state.kindId,
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
    const textarea = document.getElementById("clothAiPrompt");
    const fallback = (currentKind()?.label || "提示词") + "模板";
    const typed = typeof appPrompt === "function"
      ? await appPrompt("新建后出现在当前种类的下拉框里。选中只填入编辑框。", {
        title: "新建提示词模板",
        fieldLabel: "模板名称",
        value: fallback,
        okLabel: "创建",
      })
      : window.prompt("模板名称", fallback);
    if (typed == null) return;
    const item = {
      id: `p${Date.now().toString(36)}`,
      kind: state.kindId,
      name: String(typed).trim() || fallback,
      prompt: String(textarea?.value || "").trim() || (kindPrompts()[0]?.prompt || ""),
      savedAt: Date.now(),
    };
    state.prompts = [...(state.prompts || []), item];
    state.aiPromptId = item.id;
    if (textarea && !textarea.value.trim()) textarea.value = item.prompt;
    savePrompts();
    fillAiPromptPick();
    setAiStatus("已新建「" + item.name + "」。");
  }

  async function deletePromptTemplate() {
    const current = selectedPrompt();
    if (!current) {
      setAiStatus("先选一份要删的模板。");
      return;
    }
    const ok = typeof appConfirm === "function"
      ? await appConfirm("删掉后下拉框里不再出现。内置模板也可以藏起来，可用「恢复本类默认」找回。", {
        title: "删除提示词模板",
        okLabel: "删除",
      })
      : window.confirm("删除这份提示词模板？");
    if (!ok) return;
    state.prompts = (state.prompts || []).filter((row) => row.id !== current.id);
    if (current.builtin || String(current.id).startsWith("builtin:")) {
      state.promptDeletedIds = [...new Set([...(state.promptDeletedIds || []), current.id])];
    }
    state.aiPromptId = "";
    savePrompts();
    fillAiPromptPick();
    setAiStatus("已删除「" + current.name + "」。");
  }

  async function resetKindPrompts() {
    const ok = typeof appConfirm === "function"
      ? await appConfirm("会清掉这一类的自建/覆盖模板，并重新显示内置模板。编辑框里正在改的字不会自动发送。", {
        title: "恢复本类默认",
        okLabel: "恢复",
      })
      : window.confirm("恢复这一类的内置提示词模板？");
    if (!ok) return;
    const kindId = state.kindId;
    const builtinIds = new Set((state.promptDefaults || []).filter((row) => row.kind === kindId).map((row) => row.id));
    state.prompts = (state.prompts || []).filter((row) => row.kind !== kindId);
    state.promptDeletedIds = (state.promptDeletedIds || []).filter((id) => !builtinIds.has(id));
    state.aiPromptId = "";
    savePrompts();
    const textarea = document.getElementById("clothAiPrompt");
    const first = kindPrompts()[0];
    if (first && textarea) {
      state.aiPromptId = first.id;
      textarea.value = first.prompt;
    }
    fillAiPromptPick();
    setAiStatus("已恢复本类内置模板。");
  }

  async function imageDataUrl(url) {
    const image = await loadImage(url);
    const { width, height } = canvasSize();
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, width, height);
    return scratch.toDataURL("image/png");
  }

  async function aiReferencePng() {
    const value = document.getElementById("clothAiRef")?.value || "none";
    if (value === "none") return null;
    if (value === "canvas") return snapshotPng();
    if (value === "stock") {
      const stock = stockTemplate();
      if (!stock?.url) return null;
      return imageDataUrl(stock.url);
    }
    if (value.startsWith("board:")) {
      const board = (state.boards || []).find((row) => row.id === value.slice(6));
      if (!board?.png) return null;
      return board.png;
    }
    return null;
  }

  async function generateAiDesign() {
    const key = String(document.getElementById("clothAiKey")?.value || "").trim();
    const custom = String(document.getElementById("clothAiModelCustom")?.value || "").trim();
    const model = custom || String(document.getElementById("clothAiModel")?.value || "").trim();
    const prompt = String(document.getElementById("clothAiPrompt")?.value || "").trim();
    if (!key) {
      setAiStatus("先填 API Key。");
      return;
    }
    if (!model) {
      setAiStatus("先选或手填一个图片模型。");
      return;
    }
    if (!prompt) {
      setAiStatus("提示词是空的。可以先选一份模板再改。");
      return;
    }
    const patchOn = Boolean(document.getElementById("clothAiPatch")?.checked);
    const maskPng = patchOn ? exportMaskPng() : null;
    if (patchOn && !maskPng) {
      setAiStatus("先用笔触里的「圈选」涂要改的地方，再勾「只改圈选区域」。");
      return;
    }
    if (state.dirty && !maskPng) {
      const ok = typeof appConfirm === "function"
        ? await appConfirm("生成结果会画到当前画布上。未保存的笔触会被盖住。", { title: "生成到画布", okLabel: "生成" })
        : window.confirm("生成会盖住当前画布，继续？");
      if (!ok) return;
    }
    state.aiKey = key;
    state.aiModel = model;
    saveAiSettings();
    const button = document.getElementById("btnClothAiGenerate");
    if (button) button.disabled = true;
    setAiStatus("正在生成，可能要等一会儿…");
    try {
      const { width, height } = canvasSize();
      const referencePng = maskPng ? snapshotPng() : await aiReferencePng();
      const res = await fetch("/api/cloth-ai/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key,
          model,
          prompt,
          kind: state.kindId,
          width,
          height,
          referencePng,
          maskPng,
          baseUrl: "https://ai.qiaojiangapp.cn/v1",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ("HTTP " + res.status));
      if (!payload.png) throw new Error("没有返回图片");
      await restorePng(payload.png);
      commitHistory();
      markDirty();
      setAiStatus(maskPng ? "圈选已改，圈外像素锁在原画上。不满意可再圈、再生成。" : "已画到画布，可继续改提示词再生成。");
    } catch (error) {
      setAiStatus(String(error.message || error));
    } finally {
      if (button) button.disabled = false;
    }
  }

  function putClothSaves(payload) {
    return fetch("/api/saves/cloth", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json().catch(() => ({}));
    });
  }

  async function fetchClothSaves() {
    try {
      const res = await fetch("/api/saves/cloth", { credentials: "same-origin" });
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

  function boardsBundle() {
    return { v: 1, savedAt: Date.now(), items: state.boards };
  }

  function saveSession() {
    const snap = sessionSnapshot();
    persistSessionLocal(snap);
    putClothSaves({ session: snap }).catch((error) => console.warn(error));
    state.dirty = false;
    setSaveStatus("已保存");
  }

  async function saveDesign() {
    const name = String(document.getElementById("clothSaveName")?.value || "").trim() || currentKind()?.label || "未命名衣服";
    state.designName = name;
    const item = {
      id: `c${Date.now().toString(36)}`,
      name,
      kind: state.kindId,
      gender: state.gender,
      templateId: state.templateId,
      png: snapshotPng(),
      savedAt: Date.now(),
    };
    state.designs = [...state.designs, item].slice(-40);
    const bundle = designsBundle();
    persistDesignsLocal(bundle);
    renderDesigns();
    setModalVisible("dlgClothSave", false);
    try {
      await putClothSaves({ session: sessionSnapshot(), designs: bundle });
      state.dirty = false;
      setSaveStatus("已保存 " + name);
    } catch (error) {
      console.warn(error);
      setSaveStatus("本机已保存");
    }
  }

  async function saveBoard() {
    const fallback = currentKind()?.label || "底板";
    const name = typeof appPrompt === "function"
      ? await appPrompt("这块底板会出现在当前种类的列表里，以后可以点它接着画。", {
        title: "存为底板",
        fieldLabel: "底板名称",
        value: state.designName || fallback,
        placeholder: fallback,
        okLabel: "保存",
      })
      : window.prompt("底板名称", state.designName || fallback);
    if (name == null) return;
    const item = {
      id: `b${Date.now().toString(36)}`,
      name: String(name).trim() || fallback,
      kind: state.kindId,
      gender: state.gender,
      png: snapshotPng(),
      savedAt: Date.now(),
    };
    state.boards = [...state.boards, item].slice(-40);
    templateCtx.clearRect(0, 0, canvas.width, canvas.height);
    templateCtx.drawImage(canvas, 0, 0);
    state.templateId = item.id;
    const bundle = boardsBundle();
    persistBoardsLocal(bundle);
    renderTemplates();
    try {
      await putClothSaves({ session: sessionSnapshot(), boards: bundle });
      setSaveStatus("已存底板 " + item.name);
    } catch (error) {
      console.warn(error);
      setSaveStatus("本机已存底板");
    }
  }

  async function deleteBoard(template) {
    if (!template?.custom) return;
    const ok = typeof appConfirm === "function"
      ? await appConfirm(`删除底板「${template.name}」？`, { title: "删除底板", okLabel: "删除", danger: true })
      : window.confirm("删除这块底板？");
    if (!ok) return;
    state.boards = state.boards.filter((row) => row.id !== template.id);
    if (state.templateId === template.id) state.templateId = BLANK_ID;
    const bundle = boardsBundle();
    persistBoardsLocal(bundle);
    renderTemplates();
    putClothSaves({ boards: bundle }).catch((error) => console.warn(error));
  }

  async function openDesign(item) {
    state.designName = item.name || "";
    state.gender = item.gender === "male" ? "male" : "female";
    await selectKind(item.kind, { templateId: item.templateId, png: item.png, silent: true, keepHistory: false });
    document.getElementById("clothSaveName").value = item.name || "";
    renderKinds();
    renderTemplates();
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
      if (!prev || Number(item.savedAt) >= Number(prev.savedAt)) byId.set(item.id, item);
    });
    return { items: [...byId.values()], savedAt: Math.max(Number(local?.savedAt) || 0, Number(remote?.savedAt) || 0) };
  }

  function mergeBoards(local, remote) {
    return mergeDesigns(local, remote);
  }

  function pointerCount() {
    return pointers.size;
  }

  function paintPointFrom(event) {
    const point = boardPoint(event);
    return event.shiftKey ? lockAxis(point) : point;
  }

  function beginPaint(event) {
    const point = paintPointFrom(event);
    strokeOrigin = point;
    if (state.tool === "pan") return;
    if (state.tool === "eyedrop") {
      pickColor(point.x, point.y);
      painting = true;
      return;
    }
    if (state.tool === "fill") {
      floodFill(point.x, point.y);
      commitHistory();
      markDirty();
      return;
    }
    if (state.tool === "line") {
      lineStart = point;
      painting = true;
      strokeDirty = true;
      return;
    }
    painting = true;
    lastPoint = point;
    smoothPoint = point;
    if (state.tool !== "patch") {
      strokeDirty = true;
      stamp(point.x, point.y, event);
      markDirty();
      return;
    }
    stamp(point.x, point.y, event);
  }

  function movePaint(event) {
    if (!painting || state.tool === "pan" || state.tool === "fill") return;
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    const list = samples.length ? samples : [event];
    list.forEach((sample) => {
      const point = paintPointFrom(sample);
      if (state.tool === "eyedrop") {
        pickColor(point.x, point.y);
        return;
      }
      if (state.tool === "line") {
        drawLineGhost(lineStart, point, sample);
        return;
      }
      if (lastPoint && smoothPoint) {
        const mid = { x: (smoothPoint.x + point.x) / 2, y: (smoothPoint.y + point.y) / 2 };
        stroke(lastPoint, mid, sample);
        lastPoint = mid;
      } else if (lastPoint) {
        stroke(lastPoint, point, sample);
        lastPoint = point;
      }
      smoothPoint = point;
    });
  }

  function endPaint(event) {
    if (state.tool === "line" && painting && lineStart) {
      const point = paintPointFrom(event);
      clearGhost();
      stroke(lineStart, point, event);
      markDirty();
    }
    if (strokeDirty) commitHistory();
    strokeDirty = false;
    painting = false;
    lineStart = null;
    lastPoint = null;
    strokeOrigin = null;
    smoothPoint = null;
    clearGhost();
    if (state.tool === "patch") syncMaskChrome();
  }

  function beginGesture() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
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
    if (!gesture) return;
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy) || 1;
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const nextZoom = Math.min(12, Math.max(0.2, gesture.zoom * (dist / gesture.dist)));
    state.panX = gesture.panX + (midX - gesture.midX);
    state.panY = gesture.panY + (midY - gesture.midY);
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

  function workspaceMode() {
    return window.MobileWorkspace?.modeForViewport() || { mobile: false, tablet: false };
  }

  function closeClothSheets() {
    window.MobileWorkspace?.closeSheet("cloth-templates");
    window.MobileWorkspace?.closeSheet("cloth-tools");
  }

  function bindSheets() {
    window.MobileWorkspace?.registerSheet({
      id: "cloth-templates",
      root: "#clothTemplateSheet",
      trigger: "#btnClothMobileTemplates",
      backdrop: "#clothSheetBackdrop",
      inert: [".cloth-stage", ".cloth-app .topbar"],
      initialFocus: "#btnClothTemplatesClose",
      mutex: "cloth-workspace",
    });
    window.MobileWorkspace?.registerSheet({
      id: "cloth-tools",
      root: "#clothToolSheet",
      trigger: "#btnClothMobileTools",
      backdrop: "#clothSheetBackdrop",
      inert: [".cloth-stage", ".cloth-app .topbar"],
      initialFocus: "#btnClothToolsClose",
      mutex: "cloth-workspace",
    });
    document.getElementById("btnClothMobileTemplates")?.addEventListener("click", () => {
      window.MobileWorkspace?.toggleSheet("cloth-templates");
    });
    document.getElementById("btnClothMobileTools")?.addEventListener("click", () => {
      window.MobileWorkspace?.toggleSheet("cloth-tools");
    });
    document.getElementById("btnClothMobileFiles")?.addEventListener("click", () => {
      window.MobileWorkspace?.toggleSheet("cloth-tools");
    });
    document.getElementById("btnClothTemplatesClose")?.addEventListener("click", () => window.MobileWorkspace?.closeSheet("cloth-templates"));
    document.getElementById("btnClothToolsClose")?.addEventListener("click", () => window.MobileWorkspace?.closeSheet("cloth-tools"));
    document.getElementById("clothSheetBackdrop")?.addEventListener("click", () => closeClothSheets());
  }

  function bindUi() {
    document.querySelectorAll("#genderRow [data-gender]").forEach((button) => {
      button.addEventListener("click", () => {
        state.gender = button.dataset.gender;
        document.querySelectorAll("#genderRow [data-gender]").forEach((node) => {
          const on = node === button;
          node.classList.toggle("on", on);
          node.setAttribute("aria-selected", String(on));
        });
        const next = kindsForGender(state.gender).find((kind) => kind.id === state.kindId) || kindsForGender(state.gender)[0];
        if (next) selectKind(next.id);
        else renderKinds();
      });
    });
    document.getElementById("btnSaveBoard")?.addEventListener("click", () => saveBoard());
    document.getElementById("btnClothAi")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnClothAiHud")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnClothAiRail")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnClothMobileAi")?.addEventListener("click", () => openAiDialog());
    document.getElementById("btnClothAiModels")?.addEventListener("click", () => refreshAiModels());
    document.getElementById("btnClothAiPromptNew")?.addEventListener("click", () => createPromptTemplate());
    document.getElementById("btnClothAiPromptSave")?.addEventListener("click", () => saveCurrentPrompt());
    document.getElementById("btnClothAiPromptDel")?.addEventListener("click", () => deletePromptTemplate());
    document.getElementById("btnClothAiPromptReset")?.addEventListener("click", () => resetKindPrompts());
    document.getElementById("btnClothAiGenerate")?.addEventListener("click", () => generateAiDesign());
    document.getElementById("btnClearMask")?.addEventListener("click", () => clearMask());
    document.getElementById("clothAiPatch")?.addEventListener("change", () => {
      const on = Boolean(document.getElementById("clothAiPatch")?.checked);
      if (on && !maskHasInk()) {
        setTool("patch");
        closeAiDialog();
      }
      const contract = document.getElementById("clothAiContract");
      if (contract) contract.textContent = aiContractText();
      syncMaskChrome();
    });
    document.getElementById("clothAiPromptPick")?.addEventListener("change", (event) => {
      const id = event.target.value;
      state.aiPromptId = id;
      const row = kindPrompts().find((item) => item.id === id);
      const textarea = document.getElementById("clothAiPrompt");
      if (row && textarea) textarea.value = row.prompt;
      setAiStatus(row ? "已填入「" + row.name + "」，可以改完再生成。" : "");
    });
    document.getElementById("clothAiKey")?.addEventListener("change", () => {
      state.aiKey = String(document.getElementById("clothAiKey")?.value || "").trim();
      saveAiSettings();
    });
    document.getElementById("clothAiModel")?.addEventListener("change", (event) => {
      state.aiModel = event.target.value || "";
      const custom = document.getElementById("clothAiModelCustom");
      if (custom && state.aiModel) custom.value = "";
      saveAiSettings();
    });
    document.getElementById("clothAiModelCustom")?.addEventListener("change", () => {
      const custom = String(document.getElementById("clothAiModelCustom")?.value || "").trim();
      if (custom) state.aiModel = custom;
      saveAiSettings();
    });
    document.getElementById("brushSize")?.addEventListener("input", (event) => {
      setBrushSize(event.target.value);
    });
    document.getElementById("sizePresets")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-size]");
      if (button) setBrushSize(button.dataset.size);
    });
    document.getElementById("paintColor")?.addEventListener("input", (event) => {
      state.color = event.target.value || "#000000";
    });
    document.getElementById("btnUndo")?.addEventListener("click", () => undo());
    document.getElementById("btnRedo")?.addEventListener("click", () => redo());
    document.getElementById("btnClothMobileUndo")?.addEventListener("click", () => undo());
    document.getElementById("btnClothMobileRedo")?.addEventListener("click", () => redo());
    document.getElementById("btnClothMobilePan")?.addEventListener("click", () => {
      setTool(state.tool === "pan" ? "round" : "pan");
    });
    document.getElementById("btnClothMobileNew")?.addEventListener("click", () => startNewDesign());
    document.getElementById("btnNewDesign")?.addEventListener("click", () => startNewDesign());
    document.getElementById("btnNewDesignRail")?.addEventListener("click", () => startNewDesign());
    document.getElementById("btnImportPng")?.addEventListener("click", () => document.getElementById("fileClothImage")?.click());
    document.getElementById("btnExportPng")?.addEventListener("click", () => exportJpg());
    document.getElementById("btnRestore")?.addEventListener("click", () => restoreDefault());
    document.getElementById("btnPreview")?.addEventListener("click", () => showPreview());
    ["previewClothPick", "previewHairPick", "previewExprPick", "previewFacePick"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        applyPreviewSlots({ update: true }).catch((error) => console.warn(error));
      });
    });
    document.getElementById("btnSaveDesign")?.addEventListener("click", () => {
      const input = document.getElementById("clothSaveName");
      if (input && !input.value) input.value = currentKind()?.label || "";
      setModalVisible("dlgClothSave", true);
    });
    document.getElementById("btnClothSaveOk")?.addEventListener("click", () => saveDesign());
    document.querySelectorAll("[data-cloth-io]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.clothIo;
        if (action === "new") startNewDesign();
        if (action === "import") document.getElementById("fileClothImage")?.click();
        if (action === "export") exportJpg();
        if (action === "restore") restoreDefault();
        if (action === "preview") showPreview();
      });
    });
    document.getElementById("fileClothImage")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      importImageFile(file);
    });
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.closeModal;
        if (id === "dlgClothAi") closeAiDialog();
        else setModalVisible(id, false);
      });
    });
    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", onPointerUp);
    board.addEventListener("pointercancel", onPointerUp);
    board.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (event.altKey) {
        setBrushSize(state.size + (event.deltaY < 0 ? 1 : -1));
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      const before = boardPoint(event);
      const next = Math.min(12, Math.max(0.2, state.zoom * (event.deltaY < 0 ? 1.12 : 0.9)));
      state.zoom = next;
      const rect = board.getBoundingClientRect();
      state.panX = point.x - rect.left - before.x * next;
      state.panY = point.y - rect.top - before.y * next;
      applyCamera();
    }, { passive: false });
    document.addEventListener("keydown", (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "");
      if (event.key === "Escape") {
        closeClothSheets();
        setModalVisible("dlgClothPreview", false);
        setModalVisible("dlgClothSave", false);
        closeAiDialog();
        return;
      }
      if (!typing && event.code === "Space" && !event.repeat) {
        event.preventDefault();
        if (!spacePan) {
          spacePan = true;
          toolBeforePan = state.tool;
          setTool("pan");
        }
        return;
      }
      if (!typing && (event.key === "[" || event.key === "]")) {
        event.preventDefault();
        setBrushSize(state.size + (event.key === "]" ? 1 : -1));
        return;
      }
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && TOOL_KEYS[event.key]) {
        event.preventDefault();
        setTool(TOOL_KEYS[event.key]);
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    });
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space" && spacePan) {
        spacePan = false;
        setTool(toolBeforePan || "round");
      }
    });
    window.addEventListener("resize", () => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => fitCanvas(), 80);
    });
    window.MobileWorkspace?.onModeChange(() => {
      fitCanvas();
      if (!workspaceMode().mobile) closeClothSheets();
    });
    syncHistoryButtons();
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
          .finally(() => window.location.assign(href));
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

  async function restoreSession(snap) {
    if (!snap || typeof snap !== "object") return false;
    if (snap.gender === "male" || snap.gender === "female") state.gender = snap.gender;
    state.tool = TOOLS.some((tool) => tool.id === snap.tool) ? snap.tool : state.tool;
    state.color = snap.color || state.color;
    state.size = Math.max(1, Number(snap.size) || state.size);
    state.designName = snap.designName || "";
    const color = document.getElementById("paintColor");
    if (color) color.value = state.color;
    setBrushSize(state.size);
    document.getElementById("clothSaveName").value = state.designName;
    document.querySelectorAll("#genderRow [data-gender]").forEach((node) => {
      const on = node.dataset.gender === state.gender;
      node.classList.toggle("on", on);
      node.setAttribute("aria-selected", String(on));
    });
    await selectKind(snap.kindId || state.kindId, {
      templateId: (state.boards || []).some((row) => row.id === snap.templateId) ? snap.templateId : BLANK_ID,
      png: snap.png,
      silent: true,
      keepHistory: false,
    });
    if (snap.outfit && typeof snap.outfit === "object") {
      state.outfit = {
        bodyKind: snap.outfit.bodyKind || "",
        cloth: snap.outfit.cloth && typeof snap.outfit.cloth === "object" ? snap.outfit.cloth : {},
        hair: snap.outfit.hair || "",
        expression: snap.outfit.expression || "",
        face: snap.outfit.face || "",
      };
    }
    setTool(state.tool);
    return true;
  }

  async function boot() {
    if (window.deskAccountReady) await window.deskAccountReady;
    document.documentElement.classList.add("boot-pending");
    window.MobileWorkspace?.init();
    fillTools();
    fillSwatches();
    setBrushSize(state.size);
    bindSheets();
    bindUi();
    const [catalog, remote, promptDoc] = await Promise.all([
      fetch("/data/cloth_catalog.json", { credentials: "same-origin", cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error("catalog " + res.status);
        return res.json();
      }),
      fetchClothSaves(),
      fetch("/data/cloth_ai_prompts.json", { credentials: "same-origin", cache: "no-store" }).then(async (res) => {
        if (!res.ok) return { templates: [] };
        return res.json();
      }).catch(() => ({ templates: [] })),
    ]);
    if (!catalog || !Array.isArray(catalog.kinds) || !catalog.kinds.length) {
      throw new Error("empty cloth catalog");
    }
    state.catalog = catalog;
    let localDesigns = { items: [] };
    try {
      localDesigns = JSON.parse(deskGet(DESIGNS_KEY) || "null") || { items: [] };
    } catch {
      localDesigns = { items: [] };
    }
    const merged = mergeDesigns(localDesigns, remote?.designs);
    state.designs = merged.items || [];
    persistDesignsLocal({ v: 1, savedAt: merged.savedAt || Date.now(), items: state.designs });
    let localBoards = { items: [] };
    try {
      localBoards = JSON.parse(deskGet(BOARDS_KEY) || "null") || { items: [] };
    } catch {
      localBoards = { items: [] };
    }
    const mergedBoards = mergeBoards(localBoards, remote?.boards);
    state.boards = mergedBoards.items || [];
    persistBoardsLocal({ v: 1, savedAt: mergedBoards.savedAt || Date.now(), items: state.boards });
    state.promptDefaults = Array.isArray(promptDoc?.templates) ? promptDoc.templates : [];
    let localAi = {};
    try {
      localAi = JSON.parse(deskGet(AI_KEY) || "null") || {};
    } catch {
      localAi = {};
    }
    const ai = ((Number(localAi.savedAt) || 0) >= (Number(remote?.ai?.savedAt) || 0) ? localAi : remote?.ai) || {};
    state.aiKey = String(ai.apiKey || "");
    state.aiModel = String(ai.model || "");
    let localPrompts = { items: [], deletedIds: [] };
    try {
      localPrompts = JSON.parse(deskGet(PROMPTS_KEY) || "null") || localPrompts;
    } catch {
      localPrompts = { items: [], deletedIds: [] };
    }
    const localPromptAt = Number(localPrompts.savedAt) || 0;
    const remotePromptAt = Number(remote?.prompts?.savedAt) || 0;
    const promptState = localPromptAt >= remotePromptAt ? localPrompts : (remote?.prompts || localPrompts);
    state.prompts = Array.isArray(promptState.items) ? promptState.items : [];
    state.promptDeletedIds = Array.isArray(promptState.deletedIds) ? promptState.deletedIds : [];
    const push = {};
    if ((merged.items || []).length && (!remote?.designs?.items || !remote.designs.items.length)) {
      push.designs = designsBundle();
    }
    if ((mergedBoards.items || []).length && (!remote?.boards?.items || !remote.boards.items.length)) {
      push.boards = boardsBundle();
    }
    if ((state.prompts.length || (state.promptDeletedIds || []).length) && (!remote?.prompts?.items || !remote.prompts.items.length) && !(remote?.prompts?.deletedIds || []).length) {
      push.prompts = promptsBundle();
    }
    if (state.aiKey && !remote?.ai?.apiKey) {
      push.ai = aiSettingsBundle();
    }
    if (Object.keys(push).length) putClothSaves(push).catch((error) => console.warn(error));
    renderKinds();
    renderDesigns();
    let localSession = null;
    try {
      localSession = JSON.parse(deskGet(SESSION_KEY) || "null");
    } catch {
      localSession = null;
    }
    const session = (Number(localSession?.savedAt) || 0) >= (Number(remote?.session?.savedAt) || 0) ? localSession : remote?.session;
    try {
      if (!(await restoreSession(session))) {
        await selectKind(state.kindId, { clear: true, keepHistory: false });
      }
    } catch (error) {
      console.warn(error);
      await selectKind(state.kindId, { clear: true, keepHistory: false });
    }
    wireDeskSwitchSave(() => {
      const snap = sessionSnapshot();
      persistSessionLocal(snap);
      putClothSaves({ session: snap }).catch((error) => console.warn(error));
    });
    warmOtherDesk("/web/building.html", ["/web/building.js?v=280"]);
    warmOtherDesk("/", ["/web/app.js?v=293"]);
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("boot-pending");
      document.documentElement.classList.add("boot-ready");
      fitCanvas();
    });
  }

  boot().catch((error) => {
    console.warn(error);
    const meta = document.getElementById("kindMeta");
    if (meta) meta.textContent = "底板目录加载失败，请刷新。";
    document.documentElement.classList.remove("boot-pending");
    document.documentElement.classList.add("boot-ready");
  });
})();
