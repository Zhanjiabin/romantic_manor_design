(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BoardMosaic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const COLS = 36, ROWS = 24, DARK = 50, MAX_EDGE = 12, MAX_TILES = 64;
  // basesvr/light/light.cfg: AddScaleMode(width,height,offsetX,offsetY).
  // Base sprite anchors come from 高清电子广告牌.ale's two frame records.
  const VIEWS = [
    { width: 87, height: 65, slope: -0.5, x: -15, y: -105, baseX: -18, baseY: -45 },
    { width: 89, height: 65, slope: 0.5, x: -15, y: -80, baseX: -17, baseY: -13 },
  ];
  function normalize(input = {}) {
    const cols = Number(input?.cols ?? 1), rows = Number(input?.rows ?? 1);
    if (![cols, rows].every(n => Number.isInteger(n) && n >= 1 && n <= MAX_EDGE)) throw new Error("拼接行列数需为 1–12");
    const mask = input?.mask == null ? Array(cols * rows).fill(true) : Array.from(input.mask, Boolean);
    if (mask.length !== cols * rows || !mask.some(Boolean)) throw new Error("至少保留一块广告牌");
    if (mask.filter(Boolean).length > MAX_TILES) throw new Error("最多拼接 64 块广告牌");
    return { cols, rows, mask };
  }
  function preset(name, cols = 3, rows = 3) {
    const sizes = { single: [1, 1], four: [2, 2], nine: [3, 3], horizontal: [4, 1], vertical: [1, 4], cross: [3, 3], l: [3, 3], heart: [5, 4] };
    [cols, rows] = sizes[name] || [cols, rows];
    const heart = [0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0];
    return normalize({ cols, rows, mask: Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      return name === "cross" ? x === 1 || y === 1 : name === "l" ? x === 0 || y === rows - 1 : name === "heart" ? heart[i] : true;
    }) });
  }
  function tiles(layout) {
    return layout.mask.flatMap((on, index) => on ? [{ index, col: index % layout.cols, row: Math.floor(index / layout.cols) }] : []);
  }
  function hasCell(layout, x, y) {
    return x >= 0 && y >= 0 && x < layout.cols * COLS && y < layout.rows * ROWS
      && layout.mask[Math.floor(y / ROWS) * layout.cols + Math.floor(x / COLS)];
  }
  function extract(page, layout, index) {
    if (!layout.mask[index]) throw new Error("该位置没有广告牌");
    const out = new Uint8Array(COLS * ROWS).fill(DARK), x = index % layout.cols * COLS, y = Math.floor(index / layout.cols) * ROWS;
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) out[row * COLS + col] = page[(y + row) * layout.cols * COLS + x + col] ?? DARK;
    return out;
  }
  function insert(page, layout, index, tile) {
    if (!layout.mask[index]) return;
    const x = index % layout.cols * COLS, y = Math.floor(index / layout.cols) * ROWS;
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) page[(y + row) * layout.cols * COLS + x + col] = tile[row * COLS + col] ?? DARK;
  }
  function clean(page, layout) {
    for (let y = 0; y < layout.rows * ROWS; y++) for (let x = 0; x < layout.cols * COLS; x++) if (!hasCell(layout, x, y)) page[y * layout.cols * COLS + x] = DARK;
    return page;
  }
  function remap(page, from, to) {
    const out = new Uint8Array(to.cols * COLS * to.rows * ROWS).fill(DARK);
    for (const tile of tiles(to)) {
      const old = tile.row * from.cols + tile.col;
      if (tile.col < from.cols && tile.row < from.rows && from.mask[old]) insert(out, to, tile.index, extract(page, from, old));
    }
    return out;
  }
  function placement(layout, facing = 0) {
    const view = VIEWS[facing === 1 ? 1 : 0];
    return tiles(layout).map((tile, order) => ({ ...tile, number: order + 1,
      dx: tile.col * view.width, dy: tile.row * view.height + tile.col * view.width * view.slope }));
  }
  // A small uncompressed ZIP writer avoids multiple browser download prompts.
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    function crc32(bytes) {
      let crc = -1;
      for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
      return (crc ^ -1) >>> 0;
    }
    for (const file of files) {
      const name = encoder.encode(file.name), bytes = typeof file.data === "string" ? encoder.encode(file.data) : new Uint8Array(file.data);
      const crc = crc32(bytes), header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
      const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer);
      e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x800, true);
      e.setUint32(16, crc, true); e.setUint32(20, bytes.length, true); e.setUint32(24, bytes.length, true); e.setUint16(28, name.length, true); e.setUint32(42, offset, true); entry.set(name, 46);
      chunks.push(header, bytes); directory.push(entry); offset += header.length + bytes.length;
    }
    const size = directory.reduce((n, item) => n + item.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...directory, end], { type: "application/zip" });
  }
  return { COLS, ROWS, DARK, MAX_EDGE, MAX_TILES, VIEWS, normalize, preset, tiles, hasCell, extract, insert, clean, remap, placement, zip };
});
