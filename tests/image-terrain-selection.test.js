const test = require("node:test");
const assert = require("node:assert/strict");
const { selectionCorners, hitSelection, selectionFromDrag, moveSelection, fitSelection } = require("../web/image-terrain-core.js");

test("square selection keeps its ratio in reverse drags and at map edges", () => {
  const bounds = { w: 1000, h: 800 };
  const rect = selectionFromDrag({ x: 700, y: 600 }, { x: 200, y: 400 }, bounds, 1);
  assert.deepEqual(rect, { x: 200, y: 100, w: 500, h: 500 });
  const edge = selectionFromDrag({ x: 900, y: 200 }, { x: 1500, y: 600 }, bounds, 1);
  assert.deepEqual(edge, { x: 900, y: 200, w: 100, h: 100 });
});

test("image ratio, free rectangles and corner crossings use the same bounded geometry", () => {
  const bounds = { w: 1000, h: 800 };
  const a = { x: 200, y: 200 }, b = { x: 600, y: 500 };
  assert.deepEqual(selectionFromDrag(a, b, bounds, 2), { x: 200, y: 200, w: 600, h: 300 });
  assert.deepEqual(selectionFromDrag(a, b, bounds), { x: 200, y: 200, w: 400, h: 300 });
  assert.deepEqual(selectionFromDrag(a, { x: 100, y: 100 }, bounds, 2), { x: 0, y: 100, w: 200, h: 100 });
});

test("handles take priority over moving the interior and movement keeps size at boundaries", () => {
  const rect = { x: 100, y: 100, w: 300, h: 200 };
  assert.equal(hitSelection(rect, { x: 105, y: 105 }, 10), 0);
  assert.equal(hitSelection(rect, { x: 250, y: 200 }, 10), "move");
  assert.equal(hitSelection(rect, { x: 600, y: 200 }, 10), -1);
  assert.equal(hitSelection(rect, selectionCorners(rect)[2], 10), 2);
  assert.deepEqual(moveSelection(rect, 999, -999, { w: 600, h: 500 }), { x: 300, y: 0, w: 300, h: 200 });
});

test("numeric resize preserves center and scales both dimensions to fit", () => {
  const bounds = { w: 1000, h: 800 }, rect = { x: 200, y: 200, w: 400, h: 200 };
  assert.deepEqual(fitSelection(rect, 200, 200, bounds), { x: 300, y: 200, w: 200, h: 200 });
  assert.deepEqual(fitSelection(rect, 2000, 1000, bounds), { x: 0, y: 50, w: 1000, h: 500 });
});
