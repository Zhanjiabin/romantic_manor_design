// Authoritative order from rc3.exe's compact-integer table initializer.
const ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_`abcdefghijklmnopqrstuvwxyz";
const AIDX = Object.fromEntries([...ALPHA].map((c, i) => [c, i]));
const KIND36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const KIDX = Object.fromEntries([...KIND36].map((c, i) => [c, i]));

function encKind(n) {
  n = n | 0;
  if (n < 0 || n >= KIND36.length) throw new Error("kind " + n);
  return KIND36[n];
}

function decKind(ch) {
  const i = KIDX[ch];
  if (i === undefined) return -1;
  return i;
}

function enc(n, width = 0) {
  if (n < 0) throw new Error("neg");
  let s = "";
  if (n === 0) s = "0";
  else {
    while (n > 0) {
      s = ALPHA[n % 64] + s;
      n = Math.floor(n / 64);
    }
  }
  if (width) {
    if (s.length > width) throw new Error("overflow");
    s = s.padStart(width, "0");
  }
  return s;
}

function dec(s) {
  let n = 0;
  for (const ch of s) {
    if (AIDX[ch] === undefined) throw new Error("bad digit " + ch);
    n = n * 64 + AIDX[ch];
  }
  return n;
}

function parseTerrainText(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  const m = text.match(/模板\s*=\s*\((.*)\)\s*;\s*size\s*=\s*([^;]+)\s*;\s*mapflag\s*=\s*(\S+)/is);
  if (!m) throw new Error("不是 模板= 地形图纸");
  const inner = m[1].trim();
  const sizeTok = m[2].trim();
  const flagTok = m[3].trim().replace(/;+$/, "");
  const stamps = parseInner(inner);
  const size = /^\d+$/.test(sizeTok) ? +sizeTok : dec(sizeTok);
  const mapflag = /^\d+$/.test(flagTok) ? +flagTok : dec(flagTok);
  return { stamps, size, mapflag };
}

function parseInner(inner) {
  if (!inner) return [];
  if (inner.includes(",")) {
    const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length % 3 !== 0) throw new Error("模板= 逗号分组不是 3 的倍数");
    const out = [];
    for (let i = 0; i < parts.length; i += 3) {
      out.push({ kind: parts[i], x: dec(parts[i + 1]), y: dec(parts[i + 2]) });
    }
    return out;
  }
  const compact = inner.replace(/\s+/g, "");
  if (compact.length % 5 !== 0) throw new Error("打包 模板= 长度不是 5 的倍数");
  const out = [];
  for (let i = 0; i < compact.length; i += 5) {
    const rec = compact.slice(i, i + 5);
    out.push({ kind: rec[0], x: dec(rec.slice(1, 3)), y: dec(rec.slice(3, 5)) });
  }
  return out;
}

function formatTerrain(stamps, size, mapflag) {
  const bits = [];
  for (const s of stamps) {
    bits.push(s.kind, enc(s.x), enc(s.y));
  }
  return "模板=(" + bits.join(",") + ");size=" + enc(size, 2) + ";mapflag=" + enc(mapflag, 1);
}

function parseV1(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text.toUpperCase().startsWith("V1;")) throw new Error("不是 V1; 建筑图纸");
  const recs = text.slice(3).split(";").map((s) => s.trim()).filter(Boolean);
  for (const r of recs) {
    if (r.length !== 9) throw new Error("V1 记录长度不是 9: " + r);
  }
  const kind = detectKind(recs);
  return { kind, records: recs.map((r) => parseRec(r, kind)), raw: recs };
}

function detectKind(recs) {
  if (!recs.length) return "manor";
  try {
    const mats = recs.map((r) => dec(r.slice(5, 8)));
    if (mats.filter((m) => m >= 1 && m <= 999).length >= Math.max(1, mats.length * 0.85)) {
      return "desk";
    }
  } catch (e) {
    return "manor";
  }
  return "manor";
}

function parseRec(rec, kind) {
  if (kind === "desk") {
    const [x, y] = unpackDeskCoordinates(rec.slice(0, 5));
    return {
      mode: "desk",
      x,
      y,
      mat: dec(rec.slice(5, 8)),
      state: dec(rec[8]),
      raw: rec,
    };
  }
  return {
    mode: "manor",
    x: dec(rec.slice(0, 2)),
    y: dec(rec.slice(2, 4)),
    item: dec(rec.slice(4, 8)),
    dir: dec(rec[8]),
    raw: rec,
  };
}

function formatV1(records, kind = "manor") {
  const recs = records.map((obj) => {
    if (typeof obj === "string") return obj;
    if ((obj.mode || kind) === "desk") {
      return (
        packDeskCoordinates(obj.x, obj.y) +
        enc(obj.mat, 3) +
        enc(obj.state ?? obj.flip ?? 0, 1)
      );
    }
    const item = obj.item ?? obj.item ?? 0;
    const dir = obj.dir ?? obj.dir ?? 0;
    return enc(obj.x, 2) + enc(obj.y, 2) + enc(item, 4) + enc(dir, 1);
  });
  return "V1;" + recs.join(";");
}

function decodeS15(value) {
  value &= 0x7fff;
  return value > 0x3fff ? value - 0x8000 : value;
}

function unpackDeskCoordinates(token) {
  if (token.length !== 5) throw new Error("建筑坐标必须是 5 个字符");
  const packed = dec(token);
  const x = Math.floor(packed / 32768) & 0x7fff;
  const y = packed & 0x7fff;
  return [decodeS15(x), decodeS15(y)];
}

function packDeskCoordinates(x, y) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < -0x4000 || x > 0x3fff || y < -0x4000 || y > 0x3fff) {
    throw new Error("建筑坐标超出有符号 15 位范围");
  }
  const packed = (x & 0x7fff) * 32768 + (y & 0x7fff);
  return enc(packed, 5);
}
