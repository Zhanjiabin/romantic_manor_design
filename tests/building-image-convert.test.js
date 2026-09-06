"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Convert = require("../web/building-image-convert.js");

const INDEX_PATH = path.join(__dirname, "../data/building_sprite_index.json");
const UID_PATH = path.join(__dirname, "../data/building_pack_uids.json");

function loadIndex() {
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}

function fixtureIndex() {
  const packs = ["bazaar"];
  const rows = [
    { category: "地面", local: 301, frame: 0, width: 48, height: 24, mean: [150, 150, 150] },
    { category: "墙壁", local: 501, frame: 0, width: 28, height: 48, mean: [210, 190, 150] },
    { category: "墙壁", local: 508, frame: 1, width: 28, height: 48, mean: [210, 190, 150] },
    { category: "门窗", local: 201, frame: 0, width: 24, height: 40, mean: [90, 70, 50] },
    { category: "门窗", local: 201, frame: 1, width: 24, height: 40, mean: [90, 70, 50] },
    { category: "装饰", local: 101, frame: 0, width: 32, height: 28, mean: [40, 80, 160] },
    { category: "屋顶", local: 401, frame: 0, width: 56, height: 28, mean: [120, 70, 50] },
  ];
  return {
    entries: rows.map((row) => {
      const gray = new Uint8Array(256).fill(row.mean[0]);
      return {
        pack: "bazaar",
        local: row.local,
        uid: 14,
        mat: 14000 + row.local,
        category: row.category,
        file: `${row.category}.ale`,
        frame: row.frame,
        width: row.width,
        height: row.height,
        anchorX: 0,
        anchorY: 0,
        phash: Convert.phashFromGray16(gray),
        gray: Convert.encodeGray16(gray),
        mean: row.mean,
        edges: [1, 1, 1, 1, 1, 1, 1, 1],
      };
    }),
    packs,
  };
}

function bookshopStructure() {
  return {
    floor: {
      cx: 280,
      cy: 320,
      w: 160,
      h: 80,
      left: { x: 200, y: 320 },
      right: { x: 360, y: 320 },
      front: { x: 280, y: 360 },
      back: { x: 280, y: 280 },
    },
    walls: [
      {
        a: { x: 200, y: 320 },
        b: { x: 280, y: 280 },
        openings: [{ t: 0.45, w: 22 }],
        state: 1,
      },
      {
        a: { x: 360, y: 320 },
        b: { x: 280, y: 280 },
        openings: [],
        state: 0,
      },
    ],
    props: [{ x: 310, y: 210, kind: "sign", mean: [40, 80, 160] }],
    roof: [],
  };
}

function makeRgba(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, width, height);
  return { width, height, data };
}

function fillRect(data, width, x, y, w, h, rgb) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      if (col < 0 || row < 0 || col >= width) continue;
      const o = (row * width + col) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
}

test("phash and gray round-trip stay stable", () => {
  const gray = new Uint8Array(256);
  for (let i = 0; i < 256; i++) gray[i] = (i * 13) % 256;
  const encoded = Convert.encodeGray16(gray);
  const decoded = Convert.decodeGray16(encoded);
  assert.equal(decoded.length, 256);
  assert.equal(decoded[20], gray[20]);
  const hash = Convert.phashFromGray16(gray);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(Convert.hammingHex(hash, hash), 0);
  assert.ok(Convert.ncc(gray, gray) > 0.99);
});

test("structure stays compact in the image instead of stretching to the whole house frame", () => {
  const image = makeRgba(200, 180, (data, width) => {
    fillRect(data, width, 0, 0, 200, 180, [48, 160, 64]);
    fillRect(data, width, 70, 70, 60, 55, [210, 190, 150]);
    fillRect(data, width, 78, 105, 44, 18, [150, 150, 150]);
  });
  const cleaned = Convert.keepLargestOpaqueComponent(Convert.removeBackground(image));
  const target = { x: 40, y: 40, w: 480, h: 460 };
  const structure = Convert.estimateStructure(cleaned, target, { fit: "contain" });
  assert.ok(structure.seated, "should seat on foundation");
  assert.ok(structure.floor.w <= 160, `floor.w=${structure.floor.w}`);
  assert.ok(structure.floor.h <= 90, `floor.h=${structure.floor.h}`);
  assert.ok(Math.abs(structure.floor.cx - (target.x + target.w * 0.5)) < 8);
  assert.ok(structure.walls.length >= 2);
  assert.ok(structure.walls.every((wall) => (wall.openings || []).length >= 1));
  const wallLen = Math.hypot(
    structure.walls[0].b.x - structure.walls[0].a.x,
    structure.walls[0].b.y - structure.walls[0].a.y
  );
  assert.ok(wallLen < 120, `wallLen=${wallLen}`);
});

test("screenshot convert without a user structure stays unresolved", () => {
  const result = Convert.convertPrepared(
    makeRgba(120, 100, (data, width) => {
      fillRect(data, width, 0, 0, 120, 100, [40, 150, 60]);
      fillRect(data, width, 40, 30, 45, 50, [205, 185, 145]);
    }),
    fixtureIndex(),
    {
      mode: "screenshot",
      packKeys: ["bazaar"],
      threshold: "loose",
      target: { x: 80, y: 90, w: 400, h: 360 },
    }
  );
  assert.equal(result.spec.records.length, 0);
  assert.equal(result.summary.total, 0);
  assert.match(result.status, /待确认墙线/);
  assert.ok(result.structure);
  assert.equal(result.structure.__pendingReview, true);
  assert.ok(Array.isArray(result.structure.walls));
  assert.ok(Array.isArray(result.structure.wallMean));
  assert.equal(result.apply.ok, false);
  assert.equal(result.catastrophic, false);
});

test("legacy screenshot flag still invents L walls so the old failure stays reproducible", () => {
  const result = Convert.convertPrepared(
    makeRgba(120, 100, (data, width) => {
      fillRect(data, width, 0, 0, 120, 100, [40, 150, 60]);
      fillRect(data, width, 40, 30, 45, 50, [205, 185, 145]);
    }),
    fixtureIndex(),
    {
      mode: "screenshot",
      legacyScreenshot: true,
      packKeys: ["bazaar"],
      threshold: "loose",
      target: { x: 80, y: 90, w: 400, h: 360 },
    }
  );
  const cats = result.spec.records.map((row) => row.category);
  assert.ok(cats.includes("地面"));
  assert.ok(Convert.isCatastrophic(result.spec) || cats.includes("墙壁"));
});

test("bookshop sketch spec is not all walls and stays on iso axes", () => {
  const spec = Convert.assembleSketch(bookshopStructure(), fixtureIndex(), {
    packKeys: ["bazaar"],
    threshold: "loose",
    mode: "sketch",
  });
  const cats = spec.records.map((row) => row.category);
  assert.ok(cats.includes("地面"), "needs floor");
  const walls = spec.records.filter((row) => row.category === "墙壁");
  const faces = new Set(walls.map((row) => Number(row.state) || 0));
  assert.ok(faces.size >= 2, "needs two wall facings");
  assert.ok(cats.includes("门窗") || cats.includes("装饰"), "needs opening or decor");
  assert.ok(!spec.records.every((row) => row.category === "墙壁"));
  assert.ok(Convert.wallsOnIsoAxis(spec.records));
  assert.ok(Convert.isGoldLike(spec));
  const summary = Convert.summarizeSpec(spec);
  assert.match(Convert.statusText(summary, "sketch"), /认出 \d+ 面墙/);
  const uids = JSON.parse(fs.readFileSync(UID_PATH, "utf8")).mapping;
  const errors = Convert.validateSpec(spec, uids);
  assert.deepEqual(errors, []);
  spec.records.forEach((row) => {
    assert.equal(row.mat, 14 * 1000 + row.local);
    assert.ok(row.x >= 0 && row.x <= 2047);
    assert.ok(row.y >= 0 && row.y <= 2047);
    assert.notEqual(row.mat, 0);
  });
});

test("background removal keeps the building and drops green", () => {
  const image = makeRgba(40, 40, (data, width) => {
    fillRect(data, width, 0, 0, 40, 40, [60, 180, 70]);
    fillRect(data, width, 12, 10, 16, 18, [200, 180, 140]);
  });
  const cleaned = Convert.removeBackground(image);
  let kept = 0;
  let green = 0;
  for (let i = 0; i < cleaned.data.length; i += 4) {
    if (cleaned.data[i + 3] > 20) {
      kept += 1;
      if (cleaned.data[i + 1] > cleaned.data[i] + 20) green += 1;
    }
  }
  assert.ok(kept > 40);
  assert.ok(green < kept * 0.2);
});

test("screenshot convert with a bookshop-like layout is not wall-only", () => {
  const image = makeRgba(160, 140, (data, width) => {
    fillRect(data, width, 0, 0, 160, 140, [48, 160, 64]);
    fillRect(data, width, 40, 90, 80, 28, [150, 150, 150]);
    fillRect(data, width, 42, 40, 18, 60, [210, 190, 150]);
    fillRect(data, width, 100, 40, 18, 60, [210, 190, 150]);
    fillRect(data, width, 46, 58, 12, 22, [90, 70, 50]);
    fillRect(data, width, 108, 28, 16, 14, [40, 80, 160]);
  });
  const result = Convert.convertPrepared(image, fixtureIndex(), {
    mode: "sketch",
    structure: bookshopStructure(),
    packKeys: ["bazaar"],
    threshold: "loose",
    target: { x: 80, y: 90, w: 400, h: 360 },
  });
  assert.ok(Convert.isGoldLike(result.spec));
  assert.ok(!result.spec.records.every((row) => row.category === "墙壁"));
  assert.ok(result.summary.floors >= 1);
  assert.ok(result.summary.walls >= 2);
  assert.ok(result.summary.openings + result.summary.decors >= 1);
});

test("mustPick never falls back to the first index entry", () => {
  const empty = Convert.mustPick([], { w: 32, h: 32, mean: [0, 0, 0] }, Convert.THRESHOLDS.strict);
  assert.equal(empty, null);
});

test("desk foot offset matches the opaque-bounds formula", () => {
  const offset = Convert.computeFootOffset({ x: 4, y: 6, width: 40, height: 50 }, { width: 48, height: 64 });
  assert.equal(offset.x, 4 + 40 / 2);
  assert.equal(offset.y, 6 + 50 - Math.max(1, 50 * 0.08));
  const fallback = Convert.computeFootOffset(null, { width: 20, height: 30 });
  assert.equal(fallback.x, 10);
  assert.equal(fallback.y, 24);
});

test("floor-only specs are catastrophic and cannot auto-apply", () => {
  const spec = {
    records: [{ mat: 14301, pack: "bazaar", local: 301, category: "地面", group: "地面", x: 100, y: 120, confidence: 0.2 }],
  };
  assert.equal(Convert.isCatastrophic(spec), true);
  assert.equal(Convert.canAutoApply(spec).ok, false);
  assert.equal(Convert.canAutoApply(spec, { userEdited: true }).ok, true);
});

test("locked sprite index encodes UID mats and skips kits", () => {
  assert.ok(fs.existsSync(INDEX_PATH), "run tools/build_sprite_index.py");
  const doc = loadIndex();
  assert.equal(doc.schema, 1);
  assert.ok(doc.entryCount >= 100);
  assert.equal(doc.entries.length, doc.entryCount);
  const uids = JSON.parse(fs.readFileSync(UID_PATH, "utf8")).mapping;
  const categories = new Set(["装饰", "门窗", "地面", "屋顶", "墙壁"]);
  const seenKit = [];
  doc.entries.forEach((entry) => {
    assert.equal(entry.mat, entry.uid * 1000 + entry.local);
    assert.equal(uids[String(entry.uid)], entry.pack);
    assert.ok(entry.local < 600, `kit local ${entry.local}`);
    assert.ok(categories.has(entry.category));
    assert.ok(entry.phash);
    assert.ok(entry.gray);
    assert.ok(entry.width > 0 && entry.height > 0);
    if (entry.local >= 600) seenKit.push(entry);
  });
  assert.equal(seenKit.length, 0);
  const errors = Convert.validateSpec(
    {
      records: doc.entries.slice(0, 8).map((entry) => ({
        pack: entry.pack,
        local: entry.local,
        mat: entry.mat,
        x: 100,
        y: 120,
        state: entry.frame || 0,
      })),
    },
    uids
  );
  assert.deepEqual(errors, []);
});
