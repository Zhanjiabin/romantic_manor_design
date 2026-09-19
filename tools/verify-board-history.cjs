"use strict";

// Run against the local desk server with optional Playwright installed.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const blank = Array(36 * 24).fill(50);
      await page.route("**/api/saves/board", route => route.fulfill({ json: {
        designs: { items: [{ id: "history-fixture", name: "回归测试作品", pages: [blank], savedAt: 1 }] },
      } }));
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: {
          writeText: async text => { window.testClipboard = text; },
          readText: async () => window.testClipboard || "",
        } });
      });
      await page.goto(process.env.BOARD_URL || "http://127.0.0.1:8765/web/board.html");
      await page.waitForSelector("html.boot-ready");
      await page.waitForFunction(() => performance.getEntriesByType("resource").some(r => r.name.includes("board_highlight.png")));
      const mobile = await page.evaluate(() => document.documentElement.classList.contains("is-mobile-workspace") && !document.documentElement.classList.contains("is-tablet-workspace"));
      const picture = async () => createHash("sha256").update(await page.locator("#paintCanvas").evaluate(canvas => canvas.toDataURL())).digest("hex");
      const focusCanvas = () => page.locator("#paintBoard").focus();
      async function tool(key) { await focusCanvas(); await page.keyboard.press(String(key)); }
      async function draw(x, y, x2 = x, y2 = y) {
        const box = await page.locator("#paintCanvas").boundingBox();
        const point = (col, row) => [box.x + (col + 0.5) * box.width / 36, box.y + (row + 0.5) * box.height / 24];
        await page.mouse.move(...point(x, y));
        await page.mouse.down();
        if (x2 !== x || y2 !== y) await page.mouse.move(...point(x2, y2), { steps: 8 });
        await page.mouse.up();
      }
      async function roundTrip(before, after) {
        assert.notEqual(after, before, "operation visibly changes the canvas");
        await page.locator("#btnUndo").click();
        assert.equal(await picture(), before, "first undo restores the state before this operation");
        await page.locator("#btnRedo").click();
        assert.equal(await picture(), after, "redo exactly restores the operation");
      }
      async function pagesPanel(open) {
        if (mobile && (await page.locator("#btnBoardMobilePages").getAttribute("aria-expanded") === "true") !== open) {
          await page.locator("#btnBoardMobilePages").click();
        }
      }

      assert.equal(await page.locator("#btnUndo").isDisabled(), true);
      assert.equal(await page.locator("#btnRedo").isDisabled(), true);
      const empty = await picture();
      await draw(7, 7, 12, 7);
      const stroke = await picture();
      await roundTrip(empty, stroke);
      await draw(7, 7); // Same color: do not insert an empty undo step.
      await page.locator("#btnUndo").click();
      assert.equal(await picture(), empty);
      assert.equal(await page.locator("#btnUndo").isDisabled(), true);
      await tool(7); // Eyedropper must not erase the redo branch.
      await draw(20, 20);
      assert.equal(await page.locator("#btnRedo").isDisabled(), false);
      await focusCanvas();
      await page.keyboard.press("Control+y");
      assert.equal(await picture(), stroke);
      await page.keyboard.press("Control+z");
      assert.equal(await picture(), empty);
      await page.keyboard.press("Control+Shift+z");
      assert.equal(await picture(), stroke);
      await page.locator("#btnUndo").click();
      await tool(2);
      if (mobile) await page.locator("#btnBoardMobileTools").click();
      await page.locator('#paletteGrid [data-frame="2"]').click();
      if (mobile) await page.locator("#btnBoardMobileTools").click();
      await draw(18, 12);
      assert.equal(await page.locator("#btnRedo").isDisabled(), true, "new painting clears redo");

      for (const [key, a, b, c, d] of [[5, 3, 3, 10, 5], [4, 18, 12, 18, 12], [3, 24, 15, 27, 15], [6, 0, 0, 0, 0]]) {
        await tool(key);
        const before = await picture();
        await draw(a, b, c, d);
        await roundTrip(before, await picture());
      }
      await pagesPanel(true);
      await page.locator('[data-board-page="add"]').click();
      await pagesPanel(false);
      assert.equal(await page.locator("#pageCount").innerText(), "2");
      await tool(2);
      await draw(5, 5);
      const secondPage = await picture();
      await pagesPanel(true);
      await page.locator("#btnPrevPage").click();
      await pagesPanel(false);
      await page.locator("#btnUndo").click();
      assert.equal(await picture(), empty);
      assert.equal(await page.locator(".page-card.on b").innerText(), "第 2 页", "undo returns to the edited page");
      await page.locator("#btnRedo").click();
      assert.equal(await picture(), secondPage);
      await pagesPanel(true);
      await page.locator(".board-page-more summary").click();
      await page.locator('[data-board-page="del"]').click();
      await pagesPanel(false);
      assert.equal(await page.locator("#pageCount").innerText(), "1");
      await page.locator("#btnUndo").click();
      assert.equal(await picture(), secondPage);
      assert.equal(await page.locator("#pageCount").innerText(), "2");
      await page.locator("#btnRedo").click();
      assert.equal(await page.locator("#pageCount").innerText(), "1");

      const beforeImport = await picture();
      const oldInterval = await page.locator("#pageInterval").inputValue();
      await page.locator("#fileBoardImage").setInputFiles({ name: "history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ pages: [blank.map((v, i) => i % 3 ? 12 : 45)], interval: 250 })) });
      await page.waitForFunction(() => document.getElementById("pageInterval").value === "250");
      await roundTrip(beforeImport, await picture());
      await page.locator("#btnUndo").click();
      assert.equal(await page.locator("#pageInterval").inputValue(), oldInterval);
      await page.locator("#btnRedo").click();
      assert.equal(await page.locator("#pageInterval").inputValue(), "250");

      // Undo and redo must not move the toolbar while held or after release.
      for (const id of ["btnUndo", "btnRedo"]) {
        const target = page.locator(`#${id}`), before = await target.boundingBox();
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down();
        assert.deepEqual(await target.boundingBox(), before);
        assert.equal(await target.evaluate(el => getComputedStyle(el).transform), "none");
        await page.mouse.up();
        assert.deepEqual(await target.boundingBox(), before);
      }

      if (!mobile) {
        await page.locator("#btnSaveDesign").click();
        await page.locator("#boardSaveName").fill("已保存的灯牌");
        await page.locator("#btnBoardSaveOk").click();
        await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
        await page.locator("#btnUndo").click();
        assert.equal(await page.locator("#boardSaveName").inputValue(), "已保存的灯牌", "undo preserves saved identity");
        assert.equal(await page.locator(".design-card.on .design-card-name").innerText(), "已保存的灯牌");
        await page.locator("#btnRedo").click();
        const savedPicture = await picture();
        await page.locator("#btnNewDesign").click();
        await page.locator("#dlgAppOk").click();
        assert.equal(await picture(), empty);
        await page.locator("#btnUndo").click();
        assert.equal(await picture(), savedPicture);
        assert.equal(await page.locator("#boardSaveName").inputValue(), "已保存的灯牌");
        await page.locator("#btnRedo").click();
        assert.equal(await picture(), empty);
        await page.locator(".design-card").filter({ hasText: "回归测试作品" }).click();
        assert.equal(await page.locator("#btnUndo").isDisabled(), true, "opening another work starts its own history");
        assert.equal(await page.locator("#btnRedo").isDisabled(), true);

        await tool(2);
        // Pinching cancels the tentative one-finger dot without adding history.
        const cdp = await context.newCDPSession(page);
        const box = await page.locator("#paintCanvas").boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point, { ...point, x: point.x + 40, id: 1 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        assert.equal(await picture(), empty);
        assert.equal(await page.locator("#btnUndo").isDisabled(), true);
        await cdp.detach();

        await draw(10, 10);
        const copied = await picture();
        await focusCanvas();
        await page.keyboard.press("Control+c");
        await page.locator('[data-board-page="add"]').click();
        await page.locator('[data-board-page="paste"]').click();
        await roundTrip(empty, copied);
        await page.locator("#pageInterval").fill("350");
        await page.locator("#pageInterval").dispatchEvent("change");
        await page.locator("#btnUndo").click();
        assert.equal(await page.locator("#pageInterval").inputValue(), "250");
        await page.locator("#btnRedo").click();
        assert.equal(await page.locator("#pageInterval").inputValue(), "350");
        await page.locator("#btnPlayPages").click();
        assert.equal(await page.locator("#btnPlayPages").getAttribute("aria-pressed"), "true");
        await page.locator("#btnUndo").click();
        assert.equal(await page.locator("#btnPlayPages").getAttribute("aria-pressed"), "false");
      }
      assert.deepEqual(errors, []);
      console.log(`${width}x${height}: strokes, fill, erase, line, spray, no-op, shortcuts, branching, pages, import and stationary buttons passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
