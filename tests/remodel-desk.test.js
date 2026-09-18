"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/remodel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "web/remodel.css"), "utf8");
const js = fs.readFileSync(path.join(root, "web/remodel.js"), "utf8");
const core = fs.readFileSync(path.join(root, "web/remodel-paper-library-core.js"), "utf8");
const buildingJs = fs.readFileSync(path.join(root, "web/building.js"), "utf8");
const buildingHtml = fs.readFileSync(path.join(root, "web/building.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "web/app.js"), "utf8");

test("remodel desk is a separate page from the building desk", () => {
  assert.match(html, /改造设计桌/);
  assert.match(html, /web\/remodel\.js/);
  assert.match(html, /选择基座/);
  assert.match(html, /id="hudStack"/);
  assert.doesNotMatch(html, /注意！超出亮光部分会被剪裁/);
  assert.doesNotMatch(html, /remodelClipNote/);
  assert.doesNotMatch(html, /web\/building\.js/);
  assert.doesNotMatch(html, /web\/paper-library-core\.js\?v=/);
});

test("remodel mobile chrome overrides load after the shared workspace stylesheet", () => {
  const cssHref = html.match(/href="\/web\/remodel\.css\?v=\d+"/);
  const mobileHref = html.match(/href="\/web\/mobile-workspace\.css\?v=\d+"/);
  assert.ok(cssHref && mobileHref);
  assert.ok(html.indexOf(mobileHref[0]) < html.indexOf(cssHref[0]));
  assert.match(css, /building-app\.remodel-app/);
  assert.match(css, /desk-switch-inline/);
  assert.match(css, /\.remodel-clip-note/);
  assert.doesNotMatch(css, /注意！超出亮光部分会被剪裁/);
});

test("remodel javascript never writes the building save APIs", () => {
  assert.match(js, /\/api\/saves\/remodel/);
  assert.match(js, /customBases/);
  assert.match(js, /nativeGetBaseIndex/);
  assert.match(js, /SetPut\(/);
  assert.match(js, /manor-remodel-session-v1/);
  assert.match(js, /manor-remodel-customs-v1/);
  assert.match(js, /manor-remodel-paper-library/);
  assert.match(core, /\/api\/saves\/remodel\/papers/);
  assert.doesNotMatch(js, /\/api\/saves\/building/);
  assert.doesNotMatch(js, /\/api\/saves\/terrain/);
  assert.doesNotMatch(js, /manor-building-/);
  assert.doesNotMatch(js, /manor-pending-building-import/);
  assert.doesNotMatch(js, /manor-pending-preview-building/);
  assert.doesNotMatch(js, /const PAPER_LIBRARY_DB = "manor-paper-library"/);
  assert.doesNotMatch(js, /PAPER_LIBRARY_DESK = "building"/);
  assert.doesNotMatch(buildingJs, /\/api\/saves\/remodel/);
  assert.doesNotMatch(buildingJs, /nativeGetBaseIndex/);
  assert.doesNotMatch(buildingJs, /manor-remodel-/);
  assert.doesNotMatch(core, /\/api\/saves\/building\/papers/);
  assert.doesNotMatch(appJs, /\/api\/saves\/remodel/);
  assert.doesNotMatch(appJs, /manor-remodel-/);
});

test("building desk html only gained a remodel switcher link", () => {
  assert.match(buildingHtml, /web\/remodel\.html/);
  assert.match(buildingHtml, /建筑设计桌/);
  assert.doesNotMatch(buildingHtml, /web\/remodel\.js/);
});

test("GetBaseIndex keeps furniture 1x1 off the decoration 1x1 mask", () => {
  const context = { window: {}, state: { catalog: { building: { customBases: [
    { no: 1, kind: 0, name: "装饰基座1×1", command: "SetPut(1,1)", baseImage: "baseimg/1&1.ale" },
    { no: 9, kind: 1, name: "家具基座1×1", command: "SetPut(1,1)", baseImage: "baseimg/2&2.ale" },
    { no: 25, kind: 0, name: "装饰基座6×6", command: "SetPut(6,6)" },
  ] } } } };
  vm.createContext(context);
  const start = js.indexOf("function designBases()");
  const end = js.indexOf("window.RemodelNative");
  vm.runInContext(js.slice(start, end) + "this.nativeGetBaseIndex = nativeGetBaseIndex;", context);
  const deco = context.nativeGetBaseIndex(0, 1, 1);
  const furn = context.nativeGetBaseIndex(1, 1, 1);
  assert.equal(deco.no, 1);
  assert.equal(furn.no, 9);
  assert.equal(context.nativeGetBaseIndex(0, 6, 6).name, "装饰基座6×6");
  assert.equal(context.nativeGetBaseIndex(3, 6, 6), null);
});

test("mobile view centers on the item base bitmap, not the grass origin", () => {
  assert.match(js, /function remodelSubjectBitmap/);
  assert.match(js, /function remodelVisibleInsets/);
  assert.match(js, /prevReady/);
  const context = { window: {}, state: { baseLayout: null, keepFoundation: true, phase: "design" } };
  vm.createContext(context);
  const start = js.indexOf("function remodelSubjectBitmap");
  const end = js.indexOf("function remodelVisibleInsets");
  vm.runInContext(js.slice(start, end) + "this.remodelSubjectBitmap = remodelSubjectBitmap;", context);
  const floor = context.remodelSubjectBitmap(
    { floorX: 10, floorY: 20, floorW: 40, floorH: 30, maskX: 0, maskY: 0, maskW: 80, maskH: 80 },
    true,
    "design"
  );
  assert.equal(floor.x, 30);
  assert.equal(floor.y, 35);
  const mask = context.remodelSubjectBitmap(
    { floorX: 10, floorY: 20, floorW: 40, floorH: 30, maskX: 0, maskY: 0, maskW: 80, maskH: 80 },
    false,
    "design"
  );
  assert.equal(mask.x, 40);
  assert.equal(mask.y, 40);
});

test("paper library core copy points at remodel papers", () => {
  assert.match(core, /\/api\/saves\/remodel\/papers/);
  assert.doesNotMatch(core, /\/api\/saves\/building\/papers/);
});

test("copy to game encodes native TxtExport V1; desk records", () => {
  assert.match(html, /复制到游戏/);
  assert.match(html, /id="dlgRemodelClip"/);
  assert.match(html, /data-command="copyToGame"/);
  assert.match(js, /encodeNativeDesignClip/);
  assert.match(js, /CopyToClipBoard/);
  assert.match(js, /0x4fff/);
  assert.doesNotMatch(buildingJs, /encodeNativeDesignClip/);
  assert.doesNotMatch(buildingJs, /copyToGame/);
  assert.match(js, /return `\/bdesign\/item\/\$\{src/);
  assert.match(js, /\/bdesign\/item\/\$\{path\}/);
  assert.match(js, /itemPackFamily/);
  assert.match(js, /itemPaperMat/);
  assert.match(js, /nativePaperMat/);
  assert.match(js, /装饰素材包/);
  assert.match(js, /家具素材包/);
  assert.match(js, /Number\(row.uid\) \* 1000 \+ localId/);
  assert.doesNotMatch(buildingJs, /itemPackFamily/);
  assert.doesNotMatch(buildingJs, /itemPaperMat/);
  assert.doesNotMatch(buildingJs, /nativePaperMat/);
  assert.doesNotMatch(buildingJs, /\/data\/item_pack_uids\.json/);

  const uids = JSON.parse(fs.readFileSync(path.join(root, "data/item_pack_uids.json"), "utf8"));
  const matStart = js.indexOf("function itemPaperMat");
  const matEnd = js.indexOf("function packForPaperUid");
  assert.ok(matStart >= 0 && matEnd > matStart);
  const matCtx = { state: { itemPackMeta: uids.packs } };
  vm.createContext(matCtx);
  vm.runInContext(js.slice(matStart, matEnd), matCtx);
  assert.equal(matCtx.itemPaperMat(101, "i_xmas03"), 10101);
  assert.equal(matCtx.itemPaperMat(101, "i_tool02"), 7101);
  assert.equal(matCtx.itemPaperMat(101, "o_china03"), 2101);
  assert.equal(matCtx.itemPaperMat(10101, "i_xmas03"), 10101);
  const ornament = uids.packs.filter((row) => row.family === "ornament").map((row) => row.key);
  const furniture = uids.packs.filter((row) => row.family === "furniture").map((row) => row.key);
  assert.ok(ornament.includes("o_china03") && !ornament.includes("i_xmas03"));
  assert.ok(furniture.includes("i_xmas03") && !furniture.includes("o_china03"));
  assert.equal(ornament.filter((key) => key === "o_q02").length, 1);
  assert.equal(furniture.filter((key) => key === "i_tool02").length, 1);

  const codecJs = fs.readFileSync(path.join(root, "web/codec.js"), "utf8");
  const start = js.indexOf("const NATIVE_CLIP_MAX");
  const end = js.indexOf("function nativeClipExportRecords");
  assert.ok(start >= 0 && end > start);
  const context = { console };
  vm.createContext(context);
  vm.runInContext(codecJs + "\n" + js.slice(start, end), context);
  const sample = "V1;0Mk2s07s1;0Tk2u07s0";
  const parsedSample = context.parseV1(sample);
  const text = context.encodeNativeDesignClip(parsedSample.records);
  assert.equal(text, sample);
  assert.equal(text.includes("\n") || text.includes("\r"), false);
  assert.equal([...text].every((ch) => ch.charCodeAt(0) >= 0x20), true);
  const recs = text.slice(3).split(";");
  assert.ok(recs.every((row) => row.length === 9));
  const parsed = context.parseV1(text);
  assert.equal(parsed.kind, "desk");
  assert.equal(parsed.records[0].x, 182);
  assert.equal(parsed.records[0].y, 184);
  assert.equal(parsed.records[0].mat, 504);
  assert.equal(context.encodeNativeDesignClip([]), "");
  assert.equal(context.encodeNativeDesignClip([{ x: 1, y: 2, mat: 3, state: 0, hidden: true }]), "");
});
