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
    if (source.pixels[offset + 3] < alphaThreshold) return null;
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

  function rgbDistanceSq(a, b) {
    if (!a || !b) return Infinity;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function luminanceAt(source, x, y) {
    const offset = (y * source.width + x) * 4;
    const r = source.pixels[offset];
    const g = source.pixels[offset + 1];
    const b = source.pixels[offset + 2];
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }

  function lineProjection(source, axis) {
    const length = axis === "x" ? source.width : source.height;
    const cross = axis === "x" ? source.height : source.width;
    const stride = Math.max(1, Math.floor(cross / 420));
    const result = new Array(length).fill(0);
    for (let position = 2; position < length - 2; position++) {
      let sum = 0;
      let count = 0;
      for (let other = 0; other < cross; other += stride) {
        const center = axis === "x"
          ? luminanceAt(source, position, other)
          : luminanceAt(source, other, position);
        const before = axis === "x"
          ? luminanceAt(source, position - 2, other)
          : luminanceAt(source, other, position - 2);
        const after = axis === "x"
          ? luminanceAt(source, position + 2, other)
          : luminanceAt(source, other, position + 2);
        sum += Math.max(0, (before + after) / 2 - center);
        count += 1;
      }
      result[position] = count ? sum / count : 0;
    }
    return result;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)];
  }

  function interpolated(values, position) {
    const left = clamp(Math.floor(position), 0, values.length - 1);
    const right = clamp(left + 1, 0, values.length - 1);
    const t = position - Math.floor(position);
    return values[left] * (1 - t) + values[right] * t;
  }

  function estimateGridAxis(scores, options = {}) {
    if (!scores?.length) return null;
    const minPeriod = Math.max(6, Number(options.minPeriod) || 8);
    const maxPeriod = Math.min(scores.length / 4, Number(options.maxPeriod) || 64);
    if (maxPeriod < minPeriod) return null;
    const baseline = percentile(scores, 0.5);
    let bestPeriod = 0;
    let bestCorrelation = -Infinity;
    for (let period = minPeriod; period <= maxPeriod; period += 0.25) {
      let sum = 0;
      let count = 0;
      for (let x = period; x < scores.length; x += 1) {
        const a = Math.max(0, scores[Math.round(x)] - baseline);
        const b = Math.max(0, interpolated(scores, x - period) - baseline);
        sum += Math.sqrt(a * b);
        count += 1;
      }
      const correlation = count ? sum / count : 0;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }
    if (!bestPeriod) return null;

    let bestPhase = 0;
    let bestPhaseScore = -Infinity;
    for (let phase = 0; phase < bestPeriod; phase += 0.25) {
      const values = [];
      for (let position = phase; position < scores.length; position += bestPeriod) {
        values.push(interpolated(scores, position));
      }
      values.sort((a, b) => b - a);
      const keep = Math.max(4, Math.round(values.length * 0.75));
      const score = values.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep;
      if (score > bestPhaseScore) {
        bestPhaseScore = score;
        bestPhase = phase;
      }
    }

    const allLines = [];
    for (let position = bestPhase; position < scores.length; position += bestPeriod) {
      allLines.push({ position, score: interpolated(scores, position) });
    }
    const threshold = baseline + Math.max(0.3, (percentile(scores, 0.8) - baseline) * 0.16);
    let best = null;
    for (let start = 0; start < allLines.length - 7; start++) {
      let good = 0;
      let totalScore = 0;
      for (let end = start; end < allLines.length; end++) {
        if (allLines[end].score >= threshold) good += 1;
        totalScore += Math.max(0, allLines[end].score - baseline);
        const count = end - start + 1;
        if (count < 8 || good / count < 0.62) continue;
        const candidate = { start, end, count, good, totalScore };
        if (
          !best ||
          candidate.count > best.count ||
          (candidate.count === best.count && candidate.totalScore > best.totalScore)
        ) best = candidate;
      }
    }
    if (!best) return null;
    while (best.start < best.end && allLines[best.start].score < threshold) best.start += 1;
    while (best.end > best.start && allLines[best.end].score < threshold) best.end -= 1;
    const lines = allLines.slice(best.start, best.end + 1);
    if (lines.length < 8) return null;
    const peakMean = lines.reduce((sum, line) => sum + line.score, 0) / lines.length;
    const confidence = clamp((peakMean - baseline) / Math.max(1, percentile(scores, 0.95) - baseline), 0, 1);
    return {
      start: lines[0].position,
      end: lines[lines.length - 1].position,
      period: bestPeriod,
      lines: lines.map((line) => line.position),
      intervals: Math.max(0, lines.length - 1),
      confidence,
    };
  }

  function trimAxisIntervals(axis, targetIntervals) {
    if (!axis || axis.intervals <= targetIntervals) return axis;
    const remove = axis.intervals - targetIntervals;
    let left = 0;
    let right = axis.lines.length - 1;
    for (let i = 0; i < remove; i++) {
      const leftGap = axis.lines[left + 1] - axis.lines[left];
      const rightGap = axis.lines[right] - axis.lines[right - 1];
      if (leftGap >= rightGap) left += 1;
      else right -= 1;
    }
    const lines = axis.lines.slice(left, right + 1);
    return {
      ...axis,
      start: lines[0],
      end: lines[lines.length - 1],
      lines,
      intervals: lines.length - 1,
    };
  }

  function detectGrid(source, options = {}) {
    if (!source?.pixels || source.width < 64 || source.height < 64) return null;
    let x = estimateGridAxis(lineProjection(source, "x"), options);
    let y = estimateGridAxis(lineProjection(source, "y"), options);
    if (!x || !y) return null;
    const periodRatio = Math.max(x.period, y.period) / Math.max(1, Math.min(x.period, y.period));
    if (periodRatio > 1.28 || x.intervals < 8 || y.intervals < 8) return null;
    if (Math.abs(x.intervals - y.intervals) <= 3) {
      const intervals = Math.min(x.intervals, y.intervals);
      x = trimAxisIntervals(x, intervals);
      y = trimAxisIntervals(y, intervals);
    }
    const confidence = Math.min(x.confidence, y.confidence) * clamp(1.28 - periodRatio, 0, 0.28) / 0.28;
    if (confidence < (Number(options.minConfidence) || 0.16)) return null;
    const grid = {
      x0: x.start,
      x1: x.end,
      y0: y.start,
      y1: y.end,
      cols: x.intervals,
      rows: y.intervals,
      stepX: (x.end - x.start) / Math.max(1, x.intervals),
      stepY: (y.end - y.start) / Math.max(1, y.intervals),
      confidence,
      xLines: x.lines,
      yLines: y.lines,
    };
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
    return grid;
  }

  function gridSample(source, grid, normalizedX, normalizedY, alphaThreshold = 0) {
    if (!grid) return { rgb: null, confidence: 0, samples: 0 };
    const col = clamp(Math.floor(clamp(normalizedX, 0, 0.999999) * grid.cols), 0, grid.cols - 1);
    const row = clamp(Math.floor(clamp(normalizedY, 0, 0.999999) * grid.rows), 0, grid.rows - 1);
    const x0 = grid.x0 + col * grid.stepX;
    const y0 = grid.y0 + row * grid.stepY;
    const bounds = {
      x0: x0 + grid.stepX * 0.14,
      x1: x0 + grid.stepX * 0.86,
      y0: y0 + grid.stepY * 0.14,
      y1: y0 + grid.stepY * 0.86,
    };
    const sampled = dominantSample(
      source,
      bounds,
      { alphaThreshold, quantize: 12, sampleCols: 8, sampleRows: 8 }
    );
    if (!sampled.rgb || !grid.backgroundRgb || rgbDistanceSq(sampled.rgb, grid.backgroundRgb) > 24 * 24) {
      return sampled;
    }
    let ink = 0;
    let opaque = 0;
    const xStart = clamp(Math.ceil(bounds.x0), 0, source.width - 1);
    const xEnd = clamp(Math.floor(bounds.x1), 0, source.width - 1);
    const yStart = clamp(Math.ceil(bounds.y0), 0, source.height - 1);
    const yEnd = clamp(Math.floor(bounds.y1), 0, source.height - 1);
    const fillLuma = sampled.rgb[0] * 0.2126 + sampled.rgb[1] * 0.7152 + sampled.rgb[2] * 0.0722;
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const rgb = pixelRgb(source, x, y, alphaThreshold);
        if (!rgb) continue;
        opaque += 1;
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        if (fillLuma - luma > 45 && rgbDistanceSq(rgb, sampled.rgb) > 45 * 45) ink += 1;
      }
    }
    const inkRatio = opaque ? ink / opaque : 0;
    if (inkRatio < 0.018) {
      return { rgb: null, confidence: sampled.confidence, samples: sampled.samples, blank: true, inkRatio };
    }
    return { ...sampled, inkRatio, labeled: true };
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

  function fillSmallIslands(cells, indices, positions, minSize) {
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
    fillSmallIslands(cells, indices, positions, strong ? 4 : 3);
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

  return {
    pixelRgb,
    dominantSample,
    enhancedSample,
    detailPreset,
    clusterPalette,
    nearestPaletteIndex,
    detectGrid,
    gridSample,
    cleanTerrainIndices,
  };
});
