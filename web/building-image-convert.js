(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BuildingImageConvert = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CATEGORY_LAYERS = ["地面", "墙壁", "屋顶", "门窗", "装饰"];
  const MAX_COORD = 2047;
  const GRAY_SIZE = 16;
  const PHASH_BITS = 64;
  const THRESHOLDS = {
    loose: { hamming: 22, ncc: 0.22, sizeLo: 0.45, sizeHi: 2.2 },
    medium: { hamming: 16, ncc: 0.38, sizeLo: 0.62, sizeHi: 1.6 },
    strict: { hamming: 11, ncc: 0.52, sizeLo: 0.74, sizeHi: 1.38 },
  };
  const MIN_APPLY_CONFIDENCE = 0.45;
  const FOOT_MODEL_VERSION = "desk-stampFootOffset-v1";
  const UNRESOLVED_STATUS = "未识别：截图自动还原尚未完成，不会铺默认地基或墙。请手绘墙线后再选件。";

  function sceneToIso(x, y) {
    return { u: x / 4 + y / 2, v: x / 4 - y / 2 };
  }

  function isoToScene(u, v) {
    return { x: 2 * (u + v), y: u - v };
  }

  function paperClamp(x, y) {
    return {
      x: Math.max(0, Math.min(MAX_COORD, Math.round(Number(x) || 0))),
      y: Math.max(0, Math.min(MAX_COORD, Math.round(Number(y) || 0))),
    };
  }

  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function rgbDistance(a, b) {
    const dr = (a?.[0] || 0) - (b?.[0] || 0);
    const dg = (a?.[1] || 0) - (b?.[1] || 0);
    const db = (a?.[2] || 0) - (b?.[2] || 0);
    return dr * dr + dg * dg + db * db;
  }

  function decodeGray16(b64) {
    if (!b64) return null;
    try {
      if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }

  function encodeGray16(gray) {
    const bytes = gray instanceof Uint8Array ? gray : Uint8Array.from(gray);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary);
  }

  function phashFromGray16(gray) {
    const cells = new Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let total = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) total += gray[(y * 2 + dy) * GRAY_SIZE + (x * 2 + dx)] || 0;
        }
        cells[y * 8 + x] = total / 4;
      }
    }
    const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
    let bits = 0n;
    cells.forEach((value, index) => {
      if (value > mean) bits |= 1n << BigInt(63 - index);
    });
    return bits.toString(16).padStart(16, "0");
  }

  function hammingHex(a, b) {
    if (!a || !b) return PHASH_BITS;
    const left = BigInt(`0x${a}`);
    const right = BigInt(`0x${b}`);
    let xor = left ^ right;
    let count = 0;
    while (xor) {
      xor &= xor - 1n;
      count += 1;
    }
    return count;
  }

  function ncc(a, b) {
    if (!a || !b) return 0;
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= n;
    mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const xa = a[i] - ma;
      const xb = b[i] - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    if (da < 1e-6 || db < 1e-6) return 0;
    return num / Math.sqrt(da * db);
  }

  function edgeHistogram(gray) {
    const bins = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let y = 1; y < GRAY_SIZE - 1; y++) {
      for (let x = 1; x < GRAY_SIZE - 1; x++) {
        const gx = (gray[y * GRAY_SIZE + x + 1] || 0) - (gray[y * GRAY_SIZE + x - 1] || 0);
        const gy = (gray[(y + 1) * GRAY_SIZE + x] || 0) - (gray[(y - 1) * GRAY_SIZE + x] || 0);
        if (!gx && !gy) continue;
        const angle = (Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI);
        bins[Math.min(7, Math.floor(angle * 8))] += 1;
      }
    }
    return bins;
  }

  function resizeGray(src, srcW, srcH, dstW, dstH) {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      const sy = ((y + 0.5) * srcH) / dstH - 0.5;
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)));
      const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
      const fy = sy - y0;
      for (let x = 0; x < dstW; x++) {
        const sx = ((x + 0.5) * srcW) / dstW - 0.5;
        const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)));
        const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
        const fx = sx - x0;
        const a = src[y0 * srcW + x0] || 0;
        const b = src[y0 * srcW + x1] || 0;
        const c = src[y1 * srcW + x0] || 0;
        const d = src[y1 * srcW + x1] || 0;
        out[y * dstW + x] = Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
      }
    }
    return out;
  }

  function rgbaToGray(data, width, height) {
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = data[p + 3] < 16 ? 0 : luminance(data[p], data[p + 1], data[p + 2]);
    }
    return gray;
  }

  function meanRgbOf(data, width, height, rect) {
    const left = Math.max(0, Math.floor(rect?.x || 0));
    const top = Math.max(0, Math.floor(rect?.y || 0));
    const right = Math.min(width, Math.ceil((rect?.x || 0) + (rect?.w || width)));
    const bottom = Math.min(height, Math.ceil((rect?.y || 0) + (rect?.h || height)));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const o = (y * width + x) * 4;
        if (data[o + 3] < 40) continue;
        r += data[o];
        g += data[o + 1];
        b += data[o + 2];
        n += 1;
      }
    }
    if (!n) return [0, 0, 0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function fingerprintFromRgba(data, width, height, rect) {
    const x = Math.max(0, Math.floor(rect?.x || 0));
    const y = Math.max(0, Math.floor(rect?.y || 0));
    const w = Math.max(1, Math.min(width - x, Math.ceil(rect?.w || width)));
    const h = Math.max(1, Math.min(height - y, Math.ceil(rect?.h || height)));
    const patch = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const o = ((y + row) * width + (x + col)) * 4;
        patch[row * w + col] = data[o + 3] < 16 ? 0 : luminance(data[o], data[o + 1], data[o + 2]);
      }
    }
    const gray = resizeGray(patch, w, h, GRAY_SIZE, GRAY_SIZE);
    return {
      gray,
      phash: phashFromGray16(gray),
      mean: meanRgbOf(data, width, height, { x, y, w, h }),
      edges: edgeHistogram(gray),
    };
  }

  function pixelAt(data, width, height, x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const o = (y * width + x) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3]];
  }

  function isGreenScreen(r, g, b, a) {
    if (a < 16) return true;
    // desk grass / green curtain
    if (g > r + 14 && g > b + 8 && g > 55 && g - Math.min(r, b) > 16) return true;
    // darker lawn under the house shell
    if (g > 40 && g >= r && g >= b && g - Math.max(r, b) >= -8 && r < 110 && b < 110 && (g - r) + (g - b) > 18) {
      return true;
    }
    return false;
  }

  function isHouseShell(r, g, b, a) {
    if (a < 40) return true;
    // translucent cyan/blue design-desk mask veil
    if (a < 180 && b > r + 8 && b >= g && b > 90 && r < 160) return true;
    if (a < 140 && Math.abs(r - g) < 18 && Math.abs(g - b) < 24 && r > 70 && r < 170) return true;
    return false;
  }

  function isSceneBackground(r, g, b, a) {
    return isGreenScreen(r, g, b, a) || isHouseShell(r, g, b, a);
  }

  function cornerBackground(data, width, height) {
    const corners = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ];
    const samples = [];
    corners.forEach(([x, y]) => {
      const px = pixelAt(data, width, height, x, y);
      if (px && px[3] >= 16) samples.push(px);
    });
    if (samples.length < 2) return null;
    const mean = [0, 0, 0];
    samples.forEach((rgb) => {
      mean[0] += rgb[0];
      mean[1] += rgb[1];
      mean[2] += rgb[2];
    });
    mean[0] = Math.round(mean[0] / samples.length);
    mean[1] = Math.round(mean[1] / samples.length);
    mean[2] = Math.round(mean[2] / samples.length);
    const spread = Math.max(...samples.map((rgb) => rgbDistance(rgb, mean)));
    if (spread > 52 * 52) return null;
    return mean;
  }

  function removeBackground(imageData, options = {}) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const data = src.slice ? src.slice() : Uint8ClampedArray.from(src);
    const bg = options.backgroundRgb || cornerBackground(data, width, height);
    // Pass 1: full-image grass / shell / low-alpha wipe (not only flood from edges).
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const a = data[o + 3];
      const nearBg = bg ? rgbDistance([r, g, b], bg) <= 34 * 34 : false;
      if (isSceneBackground(r, g, b, a) || nearBg || a < 20) data[o + 3] = 0;
    }
    // Pass 2: flood leftover edge-connected near-background.
    const seen = new Uint8Array(width * height);
    const queue = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = y * width + x;
      if (seen[i]) return;
      seen[i] = 1;
      queue.push(i);
    };
    for (let x = 0; x < width; x++) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      push(0, y);
      push(width - 1, y);
    }
    while (queue.length) {
      const i = queue.pop();
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const a = data[o + 3];
      if (a < 8) {
        const x = i % width;
        const y = (i / width) | 0;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
        continue;
      }
      const nearBg = bg ? rgbDistance([r, g, b], bg) <= 38 * 38 : false;
      if (!(isSceneBackground(r, g, b, a) || nearBg)) continue;
      data[o + 3] = 0;
      const x = i % width;
      const y = (i / width) | 0;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    return { width, height, data };
  }

  function keepLargestOpaqueComponent(prepared) {
    const { width, height, data } = prepared;
    const seen = new Uint8Array(width * height);
    let best = null;
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[start * 4 + 3] < 24) continue;
      const queue = [start];
      seen[start] = 1;
      let i = 0;
      let left = width;
      let top = height;
      let right = 0;
      let bottom = 0;
      let area = 0;
      while (i < queue.length) {
        const idx = queue[i++];
        const x = idx % width;
        const y = (idx / width) | 0;
        area += 1;
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
        [idx + 1, idx - 1, idx + width, idx - width].forEach((next) => {
          if (next < 0 || next >= seen.length || seen[next]) return;
          if (data[next * 4 + 3] < 24) return;
          seen[next] = 1;
          queue.push(next);
        });
      }
      if (!best || area > best.area) best = { left, top, right, bottom, area, cells: queue };
    }
    if (!best || best.area < 40) return prepared;
    const out = data.slice ? data.slice() : Uint8ClampedArray.from(data);
    const keep = new Uint8Array(width * height);
    best.cells.forEach((idx) => {
      keep[idx] = 1;
    });
    for (let i = 0; i < keep.length; i++) {
      if (!keep[i]) out[i * 4 + 3] = 0;
    }
    return { width, height, data: out };
  }

  function opaqueBBox(prepared) {
    const { width, height, data } = prepared;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 24) continue;
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
    }
    if (right < left || bottom < top) return null;
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1, left, top, right, bottom };
  }

  function fitRect(imageW, imageH, mode) {
    if (mode === "stretch") return { x: 0, y: 0, w: 1, h: 1 };
    const ratio = imageW / Math.max(1, imageH);
    if (mode === "cover") {
      if (ratio > 1) {
        const w = 1 / ratio;
        return { x: (1 - w) / 2, y: 0, w, h: 1 };
      }
      const h = ratio;
      return { x: 0, y: (1 - h) / 2, w: 1, h };
    }
    if (ratio > 1) {
      const h = 1 / ratio;
      return { x: 0, y: (1 - h) / 2, w: 1, h };
    }
    const w = ratio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }

  function imageToPaper(nx, ny, target, fitted) {
    return {
      x: target.x + (fitted.x + nx * fitted.w) * target.w,
      y: target.y + (fitted.y + ny * fitted.h) * target.h,
    };
  }

  function classifySource(prepared) {
    const box = opaqueBBox(prepared);
    if (!box) return "sketch";
    const { width, height, data } = prepared;
    let iso = 0;
    let ortho = 0;
    for (let y = box.top + 2; y < box.bottom - 2; y += 2) {
      for (let x = box.left + 2; x < box.right - 2; x += 2) {
        const a = data[(y * width + x) * 4 + 3];
        if (a < 24) continue;
        const d1 = Math.abs(a - data[((y + 1) * width + x + 2) * 4 + 3]);
        const d2 = Math.abs(a - data[((y - 1) * width + x + 2) * 4 + 3]);
        const dx = Math.abs(a - data[(y * width + x + 2) * 4 + 3]);
        const dy = Math.abs(a - data[((y + 2) * width + x) * 4 + 3]);
        iso += d1 + d2;
        ortho += dx + dy;
      }
    }
    return iso > ortho * 1.08 ? "screenshot" : "sketch";
  }

  function blobsFromAlpha(prepared, minArea = 48) {
    const { width, height, data } = prepared;
    const seen = new Uint8Array(width * height);
    const blobs = [];
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[start * 4 + 3] < 24) continue;
      const queue = [start];
      seen[start] = 1;
      let i = 0;
      let left = width;
      let top = height;
      let right = 0;
      let bottom = 0;
      let area = 0;
      while (i < queue.length) {
        const idx = queue[i++];
        const x = idx % width;
        const y = (idx / width) | 0;
        area += 1;
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
        const neighbors = [idx + 1, idx - 1, idx + width, idx - width];
        neighbors.forEach((next) => {
          if (next < 0 || next >= seen.length || seen[next]) return;
          if (data[next * 4 + 3] < 24) return;
          seen[next] = 1;
          queue.push(next);
        });
      }
      const w = right - left + 1;
      const h = bottom - top + 1;
      if (area < minArea || w < 6 || h < 6) continue;
      blobs.push({
        x: left,
        y: top,
        w,
        h,
        area,
        cx: left + w / 2,
        cy: top + h / 2,
      });
    }
    blobs.sort((a, b) => b.area - a.area);
    return blobs.slice(0, 72);
  }

  function guessCategory(blob, box) {
    const ny = box ? (blob.cy - box.y) / Math.max(1, box.h) : blob.cy;
    const ratio = blob.w / Math.max(1, blob.h);
    if (ny > 0.72 && blob.h < (box?.h || blob.h) * 0.38) return "地面";
    if (ny < 0.28 && ratio > 0.9) return "屋顶";
    if (blob.h > blob.w * 0.85 && ny > 0.18 && ny < 0.82) return "墙壁";
    if (ny > 0.32 && ny < 0.78 && ratio < 1.2) return "门窗";
    return "装饰";
  }

  function filterEntries(index, options = {}) {
    const packSet = options.packKeys?.length ? new Set(options.packKeys) : null;
    const category = options.category;
    return (index?.entries || []).filter((entry) => {
      if (packSet && !packSet.has(entry.pack)) return false;
      if (category && entry.category !== category) return false;
      if (!entry.mat || entry.mat < 1000) return false;
      return true;
    });
  }

  function sizeRatio(entry, w, h) {
    const rw = w / Math.max(1, entry.width || w);
    const rh = h / Math.max(1, entry.height || h);
    return Math.max(rw, 1 / rw, rh, 1 / rh);
  }

  function pickEntry(entries, probe, limits) {
    let best = null;
    entries.forEach((entry) => {
      const ratio = sizeRatio(entry, probe.w || entry.width, probe.h || entry.height);
      if (ratio > limits.sizeHi / Math.max(0.2, limits.sizeLo) && ratio > 2.4) return;
      const gray = entry._gray || (entry._gray = decodeGray16(entry.gray));
      const ham = probe.phash ? hammingHex(probe.phash, entry.phash) : 16;
      if (probe.phash && ham > limits.hamming + 6) return;
      const corr = probe.gray && gray ? ncc(probe.gray, gray) : 0.3;
      const color = probe.mean && entry.mean ? Math.sqrt(rgbDistance(probe.mean, entry.mean)) / 255 : 0.4;
      const size = Math.abs(Math.log(ratio || 1));
      const score = ham / 64 + (1 - corr) + color + size;
      if (!best || score < best.score) {
        best = { entry, score, confidence: Math.max(0, 1 - score / 3), hamming: ham, ncc: corr };
      }
    });
    if (!best) return null;
    if (probe.phash && best.hamming > limits.hamming && best.ncc < limits.ncc) return null;
    return best;
  }

  function computeFootOffset(opaque, geometry) {
    if (opaque && opaque.width > 1 && opaque.height > 1) {
      return {
        x: opaque.x + opaque.width / 2,
        y: opaque.y + opaque.height - Math.max(1, opaque.height * 0.08),
      };
    }
    const width = geometry?.width || 16;
    const height = geometry?.height || 16;
    return { x: width / 2, y: height * 0.8 };
  }

  function opaqueFromEntry(entry) {
    if (entry?.opaque && entry.opaque.width > 1) return entry.opaque;
    const box = entry?.opaqueBbox;
    if (Array.isArray(box) && box.length >= 4) {
      return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
    }
    return null;
  }

  function stampFoot(entry) {
    if (Array.isArray(entry?.footOffset) && entry.footOffset.length >= 2) {
      return { x: Number(entry.footOffset[0]) || 0, y: Number(entry.footOffset[1]) || 0 };
    }
    return computeFootOffset(opaqueFromEntry(entry), entry);
  }

  function recordFromFoot(entry, footX, footY, extra = {}) {
    const foot = stampFoot(entry);
    const pos = paperClamp(footX - foot.x, footY - foot.y);
    return {
      pack: entry.pack,
      local: entry.local,
      mat: entry.mat,
      x: pos.x,
      y: pos.y,
      state: extra.state != null ? extra.state : entry.frame || 0,
      depth: pos.x + 2 * pos.y,
      group: extra.group || groupFor(entry.category, pos),
      label: extra.label || `${entry.category} #${entry.local}`,
      confidence: extra.confidence,
      footX,
      footY,
      category: entry.category,
      file: entry.file,
      width: entry.width,
      height: entry.height,
    };
  }

  function groupFor(category, pos) {
    if (category === "地面") return "地面";
    if (category === "屋顶") return "屋顶";
    if (category === "门窗") return "门窗";
    if (category === "装饰") return "装饰";
    return pos.y < 260 ? "后墙" : "前墙";
  }

  function nmsHits(records, iou = 0.55) {
    const kept = [];
    records
      .slice()
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .forEach((row) => {
        const overlap = kept.some((other) => {
          if (other.category !== row.category) return false;
          const ax2 = other.x + (other.width || 16);
          const ay2 = other.y + (other.height || 16);
          const bx2 = row.x + (row.width || 16);
          const by2 = row.y + (row.height || 16);
          const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(other.x, row.x));
          const iy = Math.max(0, Math.min(ay2, by2) - Math.max(other.y, row.y));
          const inter = ix * iy;
          const union = (other.width || 16) * (other.height || 16) + (row.width || 16) * (row.height || 16) - inter;
          return union > 0 && inter / union > iou;
        });
        if (!overlap) kept.push(row);
      });
    return kept;
  }

  function projectToAxis(point, origin, axis) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const len = axis.x * axis.x + axis.y * axis.y;
    const t = (dx * axis.x + dy * axis.y) / Math.max(1e-6, len);
    return { x: origin.x + t * axis.x, y: origin.y + t * axis.y, t };
  }

  function snapWallsToIso(records) {
    const walls = records.filter((row) => row.category === "墙壁");
    if (walls.length < 2) return records;
    const axes = [
      { x: 2, y: 1 },
      { x: 2, y: -1 },
    ];
    const groups = [[], []];
    walls.forEach((row) => {
      const face = Number(row.state) || 0;
      groups[face % 2].push(row);
    });
    groups.forEach((group, face) => {
      if (!group.length) return;
      const origin = {
        x: group.reduce((sum, row) => sum + (row.footX || row.x), 0) / group.length,
        y: group.reduce((sum, row) => sum + (row.footY || row.y), 0) / group.length,
      };
      const axis = axes[face % 2];
      group.forEach((row) => {
        const snapped = projectToAxis(
          { x: row.footX || row.x, y: row.footY || row.y },
          origin,
          axis
        );
        const next = recordFromFoot(
          {
            pack: row.pack,
            local: row.local,
            mat: row.mat,
            width: row.width,
            height: row.height,
            category: row.category,
            file: row.file,
            frame: face,
          },
          snapped.x,
          snapped.y,
          { state: face, group: row.group, label: row.label, confidence: row.confidence }
        );
        Object.assign(row, next);
      });
    });
    return records;
  }

  function depthSortRecords(records) {
    return records.slice().sort((a, b) => (a.depth || a.x + 2 * a.y) - (b.depth || b.x + 2 * b.y) || a.x - b.x);
  }

  function wallsOnIsoAxis(records, slop = 8) {
    const walls = records.filter((row) => row.category === "墙壁");
    if (walls.length < 2) return walls.length === 1;
    const faces = new Map();
    walls.forEach((row) => {
      const key = Number(row.state) || 0;
      if (!faces.has(key)) faces.set(key, []);
      faces.get(key).push(row);
    });
    return [...faces.values()].every((group) => {
      if (group.length < 2) return true;
      const axis = (Number(group[0].state) || 0) % 2 === 0 ? { x: 2, y: 1 } : { x: 2, y: -1 };
      const origin = { x: group[0].footX || group[0].x, y: group[0].footY || group[0].y };
      return group.every((row) => {
        const raw = { x: row.footX || row.x, y: row.footY || row.y };
        const snapped = projectToAxis(raw, origin, axis);
        return Math.hypot(raw.x - snapped.x, raw.y - snapped.y) <= slop;
      });
    });
  }

  function makePaperMapper(imageW, imageH, target, fitMode) {
    const fitted = fitRect(imageW, imageH, fitMode || "contain");
    return {
      fitted,
      toPaper(px, py) {
        return {
          x: target.x + (fitted.x + (px / Math.max(1, imageW)) * fitted.w) * target.w,
          y: target.y + (fitted.y + (py / Math.max(1, imageH)) * fitted.h) * target.h,
        };
      },
      toImage(paperX, paperY) {
        const nx = (paperX - target.x) / Math.max(1e-6, target.w);
        const ny = (paperY - target.y) / Math.max(1e-6, target.h);
        return {
          x: ((nx - fitted.x) / Math.max(1e-6, fitted.w)) * imageW,
          y: ((ny - fitted.y) / Math.max(1e-6, fitted.h)) * imageH,
        };
      },
    };
  }

  function sampleBandMean(prepared, box, y0, y1) {
    const { width, height, data } = prepared;
    const top = Math.max(box.top, Math.floor(box.y + box.h * y0));
    const bottom = Math.min(box.bottom, Math.ceil(box.y + box.h * y1));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = top; y < bottom; y += 2) {
      for (let x = box.left; x <= box.right; x += 2) {
        const o = (y * width + x) * 4;
        if (data[o + 3] < 40) continue;
        if (isSceneBackground(data[o], data[o + 1], data[o + 2], data[o + 3])) continue;
        r += data[o];
        g += data[o + 1];
        b += data[o + 2];
        n += 1;
      }
    }
    if (!n) return null;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function floorDiamondAt(cx, cy, w, h) {
    return {
      cx,
      cy,
      w,
      h,
      left: { x: cx - w / 2, y: cy },
      right: { x: cx + w / 2, y: cy },
      front: { x: cx, y: cy + h / 2 },
      back: { x: cx, y: cy - h / 2 },
    };
  }

  function floorDiamondFromBox(box) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h * 0.78;
    const w = Math.max(40, box.w * 0.78);
    const h = Math.max(22, Math.min(box.h * 0.42, w * 0.52));
    return floorDiamondAt(cx, cy, w, h);
  }

  function translatePoint(pt, dx, dy) {
    return { x: pt.x + dx, y: pt.y + dy };
  }

  function seatStructureOnFoundation(structure, target) {
    const src = structure.floor;
    if (!src || !target) return structure;
    const desiredW = Math.max(96, Math.min(150, target.w * 0.3));
    const desiredH = Math.max(48, Math.min(80, desiredW * 0.5));
    const cx = target.x + target.w * 0.5;
    const cy = target.y + target.h * 0.6;
    const scaleX = desiredW / Math.max(24, src.w || desiredW);
    const scaleY = desiredH / Math.max(16, src.h || desiredH);
    const scale = Math.min(scaleX, scaleY);
    const mapPt = (pt) => ({
      x: cx + (pt.x - src.cx) * scale,
      y: cy + (pt.y - src.cy) * scale,
    });
    const floor = floorDiamondAt(cx, cy, desiredW, desiredH);
    const walls = (structure.walls || []).map((wall, index) => {
      const a = mapPt(wall.a);
      const b = mapPt(wall.b);
      // Rebuild as clean L on seated floor if the mapped segment is too short/long.
      if (index === 0) {
        return {
          a: { x: floor.left.x * 0.4 + floor.back.x * 0.6, y: floor.left.y * 0.4 + floor.back.y * 0.6 },
          b: { ...floor.back },
          openings: wall.openings?.length ? wall.openings : [{ t: 0.42, w: 22 }],
          state: 1,
        };
      }
      return {
        a: { x: floor.right.x * 0.4 + floor.back.x * 0.6, y: floor.right.y * 0.4 + floor.back.y * 0.6 },
        b: { ...floor.back },
        openings: wall.openings?.length ? wall.openings : [{ t: 0.58, w: 20 }],
        state: 0,
      };
    });
    if (!walls.length) {
      walls.push(
        {
          a: { x: floor.left.x * 0.4 + floor.back.x * 0.6, y: floor.left.y * 0.4 + floor.back.y * 0.6 },
          b: { ...floor.back },
          openings: [{ t: 0.42, w: 22 }],
          state: 1,
        },
        {
          a: { x: floor.right.x * 0.4 + floor.back.x * 0.6, y: floor.right.y * 0.4 + floor.back.y * 0.6 },
          b: { ...floor.back },
          openings: [{ t: 0.58, w: 20 }],
          state: 0,
        }
      );
    }
    const props = (structure.props || []).slice(0, 3).map((point) => ({
      ...point,
      x: cx + (point.x - src.cx) * scale,
      y: cy + (point.y - src.cy) * scale - 18,
    }));
    if (!props.length) {
      props.push({ x: cx + desiredW * 0.12, y: cy - desiredH * 0.75, kind: "sign", mean: [40, 90, 170] });
    }
    return {
      ...structure,
      floor,
      walls,
      props,
      roof: [],
      seated: true,
    };
  }

  function estimateStructure(prepared, target, options = {}) {
    const box =
      opaqueBBox(prepared) ||
      { x: 0, y: 0, w: prepared.width, h: prepared.height, left: 0, top: 0, right: prepared.width - 1, bottom: prepared.height - 1 };
    const mapper = makePaperMapper(prepared.width, prepared.height, target, options.fit || "contain");
    const floorImg = floorDiamondFromBox(box);
    // Image-space overlay (for left canvas) stays glued to the detected building.
    const imageFloor = floorImg;
    const imageWalls = [
      {
        a: {
          x: floorImg.left.x * 0.4 + floorImg.back.x * 0.6,
          y: floorImg.left.y * 0.4 + floorImg.back.y * 0.6,
        },
        b: { ...floorImg.back },
        openings: [{ t: 0.42, w: 22 }],
        state: 1,
      },
      {
        a: {
          x: floorImg.right.x * 0.4 + floorImg.back.x * 0.6,
          y: floorImg.right.y * 0.4 + floorImg.back.y * 0.6,
        },
        b: { ...floorImg.back },
        openings: [{ t: 0.58, w: 20 }],
        state: 0,
      },
    ];
    const left = mapper.toPaper(floorImg.left.x, floorImg.left.y);
    const right = mapper.toPaper(floorImg.right.x, floorImg.right.y);
    const back = mapper.toPaper(floorImg.back.x, floorImg.back.y);
    const front = mapper.toPaper(floorImg.front.x, floorImg.front.y);
    const mapped = {
      floor: {
        cx: (left.x + right.x) / 2,
        cy: (front.y + back.y) / 2,
        w: Math.hypot(right.x - left.x, right.y - left.y),
        h: Math.hypot(front.x - back.x, front.y - back.y),
        left,
        right,
        front,
        back,
      },
      walls: [
        {
          a: mapper.toPaper(imageWalls[0].a.x, imageWalls[0].a.y),
          b: mapper.toPaper(imageWalls[0].b.x, imageWalls[0].b.y),
          openings: imageWalls[0].openings.slice(),
          state: 1,
        },
        {
          a: mapper.toPaper(imageWalls[1].a.x, imageWalls[1].a.y),
          b: mapper.toPaper(imageWalls[1].b.x, imageWalls[1].b.y),
          openings: imageWalls[1].openings.slice(),
          state: 0,
        },
      ],
      props: [],
      roof: [],
    };
    const floorMean = sampleBandMean(prepared, box, 0.62, 0.95) || [150, 150, 150];
    const wallMean = sampleBandMean(prepared, box, 0.28, 0.68) || [210, 190, 150];
    const seated = seatStructureOnFoundation(mapped, target);
    return {
      ...seated,
      floorMean,
      wallMean,
      coreBox: box,
      fitted: mapper.fitted,
      imageFloor,
      imageWalls,
      imageProps: [],
    };
  }

  function openingHits(wall, t) {
    return (wall.openings || []).some((opening) => Math.abs(t - opening.t) * 1 < Math.max(0.08, (opening.w || 18) / 220));
  }

  function tileAlong(wall, entry, extra) {
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy);
    const pitch = Math.max(14, Math.min(36, (entry.width || 24) * 0.62));
    const count = Math.max(1, Math.min(8, Math.round(len / pitch)));
    const records = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      if (openingHits(wall, t) && extra?.skipOpenings) continue;
      const footX = wall.a.x + dx * t;
      const footY = wall.a.y + dy * t;
      records.push(
        recordFromFoot(entry, footX, footY, {
          state: extra?.state != null ? extra.state : entry.frame || 0,
          group: extra?.group,
          label: extra?.label,
          confidence: extra?.confidence,
        })
      );
    }
    return records;
  }

  function preferCompactEntries(entries, maxArea = 72 * 72) {
    const compact = entries.filter((entry) => (entry.width || 24) * (entry.height || 24) <= maxArea);
    return compact.length ? compact : entries;
  }

  function pickSizedEntry(entries, probe, limits) {
    const pool = preferCompactEntries(entries, (probe.maxArea != null ? probe.maxArea : 64 * 64));
    const ranked = pool
      .map((entry) => {
        const ratio = sizeRatio(entry, probe.w || entry.width, probe.h || entry.height);
        const gray = entry._gray || (entry._gray = decodeGray16(entry.gray));
        const ham = probe.phash ? hammingHex(probe.phash, entry.phash) : 12;
        const corr = probe.gray && gray ? ncc(probe.gray, gray) : 0.35;
        const color = probe.mean && entry.mean ? Math.sqrt(rgbDistance(probe.mean, entry.mean)) / 255 : 0.35;
        const size = Math.abs(Math.log(ratio || 1));
        const score = size * 1.4 + color * 1.6 + ham / 80 + (1 - corr) * 0.4;
        return { entry, score, confidence: Math.max(0, 1 - score / 3), hamming: ham, ncc: corr, ratio };
      })
      .sort((a, b) => a.score - b.score);
    return ranked[0] || null;
  }

  function tileFloorDiamond(floor, entry, confidence) {
    if (!floor) return [];
    const records = [];
    const countU = 2;
    const countV = 2;
    for (let u = 0; u < countU; u++) {
      for (let v = 0; v < countV; v++) {
        const su = (u + 0.5) / countU;
        const sv = (v + 0.5) / countV;
        const px =
          (1 - su) * (1 - sv) * floor.left.x +
          su * (1 - sv) * floor.back.x +
          su * sv * floor.right.x +
          (1 - su) * sv * floor.front.x;
        const py =
          (1 - su) * (1 - sv) * floor.left.y +
          su * (1 - sv) * floor.back.y +
          su * sv * floor.right.y +
          (1 - su) * sv * floor.front.y;
        records.push(
          recordFromFoot(entry, px, py, {
            state: 0,
            group: "地面",
            confidence,
            label: `地面 #${entry.local}`,
          })
        );
      }
    }
    return records;
  }

  function mustPick(entries, probe, limits) {
    if (!entries?.length) return null;
    return pickSizedEntry(entries, probe, limits) || pickEntry(entries, probe, limits) || null;
  }

  function assembleSketch(structure, index, options = {}) {
    const limits = THRESHOLDS[options.threshold] || THRESHOLDS.medium;
    const records = [];
    const floors = preferCompactEntries(filterEntries(index, { ...options, category: "地面" }), 48 * 28);
    const walls = preferCompactEntries(filterEntries(index, { ...options, category: "墙壁" }), 56 * 72);
    const windows = preferCompactEntries(filterEntries(index, { ...options, category: "门窗" }), 48 * 64);
    const decors = preferCompactEntries(filterEntries(index, { ...options, category: "装饰" }), 48 * 48);
    const floorMean = structure.floorMean || options.floorMean || [150, 150, 150];
    const wallMean = structure.wallMean || options.wallMean || [210, 190, 150];
    const seated = structure.seated ? structure : seatStructureOnFoundation(structure, options.target || { x: 80, y: 90, w: 400, h: 360 });
    const floorPick = mustPick(floors, { w: 36, h: 20, mean: floorMean, maxArea: 48 * 28 }, limits);
    if (floorPick && seated.floor) {
      records.push(...tileFloorDiamond(seated.floor, floorPick.entry, floorPick.confidence));
    }
    (seated.walls || []).forEach((wall, indexWall) => {
      const face = wall.state != null ? wall.state : indexWall % 2;
      const faced = walls.filter((entry) => (entry.frame || 0) % 2 === face % 2);
      const pool = faced.length ? faced : walls;
      const pick = mustPick(pool, { w: 32, h: 48, mean: wallMean, maxArea: 56 * 72 }, limits);
      if (!pick) return;
      const group = face ? "后墙" : "前墙";
      records.push(
        ...tileAlong(wall, pick.entry, {
          state: face,
          group,
          skipOpenings: true,
          confidence: pick.confidence,
          label: `${group} ${pick.entry.local}`,
        })
      );
      (wall.openings || []).forEach((opening, openingIndex) => {
        const winPick = mustPick(windows, { w: 28, h: 40, mean: options.openingMean || [110, 80, 55], maxArea: 48 * 64 }, limits);
        if (!winPick) return;
        const footX = wall.a.x + (wall.b.x - wall.a.x) * opening.t;
        const footY = wall.a.y + (wall.b.y - wall.a.y) * opening.t;
        records.push(
          recordFromFoot(winPick.entry, footX, footY - 8, {
            state: face,
            group: "门窗",
            confidence: winPick.confidence,
            label: openingIndex ? `门 #${winPick.entry.local}` : `窗 #${winPick.entry.local}`,
          })
        );
      });
    });
    (seated.props || []).forEach((point) => {
      const pick = mustPick(decors, { w: 28, h: 28, mean: point.mean || [40, 80, 160], maxArea: 48 * 48 }, limits);
      if (!pick) return;
      records.push(
        recordFromFoot(pick.entry, point.x, point.y, {
          group: "装饰",
          confidence: pick.confidence,
          label: `装饰 #${pick.entry.local}`,
        })
      );
    });
    return assembleSpec(records, { ...options, structure: { ...structure, ...seated } });
  }

  function matchScreenshot(prepared, index, options = {}) {
    const target = options.target || { x: 48, y: 48, w: 474, h: 454 };
    const structure = estimateStructure(prepared, target, options);
    return assembleSketch(structure, index, {
      ...options,
      target,
      floorMean: structure.floorMean,
      wallMean: structure.wallMean,
      mode: "screenshot",
      structure,
    });
  }

  function assembleSpec(records, options = {}) {
    const cleaned = depthSortRecords(
      nmsHits(records.filter((row) => Number(row.mat) > 0 && row.x >= 0 && row.y >= 0 && row.x <= MAX_COORD && row.y <= MAX_COORD))
    );
    return {
      name: options.name || "图片转建筑",
      localPack: null,
      sort: "depth",
      mode: options.mode || "sketch",
      structure: options.structure || null,
      fitted: options.fitted || options.structure?.fitted || null,
      records: cleaned,
    };
  }

  function summarizeSpec(spec) {
    const records = spec?.records || [];
    const count = (group) => records.filter((row) => row.group === group || row.category === group).length;
    const walls = records.filter((row) => row.category === "墙壁");
    const faces = new Set(walls.map((row) => Number(row.state) || 0));
    return {
      floors: count("地面"),
      walls: faces.size || (walls.length ? 1 : 0),
      wallPieces: walls.length,
      openings: count("门窗"),
      roofs: count("屋顶"),
      decors: count("装饰"),
      total: records.length,
    };
  }

  function statusText(summary, mode) {
    if (!summary?.total) return UNRESOLVED_STATUS;
    const kind = mode === "screenshot" ? "截图还原" : "结构选件";
    return `${kind}：认出 ${summary.walls} 面墙、${summary.openings} 个开口、${summary.decors} 件装饰${summary.floors ? `、${summary.floors} 块地面` : ""}。`;
  }

  function isCatastrophic(spec) {
    const records = spec?.records || [];
    if (!records.length) return false;
    if (records.some((row) => !row.mat || Number(row.mat) < 1000)) return true;
    if (records.some((row) => row.x < 0 || row.y < 0 || row.x > MAX_COORD || row.y > MAX_COORD)) return true;
    const floors = records.filter((row) => row.category === "地面" || row.group === "地面");
    const others = records.filter((row) => row.category !== "地面" && row.group !== "地面");
    if (floors.length && !others.length) return true;
    const mean = records.reduce((sum, row) => sum + (Number(row.confidence) || 0), 0) / records.length;
    if (mean > 0 && mean < 0.28) return true;
    return false;
  }

  function canAutoApply(spec, options = {}) {
    const records = spec?.records || [];
    if (!records.length) {
      return { ok: false, reason: UNRESOLVED_STATUS };
    }
    if (isCatastrophic(spec) && !options.userEdited) {
      return { ok: false, reason: "结果不可用：只有地基、坐标越界或置信度过低，不会写入当前户型。" };
    }
    if (options.userEdited) return { ok: true, reason: "" };
    const mean = records.reduce((sum, row) => sum + (Number(row.confidence) || 0), 0) / records.length;
    if (mean < MIN_APPLY_CONFIDENCE) {
      return { ok: false, reason: "识别置信度太低，未写入。请手绘墙线或换一张图。" };
    }
    return { ok: true, reason: "" };
  }

  function unresolvedSpec(options = {}) {
    return assembleSpec([], { ...options, mode: options.mode || "screenshot", structure: options.structure || null });
  }

  function suggestStructure(prepared, target, options = {}) {
    try {
      const estimated = estimateStructure(prepared, target, options);
      return {
        ...estimated,
        walls: Array.isArray(estimated.walls) ? estimated.walls : [],
        props: Array.isArray(estimated.props) ? estimated.props : [],
        roof: Array.isArray(estimated.roof) ? estimated.roof : [],
        __pendingReview: true,
        __userEdited: false,
      };
    } catch {
      return {
        walls: [],
        props: [],
        roof: [],
        wallMean: [210, 190, 150],
        floorMean: [150, 150, 150],
        fitted: null,
        __pendingReview: true,
        __userEdited: false,
      };
    }
  }

  function legacyScreenshotEnabled(options = {}) {
    if (options.legacyScreenshot === true) return true;
    if (typeof location === "undefined") return false;
    try {
      if (/[?&]imageBuilding=legacy(?:&|$)/.test(location.search || "")) return true;
      return globalThis.localStorage?.getItem("MANOR_IMAGE_BUILDING_LEGACY") === "1";
    } catch {
      return false;
    }
  }

  function isGoldLike(spec) {
    const records = spec?.records || [];
    if (!records.length) return false;
    const cats = records.map((row) => row.category);
    const walls = records.filter((row) => row.category === "墙壁");
    const faces = new Set(walls.map((row) => Number(row.state) || 0));
    const hasFloor = cats.includes("地面");
    const hasOpeningOrDecor = cats.includes("门窗") || cats.includes("装饰");
    const allWalls = records.every((row) => row.category === "墙壁");
    return hasFloor && faces.size >= 2 && hasOpeningOrDecor && !allWalls && wallsOnIsoAxis(records);
  }

  function validateSpec(spec, uidMap) {
    const errors = [];
    (spec?.records || []).forEach((row, index) => {
      if (!row.mat || row.mat < 1000) errors.push(`records[${index}] missing locked mat`);
      if (row.x < 0 || row.y < 0 || row.x > MAX_COORD || row.y > MAX_COORD) {
        errors.push(`records[${index}] coord out of 0..${MAX_COORD}`);
      }
      if (uidMap) {
        const uid = Math.floor(row.mat / 1000);
        const local = row.mat % 1000;
        const pack = uidMap[String(uid)] || uidMap[uid];
        if (!pack) errors.push(`records[${index}] unregistered uid ${uid}`);
        if (pack && row.pack && pack !== row.pack) errors.push(`records[${index}] pack mismatch`);
        if (row.local != null && row.local !== local) errors.push(`records[${index}] local mismatch`);
      }
    });
    return errors;
  }

  function convertPrepared(prepared, index, options = {}) {
    let cleaned = options.skipBackground === false ? prepared : removeBackground(prepared);
    cleaned = keepLargestOpaqueComponent(cleaned);
    const requested = options.mode || "auto";
    const detected = requested === "auto" ? classifySource(cleaned) : requested;
    const target = options.target || { x: 80, y: 90, w: 400, h: 360 };
    const given = options.structure || null;
    let result;
    if (given) {
      const seated = given.seated ? given : seatStructureOnFoundation(given, target);
      result = assembleSketch(seated, index, {
        ...options,
        target,
        mode: detected === "screenshot" ? "screenshot" : "sketch",
        structure: seated,
        floorMean: seated.floorMean || given.floorMean || options.floorMean,
        wallMean: seated.wallMean || given.wallMean || options.wallMean,
      });
    } else if (legacyScreenshotEnabled(options) && (index?.entries || []).length) {
      result = matchScreenshot(cleaned, index, { ...options, target, mode: "screenshot" });
    } else {
      const hint = suggestStructure(cleaned, target, options);
      result = unresolvedSpec({
        ...options,
        target,
        mode: detected === "sketch" ? "sketch" : "screenshot",
        structure: hint,
        fitted: hint.fitted,
      });
    }
    const summary = summarizeSpec(result);
    const empty = !summary.total;
    return {
      spec: result,
      prepared: cleaned,
      mode: result.mode,
      structure: result.structure,
      fitted: result.fitted || result.structure?.fitted || null,
      summary,
      catastrophic: isCatastrophic(result),
      apply: canAutoApply(result, { userEdited: !!(given && given.__userEdited) }),
      status: empty && result.structure?.__pendingReview
        ? `已给出待确认墙线与配色提示（墙体 RGB ${result.structure.wallMean?.join("/") || "未知"}）；请手绘调整后再应用。`
        : empty ? UNRESOLVED_STATUS : statusText(summary, result.mode),
    };
  }

  return {
    CATEGORY_LAYERS,
    MAX_COORD,
    THRESHOLDS,
    MIN_APPLY_CONFIDENCE,
    FOOT_MODEL_VERSION,
    UNRESOLVED_STATUS,
    sceneToIso,
    isoToScene,
    paperClamp,
    decodeGray16,
    encodeGray16,
    phashFromGray16,
    hammingHex,
    ncc,
    fingerprintFromRgba,
    removeBackground,
    keepLargestOpaqueComponent,
    classifySource,
    blobsFromAlpha,
    fitRect,
    imageToPaper,
    makePaperMapper,
    estimateStructure,
    seatStructureOnFoundation,
    assembleSketch,
    matchScreenshot,
    snapWallsToIso,
    nmsHits,
    depthSortRecords,
    wallsOnIsoAxis,
    assembleSpec,
    summarizeSpec,
    statusText,
    isGoldLike,
    isCatastrophic,
    canAutoApply,
    validateSpec,
    suggestStructure,
    convertPrepared,
    computeFootOffset,
    filterEntries,
    pickEntry,
    pickSizedEntry,
    mustPick,
    recordFromFoot,
    tileFloorDiamond,
  };
});
