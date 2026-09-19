"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../web/cloth.js"), "utf8");

class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

function helpers() {
  const context = vm.createContext({ ImageData });
  vm.runInContext(source.slice(source.indexOf("  function colorDist("), source.indexOf("  function kindHasUvIslands(")), context);
  return context;
}

test("native outlines and AI coverage preserve one-pixel gaps and transparent holes", () => {
  const h = helpers();
  const input = new ImageData(12, 10);
  for (let y = 1; y < 9; y++) {
    for (let x = 1; x < 11; x++) {
      if (x === 5 || (x === 8 && y === 5)) continue;
      input.data.set([17, 17, 17, 255], (y * 12 + x) * 4);
    }
  }
  for (const fillIslands of [false, true]) {
    const out = h.extractUvOutline(input, { coverageMask: true, fillIslands });
    for (let p = 0; p < 120; p++) {
      if (!input.data[p * 4 + 3]) assert.equal(out.data[p * 4 + 3], 0, `outside pixel ${p}`);
    }
    assert.equal(out.data[(4 * 12 + 4) * 4 + 3], 255);
    assert.equal(out.data[(4 * 12 + 6) * 4 + 3], 255);
    assert.equal(out.data[(3 * 12 + 3) * 4 + 3], fillIslands ? 78 : 0);
  }
});

test("native UV shape is independent of texture or JPEG background colors", () => {
  const h = helpers();
  const input = new ImageData(8, 8);
  input.data.set([255, 20, 168, 255], (4 * 8 + 4) * 4);
  const first = h.extractUvOutline(input, { coverageMask: true });
  for (let p = 0; p < 64; p++) input.data.set([244, 240, 234], p * 4);
  const second = h.extractUvOutline(input, { coverageMask: true });
  assert.deepEqual(first.data, second.data);
});

test("a slow previous-kind guide cannot overwrite the newly selected kind", async () => {
  const draws = [], pending = {};
  const context = vm.createContext({
    state: { kindId: "female-short" }, uvGuideOn: true, uvGuideRequest: 0,
    guideCanvas: () => ({ width: 256, height: 256, getContext: () => ({ clearRect() {}, drawImage: (...args) => draws.push(args) }) }),
    syncUvGuideButton() {}, kindHasUvIslands: () => true,
    uvOutlineForKind: (kind) => new Promise(resolve => { pending[kind] = resolve; }), console,
  });
  vm.runInContext(source.slice(source.indexOf("  async function refreshUvGuide("), source.indexOf("  function setUvGuideOn(")), context);
  const first = context.refreshUvGuide();
  context.state.kindId = "male-long";
  const second = context.refreshUvGuide();
  pending["male-long"]("correct guide");
  await second;
  pending["female-short"]("stale guide");
  await first;
  assert.deepEqual(draws.map(row => row[0]), ["correct guide"]);
});
