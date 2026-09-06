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
    const accept = (x, y) => {
      if (kind === "circle") {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        return nx * nx + ny * ny <= 1.04;
      }
      if (kind === "triangle") return pointInTriangle({ x, y }, v0, v1, v2);
      if (kind === "diamond") return Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1.04;
      return true;
    };

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
      const edgeStep = options.lineStep || Math.min(px, py);
      walkLine({ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }, edgeStep);
      walkLine({ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }, edgeStep);
      walkLine({ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }, edgeStep);
      walkLine({ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }, edgeStep);
      return pts;
    }

    if (options.lattice === "iso") {
      const step = Math.max(1, px / 4);
      const origin = sceneToIso(a.x, a.y);
      const corners = [
        sceneToIso(rect.left, rect.top),
        sceneToIso(rect.right, rect.top),
        sceneToIso(rect.left, rect.bottom),
        sceneToIso(rect.right, rect.bottom),
      ];
      const uMin = Math.min(...corners.map((p) => p.u));
      const uMax = Math.max(...corners.map((p) => p.u));
      const vMin = Math.min(...corners.map((p) => p.v));
      const vMax = Math.max(...corners.map((p) => p.v));
      const u0 = origin.u + Math.floor((uMin - origin.u) / step) * step;
      const v0 = origin.v + Math.floor((vMin - origin.v) / step) * step;
      for (let u = u0; u <= uMax + step * 0.01 && pts.length < cap; u += step) {
        for (let v = v0; v <= vMax + step * 0.01 && pts.length < cap; v += step) {
          const p = isoToScene(u, v);
          if (
            p.x < rect.left - 0.51 ||
            p.x > rect.right + 0.51 ||
            p.y < rect.top - 0.51 ||
            p.y > rect.bottom + 0.51
          ) {
            continue;
          }
          if (!accept(p.x, p.y)) continue;
          push(p.x, p.y);
        }
      }
      if (!pts.length) push(a.x, a.y);
      return pts;
    }

    const stagger = !aligned && kind === "tile";
    for (let y = rect.top, row = 0; y <= rect.bottom + 0.01 && pts.length < cap; y += py, row++) {
      const ox = stagger && row % 2 ? px / 2 : 0;
      for (let x = rect.left + ox; x <= rect.right + 0.01 && pts.length < cap; x += px) {
        if (!accept(x, y)) continue;
        push(x, y);
      }
    }
    if (!pts.length) push(a.x, a.y);
    return pts;
  }

  const SMART_WALL_ROLES = ["base", "body", "cap"];
  const SMART_WALL_LABELS = {
    base: "墙脚",
    body: "墙身",
    cap: "墙顶",
  };

  function finitePoint(point) {
    return {
      x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 0,
      y: Number.isFinite(Number(point?.y)) ? Number(point.y) : 0,
    };
  }

  function projectToIsoAxis(start, end) {
    if (Number.isFinite(Number(start)) && Number.isFinite(Number(end))) {
      start = { x: Number(start), y: Number(end) };
      end = null;
    }
    const a = end == null ? { x: 0, y: 0 } : finitePoint(start);
    const b = finitePoint(end == null ? start : end);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const axes = [
      { axis: "u", state: 0, x: 2, y: 1 },
      { axis: "v", state: 1, x: 2, y: -1 },
    ];
    let best = null;
    axes.forEach((axis) => {
      const scale = (dx * axis.x + dy * axis.y) / 5;
      const px = axis.x * scale;
      const py = axis.y * scale;
      const error = (dx - px) ** 2 + (dy - py) ** 2;
      if (!best || error < best.error - EPSILON) {
        best = {
          x: a.x + px,
          y: a.y + py,
          axis: axis.axis,
          state: axis.state,
          scale,
          error,
        };
      }
    });
    return best;
  }

  function smartRoleConfig(style, role) {
    const listed = Array.isArray(style?.roles)
      ? style.roles.find((entry) => String(entry?.role ?? entry?.name) === role)
      : null;
    const value = listed ?? style?.roles?.[role] ?? style?.[role];
    if (value == null || value === false) return null;
    if (typeof value === "object" && !Array.isArray(value)) return value;
    return { value };
  }

  function smartRoleNames(style) {
    const requested = Array.isArray(style?.layers) && style.layers.length
      ? style.layers
      : SMART_WALL_ROLES;
    return [...new Set(requested.map(String))];
  }

  function smartWallWarning(role, wallIndex) {
    return {
      code: "missing-role",
      role,
      wallIndex,
      message: `智能墙缺少 ${role} 角色素材`,
    };
  }

  function smartOpeningRange(opening, length) {
    if (!opening || typeof opening !== "object") return null;
    if (Number.isFinite(Number(opening.t0)) || Number.isFinite(Number(opening.t1))) {
      const t0 = Number.isFinite(Number(opening.t0)) ? Number(opening.t0) : Number(opening.t1);
      const t1 = Number.isFinite(Number(opening.t1)) ? Number(opening.t1) : Number(opening.t0);
      return [Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))];
    }
    const t = Math.max(0, Math.min(1, Number(opening.t) || 0));
    const width = Math.max(0, Number(opening.width ?? opening.w) || 0);
    const half = width <= 1 && opening.normalized !== false
      ? width / 2
      : width / (2 * Math.max(EPSILON, length));
    return [Math.max(0, t - half), Math.min(1, t + half)];
  }

  function smartOpeningHits(wall, role, t, length) {
    return (Array.isArray(wall?.openings) ? wall.openings : []).some((opening) => {
      if (Array.isArray(opening?.roles) && !opening.roles.includes(role)) return false;
      const range = smartOpeningRange(opening, length);
      return range && t >= range[0] - EPSILON && t <= range[1] + EPSILON;
    });
  }

  function smartPointState(style, role, roleConfig, wall, pointIndex, pointCount, axisState) {
    const source =
      wall?.states ??
      wall?.state ??
      roleConfig?.states ??
      roleConfig?.state ??
      style?.states?.[axisState ? "v" : "u"] ??
      style?.stateByAxis?.[axisState ? "v" : "u"] ??
      axisState;
    let value = source;
    if (typeof source === "function") {
      value = source({ pointIndex, pointCount, wall, axis: axisState ? "v" : "u", role });
    } else if (Array.isArray(source)) {
      value = source[Math.min(pointIndex, source.length - 1)];
    }
    const state = Number(value);
    return Number.isFinite(state) ? ((Math.round(state) % 64) + 64) % 64 : axisState;
  }

  function solveSmartWallSegment(style, wall, options = {}) {
    if (style?.a && (wall?.roles || wall?.layers || wall?.style)) {
      const swap = style;
      style = wall;
      wall = swap;
    } else if (wall == null && style?.wall) {
      wall = style.wall;
      style = style.style || style;
    }
    if (Number.isInteger(options)) options = { wallIndex: options };
    const wallIndex = Number.isInteger(options.wallIndex) ? options.wallIndex : 0;
    const warnings = [];
    const roles = smartRoleNames(style);
    const availableRoles = roles
      .map((role) => ({ role, config: smartRoleConfig(style, role) }))
      .filter(({ role, config }) => {
        if (config) return true;
        warnings.push(smartWallWarning(role, wallIndex));
        return false;
      });
    const a = finitePoint(wall?.a ?? wall?.start);
    const rawEnd = finitePoint(wall?.b ?? wall?.end);
    const projected = wall?.project === false || options.project === false
      ? {
          x: rawEnd.x,
          y: rawEnd.y,
          axis: Math.abs(rawEnd.y - a.y) <= Math.abs(rawEnd.x - a.x) / 2 ? "u" : "v",
          state: (rawEnd.x - a.x) * (rawEnd.y - a.y) < 0 ? 1 : 0,
        }
      : projectToIsoAxis(a, rawEnd);
    const b = { x: projected.x, y: projected.y };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) {
      warnings.push({
        code: "zero-length-wall",
        wallIndex,
        message: "智能墙线长度为零",
      });
      return { placements: [], warnings };
    }

    const rolePitch = availableRoles.find(({ config }) => Number(config.pitch ?? config.spacing) > 0)?.config;
    const pitch = Math.max(
      EPSILON,
      Number(wall?.pitch ?? wall?.spacing ?? style?.pitch ?? style?.spacing ?? rolePitch?.pitch ?? rolePitch?.spacing) || 24
    );
    const pointCount = Math.max(2, Math.round(length / pitch) + 1);
    const group = String(wall?.group ?? options.group ?? `${style?.groupPrefix || "smart-wall"}-${wallIndex}`);
    const groupName = String(wall?.groupName ?? style?.groupName ?? "智能墙体");
    const placements = [];

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      const t = pointIndex / (pointCount - 1);
      availableRoles.forEach(({ role, config }, roleIndex) => {
        if (smartOpeningHits(wall, role, t, length)) return;
        const offset = config.offset || {};
        const x = a.x + dx * t + (Number(config.offsetX ?? offset.x) || 0);
        const y = a.y + dy * t + (Number(config.offsetY ?? offset.y) || 0);
        const state = smartPointState(style, role, config, wall, pointIndex, pointCount, projected.state);
        const labelSource = config.label ?? style?.labels?.[role] ?? SMART_WALL_LABELS[role] ?? role;
        const label = typeof labelSource === "function"
          ? String(labelSource({ role, pointIndex, pointCount, wallIndex }))
          : String(labelSource);
        placements.push({
          role,
          x,
          y,
          state,
          group,
          groupName,
          label,
          __order: placements.length,
          __roleOrder: roleIndex,
        });
      });
    }
    return {
      placements: placements.map(({ __order, __roleOrder, ...placement }) => placement),
      warnings,
    };
  }

  function smartPlacementKey(placement) {
    const x = Math.round(Number(placement.x) * 1e6);
    const y = Math.round(Number(placement.y) * 1e6);
    return `${placement.role}|${x}|${y}`;
  }

  function solveSmartBuilding(style, building, options = {}) {
    if (building == null && (Array.isArray(style?.walls) || Array.isArray(style?.structure?.walls))) {
      building = style.structure || style;
      style = style.style || style;
    }
    const walls = Array.isArray(building) ? building : Array.isArray(building?.walls) ? building.walls : [];
    const detachedOpenings = Array.isArray(building?.openings) ? building.openings : [];
    const warnings = [];
    const byPosition = new Map();
    let order = 0;
    const addPlacement = (placement) => {
      const row = { ...placement, __order: order++ };
      const key = smartPlacementKey(row);
      if (!byPosition.has(key)) byPosition.set(key, row);
    };
    walls.forEach((wall, wallIndex) => {
      const openings = [
        ...(Array.isArray(wall?.openings) ? wall.openings : []),
        ...detachedOpenings.filter((opening) => Number(opening?.wallIndex ?? opening?.wall) === wallIndex),
      ];
      const solved = solveSmartWallSegment(style, { ...wall, openings }, { ...options, wallIndex });
      warnings.push(...solved.warnings);
      solved.placements.forEach(addPlacement);
      const a = finitePoint(wall?.a ?? wall?.start);
      const rawEnd = finitePoint(wall?.b ?? wall?.end);
      const projected = wall?.project === false || options.project === false
        ? { ...rawEnd, state: Number(wall?.state) || 0 }
        : projectToIsoAxis(a, rawEnd);
      openings.forEach((opening, openingIndex) => {
        const role = opening?.kind === "door" ? "door" : "window";
        const config = smartRoleConfig(style, role);
        if (!config) return;
        const t = Math.max(0, Math.min(1, Number(opening?.t) || 0));
        const offset = config.offset || {};
        addPlacement({
          role,
          x: a.x + (projected.x - a.x) * t + (Number(config.offsetX ?? offset.x) || 0),
          y: a.y + (projected.y - a.y) * t + (Number(config.offsetY ?? offset.y) || 0),
          state: smartPointState(style, role, config, wall, openingIndex, openings.length, projected.state),
          group: String(opening?.group || `smart-opening-${wallIndex}`),
          groupName: String(opening?.groupName || "门窗"),
          label: String(config.label || (role === "door" ? "门" : "窗")),
        });
      });
    });
    const endpoints = new Map();
    walls.forEach((wall, wallIndex) => {
      [finitePoint(wall?.a ?? wall?.start), finitePoint(wall?.b ?? wall?.end)].forEach((point) => {
        const key = `${Math.round(point.x * 1e6)}|${Math.round(point.y * 1e6)}`;
        const existing = endpoints.get(key) || { point, walls: [] };
        existing.walls.push(wallIndex);
        endpoints.set(key, existing);
      });
    });
    const cornerConfig = smartRoleConfig(style, "corner");
    if (cornerConfig) {
      endpoints.forEach(({ point, walls: joined }) => {
        if (joined.length < 2) return;
        const offset = cornerConfig.offset || {};
        addPlacement({
          role: "corner",
          x: point.x + (Number(cornerConfig.offsetX ?? offset.x) || 0),
          y: point.y + (Number(cornerConfig.offsetY ?? offset.y) || 0),
          state: Number(cornerConfig.state) || 0,
          group: `smart-corner-${joined[0]}`,
          groupName: String(cornerConfig.groupName || "转角"),
          label: String(cornerConfig.label || "转角"),
        });
      });
    }
    (Array.isArray(building?.props) ? building.props : []).forEach((prop, propIndex) => {
      const role = prop?.role === "sign" ? "sign" : "decor";
      const config = smartRoleConfig(style, role);
      if (!config) {
        warnings.push(smartWallWarning(role, -1));
        return;
      }
      const offset = config.offset || {};
      addPlacement({
        role,
        x: Number(prop?.x) + (Number(config.offsetX ?? offset.x) || 0),
        y: Number(prop?.y) + (Number(config.offsetY ?? offset.y) || 0),
        state: Number(prop?.state ?? config.state) || 0,
        group: String(prop?.group || `smart-prop-${propIndex}`),
        groupName: String(prop?.groupName || (role === "sign" ? "招牌" : "装饰")),
        label: String(config.label || (role === "sign" ? "招牌" : "装饰")),
      });
    });
    const placements = [...byPosition.values()]
      .sort((a, b) => {
        const depth = Number(a.y) - Number(b.y);
        if (Math.abs(depth) > EPSILON) return depth;
        return a.__order - b.__order;
      })
      .map(({ __order, ...placement }) => placement);
    const warningKeys = new Set();
    return {
      placements,
      warnings: warnings.filter((warning) => {
        const key = warning.code === "missing-role"
          ? `${warning.code}|${warning.role || ""}`
          : `${warning.code}|${warning.role || ""}|${warning.wallIndex ?? ""}`;
        if (warningKeys.has(key)) return false;
        warningKeys.add(key);
        return true;
      }),
    };
  }

  function clampLayerInsertIndex(index, length) {
    const len = Math.max(0, Number(length) || 0);
    if (!Number.isInteger(index)) return len;
    return Math.max(0, Math.min(len, index));
  }

  function resolveLayerInsertIndex(records, insert) {
    const list = Array.isArray(records) ? records : [];
    if (!insert || insert.kind === "front") return list.length;
    if (insert.kind === "before") {
      const idx = list.indexOf(insert.record);
      return idx < 0 ? list.length : idx;
    }
    return list.length;
  }

  function spliceRecordsAt(records, index, added) {
    const list = Array.isArray(records) ? records.slice() : [];
    const rows = Array.isArray(added) ? added : [];
    const at = clampLayerInsertIndex(index, list.length);
    list.splice(at, 0, ...rows);
    return {
      records: list,
      at,
      indices: rows.map((_, offset) => at + offset),
    };
  }

  function remapIndicesAfterInsert(indices, at, count) {
    const n = Math.max(0, Number(count) || 0);
    return (indices || []).map((index) => (index >= at ? index + n : index));
  }

  function normalizeGroupEntry(entry) {
    if (!entry) return null;
    if (typeof entry === "string") {
      const id = entry.trim();
      return id ? { id, name: "" } : null;
    }
    const id = String(entry.id || entry.group || "").trim();
    if (!id) return null;
    return { id, name: String(entry.name || entry.groupName || "") };
  }

  function recordGroupStack(record) {
    if (!record) return [];
    if (Array.isArray(record.groups) && record.groups.length) {
      return record.groups.map(normalizeGroupEntry).filter(Boolean);
    }
    const parents = Array.isArray(record.groupParents)
      ? record.groupParents.map(normalizeGroupEntry).filter(Boolean)
      : [];
    if (!record.group) return parents;
    return parents.concat({ id: String(record.group), name: String(record.groupName || "") });
  }

  function applyGroupStack(record, stack) {
    const next = { ...(record || {}) };
    const entries = (stack || []).map(normalizeGroupEntry).filter(Boolean);
    delete next.groups;
    if (!entries.length) {
      delete next.group;
      delete next.groupName;
      delete next.groupParents;
      return next;
    }
    const inner = entries[entries.length - 1];
    const parents = entries.slice(0, -1);
    next.group = inner.id;
    if (inner.name) next.groupName = inner.name;
    else delete next.groupName;
    if (parents.length) next.groupParents = parents;
    else delete next.groupParents;
    return next;
  }

  function recordInGroup(record, groupId) {
    return recordGroupStack(record).some((entry) => entry.id === groupId);
  }

  function groupMemberIndices(records, groupId) {
    const indices = [];
    (records || []).forEach((record, index) => {
      if (recordInGroup(record, groupId)) indices.push(index);
    });
    return indices;
  }

  function visiblePaperRecords(records) {
    return (records || []).filter((record) => Number(record.mat) && !record.hidden);
  }

  function expandGroupedIndices(records, indices, isolatedGroup = "") {
    const set = new Set(indices);
    const groups = new Set();
    const isolated = String(isolatedGroup || "");
    (indices || []).forEach((index) => {
      const stack = recordGroupStack(records[index]);
      if (!stack.length) return;
      if (isolated && stack.some((entry) => entry.id === isolated)) {
        groups.add(isolated);
        return;
      }
      groups.add(stack[0].id);
    });
    if (!groups.size) return [...set].sort((a, b) => a - b);
    (records || []).forEach((record, index) => {
      if (recordGroupStack(record).some((entry) => groups.has(entry.id))) set.add(index);
    });
    return [...set].sort((a, b) => a - b);
  }

  function outermostFullySelectedGroups(records, selectedIndices) {
    const selected = new Set(selectedIndices);
    const candidateIds = new Set();
    selectedIndices.forEach((index) => {
      recordGroupStack(records[index]).forEach((entry) => candidateIds.add(entry.id));
    });
    const full = [];
    candidateIds.forEach((id) => {
      const members = groupMemberIndices(records, id);
      if (members.length && members.every((index) => selected.has(index))) full.push(id);
    });
    return full.filter((id) => {
      const members = groupMemberIndices(records, id);
      const stack = recordGroupStack(records[members[0]]);
      const at = stack.findIndex((entry) => entry.id === id);
      return at >= 0 && !stack.slice(0, at).some((entry) => full.includes(entry.id));
    });
  }

  function wrapRecordsInGroup(records, selectedIndices, group, groupName = "") {
    const selected = new Set(selectedIndices);
    const outer = outermostFullySelectedGroups(records, selectedIndices);
    const parent = { id: String(group), name: String(groupName || "") };
    return (records || []).map((record, index) => {
      if (!selected.has(index)) return record;
      const stack = recordGroupStack(record);
      const keepFrom = stack.findIndex((entry) => outer.includes(entry.id));
      if (keepFrom >= 0) {
        return applyGroupStack(record, stack.slice(0, keepFrom).concat([parent], stack.slice(keepFrom)));
      }
      return applyGroupStack(record, [parent]);
    });
  }

  function peelGroupsFromRecords(records, groupIds) {
    const ids = new Set(groupIds);
    return (records || []).map((record) => {
      const stack = recordGroupStack(record).filter((entry) => !ids.has(entry.id));
      return applyGroupStack(record, stack);
    });
  }

  function layerInsertGroupHint(records, insert) {
    if (insert?.group) {
      const hint = { group: insert.group, groupName: insert.groupName || undefined };
      if (Array.isArray(insert.groupParents) && insert.groupParents.length) {
        hint.groupParents = insert.groupParents;
      }
      return hint;
    }
    if (insert?.kind !== "before") return null;
    const list = Array.isArray(records) ? records : [];
    const at = list.indexOf(insert.record);
    if (at < 0) return null;
    const front = insert.record;
    const back = at > 0 ? list[at - 1] : null;
    if (front?.group && back?.group && front.group === back.group) {
      const parents = recordGroupStack(front).slice(0, -1);
      const hint = {
        group: front.group,
        groupName: front.groupName || back.groupName || undefined,
      };
      if (parents.length) hint.groupParents = parents;
      return hint;
    }
    return null;
  }

  function applyDeskLayers(rows, layers) {
    if (!Array.isArray(rows) || !Array.isArray(layers) || layers.length !== rows.length) return rows;
    return rows.map((row, index) => {
      const extra = layers[index];
      if (!extra || typeof extra !== "object") return row;
      if (Number.isFinite(Number(extra.mat)) && Number(extra.mat) !== Number(row.mat)) return row;
      const next = {
        ...row,
        packKey: extra.packKey || row.packKey,
        localPackUnknown: extra.localPackUnknown != null ? !!extra.localPackUnknown : row.localPackUnknown,
        group: extra.group || null,
        groupName: extra.groupName || null,
        label: extra.label || null,
        locked: !!extra.locked,
        hidden: extra.hidden != null ? !!extra.hidden : row.hidden,
      };
      if (Array.isArray(extra.groupParents) && extra.groupParents.length) {
        next.groupParents = extra.groupParents.map(normalizeGroupEntry).filter(Boolean);
      }
      return next;
    });
  }

  function remapImportedDeskGroups(rows, stamp) {
    const prefix = String(stamp || Date.now());
    const groupMap = new Map();
    const remapId = (id) => {
      const key = String(id || "");
      if (!key) return key;
      if (!groupMap.has(key)) groupMap.set(key, `${prefix}-import-${groupMap.size}`);
      return groupMap.get(key);
    };
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const stack = recordGroupStack(row);
      if (!stack.length) return row;
      return applyGroupStack(
        row,
        stack.map((entry) => ({ id: remapId(entry.id), name: entry.name }))
      );
    });
  }

  function insertSpecsEqual(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if ((a.group || "") !== (b.group || "")) return false;
    if (a.kind === "front") return true;
    return a.record === b.record;
  }

  return {
    SpatialIndex,
    applyDeskLayers,
    applyGroupStack,
    applySelection,
    containRect,
    contains,
    collectStampPoints,
    constrainShapeEnd,
    createViewportTransform,
    insertSpecsEqual,
    intersects,
    expandGroupedIndices,
    groupMemberIndices,
    visiblePaperRecords,
    layerInsertGroupHint,
    normalizeRect,
    outermostFullySelectedGroups,
    peelGroupsFromRecords,
    recordGroupStack,
    recordInGroup,
    rectFromPoints,
    remapImportedDeskGroups,
    wrapRecordsInGroup,
    remapIndicesAfterInsert,
    resolveLayerInsertIndex,
    selectFromRect,
    solveSmartBuilding,
    solveSmartWallSegment,
    snapGridPoint,
    snapMove,
    spliceRecordsAt,
    projectToIsoAxis,
    sceneToIso,
    isoToScene,
    union,
  };
});
