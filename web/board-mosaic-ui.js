(function (root) {
  "use strict";
  root.BoardMosaicUI = function (api) {
    const M = root.BoardMosaic, { state, board, canvas } = api;
    const $ = id => document.getElementById(id);
    let draft = M.normalize(), previewPage = null, exporting = false;
    const bases = [0, 1].map(i => { const image = new Image(); image.onload = () => { if (previewPage) drawGamePreview(previewPage); }; image.src = `/data/board_base_${i}.png`; return image; });
    const presets = ["single", "four", "nine", "horizontal", "vertical", "cross", "l", "heart"];

    function drawTileLines(context, layout, px, selected = -1) {
      if (M.tiles(layout).length <= 1) return;
      const w = M.COLS * px, h = M.ROWS * px;
      context.save();
      context.lineWidth = Math.max(1, px / 5);
      context.font = `bold ${Math.max(12, px * 1.4)}px sans-serif`;
      for (const [i, tile] of M.tiles(layout).entries()) {
        const x = tile.col * w, y = tile.row * h;
        context.strokeStyle = tile.index === selected ? "#ffdb70" : "rgba(111,236,205,.8)";
        context.strokeRect(x + 1, y + 1, w - 2, h - 2);
        context.fillStyle = "rgba(0,0,0,.75)";
        context.fillRect(x + 3, y + 3, px * 3 + 16, px * 2 + 12);
        context.fillStyle = "#fff";
        context.fillText(String(i + 1), x + 9, y + px * 1.5 + 10);
      }
      context.restore();
    }

    function drawGuide() {
      const guide = $("boardGuides");
      guide.width = canvas.width; guide.height = canvas.height;
      if ($("boardShowGuides").checked) drawTileLines(guide.getContext("2d"), state.layout, canvas.width / (state.layout.cols * M.COLS), state.tile);
    }

    function sync() {
      const tiles = M.tiles(state.layout), multi = tiles.length > 1;
      $("boardLayoutSummary").textContent = `${tiles.length} 块 · ${state.layout.cols * M.COLS}×${state.layout.rows * M.ROWS}`;
      $("boardTileField").hidden = !multi;
      const select = $("boardActiveTile"); select.replaceChildren();
      tiles.forEach((tile, i) => select.add(new Option(`${i + 1} 号 · 第 ${tile.row + 1} 行 ${tile.col + 1} 列`, String(tile.index))));
      select.value = String(state.tile);
      $("btnBoardCopy").title = multi ? "复制选中块的当前动画页，到一块游戏广告牌中粘贴" : "复制当前页到游戏广告牌";
      $("btnFinalize").title = multi ? "下载全部分块 ALE、剪贴板文本、拼接图纸与摆放说明 ZIP" : "下载当前广告牌 ALE";
      $("kindMeta").textContent = `${multi ? "每块 " : ""}36×24 · 最多 10 页`;
      $("boardShowGuides").closest("label").hidden = !multi;
      drawGuide();
    }

    function renderDraft() {
      $("boardLayoutCols").value = draft.cols;
      $("boardLayoutRows").value = draft.rows;
      const grid = $("boardLayoutMask"); grid.replaceChildren();
      grid.style.setProperty("--layout-cols", draft.cols);
      let number = 0;
      draft.mask.forEach((on, index) => {
        const button = document.createElement("button"); button.type = "button";
        button.className = on ? "on" : "";
        button.textContent = on ? String(++number) : "+";
        button.setAttribute("aria-pressed", String(on));
        button.setAttribute("aria-label", `第 ${Math.floor(index / draft.cols) + 1} 行第 ${index % draft.cols + 1} 列`);
        button.addEventListener("click", () => {
          const mask = draft.mask.slice(); mask[index] = !mask[index];
          updateDraft({ ...draft, mask }, "custom");
        });
        grid.append(button);
      });
      $("boardLayoutInfo").textContent = `${number} 块 · 总画布 ${draft.cols * M.COLS}×${draft.rows * M.ROWS} 灯珠。点击格子留空，最多 64 块。`;
    }

    function setDraft(layout) {
      draft = M.normalize(layout);
      $("boardLayoutPreset").value = presets.find(name => JSON.stringify(M.preset(name)) === JSON.stringify(draft)) || "custom";
      renderDraft();
    }

    function updateDraft(layout, preset) {
      try {
        draft = M.normalize(layout);
        $("boardLayoutPreset").value = preset;
        renderDraft();
        api.setDraftLayout(draft);
      } catch (error) {
        $("boardLayoutInfo").textContent = error.message;
        $("boardLayoutCols").value = draft.cols;
        $("boardLayoutRows").value = draft.rows;
      }
    }

    function zoom(factor, point) {
      const rect = board.getBoundingClientRect(), x = point?.x ?? rect.width / 2, y = point?.y ?? rect.height / 2;
      const next = Math.max(0.02, Math.min(12, state.zoom * factor));
      state.panX = x - (x - state.panX) * next / state.zoom;
      state.panY = y - (y - state.panY) * next / state.zoom;
      state.zoom = next; api.applyCamera();
    }

    function drawGamePreview(page) {
      previewPage = page;
      const facing = Number($("boardPreviewFacing").value), view = M.VIEWS[facing], layout = state.layout;
      const game = $("boardPreviewMode").value === "game", scale = Number($("boardPreviewScale").value);
      $("boardGamePreview").hidden = !game;
      $("previewCanvas").hidden = game;
      const width = layout.cols * view.width, height = layout.rows * view.height;
      const margin = 20, rise = width * view.slope, top = Math.max(0, -rise);
      const out = $("boardGameCanvas"), context = out.getContext("2d");
      out.width = Math.ceil(width + margin * 2); out.height = Math.ceil(height + Math.abs(rise) + margin * 2 + 18);
      out.style.width = `${out.width * scale}px`; out.style.height = `${out.height * scale}px`;
      // Render all bases first. Lower screens cover internal supports just as an aligned stack does.
      if ($("boardPreviewBases").checked && bases[facing].complete && bases[facing].naturalWidth) {
        for (const tile of M.placement(layout, facing)) {
          const faceTop = view.y + Math.max(0, -view.width * view.slope);
          const x = margin + tile.dx + view.baseX - view.x;
          const y = margin + top + tile.dy + view.baseY - faceTop;
          context.drawImage(bases[facing], x, y);
        }
      }
      const flat = document.createElement("canvas");
      const px = Math.min(6, Math.max(1, Math.floor(1800 / (layout.cols * M.COLS))));
      flat.width = layout.cols * M.COLS * px; flat.height = layout.rows * M.ROWS * px;
      api.drawGrid(flat.getContext("2d"), page, null, layout, px);
      // One affine transform of the whole image keeps neighboring edges identical.
      context.save();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.setTransform(width / flat.width, rise / flat.width, 0, height / flat.height, margin, margin + top);
      context.drawImage(flat, 0, 0);
      context.restore();
      const table = $("boardPlacementTable"); table.replaceChildren();
      const rows = document.createElement("table");
      const heading = document.createElement("tr");
      ["块", "行 / 列", "横向偏移", "纵向偏移"].forEach(text => { const th = document.createElement("th"); th.textContent = text; heading.append(th); });
      rows.append(heading);
      M.placement(layout, facing).forEach(tile => {
        const row = document.createElement("tr");
        [tile.number, `${tile.row + 1} / ${tile.col + 1}`, `${tile.dx}px`, `${tile.dy}px`].forEach(text => { const td = document.createElement("td"); td.textContent = String(text); row.append(td); });
        rows.append(row);
      });
      table.append(rows);
    }

    async function exportBundle() {
      if (exporting) return;
      exporting = true;
      const button = $("btnFinalize"), old = button.textContent;
      button.disabled = true;
      const snapshot = api.sessionSnapshot(), layout = M.normalize(snapshot.layout), tiles = M.tiles(layout);
      const files = [{ name: "拼接图纸.json", data: JSON.stringify(snapshot) }];
      const positions = [0, 1].map(facing => M.placement(layout, facing));
      const guide = ["广告牌拼接说明", "", `${tiles.length} 块；每块 36×24 灯珠，${snapshot.pages.length} 个动画页。`,
        "每个编号对应一块独立广告牌。游戏里先分别编辑：复制该块的文本并使用全部粘贴，再最终定稿。", "也可使用每块的 ALE 文件；所有块设为同一朝向。动画间隔需在游戏里设置为 " + snapshot.interval + " 毫秒。",
        "拼接图纸.json 可重新导入本设计桌，继续编辑整图。", "坐标是屏幕像素相对偏移，不是庄园地格坐标；竖向堆叠需配合游戏高度调整，并遮挡内部底座。", "游戏独立牌的动画启动时间可能不同，静态图不受影响。", ""];
      try {
        for (const [i, tile] of tiles.entries()) {
          button.textContent = `导出 ${i + 1}/${tiles.length}`;
          const name = `${String(i + 1).padStart(2, "0")}_行${tile.row + 1}_列${tile.col + 1}`;
          const pages = snapshot.pages.map(page => Array.from(M.extract(page, layout, tile.index)));
          const response = await fetch("/api/board/export-ani", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, pages, interval: snapshot.interval }) });
          const result = await response.json();
          if (!response.ok || !result.ale) throw new Error(result.error || "分块导出失败");
          files.push({ name: name + ".ale", data: Uint8Array.from(atob(result.ale), char => char.charCodeAt(0)) });
          files.push({ name: name + "_全部粘贴.txt", data: api.encodeAllClip(pages) });
          guide.push(`${name}：向右上 (${positions[0][i].dx}, ${positions[0][i].dy})；向右下 (${positions[1][i].dx}, ${positions[1][i].dy})`);
        }
        files.push({ name: "摆放说明.txt", data: guide.join("\n") });
        const blob = M.zip(files), url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = (snapshot.designName || "广告牌拼接") + ".zip"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        api.setSaveStatus(`已导出 ${tiles.length} 块广告牌`);
      } catch (error) {
        if (typeof appAlert === "function") appAlert(error.message, { title: "导出失败" });
      } finally { exporting = false; button.disabled = false; button.textContent = old; }
    }

    $("btnBoardLayout").addEventListener("click", api.editLayout);
    $("boardActiveTile").addEventListener("change", event => { state.tile = Number(event.target.value); drawGuide(); });
    $("boardShowGuides").addEventListener("change", drawGuide);
    $("boardLayoutPreset").addEventListener("change", event => {
      const preset = event.target.value;
      updateDraft(preset === "custom" ? draft : M.preset(preset), preset);
    });
    for (const id of ["boardLayoutCols", "boardLayoutRows"]) $(id).addEventListener("change", () => {
      const cols = Number($("boardLayoutCols").value), rows = Number($("boardLayoutRows").value);
      const mask = Array.from({ length: Math.max(0, Math.min(144, cols * rows)) }, (_, i) => cols * rows <= M.MAX_TILES || (i % cols < draft.cols && Math.floor(i / cols) < draft.rows && draft.mask[Math.floor(i / cols) * draft.cols + i % cols]));
      updateDraft({ cols, rows, mask }, "custom");
    });
    $("btnBoardZoomIn").addEventListener("click", () => zoom(1.25));
    $("btnBoardZoomOut").addEventListener("click", () => zoom(0.8));
    $("btnBoardZoomFit").addEventListener("click", api.fitCamera);
    $("btnBoardZoomOne").addEventListener("click", () => zoom(1 / state.zoom));
    board.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = board.getBoundingClientRect();
      zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    for (const id of ["boardPreviewMode", "boardPreviewFacing", "boardPreviewScale", "boardPreviewBases"]) $(id).addEventListener("change", () => drawGamePreview(previewPage || api.currentPage()));
    sync();
    return { sync, setDraft, drawGuide, drawTileLines, drawGamePreview, exportBundle };
  };
})(window);
