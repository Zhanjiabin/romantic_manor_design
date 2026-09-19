const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the same geometry functions used by the canvas without booting the UI.
const source = fs.readFileSync(require.resolve("../web/app.js"), "utf8");
const context = vm.createContext({ logicalToNative: (u, v) => ({ cx: u, cy: v }) });
for (const name of ["imageTerrainRegionContains", "imageTerrainFitRect", "cellToImageXY"]) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  vm.runInContext(source.slice(start, end), context);
}
const contains = context.imageTerrainRegionContains;

test("rectangle uses map coordinates and supports reverse drags and boundaries", () => {
  const region = { mode: "rectangle", points: [{ x: 100, y: 80 }, { x: 20, y: 10 }] };
  assert.equal(contains(region, 50, 30), true);
  assert.equal(contains(region, 20, 80), true);
  assert.equal(contains(region, 19, 30), false);
  assert.equal(contains(region, 50, 81), false);
});

test("concave polygons clip their cutouts in either winding direction", () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
    { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
  for (const ordered of [points, points.slice().reverse()]) {
    const region = { mode: "polygon", points: ordered };
    assert.equal(contains(region, 20, 80), true);
    assert.equal(contains(region, 80, 20), true);
    assert.equal(contains(region, 80, 80), false);
    assert.equal(contains(region, 40, 80), true);
    assert.equal(contains(region, -1, 20), false);
  }
});

test("image samples the full selected rectangle regardless of map offset", () => {
  const src = { width: 101, height: 101 };
  const bounds = { minCx: 900, maxCx: 1300, minCy: 300, maxCy: 500 };
  const at = (cx, cy, fit = "stretch") => context.cellToImageXY({ cx, cy }, "front", fit, src, 3880, {}, bounds);
  assert.equal(at(900, 300).x, 0);
  assert.equal(at(1300, 500).x, 100);
  assert.equal(at(1300, 500).y, 100);
  assert.equal(at(1100, 400).x, 50);
  assert.equal(at(1100, 400).y, 50);
  assert.equal(at(900, 400, "contain"), null, "square image leaves side margins in wide target");
  assert.equal(at(1100, 300, "cover").y, 25, "cover crops top and bottom, preserving aspect ratio");
});
