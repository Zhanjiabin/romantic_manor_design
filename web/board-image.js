(function initBoardImage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BoardImage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function boardImageFactory() {
  "use strict";

  const COLS = 36, ROWS = 24, DARK = 50;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const luma = c => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const chroma = c => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
  const distance = (a, b) => a.slice(0, 3).reduce((n, v, i) => n + (v - b[i]) ** 2, 0);

  function pixel(source, x, y) {
    const offset = (clamp(Math.round(y), 0, source.height - 1) * source.width
      + clamp(Math.round(x), 0, source.width - 1)) * 4;
    return Array.from(source.data.slice(offset, offset + 4));
  }

  function isPaper(rgb) {
    return Boolean(rgb && luma(rgb) >= 228 && chroma(rgb) <= 24);
  }

  function rgbToLab(rgb) {
    const [r, g, b] = rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function hexToRgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  }

  function colorMatcher(palette, dark) {
    const colors = palette.map(c => Array.isArray(c) ? c : hexToRgb(c));
    const labs = colors.map(rgbToLab);
    const cache = new Map();
    return rgb => {
      if (!rgb) return dark;
      const key = rgb.slice(0, 3).join(",");
      if (cache.has(key)) return cache.get(key);
      const lab = rgbToLab(rgb), c = Math.hypot(lab[1], lab[2]);
      let best = dark, score = Infinity;
      labs.forEach((p, i) => {
        const pc = Math.hypot(p[1], p[2]);
        // The lamp palette has uneven brightness across hues. A dark brown must
        // not become red simply because the red lamp is darker. Pale warm fills
        // also need hue matching; their chroma is too low for the old cutoff.
        const hue = c > 4 && pc > 4 ? Math.max(0, 1 - (lab[1] * p[1] + lab[2] * p[2]) / (c * pc)) : 0;
        const d = (lab[0] - p[0]) ** 2 + 0.6 * ((lab[1] - p[1]) ** 2 + (lab[2] - p[2]) ** 2)
          + hue * 3000 * Math.min(1, c / 18) + (c > 8 && pc < 5 ? c * c * 4 : 0);
        if (d < score) { best = i; score = d; }
      });
      cache.set(key, best);
      return best;
    };
  }

  function nearestFrame(rgb, palette, dark = DARK) {
    return colorMatcher(palette, dark)(rgb);
  }

  function paletteFromSprite(source, count = 50, cell = 18, columns = 5) {
    const colors = [];
    for (let frame = 0; frame < count; frame++) {
      const channels = [[], [], []];
      for (let y = Math.ceil(cell * 0.44); y < cell * 0.72; y++) {
        for (let x = Math.ceil(cell * 0.27); x < cell * 0.72; x++) {
          const rgb = pixel(source, frame % columns * cell + x, Math.floor(frame / columns) * cell + y);
          for (let c = 0; c < 3; c++) channels[c].push(rgb[c]);
        }
      }
      colors.push(channels.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]));
    }
    return colors;
  }

  function dominant(samples) {
    if (!samples.length) return null;
    const buckets = new Map();
    for (const rgb of samples) {
      const key = rgb.slice(0, 3).map(v => Math.round(v / 16)).join(",");
      const b = buckets.get(key) || { count: 0, rgb: [0, 0, 0] };
      b.count++;
      for (let i = 0; i < 3; i++) b.rgb[i] += rgb[i];
      buckets.set(key, b);
    }
    const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    return best.rgb.map(v => Math.round(v / best.count));
  }

  function lineProjection(source, axis) {
    const length = axis === "x" ? source.width : source.height;
    const cross = axis === "x" ? source.height : source.width;
    const scores = new Float64Array(length);
    const stride = Math.max(1, Math.floor(cross / 600));
    const offset = (p, q) => (axis === "x" ? q * source.width + p : p * source.width + q) * 4;
    for (let p = 1; p < length - 1; p++) {
      const radius = Math.min(2, p, length - 1 - p);
      let sum = 0, count = 0;
      for (let q = 0; q < cross; q += stride) {
        // Lines can be darker OR lighter than the fill. RGB also catches equal-luminance lines.
        const at = offset(p, q), before = offset(p - radius, q), after = offset(p + radius, q);
        let contrast = 0;
        for (let c = 0; c < 3; c++) {
          const value = i => source.data[i + 3] < 24 ? 255 : source.data[i + c];
          const left = value(before) - value(at), right = value(after) - value(at);
          contrast += Math.max(0, Math.min(left, right) - 6, Math.min(-left, -right) - 6);
        }
        // Broad, faint lines must outweigh small high-contrast glyphs repeated in each cell.
        sum += Math.min(40, contrast / 3);
        count++;
      }
      scores[p] = sum / count;
    }
    return scores;
  }

  function fitAxis(scores, expectedStep = null) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const peaks = [];
    for (let i = 1; i < scores.length - 1; i++) {
      if (scores[i] < Math.max(3, mean * 1.25) || scores[i] < scores[i - 1] || scores[i] <= scores[i + 1]) continue;
      if (peaks.length && i - peaks[peaks.length - 1] <= 2) {
        if (scores[i] > scores[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      } else peaks.push(i);
    }
    if (peaks.length < 6) return null;
    const candidates = new Map();
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < Math.min(peaks.length, i + 5); j++) {
        const gap = peaks[j] - peaks[i];
        if (gap < 5 || gap > Math.min(180, scores.length / 5)) continue;
        candidates.set(gap, (candidates.get(gap) || 0) + 1);
      }
    }
    const periods = expectedStep ? [expectedStep] : [...new Set([...candidates].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .flatMap(([p]) => [-0.5, -0.25, 0, 0.25, 0.5].map(delta => p + delta)))];
    let best = null;
    for (const initial of periods) {
      for (const origin of peaks.slice().sort((a, b) => scores[b] - scores[a]).slice(0, 10)) {
        let start = origin, step = initial, matches = [];
        for (let pass = 0; pass < 3; pass++) {
          matches = peaks.map(p => ({ p, n: Math.round((p - start) / step) }))
            .filter(v => Math.abs(v.p - start - v.n * step) <= Math.min(2, step * 0.12));
          const unique = new Map();
          for (const hit of matches) {
            const prior = unique.get(hit.n);
            if (!prior || Math.abs(hit.p - start - hit.n * step) < Math.abs(prior.p - start - prior.n * step)) unique.set(hit.n, hit);
          }
          matches = [...unique.values()];
          if (matches.length < 6) break;
          const mn = matches.reduce((s, v) => s + v.n, 0) / matches.length;
          const mp = matches.reduce((s, v) => s + v.p, 0) / matches.length;
          const den = matches.reduce((s, v) => s + (v.n - mn) ** 2, 0);
          step = matches.reduce((s, v) => s + (v.n - mn) * (v.p - mp), 0) / den;
          start = mp - mn * step;
        }
        if (matches.length < 6 || step < 5) continue;
        const first = matches[0].n, last = matches[matches.length - 1].n;
        const coverage = matches.length / (last - first + 1);
        if (coverage < 0.7 || (last - first) * step < scores.length * 0.35) continue;
        const strength = matches.reduce((s, v) => s + scores[v.p], 0);
        const score = strength * coverage;
        if (!best || score > best.score) best = { start, step, matches, score, coverage };
      }
    }
    if (!best) return null;
    const strengths = best.matches.map(v => scores[v.p]).sort((a, b) => a - b);
    const edgeThreshold = strengths[Math.floor(strengths.length / 2)] * 0.28;
    while (best.matches.length > 6 && scores[best.matches[0].p] < edgeThreshold) best.matches.shift();
    while (best.matches.length > 6 && scores[best.matches[best.matches.length - 1].p] < edgeThreshold) best.matches.pop();
    let lo = best.matches[0].n, hi = best.matches[best.matches.length - 1].n;
    if (best.start + (lo - 1) * best.step >= -1 && best.start + (lo - 1) * best.step <= 2) lo--;
    if (Math.abs(best.start + (hi + 1) * best.step - (scores.length - 1)) <= 2) hi++;
    return { start: best.start + lo * best.step, step: best.step, count: hi - lo, confidence: best.coverage };
  }

  function detectGrid(source) {
    if (source.width < 40 || source.height < 40) return null;
    const xs = lineProjection(source, "x"), ys = lineProjection(source, "y");
    let x = fitAxis(xs), y = fitAxis(ys);
    if (x && (!y || y.step > x.step * 1.3)) y = fitAxis(ys, x.step);
    if (y && (!x || x.step > y.step * 1.3)) x = fitAxis(xs, y.step);
    if (!x || !y || x.count < 5 || y.count < 5 || Math.max(x.step, y.step) / Math.min(x.step, y.step) > 1.3) return null;
    const grid = { x0: x.start, y0: y.start, stepX: x.step, stepY: y.step, cols: x.count, rows: y.count,
      confidence: Math.min(x.confidence, y.confidence) };
    const interiorDiffers = (axis, index, color) => {
      const count = axis === "x" ? grid.rows : grid.cols;
      let different = 0;
      for (let i = 0; i < count; i++) {
        const cell = sampleCell(source, grid, axis === "x" ? index : i, axis === "y" ? index : i).rgb;
        if (cell && distance(cell, color) > 40 ** 2) different++;
      }
      return different > count * 0.2;
    };
    const ruler = (axis, n) => {
      const coordinate = (axis === "x" ? grid.x0 : grid.y0) + n * (axis === "x" ? grid.stepX : grid.stepY);
      const size = axis === "x" ? source.width : source.height;
      if (coordinate < 0 || coordinate + (axis === "x" ? grid.stepX : grid.stepY) > size + 1) return null;
      const samples = Array.from({ length: axis === "x" ? grid.rows : grid.cols }, (_, i) =>
        sampleCell(source, grid, axis === "x" ? n : i, axis === "y" ? n : i));
      const values = samples.map(c => c.rgb).filter(Boolean), color = dominant(values);
      return color && chroma(color) > 24 && samples.filter(c => c.rulerLabel && c.purity > 0.65).length > samples.length * 0.35
        && values.filter(c => distance(c, color) < 24 ** 2).length > samples.length * 0.88 ? color : null;
    };
    for (const axis of ["x", "y"]) {
      const n = axis === "x" ? grid.cols : grid.rows;
      const origin = grid[`${axis}0`], step = axis === "x" ? grid.stepX : grid.stepY;
      // Repeated labels can win at half a cell's phase; opposite rulers disambiguate it.
      for (const phase of [0, -0.5, 0.5]) {
        grid[`${axis}0`] = origin + phase * step;
        const starts = [-3, -2, -1, 0, 1, 2, 3].map(index => ({ index, color: ruler(axis, index) })).filter(c => c.color);
        const ends = [-3, -2, -1, 0, 1, 2, 3].map(delta => ({ index: n + delta, color: ruler(axis, n + delta) })).filter(c => c.color);
        const pairs = starts.filter(a => interiorDiffers(axis, a.index + 1, a.color))
          .flatMap(a => ends.filter(b => distance(a.color, b.color) < 24 ** 2 && interiorDiffers(axis, b.index - 1, b.color))
          .map(b => ({ first: a.index + 1, count: b.index - a.index - 1, cost: Math.abs(a.index + 1) + Math.abs(b.index - n) })));
        const pair = pairs.filter(p => p.count >= 5).sort((a, b) => a.cost - b.cost)[0];
        if (pair) {
          if (axis === "x") { grid.x0 += pair.first * grid.stepX; grid.cols = pair.count; }
          else { grid.y0 += pair.first * grid.stepY; grid.rows = pair.count; }
          break;
        }
        grid[`${axis}0`] = origin;
      }
    }
    return grid;
  }

  function sampleCell(source, grid, col, row) {
    const ring = [], center = [];
    const steps = Math.max(5, Math.min(17, Math.ceil(Math.min(grid.stepX, grid.stepY))));
    for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
      const fx = 0.16 + (x + 0.5) / steps * 0.68, fy = 0.16 + (y + 0.5) / steps * 0.68;
      const rgb = pixel(source, grid.x0 + (col + fx) * grid.stepX, grid.y0 + (row + fy) * grid.stepY);
      if (rgb[3] < 32) continue;
      // Labels are centered; upper/lower strips retain the bead fill.
      if (fy < 0.34 || fy > 0.66) ring.push(rgb);
      else if (fx > 0.25 && fx < 0.75) center.push(rgb);
    }
    const rgb = dominant(ring);
    if (!rgb) return { rgb: null, label: false };
    const inkThreshold = Math.min(130, luma(rgb) - 65);
    const ink = center.filter(c => luma(c) < inkThreshold).length;
    const ringInk = ring.filter(c => luma(c) < inkThreshold).length;
    const label = ink >= Math.max(2, center.length * 0.045) && ink / Math.max(1, center.length) > ringInk / ring.length * 1.7;
    const faintInk = center.filter(c => luma(c) < luma(rgb) - 20).length;
    const outerInk = ring.filter(c => luma(c) < luma(rgb) - 20).length;
    const rulerLabel = faintInk >= Math.max(2, center.length * 0.045)
      && faintInk / Math.max(1, center.length) > outerInk / ring.length * 1.7;
    const purity = ring.filter(c => distance(c, rgb) < 24 ** 2).length / ring.length;
    return { rgb, label, rulerLabel, purity };
  }

  function floodBackground(cells, cols, rows, candidate) {
    const seen = new Uint8Array(cells.length), queue = [];
    const visit = i => {
      if (seen[i] || !candidate(cells[i], i)) return;
      seen[i] = 1; queue.push(i);
    };
    for (let x = 0; x < cols; x++) { visit(x); visit((rows - 1) * cols + x); }
    for (let y = 0; y < rows; y++) { visit(y * cols); visit(y * cols + cols - 1); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % cols, y = Math.floor(i / cols);
      if (x > 0) visit(i - 1);
      if (x + 1 < cols) visit(i + 1);
      if (y > 0) visit(i - cols);
      if (y + 1 < rows) visit(i + cols);
    }
    return cells.map((c, i) => seen[i] ? null : c);
  }

  function sampleGrid(source, grid, background = "auto") {
    const samples = [];
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) samples.push(sampleCell(source, grid, x, y));
    const cells = samples.map(c => c.rgb);
    if (background === "keep" || cells.some(c => !c)) return cells;
    const edge = samples.filter((sample, i) => i < grid.cols || i >= cells.length - grid.cols
      || i % grid.cols === 0 || i % grid.cols === grid.cols - 1);
    // A coded background is part of the picture, even when tiny blurred codes look like blank paper.
    if (edge.filter(sample => sample.rulerLabel).length > edge.length * 0.8) return cells;
    const labelledPaper = samples.filter(c => c.rgb && isPaper(c.rgb) && c.label).length;
    const cleaned = floodBackground(cells, grid.cols, grid.rows, (c, i) => !c || (isPaper(c) && !samples[i].label));
    // A white region with repeated codes is artwork, including blurred or watermarked labels.
    if (labelledPaper > 12) {
      const seen = new Uint8Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        if (seen[i] || !isPaper(cleaned[i])) continue;
        const region = [i]; seen[i] = 1;
        let labels = 0;
        for (let q = 0; q < region.length; q++) {
          const at = region[q], x = at % grid.cols, y = Math.floor(at / grid.cols);
          if (samples[at].label) labels++;
          const neighbors = [];
          if (x > 0) neighbors.push(at - 1);
          if (x + 1 < grid.cols) neighbors.push(at + 1);
          if (y > 0) neighbors.push(at - grid.cols);
          if (y + 1 < grid.rows) neighbors.push(at + grid.cols);
          for (const next of neighbors) if (!seen[next] && isPaper(cleaned[next])) { seen[next] = 1; region.push(next); }
        }
        if (!labels) region.forEach(at => { cleaned[at] = null; });
      }
    }
    return cleaned;
  }

  function cropOccupied(cells, cols, rows, crop = true) {
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    cells.forEach((c, i) => {
      if (!c) return;
      x0 = Math.min(x0, i % cols); x1 = Math.max(x1, i % cols);
      y0 = Math.min(y0, Math.floor(i / cols)); y1 = Math.max(y1, Math.floor(i / cols));
    });
    if (!crop || x1 < 0) return { cells, cols, rows, bounds: [0, 0, cols, rows] };
    const width = x1 - x0 + 1, height = y1 - y0 + 1, next = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) next.push(cells[y * cols + x]);
    return { cells: next, cols: width, rows: height, bounds: [x0, y0, width, height] };
  }

  function consolidateColors(cells) {
    const counts = new Map();
    for (const rgb of cells) {
      if (!rgb) continue;
      const key = rgb.join(",");
      const sample = counts.get(key) || { key, rgb, count: 0 };
      sample.count++;
      counts.set(key, sample);
    }
    const groups = [], assignments = new Map();
    for (const sample of [...counts.values()].sort((a, b) => b.count - a.count)) {
      const lab = rgbToLab(sample.rgb);
      let group = null, best = 3.5 ** 2;
      for (const candidate of groups) {
        const d = distance(lab, candidate.lab);
        if (d < best) { group = candidate; best = d; }
      }
      if (!group) {
        group = { lab, sum: [0, 0, 0], count: 0 };
        groups.push(group);
      }
      // Fixed color anchors avoid merging a chain of distinct neighboring shades.
      group.count += sample.count;
      for (let i = 0; i < 3; i++) group.sum[i] += sample.rgb[i] * sample.count;
      assignments.set(sample.key, group);
    }
    for (const group of groups) group.rgb = group.sum.map(value => Math.round(value / group.count));
    return cells.map(rgb => rgb ? assignments.get(rgb.join(",")).rgb : null);
  }

  function fitCells(cells, cols, rows, outCols, outRows, match, dark, sampling = "balanced") {
    const page = new Array(outCols * outRows).fill(dark);
    const scale = Math.min(outCols / cols, outRows / rows);
    const width = Math.max(1, Math.round(cols * scale)), height = Math.max(1, Math.round(rows * scale));
    const ox = Math.floor((outCols - width) / 2), oy = Math.floor((outRows - height) / 2);
    const mapped = cells.map(match);
    const importance = mapped.map((frame, i) => {
      if (!cells[i]) return 1;
      const x = i % cols, y = Math.floor(i / cols);
      let contrasting = 0, different = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) continue;
        const other = (y + dy) * cols + x + dx;
        if (mapped[other] === frame) continue;
        different++;
        if (!cells[other] || Math.abs(luma(cells[i]) - luma(cells[other])) > 48) contrasting++;
      }
      // Strong edge boosting merges neighboring marks at severe reductions.
      // Balanced mode limits it; explicit detail mode remains available for
      // sparse drawings whose isolated strokes matter more than area fidelity.
      const stroke = different >= 5 && contrasting >= 4;
      if (sampling === "detail") return stroke ? clamp(1 / scale, 1, 3) : different && luma(cells[i]) < 125 ? 1.55 : 1;
      const straight = (x > 0 && x + 1 < cols && mapped[i - 1] === frame && mapped[i + 1] === frame)
        || (y > 0 && y + 1 < rows && mapped[i - cols] === frame && mapped[i + cols] === frame);
      return stroke ? clamp(1 / scale, 1, straight ? 2.4 : 1.8) : different && luma(cells[i]) < 125 ? 1.15 : 1;
    });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cx = clamp(Math.floor((x + 0.5) * cols / width), 0, cols - 1);
      const cy = clamp(Math.floor((y + 0.5) * rows / height), 0, rows - 1);
      let frame = mapped[cy * cols + cx];
      if (scale < 1 && sampling !== "nearest") {
        const weights = new Map();
        const x0 = x * cols / width, x1 = (x + 1) * cols / width;
        const y0 = y * rows / height, y1 = (y + 1) * rows / height;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const i = Math.min(rows - 1, sy) * cols + Math.min(cols - 1, sx);
          const area = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
          weights.set(mapped[i], (weights.get(mapped[i]) || 0) + area * importance[i]);
        }
        frame = [...weights].sort((a, b) => b[1] - a[1]
          || Number(b[0] === frame) - Number(a[0] === frame) || a[0] - b[0])[0][0];
      }
      page[(y + oy) * outCols + x + ox] = frame;
    }
    return { page, used: [width, height] };
  }

  function sampleRaster(source, background, outCols, outRows) {
    const scale = Math.min(1, Math.max(outCols, outRows) * 6 / Math.max(source.width, source.height));
    const cols = Math.max(1, Math.round(source.width * scale)), rows = Math.max(1, Math.round(source.height * scale));
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const samples = [];
      const n = scale === 1 ? 1 : 3;
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        const rgb = pixel(source, (x + (sx + 0.5) / n) * source.width / cols - 0.5,
          (y + (sy + 0.5) / n) * source.height / rows - 0.5);
        if (rgb[3] >= 32) samples.push(rgb);
      }
      cells.push(samples.length < n * n * 0.5 ? null : dominant(samples));
    }
    const explicitBackground = cells.some(c => !c);
    return { cols, rows, cells: background === "keep" || explicitBackground ? cells : floodBackground(cells, cols, rows, c => !c || isPaper(c)) };
  }

  function analyze(source, palette, options = {}) {
    if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height)
      || source.width < 1 || source.height < 1 || !source.data || source.data.length !== source.width * source.height * 4) {
      throw new Error("图片像素数据无效");
    }
    const cols = clamp(Math.round(Number(options.cols) || COLS), 1, 512);
    const rows = clamp(Math.round(Number(options.rows) || ROWS), 1, 512);
    const dark = Number.isInteger(options.dark) ? options.dark : DARK;
    const match = colorMatcher(palette || [], dark);
    const grid = options.mode === "photo" ? null : detectGrid(source);
    if (options.mode === "grid" && !grid) throw new Error("未识别到规则网格，请选择自动识别或普通图片。");
    const sampled = grid ? { cells: sampleGrid(source, grid, options.background), cols: grid.cols, rows: grid.rows }
      : sampleRaster(source, options.background, cols, rows);
    if (grid) sampled.cells = consolidateColors(sampled.cells);
    const occupied = cropOccupied(sampled.cells, sampled.cols, sampled.rows, options.crop !== false);
    const fitted = fitCells(occupied.cells, occupied.cols, occupied.rows, cols, rows, match, dark, options.sampling);
    const usedFrames = [...new Set(fitted.page)].filter(frame => frame !== dark);
    const colors = usedFrames.map(frame => Array.isArray(palette[frame]) ? palette[frame].slice() : hexToRgb(palette[frame]));
    const reduced = occupied.cols > fitted.used[0] || occupied.rows > fitted.used[1];
    const reductionNote = reduced ? " 已缩小，细字和单格细节会丢失；可切换缩放方式对比。" : "";
    return { page: fitted.page, mode: grid ? "grid" : "photo",
      grid: grid ? { ...grid, detected: [grid.cols, grid.rows], used: fitted.used, bounds: occupied.bounds } : null,
      colors, sourceLit: occupied.cells.filter(Boolean).length,
      message: (grid ? `已识别 ${grid.cols}×${grid.rows} 格，主体 ${occupied.cols}×${occupied.rows}，灯牌 ${fitted.used[0]}×${fitted.used[1]}。`
        : `图片 ${source.width}×${source.height}，灯牌 ${fitted.used[0]}×${fitted.used[1]}。`) + reductionNote };
  }

  function sourceFromCanvas(canvas) {
    const image = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  return { COLS, ROWS, DARK, analyze, detectGrid, sampleGrid, isPaper, nearestFrame, paletteFromSprite, sourceFromCanvas };
});
