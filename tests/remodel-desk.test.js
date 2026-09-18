"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/remodel.html"), "utf8");
const js = fs.readFileSync(path.join(root, "web/remodel.js"), "utf8");
const core = fs.readFileSync(path.join(root, "web/remodel-paper-library-core.js"), "utf8");
const buildingJs = fs.readFileSync(path.join(root, "web/building.js"), "utf8");
const buildingHtml = fs.readFileSync(path.join(root, "web/building.html"), "utf8");

test("remodel desk is a separate page with native clip warning", () => {
  assert.match(html, /改造设计桌/);
  assert.match(html, /web\/remodel\.js/);
  assert.match(html, /注意！超出亮光部分会被剪裁/);
  assert.match(html, /选择基座/);
  assert.match(html, /id="hudStack"[\s\S]*remodelClipNote/);
  assert.doesNotMatch(html, /web\/building\.js/);
  assert.doesNotMatch(html, /web\/paper-library-core\.js\?v=/);
});

test("remodel javascript never writes the building save APIs", () => {
  assert.match(js, /\/api\/saves\/remodel/);
  assert.match(js, /customBases/);
  assert.match(js, /nativeGetBaseIndex/);
  assert.match(js, /SetPut\(/);
  assert.doesNotMatch(js, /\/api\/saves\/building/);
  assert.doesNotMatch(buildingJs, /\/api\/saves\/remodel/);
  assert.doesNotMatch(buildingJs, /nativeGetBaseIndex/);
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
