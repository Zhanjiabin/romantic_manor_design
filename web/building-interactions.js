(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BuildingInteractions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPSILON = 1e-7;

  function rectFromPoints(a, b) {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const right = Math.max(a.x, b.x);
    const bottom = Math.max(a.y, b.y);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom,
    };
  }

  function normalizeRect(rect) {
    const left = Number.isFinite(rect.left) ? rect.left : Number(rect.x) || 0;
    const top = Number.isFinite(rect.top) ? rect.top : Number(rect.y) || 0;
    const right = Number.isFinite(rect.right)
      ? rect.right
      : left + Math.max(0, Number(rect.width) || 0);
    const bottom = Number.isFinite(rect.bottom)
      ? rect.bottom
      : top + Math.max(0, Number(rect.height) || 0);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom,
    };
  }

  function intersects(a, b) {
    const ra = normalizeRect(a);
    const rb = normalizeRect(b);
    return (
      ra.left <= rb.right + EPSILON &&
      ra.right + EPSILON >= rb.left &&
      ra.top <= rb.bottom + EPSILON &&
      ra.bottom + EPSILON >= rb.top
    );
  }

  function contains(outer, inner) {
    const a = normalizeRect(outer);
    const b = normalizeRect(inner);
    return (
      a.left <= b.left + EPSILON &&
      a.top <= b.top + EPSILON &&
      a.right + EPSILON >= b.right &&
      a.bottom + EPSILON >= b.bottom
    );
  }

  function union(rects) {
    if (!rects.length) return null;
    const rows = rects.map(normalizeRect);
    const left = Math.min(...rows.map((rect) => rect.left));
    const top = Math.min(...rows.map((rect) => rect.top));
    const right = Math.max(...rows.map((rect) => rect.right));
    const bottom = Math.max(...rows.map((rect) => rect.bottom));
    return normalizeRect({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function containRect(elementRect, bitmapWidth, bitmapHeight) {
    const rect = {
      left: Number(elementRect.left) || 0,
      top: Number(elementRect.top) || 0,
      width: Math.max(1, Number(elementRect.width) || 1),
      height: Math.max(1, Number(elementRect.height) || 1),
    };
    const bw = Math.max(1, Number(bitmapWidth) || 1);
    const bh = Math.max(1, Number(bitmapHeight) || 1);
    const scale = Math.min(rect.width / bw, rect.height / bh);
    const width = bw * scale;
    const height = bh * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
      scaleX: width / bw,
      scaleY: height / bh,
    };
  }

  function fillRect(elementRect, bitmapWidth, bitmapHeight) {
    const rect = {
      left: Number(elementRect.left) || 0,
      top: Number(elementRect.top) || 0,
      width: Math.max(1, Number(elementRect.width) || 1),
      height: Math.max(1, Number(elementRect.height) || 1),
    };
    const bw = Math.max(1, Number(bitmapWidth) || 1);
    const bh = Math.max(1, Number(bitmapHeight) || 1);
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      scaleX: rect.width / bw,
      scaleY: rect.height / bh,
    };
  }

  function createViewportTransform(options) {
    const bitmapWidth = Math.max(1, Number(options.bitmapWidth) || 1);
    const bitmapHeight = Math.max(1, Number(options.bitmapHeight) || 1);
    const offsetX = Number(options.offsetX) || 0;
    const offsetY = Number(options.offsetY) || 0;
    const display = options.objectFit === "fill"
      ? fillRect(options.canvasRect, bitmapWidth, bitmapHeight)
      : containRect(options.canvasRect, bitmapWidth, bitmapHeight);

    return Object.freeze({
      bitmapWidth,
      bitmapHeight,
      offsetX,
      offsetY,
      display,
      scale: Math.min(display.scaleX, display.scaleY),
      clientToBitmap(clientX, clientY) {
        return {
          x: (Number(clientX) - display.left) / display.scaleX,
          y: (Number(clientY) - display.top) / display.scaleY,
        };
      },
      clientToScene(clientX, clientY) {
        const point = this.clientToBitmap(clientX, clientY);
        return { x: point.x - offsetX, y: point.y - offsetY };
      },
      sceneToClient(x, y) {
        return {
          x: display.left + (Number(x) + offsetX) * display.scaleX,
          y: display.top + (Number(y) + offsetY) * display.scaleY,
        };
      },
      sceneRectToClient(rect) {
        const row = normalizeRect(rect);
        return rectFromPoints(
          this.sceneToClient(row.left, row.top),
          this.sceneToClient(row.right, row.bottom)
        );
      },
      pxToScene(px) {
        return Number(px) / Math.max(EPSILON, this.scale);
      },
    });
  }

  class SpatialIndex {
    constructor(cellSize = 128) {
      this.cellSize = Math.max(16, Number(cellSize) || 128);
      this.cells = new Map();
      this.items = new Map();
    }

    _range(rect) {
      const row = normalizeRect(rect);
      return {
        x0: Math.floor(row.left / this.cellSize),
        y0: Math.floor(row.top / this.cellSize),
        x1: Math.floor(row.right / this.cellSize),
        y1: Math.floor(row.bottom / this.cellSize),
      };
    }

    _key(x, y) {
      return `${x}:${y}`;
    }

    clear() {
      this.cells.clear();
      this.items.clear();
    }

    insert(id, rect, value = id) {
      const box = normalizeRect(rect);
      this.items.set(id, { id, rect: box, value });
      const range = this._range(box);
      for (let y = range.y0; y <= range.y1; y++) {
        for (let x = range.x0; x <= range.x1; x++) {
          const key = this._key(x, y);
          if (!this.cells.has(key)) this.cells.set(key, new Set());
          this.cells.get(key).add(id);
        }
      }
    }

    query(rect) {
      const box = normalizeRect(rect);
      const range = this._range(box);
      const ids = new Set();
      for (let y = range.y0; y <= range.y1; y++) {
        for (let x = range.x0; x <= range.x1; x++) {
          const cell = this.cells.get(this._key(x, y));
          if (cell) cell.forEach((id) => ids.add(id));
        }
      }
      const rows = [];
      ids.forEach((id) => {
        const item = this.items.get(id);
        if (item && intersects(box, item.rect)) rows.push(item);
      });
      return rows;
    }

    all() {
      return [...this.items.values()];
    }
  }

  function selectFromRect(index, start, end, options = {}) {
    const marquee = rectFromPoints(start, end);
    const mode = options.mode === "contain" ? "contain" : "touch";
    const matches = [];
    const candidates = index ? index.query(marquee) : options.items || [];
    candidates.forEach((item) => {
      const hit = mode === "contain" ? contains(marquee, item.rect) : intersects(marquee, item.rect);
      if (hit) matches.push(item);
    });
    return { rect: marquee, mode, matches };
  }

  function applySelection(base, hits, operation = "replace") {
    if (operation === "replace") return [...new Set(hits)];
    const next = new Set(base);
    if (operation === "toggle") {
      hits.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
    } else {
      hits.forEach((id) => next.add(id));
    }
    return [...next];
  }

  const ISO_AX = 2;
  const ISO_AY = 1;
  const ISO_LEN = Math.hypot(ISO_AX, ISO_AY);

  function normalizeSnapAxis(axis) {
    return axis === "iso" || axis === "both" ? axis : "ortho";
  }

  function sceneToIso(x, y) {
    return {
      u: x / 4 + y / 2,
      v: x / 4 - y / 2,
    };
  }

  function isoToScene(u, v) {
    return {
      x: 2 * (u + v),
      y: u - v,
    };
  }

  function snapOrthoPoint(x, y, step) {
    const s = Math.max(1, Number(step) || 1);
    return {
      x: Math.round(x / s) * s,
      y: Math.round(y / s) * s,
    };
  }

  function snapIsoPoint(x, y, step) {
    const unit = Math.max(1, Number(step) || 1) / ISO_LEN;
    const { u, v } = sceneToIso(x, y);
    return isoToScene(Math.round(u / unit) * unit, Math.round(v / unit) * unit);
  }

  function closerPoint(raw, a, b) {
    const da = Math.hypot(a.x - raw.x, a.y - raw.y);
    const db = Math.hypot(b.x - raw.x, b.y - raw.y);
    return da <= db ? a : b;
  }

  function snapGridPoint(x, y, step, axis) {
    const mode = normalizeSnapAxis(axis);
    if (mode === "iso") return snapIsoPoint(x, y, step);
    if (mode === "both") return closerPoint({ x, y }, snapOrthoPoint(x, y, step), snapIsoPoint(x, y, step));
    return snapOrthoPoint(x, y, step);
  }

  function boxFeatures(rect, edges, centers) {
    const box = normalizeRect(rect);
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const pts = [];
    if (edges) {
      pts.push(
        { x: box.left, y: box.top },
        { x: box.right, y: box.top },
        { x: box.left, y: box.bottom },
        { x: box.right, y: box.bottom },
        { x: box.left, y: cy },
        { x: box.right, y: cy },
        { x: cx, y: box.top },
        { x: cx, y: box.bottom }
      );
    }
    if (centers) pts.push({ x: cx, y: cy });
    return pts;
  }

  function nearestDelta(values, targets, threshold, latch) {
    let best = { delta: 0, distance: threshold + 1, target: null };
    if (latch && Number.isFinite(latch.target)) {
      let latched = { delta: 0, distance: threshold * 1.6 + 1, target: null };
      values.forEach((value) => {
        const distance = Math.abs(latch.target - value);
        if (distance <= threshold * 1.6 && distance < latched.distance) {
          latched = { delta: latch.target - value, distance, target: latch.target };
        }
      });
      if (latched.target != null) return latched;
    }
    values.forEach((value) => {
      targets.forEach((target) => {
        const delta = target - value;
        const distance = Math.abs(delta);
        if (distance <= threshold && distance < best.distance) {
          best = { delta, distance, target };
        }
      });
    });
    return best;
  }

  function applyGridSnap(result, bounds, step, axis) {
    if (!(step > 0)) return;
    const mode = normalizeSnapAxis(axis);
    const raw = { x: bounds.left + result.x, y: bounds.top + result.y };
    const snapped = snapGridPoint(raw.x, raw.y, step, mode);
    result.x = snapped.x - bounds.left;
    result.y = snapped.y - bounds.top;
  }

  function snapMoveOrtho(options, afterGrid) {
    const bounds = normalizeRect(options.bounds);
    const threshold = Math.max(0, Number(options.threshold) || 0);
    const result = afterGrid || {
      x: Number(options.offsetX) || 0,
      y: Number(options.offsetY) || 0,
      guides: [],
      latch: { x: null, y: null, u: null, v: null },
    };
    if (!afterGrid && options.gridEnabled && Number(options.gridStep) > 0) {
      applyGridSnap(result, bounds, Number(options.gridStep), "ortho");
    }
    if (!options.objectEnabled || !options.targets?.length || threshold <= 0) return result;

    const moved = {
      left: bounds.left + result.x,
      right: bounds.right + result.x,
      top: bounds.top + result.y,
      bottom: bounds.bottom + result.y,
    };
    moved.cx = (moved.left + moved.right) / 2;
    moved.cy = (moved.top + moved.bottom) / 2;

    const targetX = [];
    const targetY = [];
    const edgeEnabled = options.edgeEnabled !== false;
    const centerEnabled = options.centerEnabled !== false;
    options.targets.forEach((target) => {
      const box = normalizeRect(target.rect || target);
      if (edgeEnabled) {
        targetX.push(box.left, box.right);
        targetY.push(box.top, box.bottom);
      }
      if (centerEnabled) {
        targetX.push((box.left + box.right) / 2);
        targetY.push((box.top + box.bottom) / 2);
      }
    });
    const moverX = [];
    const moverY = [];
    if (edgeEnabled) {
      moverX.push(moved.left, moved.right);
      moverY.push(moved.top, moved.bottom);
    }
    if (centerEnabled) {
      moverX.push(moved.cx);
      moverY.push(moved.cy);
    }

    const sx = nearestDelta(moverX, targetX, threshold, options.latch?.x);
    const sy = nearestDelta(moverY, targetY, threshold, options.latch?.y);
    if (sx.target != null) {
      result.x += sx.delta;
      result.guides.push({ type: "v", pos: sx.target });
      result.latch.x = { target: sx.target };
    }
    if (sy.target != null) {
      result.y += sy.delta;
      result.guides.push({ type: "h", pos: sy.target });
      result.latch.y = { target: sy.target };
    }
    return result;
  }

  function snapMoveIso(options, afterGrid) {
    const bounds = normalizeRect(options.bounds);
    const threshold = Math.max(0, Number(options.threshold) || 0);
    const result = afterGrid || {
      x: Number(options.offsetX) || 0,
      y: Number(options.offsetY) || 0,
      guides: [],
      latch: { x: null, y: null, u: null, v: null },
    };
    if (!afterGrid && options.gridEnabled && Number(options.gridStep) > 0) {
      applyGridSnap(result, bounds, Number(options.gridStep), "iso");
    }
    if (!options.objectEnabled || !options.targets?.length || threshold <= 0) return result;

    const moved = {
      left: bounds.left + result.x,
      right: bounds.right + result.x,
      top: bounds.top + result.y,
      bottom: bounds.bottom + result.y,
    };
    const edgeEnabled = options.edgeEnabled !== false;
    const centerEnabled = options.centerEnabled !== false;
    const moverPts = boxFeatures(moved, edgeEnabled, centerEnabled);
    const targetPts = [];
    options.targets.forEach((target) => {
      targetPts.push(...boxFeatures(target.rect || target, edgeEnabled, centerEnabled));
    });
    const isoThreshold = threshold / ISO_LEN;
    const moverU = moverPts.map((pt) => sceneToIso(pt.x, pt.y).u);
    const moverV = moverPts.map((pt) => sceneToIso(pt.x, pt.y).v);
    const targetU = targetPts.map((pt) => sceneToIso(pt.x, pt.y).u);
    const targetV = targetPts.map((pt) => sceneToIso(pt.x, pt.y).v);
    const su = nearestDelta(moverU, targetU, isoThreshold, options.latch?.u);
    const sv = nearestDelta(moverV, targetV, isoThreshold, options.latch?.v);
    if (su.target != null) {
      result.x += su.delta * ISO_AX;
      result.y += su.delta * ISO_AY;
      result.guides.push({ type: "iso-u", pos: su.target });
      result.latch.u = { target: su.target };
    }
    if (sv.target != null) {
      result.x += sv.delta * ISO_AX;
      result.y += -sv.delta * ISO_AY;
      result.guides.push({ type: "iso-v", pos: sv.target });
      result.latch.v = { target: sv.target };
    }
    return result;
  }

  function snapMove(options) {
    const mode = normalizeSnapAxis(options.axis);
    const bounds = normalizeRect(options.bounds);
    const raw = {
      x: Number(options.offsetX) || 0,
      y: Number(options.offsetY) || 0,
    };
    if (mode === "iso") return snapMoveIso(options);
    if (mode === "both") {
      const seeded = {
        x: raw.x,
        y: raw.y,
        guides: [],
        latch: { x: null, y: null, u: null, v: null },
      };
      if (options.gridEnabled && Number(options.gridStep) > 0) {
        applyGridSnap(seeded, bounds, Number(options.gridStep), "both");
      }
      const ortho = snapMoveOrtho(options, {
        x: seeded.x,
        y: seeded.y,
        guides: [],
        latch: { x: null, y: null, u: null, v: null },
      });
      const iso = snapMoveIso(options, {
        x: seeded.x,
        y: seeded.y,
        guides: [],
        latch: { x: null, y: null, u: null, v: null },
      });
      const pick = closerPoint(seeded, ortho, iso);
      pick.latch = pick === iso ? iso.latch : ortho.latch;
      return pick;
    }
    return snapMoveOrtho(options);
  }

  function constrainShapeEnd(kind, start, end, shiftKey) {
    if (!shiftKey) return { x: Number(end.x) || 0, y: Number(end.y) || 0 };
    const dx = (Number(end.x) || 0) - (Number(start.x) || 0);
    const dy = (Number(end.y) || 0) - (Number(start.y) || 0);
    if (kind === "line") {
      const dist = Math.hypot(dx, dy);
      const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return { x: start.x + Math.cos(snapped) * dist, y: start.y + Math.sin(snapped) * dist };
    }
    if (kind === "circle" || kind === "triangle" || kind === "rect" || kind === "diamond" || kind === "ring") {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      return {
        x: start.x + (dx < 0 ? -side : side),
        y: start.y + (dy < 0 ? -side : side),
      };
    }
    return { x: Number(end.x) || 0, y: Number(end.y) || 0 };
  }

  function pointInTriangle(p, a, b, c) {
    const v0x = c.x - a.x;
    const v0y = c.y - a.y;
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = p.x - a.x;
    const v2y = p.y - a.y;
    const den = v0x * v1y - v1x * v0y;
    if (Math.abs(den) < EPSILON) return false;
    const u = (v2x * v1y - v1x * v2y) / den;
    const v = (v0x * v2y - v2x * v0y) / den;
    return u >= -0.02 && v >= -0.02 && u + v <= 1.02;
  }

  function collectStampPoints(kind, start, end, pitch, options = {}) {
    const cap = Math.max(1, Number(options.cap) || 360);
    const aligned = !!options.aligned;
    const px = Math.max(4, Number(pitch?.x) || 16);
    const py = Math.max(4, Number(pitch?.y) || 16);
    const a = { x: Number(start.x) || 0, y: Number(start.y) || 0 };
    const b = { x: Number(end.x) || 0, y: Number(end.y) || 0 };
    const pts = [];
    const push = (x, y) => {
      if (pts.length >= cap) return;
      pts.push({ x, y });
    };

    const walkLine = (from, to, requestedStep = 0) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(4, Number(requestedStep) || Math.min(px, py));
      const n = Math.max(1, Math.round(dist / step));
      for (let i = 0; i <= n && pts.length < cap; i++) {
        const t = i / n;
        push(from.x + dx * t, from.y + dy * t);
      }
    };

    if (kind === "line" || kind === "stamp" || kind === "paint") {
      walkLine(a, b, kind === "line" ? options.lineStep : 0);
      return pts;
    }

    const rect = rectFromPoints(a, b);
    if (rect.width < 2 && rect.height < 2) {
      push(a.x, a.y);
      return pts;
    }

    const v0 = { x: (rect.left + rect.right) / 2, y: rect.top };
    const v1 = { x: rect.left, y: rect.bottom };
    const v2 = { x: rect.right, y: rect.bottom };
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const rx = Math.max(px / 2, rect.width / 2);
    const ry = Math.max(py / 2, rect.height / 2);

    if (kind === "ring") {
      if (aligned) {
        const circ = Math.PI * (3 * (rx + ry) - Math.sqrt(Math.max(0, (3 * rx + ry) * (rx + 3 * ry))));
        const n = Math.max(8, Math.round(circ / Math.max(4, Math.min(px, py))));
        for (let i = 0; i < n && pts.length < cap; i++) {
          const t = (Math.PI * 2 * i) / n;
          push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
        }
        return pts;
      }
      walkLine({ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top });
      walkLine({ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom });
      walkLine({ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom });
      walkLine({ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top });
      return pts;
    }

    const stagger = !aligned && kind === "tile";
    for (let y = rect.top, row = 0; y <= rect.bottom + 0.01 && pts.length < cap; y += py, row++) {
      const ox = stagger && row % 2 ? px / 2 : 0;
      for (let x = rect.left + ox; x <= rect.right + 0.01 && pts.length < cap; x += px) {
        if (kind === "circle") {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          if (nx * nx + ny * ny > 1.04) continue;
        } else if (kind === "triangle") {
          if (!pointInTriangle({ x, y }, v0, v1, v2)) continue;
        } else if (kind === "diamond") {
          if (Math.abs(x - cx) / rx + Math.abs(y - cy) / ry > 1.04) continue;
        }
        push(x, y);
      }
    }
    if (!pts.length) push(a.x, a.y);
    return pts;
  }

  return {
    SpatialIndex,
    applySelection,
    containRect,
    contains,
    collectStampPoints,
    constrainShapeEnd,
    createViewportTransform,
    intersects,
    normalizeRect,
    rectFromPoints,
    selectFromRect,
    snapGridPoint,
    snapMove,
    sceneToIso,
    isoToScene,
    union,
  };
});
