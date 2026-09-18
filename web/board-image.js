(function initBoardImage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BoardImage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function boardImageFactory() {
  "use strict";

  const COLS = 36;
  const ROWS = 24;
  const DARK = 50;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hexToRgb(hex) {
    const text = String(hex || "").replace("#", "");
    if (text.length < 6) return [0, 0, 0];
    return [parseInt(text.slice(0, 2), 16), parseInt(text.slice(2, 4), 16), parseInt(text.slice(4, 6), 16)];
  }

  function pixel(source, x, y) {
    const px = clamp(Math.round(x), 0, source.width - 1);
    const py = clamp(Math.round(y), 0, source.height - 1);
    const o = (py * source.width + px) * 4;
    return [source.data[o], source.data[o + 1], source.data[o + 2], source.data[o + 3]];
  }

  function lumaRgb(r, g, b) {
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }

  function rgbDist(a, b) {
    if (!a || !b) return 1e9;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function sat(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min;
  }

  function isPaper(rgb, paper) {
    if (!rgb) return true;
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    const chroma = sat(r, g, b);
    if (paper && rgbDist(rgb, paper) <= 28 * 28 && chroma <= 36) return true;
    if (luma >= 226 && chroma <= 28) return true;
    if (luma >= 214 && chroma <= 14) return true;
    if (luma >= 208 && chroma <= 12) return true;
    return luma >= 180 && chroma <= 40 && b >= r + 6 && b >= g + 2;
  }

  function isInk(rgb) {
    if (!rgb) return false;
    const luma = lumaRgb(rgb[0], rgb[1], rgb[2]);
    const chroma = sat(rgb[0], rgb[1], rgb[2]);
    return luma <= 78 && chroma <= 22;
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

  function labDist(a, b) {
    const dl = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }

  function collectSamples(source, points) {
    const samples = [];
    points.forEach((point) => {
      const rgb = pixel(source, point[0], point[1]);
      if (rgb[3] < 18) return;
      samples.push(rgb);
    });
    return samples;
  }

  function bucketRgb(samples) {
    const buckets = new Map();
    samples.forEach((rgb) => {
      const key = `${Math.round(rgb[0] / 12)},${Math.round(rgb[1] / 12)},${Math.round(rgb[2] / 12)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { sum: [0, 0, 0], count: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.sum[0] += rgb[0];
      bucket.sum[1] += rgb[1];
      bucket.sum[2] += rgb[2];
    });
    return [...buckets.values()].map((bucket) => {
      const rgb = bucket.sum.map((value) => Math.round(value / bucket.count));
      return { rgb, count: bucket.count, sat: sat(...rgb), luma: lumaRgb(...rgb) };
    }).sort((a, b) => b.count - a.count);
  }

  function pickRgb(samples, paper) {
    if (!samples.length) return null;
    const ranked = bucketRgb(samples);
    const chroma = ranked.filter((row) => row.sat >= 16 && !isPaper(row.rgb, paper) && !isInk(row.rgb));
    if (chroma.length) {
      return chroma.slice().sort((a, b) => (b.count * (1 + b.sat / 40)) - (a.count * (1 + a.sat / 40)))[0].rgb;
    }
    const fill = ranked.filter((row) => !isPaper(row.rgb, paper) && !isInk(row.rgb) && row.luma < 222);
    if (fill.length) return fill[0].rgb;
    const dark = ranked.filter((row) => row.sat >= 12 && row.luma < 140);
    if (dark.length) return dark[0].rgb;
    const paperish = ranked.filter((row) => isPaper(row.rgb, paper));
    if (paperish.length) return paperish[0].rgb;
    return ranked[0].rgb;
  }

  function dominantSample(source, bounds) {
    const x0 = clamp(Math.min(bounds.x0, bounds.x1), 0, source.width - 1);
    const x1 = clamp(Math.max(bounds.x0, bounds.x1), 0, source.width - 1);
    const y0 = clamp(Math.min(bounds.y0, bounds.y1), 0, source.height - 1);
    const y1 = clamp(Math.max(bounds.y0, bounds.y1), 0, source.height - 1);
    const points = [];
    const cols = 7;
    const rows = 7;
    for (let row = 0; row < rows; row += 1) {
      const y = y0 + ((row + 0.5) / rows) * Math.max(0, y1 - y0);
      for (let col = 0; col < cols; col += 1) {
        const x = x0 + ((col + 0.5) / cols) * Math.max(0, x1 - x0);
        points.push([x, y]);
      }
    }
    return pickRgb(collectSamples(source, points));
  }

  function luminanceAt(source, x, y) {
    const rgb = pixel(source, x, y);
    return lumaRgb(rgb[0], rgb[1], rgb[2]);
  }

  function lineProjection(source, axis, box) {
    const x0 = box?.x0 ?? 0;
    const y0 = box?.y0 ?? 0;
    const x1 = box?.x1 ?? source.width;
    const y1 = box?.y1 ?? source.height;
    const along0 = axis === "x" ? x0 : y0;
    const along1 = axis === "x" ? x1 : y1;
    const cross0 = axis === "x" ? y0 : x0;
    const cross1 = axis === "x" ? y1 : x1;
    const length = axis === "x" ? source.width : source.height;
    const stride = Math.max(1, Math.floor(Math.max(1, cross1 - cross0) / 420));
    const result = new Array(length).fill(0);
    for (let position = Math.max(2, along0); position < Math.min(length - 2, along1); position += 1) {
      let sum = 0;
      let count = 0;
      for (let other = cross0; other < cross1; other += stride) {
        const center = axis === "x" ? luminanceAt(source, position, other) : luminanceAt(source, other, position);
        const before = axis === "x" ? luminanceAt(source, position - 2, other) : luminanceAt(source, other, position - 2);
        const after = axis === "x" ? luminanceAt(source, position + 2, other) : luminanceAt(source, other, position + 2);
        sum += Math.abs(center - before) + Math.abs(center - after);
        count += 1;
      }
      result[position] = count ? sum / count : 0;
    }
    return result;
  }

  function autocorrPeriod(scores, minP, maxP, start, end) {
    const a0 = Math.max(0, start | 0);
    const a1 = Math.min(scores.length, end | 0);
    if (a1 - a0 < minP * 8) return 0;
    const slice = scores.slice(a0, a1);
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    const centered = slice.map((value) => value - mean);
    let bestP = 0;
    let best = -1;
    const maxPeriod = Math.min(maxP, Math.floor(slice.length / 8));
    for (let period = minP; period <= maxPeriod; period += 1) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i + period < centered.length; i += 1) {
        sum += centered[i] * centered[i + period];
        count += 1;
      }
      const score = count ? sum / count : 0;
      if (score > best) {
        best = score;
        bestP = period;
      }
    }
    return bestP;
  }

  function linesFromPeriod(scores, period, start, end) {
    if (period < 5) return null;
    const a0 = Math.max(0, start | 0);
    const a1 = Math.min(scores.length, end | 0);
    const peaks = peakPositions(scores).filter((peak) => peak >= a0 && peak < a1);
    if (!peaks.length) return null;
    const origin = peaks.reduce((best, index) => (scores[index] > scores[best] ? index : best), peaks[0]);
    const nearest = (pos) => {
      let best = null;
      let dist = 99;
      peaks.forEach((peak) => {
        const next = Math.abs(peak - pos);
        if (next < dist) {
          dist = next;
          best = peak;
        }
      });
      return dist <= Math.max(3, period * 0.38) ? best : null;
    };
    const mean = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
    const lines = [origin];
    let pos = origin + period;
    while (pos < a1 - 2) {
      const hit = nearest(Math.round(pos));
      if (hit != null) {
        if (!lines.includes(hit)) lines.push(hit);
        pos = hit + period;
      } else {
        const index = clamp(Math.round(pos), a0, a1 - 1);
        if (scores[index] > mean * 0.88) {
          lines.push(index);
          pos = index + period;
        } else pos += period;
      }
    }
    pos = origin - period;
    while (pos > a0 + 2) {
      const hit = nearest(Math.round(pos));
      if (hit != null) {
        if (!lines.includes(hit)) lines.push(hit);
        pos = hit - period;
      } else {
        const index = clamp(Math.round(pos), a0, a1 - 1);
        if (scores[index] > mean * 0.88) {
          lines.push(index);
          pos = index - period;
        } else pos -= period;
      }
    }
    const unique = [...new Set(lines)].sort((a, b) => a - b);
    if (unique.length < 11) return null;
    return { lines: unique, period, start: unique[0], end: unique[unique.length - 1], intervals: unique.length - 1 };
  }

  function peakPositions(scores) {
    const mean = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
    const threshold = mean * 1.22;
    const groups = [];
    scores.forEach((value, index) => {
      if (value <= threshold) return;
      if (!groups.length || index - groups[groups.length - 1][groups[groups.length - 1].length - 1] > 2) {
        groups.push([index]);
      } else {
        groups[groups.length - 1].push(index);
      }
    });
    return groups.map((group) => group.reduce((best, index) => (scores[index] > scores[best] ? index : best), group[0]));
  }

  function dominantGap(gaps) {
    const buckets = new Map();
    gaps.forEach((gap) => {
      buckets.set(gap, (buckets.get(gap) || 0) + 1);
      buckets.set(gap - 1, (buckets.get(gap - 1) || 0) + 0.45);
      buckets.set(gap + 1, (buckets.get(gap + 1) || 0) + 0.45);
    });
    let best = 0;
    let bestN = -1;
    buckets.forEach((count, gap) => {
      if (gap >= 5 && gap <= 90 && count > bestN) {
        bestN = count;
        best = gap;
      }
    });
    return best;
  }

  function snapLines(scores, boxStart, boxEnd) {
    const start = boxStart ?? 0;
    const end = boxEnd ?? scores.length;
    const peaks = peakPositions(scores);
    const gaps = [];
    for (let i = 0; i < peaks.length - 1; i += 1) {
      const gap = peaks[i + 1] - peaks[i];
      if (gap >= 5 && gap <= 90) gaps.push(gap);
    }
    let period = gaps.length >= 8 ? dominantGap(gaps) : 0;
    const auto = autocorrPeriod(scores, 5, 90, start, end);
    if (auto && period && Math.abs(auto - period) <= 4) period = Math.round((auto + period) / 2);
    else if (auto && gaps.length < 12) period = auto;
    if (period >= 40 && period <= 90) {
      const tenth = Math.round(period / 10);
      if (tenth >= 6 && tenth <= 24) {
        const fine = linesFromPeriod(scores, tenth, start, end);
        if (fine && fine.intervals >= 12) return fine;
      }
    }
    const fromPeriod = linesFromPeriod(scores, period, start, end);
    if (fromPeriod && fromPeriod.intervals >= 10 && fromPeriod.intervals <= 72) return fromPeriod;
    if (peaks.length < 10 || period < 5) return null;
    const origin = peaks.reduce((best, index) => (scores[index] > scores[best] ? index : best), peaks[0]);
    const nearest = (pos) => {
      let best = null;
      let dist = 99;
      peaks.forEach((peak) => {
        const next = Math.abs(peak - pos);
        if (next < dist) {
          dist = next;
          best = peak;
        }
      });
      return dist <= Math.max(3, period * 0.36) ? best : null;
    };
    const mean = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
    const lines = [origin];
    let pos = origin + period;
    while (pos < scores.length - 2) {
      const hit = nearest(Math.round(pos));
      if (hit != null) {
        if (!lines.includes(hit)) lines.push(hit);
        pos = hit + period;
      } else {
        const index = clamp(Math.round(pos), 0, scores.length - 1);
        if (scores[index] > mean * 0.88) {
          lines.push(index);
          pos = index + period;
        } else pos += period;
      }
    }
    pos = origin - period;
    while (pos > 2) {
      const hit = nearest(Math.round(pos));
      if (hit != null) {
        if (!lines.includes(hit)) lines.push(hit);
        pos = hit - period;
      } else {
        const index = clamp(Math.round(pos), 0, scores.length - 1);
        if (scores[index] > mean * 0.88) {
          lines.push(index);
          pos = index - period;
        } else pos -= period;
      }
    }
    const unique = [...new Set(lines)].sort((a, b) => a - b);
    if (unique.length < 10) return null;
    return { lines: unique, period, start: unique[0], end: unique[unique.length - 1], intervals: unique.length - 1 };
  }

  function preferChartCount(intervals) {
    // 画像素等色号表常见 54；线数多算成 55/56 时收成 54。
    if (intervals >= 52 && intervals <= 56) return 54;
    const known = [48, 42, 36, 32, 28, 24, 60, 64, 50, 40];
    let best = intervals;
    let bestScore = Infinity;
    known.forEach((n, index) => {
      const dist = Math.abs(n - intervals);
      if (dist > 2) return;
      const score = dist * 20 + index;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    });
    return best;
  }

  function gridFromAxes(x, y) {
    if (!x || !y) return null;
    const ratio = Math.max(x.period, y.period) / Math.max(1, Math.min(x.period, y.period));
    if (ratio > 1.55 || x.intervals < 10 || y.intervals < 10 || x.intervals > 72 || y.intervals > 72) return null;
    const cols = preferChartCount(x.intervals);
    const rows = preferChartCount(y.intervals);
    // Average step from the detected lines (fractional), then only keep the chart cell count.
    const stepX = (x.end - x.start) / Math.max(1, x.intervals);
    const stepY = (y.end - y.start) / Math.max(1, y.intervals);
    return {
      x0: x.start,
      y0: y.start,
      cols,
      rows,
      stepX,
      stepY,
      period: (stepX + stepY) / 2,
    };
  }

  function detectGridBox(source, box) {
    const x = snapLines(lineProjection(source, "x", box), box.x0, box.x1);
    const y = snapLines(lineProjection(source, "y", box), box.y0, box.y1);
    return gridFromAxes(x, y);
  }

  function detectGrid(source) {
    if (!source?.data || source.width < 80 || source.height < 80) return null;
    const boxes = [
      { x0: 0, y0: 0, x1: source.width, y1: source.height },
      {
        x0: Math.round(source.width * 0.02),
        y0: Math.round(source.height * 0.05),
        x1: Math.round(source.width * 0.995),
        y1: Math.round(source.height * 0.88),
      },
    ];
    let best = null;
    boxes.forEach((box) => {
      const grid = detectGridBox(source, box);
      if (!grid) return;
      if (!best || grid.cols * grid.rows > best.cols * best.rows) best = grid;
    });
    return best;
  }

  function nearColor(rgb, colors, dist) {
    if (!rgb || !colors || !colors.length) return false;
    return colors.some((color) => rgbDist(rgb, color) <= dist);
  }

  function lineColors(source, grid) {
    const points = [];
    for (let col = 0; col <= grid.cols; col += 1) {
      const x = grid.x0 + col * grid.stepX;
      for (let i = 0; i < 6; i += 1) {
        points.push([x, grid.y0 + ((i + 0.5) / 6) * grid.rows * grid.stepY]);
      }
    }
    for (let row = 0; row <= grid.rows; row += 1) {
      const y = grid.y0 + row * grid.stepY;
      for (let i = 0; i < 6; i += 1) {
        points.push([grid.x0 + ((i + 0.5) / 6) * grid.cols * grid.stepX, y]);
      }
    }
    return bucketRgb(collectSamples(source, points))
      .filter((row) => {
        if (row.count < 8) return false;
        const [r, g, b] = row.rgb;
        const chroma = row.sat;
        const luma = row.luma;
        if (r > 140 && r > g + 20 && r > b + 20) return true;
        if (chroma <= 28 && luma >= 80 && luma <= 210) return true;
        if (b >= r + 6 && luma >= 160) return true;
        return false;
      })
      .slice(0, 4)
      .map((row) => row.rgb);
  }

  function cellPoints(grid, col, row, fractions) {
    const x0 = grid.x0 + col * grid.stepX;
    const y0 = grid.y0 + row * grid.stepY;
    const points = [];
    fractions.forEach((fy) => {
      fractions.forEach((fx) => points.push([x0 + fx * grid.stepX, y0 + fy * grid.stepY]));
    });
    return points;
  }

  function guessPaper(source, grid) {
    const samples = [];
    [[1, 1], [2, 2], [3, 1], [1, 3], [2, 1]].forEach((pair) => {
      const col = pair[0];
      const row = pair[1];
      if (col >= grid.cols || row >= grid.rows) return;
      samples.push(...collectSamples(source, cellPoints(grid, col, row, [0.28, 0.5, 0.72])));
    });
    const light = samples.filter((rgb) => lumaRgb(rgb[0], rgb[1], rgb[2]) >= 210 && sat(rgb[0], rgb[1], rgb[2]) <= 36);
    if (light.length >= 4) return pickRgb(light) || [248, 248, 248];
    return dominantSample(source, { x0: 0, x1: Math.min(24, source.width), y0: 0, y1: Math.min(24, source.height) })
      || [248, 248, 248];
  }

  function cellPoint(grid, col, row, fx, fy) {
    return [grid.x0 + (col + fx) * grid.stepX, grid.y0 + (row + fy) * grid.stepY];
  }

  function meanRgb(samples) {
    if (!samples.length) return null;
    const n = samples.length;
    return [0, 1, 2].map((i) => Math.round(samples.reduce((sum, rgb) => sum + rgb[i], 0) / n));
  }

  function majorityRgb(samples) {
    if (!samples.length) return null;
    const ranked = bucketRgb(samples);
    return ranked[0] ? ranked[0].rgb : null;
  }

  function isAxisBlue(rgb) {
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    return b >= r + 18 && b >= g + 8 && luma >= 90 && luma <= 210;
  }

  function isGridRed(rgb) {
    const [r, g, b] = rgb;
    const chroma = sat(r, g, b);
    const luma = lumaRgb(r, g, b);
    return r > g + 36 && r > b + 28 && chroma >= 48 && luma >= 85 && luma <= 210;
  }

  function isDarkBrown(rgb) {
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    return luma < 115 && r > g + 6 && r > b + 10 && g >= b - 10 && sat(r, g, b) >= 14;
  }

  function isDarkGreen(rgb) {
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    return luma < 120 && g > r + 4 && g >= b - 4 && sat(r, g, b) >= 12;
  }

  function isMagentaPink(rgb) {
    // 画像素粉豆经 JPEG 会发紫。按紫灯珠最近，脸会变成一圈紫。
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    const chroma = sat(r, g, b);
    return chroma >= 20 && luma >= 90 && luma <= 220 && r > g + 6 && b > g + 6;
  }

  function isMutedRose(rgb) {
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    const chroma = sat(r, g, b);
    return luma >= 115 && luma <= 200 && r > g + 8 && Math.abs(r - b) <= 50 && chroma >= 18;
  }

  function sampleBeadCell(source, grid, col, row, paper, lines) {
    // 画像素 / 拼豆色号表：格子底色才是豆子，中间字母不是颜色。
    const ring = [];
    const steps = 11;
    for (let j = 0; j < steps; j += 1) {
      for (let i = 0; i < steps; i += 1) {
        const fx = 0.22 + (i / (steps - 1)) * 0.56;
        const fy = 0.22 + (j / (steps - 1)) * 0.56;
        if (fx >= 0.36 && fx <= 0.64 && fy >= 0.36 && fy <= 0.64) continue;
        const rgb = pixel(source, ...cellPoint(grid, col, row, fx, fy));
        if (rgb[3] < 18) continue;
        if (isAxisBlue(rgb) || isGridRed(rgb)) continue;
        ring.push(rgb);
      }
    }
    if (ring.length < 12) return null;
    const chroma = [];
    const paperN = [];
    ring.forEach((rgb) => {
      if (isPaper(rgb, paper)) paperN.push(rgb);
      else if (sat(rgb[0], rgb[1], rgb[2]) >= 22 && lumaRgb(rgb[0], rgb[1], rgb[2]) < 210) chroma.push(rgb);
    });
    if (chroma.length >= Math.max(8, ring.length * 0.26)) {
      const darkChroma = chroma.filter((rgb) => lumaRgb(rgb[0], rgb[1], rgb[2]) < 130);
      if (darkChroma.length >= Math.max(6, chroma.length * 0.34)) {
        return majorityRgb(darkChroma) || meanRgb(darkChroma);
      }
      return majorityRgb(chroma) || meanRgb(chroma);
    }

    let ink = 0;
    for (let j = 0; j < 7; j += 1) {
      for (let i = 0; i < 7; i += 1) {
        const fx = 0.32 + (i / 6) * 0.36;
        const fy = 0.32 + (j / 6) * 0.36;
        const rgb = pixel(source, ...cellPoint(grid, col, row, fx, fy));
        if (rgb[3] < 18) continue;
        if (lumaRgb(rgb[0], rgb[1], rgb[2]) <= 150 && sat(rgb[0], rgb[1], rgb[2]) <= 55) ink += 1;
      }
    }
    // 白豆 H2：白底 + 中间色号字母。空格没有字母。
    if (ink >= 3 && paperN.length >= ring.length * 0.4) return [255, 255, 255];
    return null;
  }

  function sampleGrid(source, grid) {
    const paper = guessPaper(source, grid);
    const lines = lineColors(source, grid);
    const cells = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        cells.push(sampleBeadCell(source, grid, col, row, paper, lines));
      }
    }
    return cells;
  }

  function isGutterCell(rgb, paper) {
    if (!rgb || isPaper(rgb, paper)) return true;
    const [r, g, b] = rgb;
    const luma = lumaRgb(r, g, b);
    if (b >= r + 18 && b >= g + 8 && luma >= 110 && luma <= 210) return true;
    return false;
  }

  function trimGutters(cells, cols, rows) {
    const at = (col, row) => cells[row * cols + col];
    const paper = [248, 248, 248];
    const colEmpty = (col) => {
      let empty = 0;
      for (let row = 0; row < rows; row += 1) {
        const rgb = at(col, row);
        if (cellOff(rgb) || isGutterCell(rgb, paper)) empty += 1;
      }
      return empty / rows > 0.86;
    };
    const rowEmpty = (row) => {
      let empty = 0;
      for (let col = 0; col < cols; col += 1) {
        const rgb = at(col, row);
        if (cellOff(rgb) || isGutterCell(rgb, paper)) empty += 1;
      }
      return empty / cols > 0.86;
    };
    let x0 = 0;
    let x1 = cols - 1;
    let y0 = 0;
    let y1 = rows - 1;
    const rowIndex = (row) => {
      let ink = 0;
      let chroma = 0;
      let paperN = 0;
      for (let col = x0; col <= x1; col += 1) {
        const rgb = at(col, row);
        if (cellOff(rgb) || isGutterCell(rgb, paper)) paperN += 1;
        else if (sat(rgb[0], rgb[1], rgb[2]) >= 16) chroma += 1;
        else ink += 1;
      }
      const n = x1 - x0 + 1;
      return chroma <= n * 0.08 && ink >= n * 0.18 && paperN + ink >= n * 0.9;
    };
    const colIndex = (col) => {
      let ink = 0;
      let chroma = 0;
      let paperN = 0;
      for (let row = y0; row <= y1; row += 1) {
        const cell = at(col, row);
        if (cellOff(cell) || isGutterCell(cell, paper)) paperN += 1;
        else if (sat(cell[0], cell[1], cell[2]) >= 16) chroma += 1;
        else ink += 1;
      }
      const n = y1 - y0 + 1;
      return chroma <= n * 0.08 && ink >= n * 0.18 && paperN + ink >= n * 0.9;
    };
    while (x1 - x0 + 1 > 12 && colEmpty(x0)) x0 += 1;
    while (x1 - x0 + 1 > 12 && colEmpty(x1)) x1 -= 1;
    while (y1 - y0 + 1 > 12 && rowEmpty(y0)) y0 += 1;
    while (y1 - y0 + 1 > 12 && rowEmpty(y1)) y1 -= 1;
    while (x1 - x0 + 1 > 12 && colIndex(x0)) x0 += 1;
    while (x1 - x0 + 1 > 12 && colIndex(x1)) x1 -= 1;
    while (y1 - y0 + 1 > 12 && rowIndex(y0)) y0 += 1;
    while (y1 - y0 + 1 > 12 && rowIndex(y1)) y1 -= 1;
    if (cols >= 54 && cols <= 64 && x0 === 0 && x1 === cols - 1) {
      x0 = 1;
      x1 = cols - 2;
    }
    if (rows >= 54 && rows <= 64 && y0 === 0 && y1 === rows - 1) {
      y0 = 1;
      y1 = rows - 2;
    }
    const nextCols = x1 - x0 + 1;
    const nextRows = y1 - y0 + 1;
    const next = [];
    for (let row = y0; row <= y1; row += 1) {
      for (let col = x0; col <= x1; col += 1) next.push(at(col, row));
    }
    return { cells: next, cols: nextCols, rows: nextRows, paper };
  }

  function clusterColors(rgbs, maxColors) {
    const counts = new Map();
    rgbs.forEach((rgb) => {
      if (!rgb) return;
      const key = rgb.map((value) => Math.round(value / 10) * 10).join(",");
      const row = counts.get(key) || { rgb: [0, 0, 0], count: 0 };
      row.count += 1;
      row.rgb[0] += rgb[0];
      row.rgb[1] += rgb[1];
      row.rgb[2] += rgb[2];
      counts.set(key, row);
    });
    const samples = [...counts.values()].map((row) => {
      const rgb = row.rgb.map((value) => Math.round(value / row.count));
      return { rgb, lab: rgbToLab(...rgb), count: row.count };
    }).sort((a, b) => b.count - a.count);
    const want = Math.max(1, Math.min(maxColors, samples.length));
    const centers = samples.slice(0, 1);
    while (centers.length < want) {
      let pick = null;
      let score = -1;
      samples.forEach((sample) => {
        const distance = Math.min(...centers.map((center) => labDist(sample.lab, center.lab)));
        const next = distance * Math.sqrt(sample.count);
        if (next > score) {
          score = next;
          pick = sample;
        }
      });
      if (!pick) break;
      centers.push(pick);
    }
    return centers.map((center) => ({ rgb: center.rgb.slice(), lab: center.lab.slice(), count: center.count }));
  }

  function nearestFrame(rgb, palette, dark) {
    // Each source cell → one lamp. null / paper → off.
    // Palette has no true brown: dark brown outline uses dusty rose (0).
    // JPEG pinks go bluish; keep them on the pink row, not purple.
    if (!rgb) return dark;
    const luma = lumaRgb(rgb[0], rgb[1], rgb[2]);
    const chroma = sat(rgb[0], rgb[1], rgb[2]);
    const explicitWhite = rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
    if (!explicitWhite && isPaper(rgb)) return dark;
    if (luma < 38 && chroma < 18) return dark;
    if (isDarkBrown(rgb) && palette.length) return 0;
    if (isMagentaPink(rgb) && palette.length > 42) return 42;
    if (isMutedRose(rgb) && palette.length > 42) return luma >= 175 ? 3 : 42;
    const [r, g, b] = rgb;
    if (g > 160 && g > r + 20 && g > b + 20 && palette.length > 17) return 17;
    const pick = (allowGray, allowed) => {
      let best = -1;
      let dist = Infinity;
      palette.forEach((hex, index) => {
        if (allowed && !allowed.has(index)) return;
        const prgb = hexToRgb(hex);
        const pSat = sat(...prgb);
        if (!allowGray && chroma >= 14 && pSat < 14) return;
        const next = rgbDist(rgb, prgb);
        if (next < dist) {
          dist = next;
          best = index;
        }
      });
      return best;
    };
    if (isDarkGreen(rgb) && palette.length > 24) {
      const greens = new Set();
      for (let i = 15; i <= 24; i += 1) greens.add(i);
      let green = pick(false, greens);
      if (green < 0) green = pick(true, greens);
      if (green >= 0) return green;
    }
    let best = pick(false);
    if (best < 0) best = pick(true);
    return best < 0 ? dark : best;
  }

  function cellOff(rgb) {
    return !rgb;
  }

  function denoiseCells(cells, cols, rows) {
    const next = cells.slice();
    const at = (col, row) => next[row * cols + col];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (cellOff(at(col, row))) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const x = col + dx;
            const y = row + dy;
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
            if (!cellOff(cells[y * cols + x])) n += 1;
          }
        }
        if (n < 2) next[row * cols + col] = null;
      }
    }
    return next;
  }

  function cropOccupied(cells, cols, rows, paper) {
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
    cells.forEach((rgb, index) => {
      if (cellOff(rgb)) return;
      const col = index % cols;
      const row = Math.floor(index / cols);
      x0 = Math.min(x0, col);
      y0 = Math.min(y0, row);
      x1 = Math.max(x1, col);
      y1 = Math.max(y1, row);
    });
    if (x1 < 0) return { cells, cols, rows };
    const pad = 1;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(cols - 1, x1 + pad);
    y1 = Math.min(rows - 1, y1 + pad);
    const nextCols = x1 - x0 + 1;
    const nextRows = y1 - y0 + 1;
    const next = [];
    for (let row = y0; row <= y1; row += 1) {
      for (let col = x0; col <= x1; col += 1) next.push(cells[row * cols + col]);
    }
    return { cells: next, cols: nextCols, rows: nextRows };
  }

  function fitCells(cells, cols, rows, outCols, outRows, palette, dark, paper) {
    // Nearest-neighbor scale: one source cell → one lamp color, no blending.
    const page = new Array(outCols * outRows).fill(dark);
    const scale = Math.min(1, outCols / cols, outRows / rows);
    const usedW = Math.max(1, Math.round(cols * scale));
    const usedH = Math.max(1, Math.round(rows * scale));
    const ox = Math.floor((outCols - usedW) / 2);
    const oy = Math.floor((outRows - usedH) / 2);
    for (let y = 0; y < usedH; y += 1) {
      for (let x = 0; x < usedW; x += 1) {
        const sx = Math.min(cols - 1, Math.floor(((x + 0.5) * cols) / usedW));
        const sy = Math.min(rows - 1, Math.floor(((y + 0.5) * rows) / usedH));
        page[(oy + y) * outCols + (ox + x)] = nearestFrame(cells[sy * cols + sx], palette, dark);
      }
    }
    return { page, usedW, usedH };
  }

  function samplePhoto(source, outCols, outRows, palette, dark) {
    const page = new Array(outCols * outRows).fill(dark);
    const paper = dominantSample(source, { x0: 0, x1: source.width * 0.08, y0: 0, y1: source.height * 0.08 })
      || [255, 255, 255];
    for (let y = 0; y < outRows; y += 1) {
      for (let x = 0; x < outCols; x += 1) {
        const rgb = dominantSample(source, {
          x0: (x / outCols) * source.width,
          x1: ((x + 1) / outCols) * source.width,
          y0: (y / outRows) * source.height,
          y1: ((y + 1) / outRows) * source.height,
        });
        const luma = rgb ? lumaRgb(rgb[0], rgb[1], rgb[2]) : 255;
        const chroma = rgb ? sat(rgb[0], rgb[1], rgb[2]) : 0;
        const off = !rgb || isPaper(rgb, paper) || (luma >= 198 && chroma <= 30);
        page[y * outCols + x] = off ? dark : nearestFrame(rgb, palette, dark);
      }
    }
    return page;
  }

  function analyze(source, palette, options = {}) {
    const outCols = Number(options.cols) || COLS;
    const outRows = Number(options.rows) || ROWS;
    const dark = Number.isFinite(options.dark) ? Number(options.dark) : DARK;
    const colors = Array.isArray(palette) ? palette : [];
    const grid = detectGrid(source);
    if (grid) {
      const sampled = sampleGrid(source, grid);
      const trimmed = trimGutters(sampled, grid.cols, grid.rows);
      const cleaned = denoiseCells(trimmed.cells, trimmed.cols, trimmed.rows);
      const occupied = cropOccupied(cleaned, trimmed.cols, trimmed.rows, trimmed.paper);
      const lit = occupied.cells.filter((rgb) => !cellOff(rgb));
      const clusters = clusterColors(lit.filter((rgb) => !(rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250)), 8);
      const fitted = fitCells(occupied.cells, occupied.cols, occupied.rows, outCols, outRows, colors, dark, trimmed.paper);
      return {
        page: fitted.page,
        mode: "grid",
        grid: { cols: occupied.cols, rows: occupied.rows, detected: [grid.cols, grid.rows], used: [fitted.usedW, fitted.usedH] },
        colors: clusters.map((row) => row.rgb),
        sourceLit: lit.length,
        message: `识别到 ${occupied.cols}×${occupied.rows} 拼豆色号格，已等比放进 ${fitted.usedW}×${fitted.usedH} 灯珠，白底关灯。`,
      };
    }
    return {
      page: samplePhoto(source, outCols, outRows, colors, dark),
      mode: "photo",
      grid: null,
      colors: [],
      message: `没认出色号格，按 ${outCols}×${outRows} 灯珠取样；浅底已关灯。`,
    };
  }

  function sourceFromCanvas(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  return {
    COLS,
    ROWS,
    DARK,
    analyze,
    detectGrid,
    sampleGrid,
    isPaper,
    nearestFrame,
    sourceFromCanvas,
  };
});
