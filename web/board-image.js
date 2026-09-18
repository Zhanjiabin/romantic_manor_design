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

  function lineProjection(source, axis) {
    const length = axis === "x" ? source.width : source.height;
    const cross = axis === "x" ? source.height : source.width;
    const stride = Math.max(1, Math.floor(cross / 420));
    const result = new Array(length).fill(0);
    for (let position = 2; position < length - 2; position += 1) {
      let sum = 0;
      let count = 0;
      for (let other = 0; other < cross; other += stride) {
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

  function snapLines(scores) {
    const peaks = peakPositions(scores);
    if (peaks.length < 10) return null;
    const gaps = [];
    for (let i = 0; i < peaks.length - 1; i += 1) {
      const gap = peaks[i + 1] - peaks[i];
      if (gap >= 8 && gap <= 36) gaps.push(gap);
    }
    if (gaps.length < 8) return null;
    const sorted = gaps.slice().sort((a, b) => a - b);
    const period = sorted[Math.floor(sorted.length / 2)];
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

  function detectGrid(source) {
    if (!source?.data || source.width < 80 || source.height < 80) return null;
    const x = snapLines(lineProjection(source, "x"));
    const y = snapLines(lineProjection(source, "y"));
    if (!x || !y) return null;
    const ratio = Math.max(x.period, y.period) / Math.max(1, Math.min(x.period, y.period));
    if (ratio > 1.35 || x.intervals < 10 || y.intervals < 10) return null;
    return {
      x0: x.start,
      y0: y.start,
      cols: x.intervals,
      rows: y.intervals,
      stepX: (x.end - x.start) / Math.max(1, x.intervals),
      stepY: (y.end - y.start) / Math.max(1, y.intervals),
      period: (x.period + y.period) / 2,
    };
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

  function sampleGrid(source, grid) {
    const paper = guessPaper(source, grid);
    const lines = lineColors(source, grid);
    const cells = [];
    const ringPos = [0.16, 0.22, 0.28, 0.34, 0.66, 0.72, 0.78, 0.84];
    const glyphPos = [0.34, 0.42, 0.5, 0.58, 0.66];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const ringPts = cellPoints(grid, col, row, ringPos);
        const glyphPts = cellPoints(grid, col, row, glyphPos);
        const usableRing = (points) => collectSamples(source, points).filter((rgb) => {
          if (isPaper(rgb, paper)) return false;
          if (nearColor(rgb, lines, 26 * 26) && sat(rgb[0], rgb[1], rgb[2]) <= 70) return false;
          return true;
        });
        const usableGlyphs = (points) => collectSamples(source, points).filter((rgb) => !isPaper(rgb, paper));
        const ring = usableRing(ringPts);
        const glyphs = usableGlyphs(glyphPts);
        const strong = (rgb) => {
          if (!rgb || isPaper(rgb, paper)) return false;
          return sat(rgb[0], rgb[1], rgb[2]) >= 14 || lumaRgb(rgb[0], rgb[1], rgb[2]) <= 175;
        };
        let rgb = null;
        if (ring.length >= Math.max(12, ringPts.length * 0.28)) {
          const next = pickRgb(ring, paper);
          if (strong(next)) rgb = next;
        }
        if (!rgb && glyphs.length >= 8) {
          const next = pickRgb(glyphs, paper);
          if (strong(next)) rgb = next;
        }
        if (!rgb && glyphs.length >= 5) {
          const next = pickRgb(glyphs, paper);
          if (next && lumaRgb(next[0], next[1], next[2]) <= 160 && sat(next[0], next[1], next[2]) >= 12) rgb = next;
        }
        cells.push(rgb || paper);
      }
    }
    return cells;
  }

  function trimGutters(cells, cols, rows) {
    const at = (col, row) => cells[row * cols + col];
    const paper = at(0, 0);
    const colEmpty = (col) => {
      let empty = 0;
      for (let row = 0; row < rows; row += 1) if (isPaper(at(col, row), paper)) empty += 1;
      return empty / rows > 0.86;
    };
    const rowEmpty = (row) => {
      let empty = 0;
      for (let col = 0; col < cols; col += 1) if (isPaper(at(col, row), paper)) empty += 1;
      return empty / cols > 0.86;
    };
    let x0 = 0;
    let x1 = cols - 1;
    let y0 = 0;
    let y1 = rows - 1;
    while (x1 - x0 + 1 > 12 && colEmpty(x0)) x0 += 1;
    while (x1 - x0 + 1 > 12 && colEmpty(x1)) x1 -= 1;
    while (y1 - y0 + 1 > 12 && rowEmpty(y0)) y0 += 1;
    while (y1 - y0 + 1 > 12 && rowEmpty(y1)) y1 -= 1;
    if ((cols === 56 || cols === 55 || cols === 57) && x0 === 0 && x1 === cols - 1) {
      x0 = 1;
      x1 = cols - 2;
    }
    if ((rows === 56 || rows === 55 || rows === 57) && y0 === 0 && y1 === rows - 1) {
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
    if (!rgb || isPaper(rgb)) return dark;
    const luma = lumaRgb(rgb[0], rgb[1], rgb[2]);
    const chroma = sat(rgb[0], rgb[1], rgb[2]);
    if (luma < 38 && chroma < 18) return dark;
    const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
    let best = 0;
    let dist = Infinity;
    palette.forEach((hex, index) => {
      const prgb = hexToRgb(hex);
      if (lumaRgb(...prgb) > 238 && sat(...prgb) < 12 && luma > 210 && chroma < 18) return;
      const next = labDist(lab, rgbToLab(...prgb));
      if (next < dist) {
        dist = next;
        best = index;
      }
    });
    return best;
  }

  function cropOccupied(cells, cols, rows, paper) {
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
    cells.forEach((rgb, index) => {
      if (isPaper(rgb, paper)) return;
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
    const page = new Array(outCols * outRows).fill(dark);
    const scale = Math.min(1, outCols / cols, outRows / rows);
    const usedW = Math.max(1, Math.round(cols * scale));
    const usedH = Math.max(1, Math.round(rows * scale));
    const ox = Math.floor((outCols - usedW) / 2);
    const oy = Math.floor((outRows - usedH) / 2);
    for (let y = 0; y < usedH; y += 1) {
      for (let x = 0; x < usedW; x += 1) {
        const srcX = clamp(Math.floor((x + 0.5) * cols / usedW), 0, cols - 1);
        const srcY = clamp(Math.floor((y + 0.5) * rows / usedH), 0, rows - 1);
        page[(oy + y) * outCols + (ox + x)] = nearestFrame(cells[srcY * cols + srcX], palette, dark);
      }
    }
    return page;
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
        page[y * outCols + x] = nearestFrame(rgb, palette, dark);
      }
    }
    if (page.every((value) => value === dark)) {
      return page.map((_, index) => {
        const x = index % outCols;
        const y = Math.floor(index / outCols);
        const rgb = dominantSample(source, {
          x0: (x / outCols) * source.width,
          x1: ((x + 1) / outCols) * source.width,
          y0: (y / outRows) * source.height,
          y1: ((y + 1) / outRows) * source.height,
        });
        return nearestFrame(isPaper(rgb, paper) ? null : rgb, palette, dark);
      });
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
      const occupied = cropOccupied(trimmed.cells, trimmed.cols, trimmed.rows, trimmed.paper);
      const lit = occupied.cells.filter((rgb) => !isPaper(rgb, trimmed.paper));
      const clusters = clusterColors(lit, 12);
      const page = fitCells(occupied.cells, occupied.cols, occupied.rows, outCols, outRows, colors, dark, trimmed.paper);
      return {
        page,
        mode: "grid",
        grid: { cols: occupied.cols, rows: occupied.rows, detected: [grid.cols, grid.rows] },
        colors: clusters.map((row) => row.rgb),
        sourceLit: lit.length,
        message: `识别到 ${occupied.cols}×${occupied.rows} 色号网格，${clusters.length} 个色系，白底已关灯。`,
      };
    }
    return {
      page: samplePhoto(source, outCols, outRows, colors, dark),
      mode: "photo",
      grid: null,
      colors: [],
      message: `按 ${outCols}×${outRows} 灯珠取样，并靠进游戏调色板。`,
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
    isPaper,
    nearestFrame,
    sourceFromCanvas,
  };
});
