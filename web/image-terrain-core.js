(function initImageTerrainCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ImageTerrainCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function imageTerrainCoreFactory() {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pixelRgb(source, x, y, alphaThreshold = 0) {
    if (!source?.pixels || source.width < 1 || source.height < 1) return null;
    const px = clamp(Math.round(x), 0, source.width - 1);
    const py = clamp(Math.round(y), 0, source.height - 1);
    const offset = (py * source.width + px) * 4;
    if (!source.pixels[offset + 3] || source.pixels[offset + 3] < alphaThreshold) return null;
    return [source.pixels[offset], source.pixels[offset + 1], source.pixels[offset + 2]];
  }

  function dominantSample(source, bounds, options = {}) {
    if (!source?.pixels) return { rgb: null, confidence: 0, samples: 0 };
    const alphaThreshold = Number(options.alphaThreshold) || 0;
    const quantize = Math.max(4, Number(options.quantize) || 12);
    const sampleCols = clamp(Math.round(Number(options.sampleCols) || 7), 3, 13);
    const sampleRows = clamp(Math.round(Number(options.sampleRows) || 7), 3, 13);
    const x0 = clamp(Math.min(bounds.x0, bounds.x1), 0, source.width - 1);
    const x1 = clamp(Math.max(bounds.x0, bounds.x1), 0, source.width - 1);
    const y0 = clamp(Math.min(bounds.y0, bounds.y1), 0, source.height - 1);
    const y1 = clamp(Math.max(bounds.y0, bounds.y1), 0, source.height - 1);
    const buckets = new Map();
    let total = 0;
    for (let row = 0; row < sampleRows; row++) {
      const y = y0 + ((row + 0.5) / sampleRows) * Math.max(0, y1 - y0);
      for (let col = 0; col < sampleCols; col++) {
        const x = x0 + ((col + 0.5) / sampleCols) * Math.max(0, x1 - x0);
        const rgb = pixelRgb(source, x, y, alphaThreshold);
        if (!rgb) continue;
        const key = rgb.map((channel) => Math.round(channel / quantize)).join(",");
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { sum: [0, 0, 0], count: 0 };
          buckets.set(key, bucket);
        }
        bucket.count += 1;
        bucket.sum[0] += rgb[0];
        bucket.sum[1] += rgb[1];
        bucket.sum[2] += rgb[2];
        total += 1;
      }
    }
    if (!total || !buckets.size) return { rgb: null, confidence: 0, samples: total };
    const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
    let winner = ranked[0];
    if (options.preferContrast && ranked[1] && ranked[1].count / total >= 0.32) {
      const first = winner.sum.map((sum) => sum / winner.count);
      const second = ranked[1].sum.map((sum) => sum / ranked[1].count);
      const lumaA = first[0] * 0.2126 + first[1] * 0.7152 + first[2] * 0.0722;
      const lumaB = second[0] * 0.2126 + second[1] * 0.7152 + second[2] * 0.0722;
      if (Math.abs(lumaA - lumaB) >= 28) winner = lumaB < lumaA ? ranked[1] : winner;
    }
    return {
      rgb: winner.sum.map((sum) => Math.round(sum / winner.count)),
      confidence: winner.count / total,
      samples: total,
    };
  }

  function enhancedSample(source, x, y, radiusX, radiusY, alphaThreshold = 0, options = {}) {
    return dominantSample(
      source,
      {
        x0: x - Math.max(1.2, radiusX),
        x1: x + Math.max(1.2, radiusX),
        y0: y - Math.max(1.2, radiusY),
        y1: y + Math.max(1.2, radiusY),
      },
      {
        alphaThreshold,
        quantize: options.quantize || 12,
        sampleCols: options.sampleCols || 7,
        sampleRows: options.sampleRows || 7,
        preferContrast: !!options.preferContrast,
      }
    );
  }

  function rgbToLab(r, g, b) {
    const linear = (value) => {
      const n = value / 255;
      return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    const lr = linear(r);
    const lg = linear(g);
    const lb = linear(b);
    const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
    const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
    const curve = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
    const fx = curve(x);
    const fy = curve(y);
    const fz = curve(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labDistanceWeighted(a, b, lumaWeight = 1) {
    const dl = (a[0] - b[0]) * lumaWeight;
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }

  function detailPreset(detail) {
    if (detail === "fine") {
      return { lumaWeight: 2.2, countPower: 0.4, radiusScale: 0.28, radiusCap: 9, quantize: 8, preferContrast: false };
    }
    if (detail === "merge") {
      return { lumaWeight: 1, countPower: 0.5, radiusScale: 0.42, radiusCap: 12, quantize: 12, preferContrast: false };
    }
    return { lumaWeight: 1.8, countPower: 0.55, radiusScale: 0.38, radiusCap: 14, quantize: 10, preferContrast: false };
  }

  function clusterPalette(samples, requested, options = {}) {
    if (!samples.length) return [];
    const count = Math.max(1, Math.min(requested, samples.length));
    const lumaWeight = Number(options.lumaWeight) || 1;
    const countPower = options.countPower == null ? 0.5 : Number(options.countPower);
    const prepared = samples.map((sample) => ({
      rgb: sample.rgb.slice(),
      lab: sample.lab || rgbToLab(...sample.rgb),
      count: Math.max(1, Number(sample.count) || 1),
    }));
    const centers = [prepared.reduce((best, row) => (row.count > best.count ? row : best), prepared[0])];
    while (centers.length < count) {
      let pick = null;
      let score = -1;
      prepared.forEach((sample) => {
        const distance = Math.min(...centers.map((center) => labDistanceWeighted(sample.lab, center.lab, lumaWeight)));
        const next = distance * Math.pow(sample.count, countPower);
        if (next > score) {
          score = next;
          pick = sample;
        }
      });
      if (!pick) break;
      centers.push(pick);
    }
    let palette = centers.map((center) => ({ rgb: center.rgb.slice(), lab: center.lab.slice(), count: 0 }));
    for (let iteration = 0; iteration < 10; iteration++) {
      const sums = palette.map(() => ({ rgb: [0, 0, 0], count: 0 }));
      prepared.forEach((sample) => {
        let best = 0;
        let distance = Infinity;
        palette.forEach((center, index) => {
          const next = labDistanceWeighted(sample.lab, center.lab, lumaWeight);
          if (next < distance) {
            distance = next;
            best = index;
          }
        });
        const sum = sums[best];
        sum.count += sample.count;
        for (let channel = 0; channel < 3; channel++) sum.rgb[channel] += sample.rgb[channel] * sample.count;
      });
      palette = palette.map((center, index) => {
        const sum = sums[index];
        if (!sum.count) return center;
        const rgb = sum.rgb.map((value) => Math.round(value / sum.count));
        return { rgb, lab: rgbToLab(...rgb), count: sum.count };
      });
    }
    return palette.sort((a, b) => b.count - a.count);
  }

  function nearestPaletteIndex(rgb, palette, lumaWeight = 1) {
    if (!rgb || !palette?.length) return -1;
    const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
    let best = 0;
    let distance = Infinity;
    palette.forEach((entry, index) => {
      const next = labDistanceWeighted(lab, entry.lab || rgbToLab(...entry.rgb), lumaWeight);
      if (next < distance) {
        distance = next;
        best = index;
      }
    });
    return best;
  }

  function mapPaletteToMaterials(palette, materials, mode = "distinct") {
    const source = palette.map(entry => entry.lab || rgbToLab(...entry.rgb));
    const target = materials.map(entry => rgbToLab(...entry.rgb));
    const assigned = new Array(palette.length).fill(-1);
    // Anchor large regions first. Similar source shades may share a material;
    // clearly different regions pay a penalty when their output contrast vanishes.
    const order = palette.map((_, i) => i).sort((a, b) => palette[b].count - palette[a].count);
    for (const i of order) {
      if (!palette[i].count) continue;
      let best = Infinity;
      for (let m = 0; m < target.length; m++) {
        let cost = labDistanceWeighted(source[i], target[m]);
        if (mode === "distinct") {
          for (let j = 0; j < assigned.length; j++) {
            if (assigned[j] < 0) continue;
            const contrast = Math.sqrt(labDistanceWeighted(source[i], source[j]));
            if (contrast < 14) continue;
            const output = Math.sqrt(labDistanceWeighted(target[m], target[assigned[j]]));
            const desired = Math.min(30, contrast * 0.75);
            cost += 6 * Math.pow(Math.max(0, desired - output), 2);
          }
        }
        if (cost < best) { best = cost; assigned[i] = m; }
      }
    }
    return assigned;
  }

  function cropSource(source, rect) {
    if (!rect) return source;
    const x = clamp(Math.floor(rect.x * source.width), 0, source.width - 1);
    const y = clamp(Math.floor(rect.y * source.height), 0, source.height - 1);
    const right = clamp(Math.ceil((rect.x + rect.w) * source.width), x + 1, source.width);
    const bottom = clamp(Math.ceil((rect.y + rect.h) * source.height), y + 1, source.height);
    const width = right - x, height = bottom - y;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * source.width + x) * 4;
      pixels.set(source.pixels.subarray(start, start + width * 4), row * width * 4);
    }
    return { width, height, pixels };
  }

  function rgbDistanceSq(a, b) {
    if (!a || !b) return Infinity;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function luminance(rgb) {
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }

  function lineProjection(source, axis) {
    const length = axis === "x" ? source.width : source.height;
    const cross = axis === "x" ? source.height : source.width;
    const stride = Math.max(1, Math.floor(cross / 600));
    const result = new Array(length).fill(0);
    const offset = (p, q) => (axis === "x" ? q * source.width + p : p * source.width + q) * 4;
    for (let position = 1; position < length - 1; position++) {
      const radius = Math.min(2, position, length - 1 - position);
      let sum = 0;
      let count = 0;
      let support = 0;
      for (let other = 0; other < cross; other += stride) {
        const at = offset(position, other);
        const before = offset(position - radius, other);
        const after = offset(position + radius, other);
        // A thin line contrasts with both sides; a shape edge contrasts with only one.
        let contrast = 0;
        for (let channel = 0; channel < 3; channel++) {
          const value = i => source.pixels[i + 3] < 24 ? 255 : source.pixels[i + channel];
          const left = value(before) - value(at), right = value(after) - value(at);
          contrast += (Math.max(0, Math.min(left, right) - 6, Math.min(-left, -right) - 6)
            + Math.max(0, Math.abs(left - right) - 30) * 0.12) / 3;
        }
        sum += contrast;
        if (contrast > 3) support++;
        count += 1;
      }
      result[position] = count ? sum / count * (support / count) ** 2 : 0;
    }
    return result;
  }

  function estimateGridAxis(scores, options = {}) {
    const minPeriod = Math.max(5, Number(options.minPeriod) || 5);
    const maxPeriod = Math.min(scores.length / 5, Number(options.maxPeriod) || 180);
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const peaks = [];
    for (let p = 1; p < scores.length - 1; p++) {
      if (scores[p] < Math.max(1.5, mean * 0.65) || scores[p] < scores[p - 1] || scores[p] <= scores[p + 1]) continue;
      if (peaks.length && p - peaks[peaks.length - 1] <= 2) {
        if (scores[p] > scores[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = p;
      } else peaks.push(p);
    }
    if (peaks.length < 6) return null;
    const gaps = new Map();
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < Math.min(peaks.length, i + 5); j++) {
        const gap = peaks[j] - peaks[i];
        if (gap >= minPeriod - 1 && gap <= maxPeriod + 1) gaps.set(gap, (gaps.get(gap) || 0) + 1);
      }
    }
    const periods = [...new Set([...gaps].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .flatMap(([gap]) => [-0.5, -0.25, 0, 0.25, 0.5].map(delta => gap + delta)))];
    const origins = peaks.slice().sort((a, b) => scores[b] - scores[a]).slice(0, 10);
    let best = null;
    for (const initial of periods) {
      for (const origin of origins) {
        let start = origin, step = initial, matches = [];
        // Refit the fractional pitch from all lines so resizing cannot accumulate drift.
        for (let pass = 0; pass < 6; pass++) {
          matches = peaks.map(p => ({ p, n: Math.round((p - start) / step) }))
            .filter(v => Math.abs(v.p - start - v.n * step) <= Math.min(2, step * 0.12));
          const unique = new Map();
          for (const match of matches) {
            if (!unique.has(match.n) || scores[match.p] > scores[unique.get(match.n).p]) unique.set(match.n, match);
          }
          matches = [...unique.values()].sort((a, b) => a.n - b.n);
          if (matches.length < 6) break;
          const mn = matches.reduce((sum, v) => sum + v.n, 0) / matches.length;
          const mp = matches.reduce((sum, v) => sum + v.p, 0) / matches.length;
          const den = matches.reduce((sum, v) => sum + (v.n - mn) ** 2, 0);
          if (!den) break;
          step = matches.reduce((sum, v) => sum + (v.n - mn) * (v.p - mp), 0) / den;
          start = mp - mn * step;
        }
        if (matches.length < 6 || step < minPeriod - 0.1 || step > maxPeriod + 0.1) continue;
        const first = matches[0].n, last = matches[matches.length - 1].n;
        const coverage = matches.length / (last - first + 1);
        if (coverage < 0.75 || (last - first) * step < scores.length * 0.35) continue;
        const score = matches.reduce((sum, v) => sum + scores[v.p], 0) * coverage / matches.length ** 0.75;
        if (!best || score > best.score) best = { start, step, matches, score, coverage };
      }
    }
    if (!best) return null;
    const strengths = best.matches.map(v => scores[v.p]).sort((a, b) => a - b);
    const edgeThreshold = strengths[Math.floor(strengths.length / 2)] * 0.1;
    while (best.matches.length > 6 && scores[best.matches[0].p] < edgeThreshold) best.matches.shift();
    while (best.matches.length > 6 && scores[best.matches[best.matches.length - 1].p] < edgeThreshold) best.matches.pop();
    let lo = best.matches[0].n, hi = best.matches[best.matches.length - 1].n;
    const before = best.start + (lo - 1) * best.step;
    if (before >= -1 && before <= 2 && Math.max(...scores.slice(0, 3)) > 3) lo--;
    const endDistance = Math.abs(best.start + (hi + 1) * best.step - (scores.length - 1));
    if (endDistance <= 1 || (endDistance <= 2 && Math.max(...scores.slice(-3)) > 3)) hi++;
    return { start: best.start + lo * best.step, step: best.step, count: hi - lo, confidence: best.coverage };
  }

  function detectGrid(source, options = {}) {
    if (!source?.pixels || source.width < 64 || source.height < 64) return null;
    const x = estimateGridAxis(lineProjection(source, "x"), options);
    const y = estimateGridAxis(lineProjection(source, "y"), options);
    if (!x || !y) return null;
    const periodRatio = Math.max(x.step, y.step) / Math.min(x.step, y.step);
    if (periodRatio > 2 || x.count < 5 || y.count < 5) return null;
    const confidence = Math.min(x.confidence, y.confidence);
    if (confidence < (Number(options.minConfidence) || 0.16)) return null;
    const grid = {
      x0: x.start,
      y0: y.start,
      cols: x.count,
      rows: y.count,
      stepX: x.step,
      stepY: y.step,
      confidence,
      rulers: 0,
    };
    trimGridRulers(source, grid);
    grid.x1 = grid.x0 + grid.cols * grid.stepX;
    grid.y1 = grid.y0 + grid.rows * grid.stepY;
    grid.xLines = Array.from({ length: grid.cols + 1 }, (_, i) => grid.x0 + i * grid.stepX);
    grid.yLines = Array.from({ length: grid.rows + 1 }, (_, i) => grid.y0 + i * grid.stepY);
    const cornerCells = [
      [0, 0],
      [Math.max(0, grid.cols - 1), 0],
      [0, Math.max(0, grid.rows - 1)],
      [Math.max(0, grid.cols - 1), Math.max(0, grid.rows - 1)],
    ];
    const cornerSamples = cornerCells
      .map(([col, row]) => dominantSample(
        source,
        {
          x0: grid.x0 + (col + 0.16) * grid.stepX,
          x1: grid.x0 + (col + 0.84) * grid.stepX,
          y0: grid.y0 + (row + 0.16) * grid.stepY,
          y1: grid.y0 + (row + 0.84) * grid.stepY,
        },
        { quantize: 12, sampleCols: 7, sampleRows: 7 }
      ).rgb)
      .filter(Boolean);
    if (cornerSamples.length) {
      grid.backgroundRgb = cornerSamples.reduce((best, rgb) => {
        const support = cornerSamples.filter((other) => rgbDistanceSq(rgb, other) <= 18 * 18).length;
        return !best || support > best.support ? { rgb, support } : best;
      }, null).rgb;
    }
    // Auto mode requires repeated cell labels or a paired numbered border.
    // Regular textures and windows can have periodic lines without being a chart.
    let labeled = 0, checked = 0;
    const stride = Math.max(1, Math.floor(grid.cols * grid.rows / 300));
    for (let i = 0; i < grid.cols * grid.rows; i += stride) {
      if (sampleGridCell(source, grid, i % grid.cols, Math.floor(i / grid.cols)).labeled) labeled++;
      checked++;
    }
    grid.autoSuitable = grid.rulers > 0 || (labeled >= 6 && labeled / checked >= 0.04);
    return grid;
  }

  function colorVote(colors, quantize = 16) {
    const buckets = new Map();
    for (const rgb of colors) {
      const key = rgb.map(v => Math.round(v / quantize)).join(",");
      const bucket = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
      bucket.count++;
      for (let c = 0; c < 3; c++) bucket.sum[c] += rgb[c];
      buckets.set(key, bucket);
    }
    const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    return best
      ? { rgb: best.sum.map(v => Math.round(v / best.count)), confidence: best.count / colors.length, samples: colors.length }
      : { rgb: null, confidence: 0, samples: 0 };
  }

  function sampleGridCell(source, grid, col, row, alphaThreshold = 0) {
    const ring = [], center = [];
    const steps = clamp(Math.ceil(Math.min(grid.stepX, grid.stepY)), 5, 17);
    for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
      const fx = 0.16 + (x + 0.5) / steps * 0.68;
      const fy = 0.16 + (y + 0.5) / steps * 0.68;
      const rgb = pixelRgb(source, grid.x0 + (col + fx) * grid.stepX, grid.y0 + (row + fy) * grid.stepY, alphaThreshold);
      if (!rgb) continue;
      if (fy < 0.34 || fy > 0.66) ring.push(rgb);
      else if (fx > 0.25 && fx < 0.75) center.push(rgb);
    }
    const sampled = colorVote(ring);
    if (!sampled.rgb) return { ...sampled, labeled: false };
    const fill = luminance(sampled.rgb);
    const isInk = rgb => luminance(rgb) < Math.min(130, fill - 65) || luminance(rgb) > Math.max(150, fill + 65);
    const ink = center.filter(isInk).length;
    const inkRatio = ink / Math.max(1, center.length);
    const ringRatio = ring.filter(isInk).length / ring.length;
    return { ...sampled, labeled: ink >= Math.max(2, center.length * 0.045) && inkRatio > ringRatio * 1.7 };
  }

  function trimGridRulers(source, grid) {
    const ruler = (axis, n) => {
      const step = axis === "x" ? grid.stepX : grid.stepY;
      const coordinate = (axis === "x" ? grid.x0 : grid.y0) + n * step;
      if (coordinate < 0 || coordinate + step > (axis === "x" ? source.width : source.height) + 1) return null;
      const samples = Array.from({ length: axis === "x" ? grid.rows : grid.cols }, (_, i) =>
        sampleGridCell(source, grid, axis === "x" ? n : i, axis === "y" ? n : i));
      const values = samples.map(cell => cell.rgb).filter(Boolean), rgb = colorVote(values).rgb;
      return rgb && Math.max(...rgb) - Math.min(...rgb) > 24
        && samples.filter(cell => cell.labeled).length > samples.length * 0.35
        && values.filter(value => rgbDistanceSq(value, rgb) < 24 ** 2).length > samples.length * 0.88 ? rgb : null;
    };
    for (const axis of ["x", "y"]) {
      const count = axis === "x" ? grid.cols : grid.rows;
      const starts = [-3, -2, -1, 0, 1, 2, 3].map(i => ({ i, rgb: ruler(axis, i) })).filter(v => v.rgb);
      const ends = [-3, -2, -1, 0, 1, 2, 3].map(d => ({ i: count + d, rgb: ruler(axis, count + d) })).filter(v => v.rgb);
      const pairs = starts.flatMap(a => ends.filter(b => rgbDistanceSq(a.rgb, b.rgb) < 24 ** 2)
        .map(b => ({ first: a.i + 1, count: b.i - a.i - 1, cost: Math.abs(a.i + 1) + Math.abs(b.i - count) })));
      const pair = pairs.filter(p => p.count >= 5).sort((a, b) => a.cost - b.cost)[0];
      if (!pair) continue;
      if (axis === "x") { grid.x0 += pair.first * grid.stepX; grid.cols = pair.count; }
      else { grid.y0 += pair.first * grid.stepY; grid.rows = pair.count; }
      grid.rulers++;
    }
  }

  function sampleGrid(source, grid, alphaThreshold = 0, options = {}) {
    const samples = [];
    for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
      samples.push(sampleGridCell(source, grid, col, row, alphaThreshold));
    }
    if (options.background === "keep") return samples;
    const paper = rgb => rgb && luminance(rgb) >= 228 && Math.max(...rgb) - Math.min(...rgb) <= 24;
    const neighbors = i => {
      const x = i % grid.cols, y = Math.floor(i / grid.cols), out = [];
      if (x > 0) out.push(i - 1);
      if (x + 1 < grid.cols) out.push(i + 1);
      if (y > 0) out.push(i - grid.cols);
      if (y + 1 < grid.rows) out.push(i + grid.cols);
      return out;
    };
    const seen = new Uint8Array(samples.length), queue = [];
    const visit = i => {
      const cell = samples[i];
      if (seen[i] || (cell.rgb && (!paper(cell.rgb) || cell.labeled))) return;
      seen[i] = 1;
      queue.push(i);
    };
    for (let x = 0; x < grid.cols; x++) { visit(x); visit((grid.rows - 1) * grid.cols + x); }
    for (let y = 0; y < grid.rows; y++) { visit(y * grid.cols); visit(y * grid.cols + grid.cols - 1); }
    for (let q = 0; q < queue.length; q++) neighbors(queue[q]).forEach(visit);
    const blank = i => { samples[i] = { ...samples[i], rgb: null, blank: true }; };
    queue.forEach(blank);
    // Enclosed white is artwork unless a labeled chart identifies an empty region.
    const labeledPaper = samples.filter(cell => paper(cell.rgb) && cell.labeled).length;
    if (labeledPaper >= 6) {
      for (let i = 0; i < samples.length; i++) {
        if (seen[i] || !paper(samples[i].rgb)) continue;
        const region = [i];
        seen[i] = 1;
        let labels = 0;
        for (let q = 0; q < region.length; q++) {
          const at = region[q];
          if (samples[at].labeled) labels++;
          for (const next of neighbors(at)) {
            if (seen[next] || !paper(samples[next].rgb)) continue;
            seen[next] = 1;
            region.push(next);
          }
        }
        if (!labels) region.forEach(blank);
      }
    }
    return samples;
  }

  function gridSample(source, grid, normalizedX, normalizedY, alphaThreshold = 0, samples = null) {
    if (!grid) return { rgb: null, confidence: 0, samples: 0 };
    const col = clamp(Math.floor(normalizedX * grid.cols), 0, grid.cols - 1);
    const row = clamp(Math.floor(normalizedY * grid.rows), 0, grid.rows - 1);
    return (samples || sampleGrid(source, grid, alphaThreshold))[row * grid.cols + col];
  }

  function neighborKeys(cell) {
    const u = Number(cell?.u);
    const v = Number(cell?.v);
    return [
      `${u - 1},${v}`,
      `${u + 1},${v}`,
      `${u},${v - 1}`,
      `${u},${v + 1}`,
      `${u - 1},${v - 1}`,
      `${u - 1},${v + 1}`,
      `${u + 1},${v - 1}`,
      `${u + 1},${v + 1}`,
    ];
  }

  function fillSmallIslands(cells, indices, positions, minSize, protectDetails) {
    const seen = new Uint8Array(indices.length);
    for (let start = 0; start < cells.length; start++) {
      if (seen[start]) continue;
      const value = indices[start];
      const component = [];
      const border = new Map();
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const index = stack.pop();
        component.push(index);
        neighborKeys(cells[index]).forEach((key) => {
          const next = positions.get(key);
          if (next == null) return;
          if (indices[next] === value) {
            if (!seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
            return;
          }
          border.set(indices[next], (border.get(indices[next]) || 0) + 1);
        });
      }
      if (value < 0 || component.length >= minSize || !border.size) continue;
      if (protectDetails && component.some(index => cells[index].gridCell || Number(cells[index].confidence) >= 0.8)) continue;
      const [majority] = [...border.entries()].sort((a, b) => b[1] - a[1])[0];
      component.forEach((index) => {
        indices[index] = majority;
      });
    }
  }

  function cleanTerrainIndices(cells, sourceIndices, strength = "light") {
    const indices = Array.from(sourceIndices || []);
    if (!cells?.length || !indices.length || strength === "none") {
      return { indices, changed: 0 };
    }
    const positions = new Map();
    cells.forEach((cell, index) => positions.set(`${cell.u},${cell.v}`, index));
    const strong = strength === "strong";
    fillSmallIslands(cells, indices, positions, strong ? 4 : 3, !strong);
    const maxPasses = strong ? 3 : 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      const before = indices.slice();
      cells.forEach((cell, index) => {
        const neighbors = neighborKeys(cell)
          .map((key) => positions.get(key))
          .filter((next) => next != null)
          .map((next) => before[next]);
        if (neighbors.length < 2) return;
        const counts = new Map();
        neighbors.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
        const current = before[index];
        if (current < 0 || (!strong && (cell.gridCell || Number(cell.confidence) >= 0.8))) return;
        const currentCount = counts.get(current) || 0;
        const [majority, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (majority === current) return;
        const isolated = currentCount === 0 && majorityCount >= (strong ? 2 : 3);
        const shortGap = strong && majorityCount >= 5;
        const shaky = Number(cell.confidence) > 0
          && Number(cell.confidence) < 0.45
          && currentCount <= 1
          && majorityCount >= (strong ? 3 : 4);
        if (isolated || shortGap || shaky) indices[index] = majority;
      });
    }
    let changed = 0;
    for (let index = 0; index < indices.length; index++) {
      if (indices[index] !== sourceIndices[index]) changed += 1;
    }
    return { indices, changed };
  }

  function selectionCorners(rect) {
    return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
  }

  function hitSelection(rect, point, tolerance) {
    if (!rect) return -1;
    const distances = selectionCorners(rect).map(p => Math.hypot(p.x - point.x, p.y - point.y));
    const nearest = Math.min(...distances);
    if (nearest <= tolerance) return distances.indexOf(nearest);
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h ? "move" : -1;
  }

  function selectionFromDrag(start, end, bounds, ratio = 0) {
    const a = { x: clamp(start.x, 0, bounds.w), y: clamp(start.y, 0, bounds.h) };
    const b = { x: clamp(end.x, 0, bounds.w), y: clamp(end.y, 0, bounds.h) };
    const sx = b.x < a.x ? -1 : 1, sy = b.y < a.y ? -1 : 1;
    let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (ratio > 0) {
      w = Math.max(w, h * ratio); h = w / ratio;
      const scale = Math.min(1, (sx > 0 ? bounds.w - a.x : a.x) / (w || 1),
        (sy > 0 ? bounds.h - a.y : a.y) / (h || 1));
      w *= scale; h *= scale;
    }
    return { x: sx > 0 ? a.x : a.x - w, y: sy > 0 ? a.y : a.y - h, w, h };
  }

  function moveSelection(rect, dx, dy, bounds) {
    return { ...rect, x: clamp(rect.x + dx, 0, Math.max(0, bounds.w - rect.w)),
      y: clamp(rect.y + dy, 0, Math.max(0, bounds.h - rect.h)) };
  }

  function fitSelection(rect, width, height, bounds) {
    const scale = Math.min(1, bounds.w / Math.max(1, width), bounds.h / Math.max(1, height));
    const w = Math.max(1, width * scale), h = Math.max(1, height * scale);
    return { x: clamp(rect.x + (rect.w - w) / 2, 0, bounds.w - w),
      y: clamp(rect.y + (rect.h - h) / 2, 0, bounds.h - h), w, h };
  }

  return {
    selectionCorners,
    hitSelection,
    selectionFromDrag,
    moveSelection,
    fitSelection,
    pixelRgb,
    dominantSample,
    enhancedSample,
    detailPreset,
    clusterPalette,
    nearestPaletteIndex,
    mapPaletteToMaterials,
    cropSource,
    detectGrid,
    sampleGrid,
    gridSample,
    cleanTerrainIndices,
  };
});
