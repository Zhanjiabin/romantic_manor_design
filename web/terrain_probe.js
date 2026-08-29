"use strict";

const VIEW_W = 512;
const VIEW_H = 320;
const TILE_W = 64;
const TILE_H = 32;
const DIAMOND_W = 65;
const DIAMOND_H = 33;
const SOURCE_URL = "/tiles/maptexture/c01.jpg";
const REFERENCE_URL = "/probe/reference.jpg";
const METRICS_URL = "/data/terrain_probe_metrics.json";

const canvases = {
  reference: document.getElementById("reference"),
  source: document.getElementById("source"),
  continuous: document.getElementById("continuous"),
  scanline: document.getElementById("scanline"),
  importCache: document.getElementById("importCache"),
};

const state = {
  source: null,
  reference: null,
  sourcePixels: null,
  smoothing: false,
  zoom: 1,
  camera: { x: 0, y: 0 },
  importTiles: new Map(),
  importVariants: [],
  plainVariants: [],
  decoratedVariants: [],
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取 " + url));
    image.src = url;
  });
}

async function boot() {
  bindControls();
  try {
    [state.source, state.reference] = await Promise.all([
      loadImage(SOURCE_URL),
      loadImage(REFERENCE_URL),
    ]);
    state.sourcePixels = readSourcePixels(state.source);
    buildImportedVariants();
    renderAll();
  } catch (error) {
    showFailure(error);
  }
  loadMetrics();
}

function bindControls() {
  const zoom = document.getElementById("zoom");
  const smoothing = document.getElementById("smoothing");
  zoom.addEventListener("change", () => {
    state.zoom = Number(zoom.value) || 1;
    applyDisplayScale();
  });
  smoothing.addEventListener("change", () => {
    state.smoothing = smoothing.checked;
    renderAll();
  });
  document.getElementById("reset").addEventListener("click", () => {
    state.camera.x = 0;
    state.camera.y = 0;
    state.importTiles.clear();
    renderAll();
  });
}

function readSourcePixels(image) {
  const scratch = document.createElement("canvas");
  scratch.width = image.naturalWidth;
  scratch.height = image.naturalHeight;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, scratch.width, scratch.height);
}

function configure(context) {
  context.imageSmoothingEnabled = state.smoothing;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
}

function renderAll() {
  if (!state.source || !state.reference) return;
  drawReference();
  drawSource();
  drawContinuous();
  drawIso("scanline");
  drawIso("importCache");
  applyDisplayScale();
}

function drawReference() {
  const context = canvases.reference.getContext("2d");
  configure(context);
  // The screenshot is 1024×603. This crop removes the frame and bottom UI;
  // the few in-world objects remain visible so accidental "cleaning" is obvious.
  context.drawImage(
    state.reference,
    4, 12, state.reference.naturalWidth - 10, state.reference.naturalHeight - 33,
    0, 0, VIEW_W, VIEW_H
  );
}

function drawSource() {
  const context = canvases.source.getContext("2d");
  configure(context);
  context.drawImage(state.source, 0, 0);
}

function drawContinuous() {
  const context = canvases.continuous.getContext("2d");
  configure(context);
  const width = state.source.naturalWidth;
  const height = state.source.naturalHeight;
  const phaseX = positiveMod(state.camera.x, width);
  const phaseY = positiveMod(state.camera.y, height);
  for (let y = -phaseY; y < VIEW_H; y += height) {
    for (let x = -phaseX; x < VIEW_W; x += width) {
      context.drawImage(state.source, x, y);
    }
  }
}

function drawIso(mode) {
  const canvas = canvases[mode];
  const context = canvas.getContext("2d");
  configure(context);
  context.fillStyle = "#1a6928";
  context.fillRect(0, 0, VIEW_W, VIEW_H);

  const firstRow = Math.floor(state.camera.y / (TILE_H / 2)) - 2;
  const rows = Math.ceil(VIEW_H / (TILE_H / 2)) + 5;
  for (let row = firstRow; row < firstRow + rows; row += 1) {
    const screenY = row * (TILE_H / 2) - state.camera.y;
    const offset = (row & 1) ? TILE_W / 2 : 0;
    const firstCol = Math.floor((state.camera.x - offset) / TILE_W) - 2;
    const cols = Math.ceil(VIEW_W / TILE_W) + 5;
    for (let col = firstCol; col < firstCol + cols; col += 1) {
      const screenX = col * TILE_W + offset - state.camera.x;
      let sourceX;
      let sourceY;
      if (mode === "scanline") {
        // Preserve screen-space phase while assembling 65×33 scanline diamonds.
        sourceX = screenX + state.camera.x;
        sourceY = screenY + state.camera.y;
        const tile = diamondTile(sourceX, sourceY, false);
        context.drawImage(tile, screenX - TILE_W / 2, screenY - TILE_H / 2);
      } else {
        const tile = importedVariant(col, row);
        context.drawImage(tile, screenX - TILE_W / 2, screenY - TILE_H / 2);
      }
    }
  }
}

function buildImportedVariants() {
  const width = state.sourcePixels.width;
  const height = state.sourcePixels.height;
  const columns = Math.ceil(width / TILE_W);
  state.importVariants = [];
  state.plainVariants = [];
  state.decoratedVariants = [];
  for (let index = 0; ; index++) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const sourceX = col * TILE_W + ((row & 1) ? TILE_W / 2 : 0);
    const sourceY = row * (TILE_H / 2);
    if (sourceY + DIAMOND_H > height) break;
    if (sourceX + DIAMOND_W > width) continue;
    const tile = importedDiamond(sourceX, sourceY);
    state.importVariants.push(tile);
    (tileHasYellow(tile) ? state.decoratedVariants : state.plainVariants).push(tile);
  }
}

function importedDiamond(sourceX, sourceY) {
  const key = sourceX + ":" + sourceY;
  if (state.importTiles.has(key)) return state.importTiles.get(key);
  const tile = document.createElement("canvas");
  tile.width = DIAMOND_W;
  tile.height = DIAMOND_H;
  const context = tile.getContext("2d");
  const output = context.createImageData(DIAMOND_W, DIAMOND_H);
  const source = state.sourcePixels.data;
  const sourceWidth = state.sourcePixels.width;
  for (let row = 0; row < DIAMOND_H; row++) {
    const width = 1 + 4 * (row <= 16 ? row : 32 - row);
    const start = (DIAMOND_W - width) >> 1;
    for (let localX = start; localX < start + width; localX++) {
      const srcIndex = ((sourceY + row) * sourceWidth + sourceX + localX) * 4;
      const dstIndex = (row * DIAMOND_W + localX) * 4;
      output.data[dstIndex] = source[srcIndex];
      output.data[dstIndex + 1] = source[srcIndex + 1];
      output.data[dstIndex + 2] = source[srcIndex + 2];
      output.data[dstIndex + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  state.importTiles.set(key, tile);
  return tile;
}

function tileHasYellow(tile) {
  const data = tile.getContext("2d").getImageData(0, 0, tile.width, tile.height).data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    if (data[i + 3] && red > 120 && green > 100 && blue < 100 && red > blue + 35) return true;
  }
  return false;
}

function importedVariant(col, row) {
  const hash = stableHash(col, row);
  const decorated = state.decoratedVariants;
  const plain = state.plainVariants.length ? state.plainVariants : state.importVariants;
  const pool = decorated.length && hash % 1000 < 16 ? decorated : plain;
  return pool[(hash >>> 8) % pool.length];
}

function stableHash(col, row) {
  let hash = Math.imul(col | 0, 73856093) ^ Math.imul(row | 0, 19349663) ^ Math.imul(0xc01, 83492791);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function diamondTile(sourceX, sourceY, cache) {
  const srcW = state.sourcePixels.width;
  const srcH = state.sourcePixels.height;
  const wrappedX = positiveMod(Math.round(sourceX), srcW);
  const wrappedY = positiveMod(Math.round(sourceY), srcH);
  const key = wrappedX + ":" + wrappedY;
  if (cache && state.importTiles.has(key)) return state.importTiles.get(key);

  const tile = document.createElement("canvas");
  tile.width = DIAMOND_W;
  tile.height = DIAMOND_H;
  const context = tile.getContext("2d");
  const output = context.createImageData(DIAMOND_W, DIAMOND_H);
  const source = state.sourcePixels.data;

  for (let row = 0; row < DIAMOND_H; row += 1) {
    const width = 1 + 4 * (row <= 16 ? row : 32 - row);
    const start = (DIAMOND_W - width) >> 1;
    for (let localX = start; localX < start + width; localX += 1) {
      const sx = positiveMod(wrappedX + localX - 32, srcW);
      const sy = positiveMod(wrappedY + row - 16, srcH);
      const srcIndex = (sy * srcW + sx) * 4;
      const dstIndex = (row * DIAMOND_W + localX) * 4;
      output.data[dstIndex] = source[srcIndex];
      output.data[dstIndex + 1] = source[srcIndex + 1];
      output.data[dstIndex + 2] = source[srcIndex + 2];
      output.data[dstIndex + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  if (cache) state.importTiles.set(key, tile);
  return tile;
}

function positiveMod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function applyDisplayScale() {
  const mode = state.smoothing ? "auto" : "pixelated";
  Object.values(canvases).forEach((canvas) => {
    canvas.style.width = canvas.width * state.zoom + "px";
    canvas.style.height = canvas.height * state.zoom + "px";
    canvas.style.imageRendering = mode;
  });
}

async function loadMetrics() {
  const status = document.getElementById("metricsStatus");
  try {
    const response = await fetch(METRICS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const metrics = await response.json();
    status.textContent = "分析后端：" + metrics.backend + " · " + metrics.generated_at;
    renderMetrics(metrics);
  } catch (error) {
    status.textContent = "尚无分析结果；请先运行 tools/terrain_probe.py";
  }
}

function renderMetrics(metrics) {
  const body = document.getElementById("metricsBody");
  body.replaceChildren();
  const best = metrics.scale_search && metrics.scale_search.best;
  const decisive = metrics.scale_search && metrics.scale_search.decisive;
  addMetric(
    "最佳纹理倍率",
    best ? best.scale.toFixed(3) + "×" + (decisive ? "" : "（弱峰）") : "n/a",
    decisive ? "good" : "warn"
  );
  addMetric("尺度相关峰", best ? best.score.toFixed(4) : "n/a");
  addMetric("原版黄像素", formatInt(metrics.reference.yellow.pixel_count));
  addMetric("原版黄花簇", formatInt(metrics.reference.yellow.cluster_count));
  addMetric("c01 黄像素", formatInt(metrics.source.yellow.pixel_count));
  addMetric("c01 黄花簇", formatInt(metrics.source.yellow.cluster_count));
  const groups = metrics.comparison && metrics.comparison.rank_groups;
  const rankingText = groups
    ? groups.map((group) => group.join(" = ")).join(" › ")
    : "n/a";
  addMetric("候选综合排序", rankingText, groups ? "good" : "");
  addMetric("原版强周期", strongestPeriod(metrics.reference.periodicity));
  const validated = metrics.validated_engine_model;
  if (validated) {
    addMetric("GTile 有效变体", formatInt(validated.rule.variant_count));
    addMetric(
      "花簇密度误差",
      (validated.flower_cluster_density_error * 100).toFixed(2) + "%",
      validated.acceptance.flower_density_within_15_percent ? "good" : "warn"
    );
    const checks = Object.values(validated.acceptance);
    addMetric(
      "最终验收",
      checks.every(Boolean) ? "全部通过" : "有未通过项",
      checks.every(Boolean) ? "good" : "warn"
    );
  }

  function addMetric(label, value, kind) {
    const node = document.getElementById("metricTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector("strong").textContent = label;
    node.querySelector("span").textContent = value;
    if (kind) node.classList.add(kind);
    body.appendChild(node);
  }
}

function strongestPeriod(periodicity) {
  const peaks = periodicity && periodicity.lags;
  if (!peaks) return "n/a";
  const entries = Object.entries(peaks).map(([lag, axes]) => {
    return [lag, Math.max(axes.x || -1, axes.y || -1)];
  });
  entries.sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] + "px / " + entries[0][1].toFixed(3) : "n/a";
}

function formatInt(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function showFailure(error) {
  document.querySelectorAll(".canvas-shell, .source-shell").forEach((shell) => {
    shell.textContent = "加载失败：" + error.message;
    shell.classList.add("error");
  });
}

boot();
