(function initMaterialLedger(global) {
  "use strict";

  let bound = false;
  let payload = null;
  let exporting = false;

  function ensureDom() {
    let modal = document.getElementById("dlgMaterialLedger");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal material-ledger-modal";
    modal.id = "dlgMaterialLedger";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card material-ledger" role="dialog" aria-modal="true" aria-labelledby="materialLedgerTitle">
        <div class="modal-cap">
          <span id="materialLedgerTitle">材料清单</span>
          <button type="button" class="icon-x" id="btnMaterialLedgerClose" aria-label="关闭"></button>
        </div>
        <div class="modal-body">
          <p class="material-ledger-summary" id="materialLedgerSummary"></p>
          <div class="material-ledger-body" id="materialLedgerBody"></div>
        </div>
        <div class="material-ledger-foot">
          <button type="button" class="btn" id="btnMaterialLedgerDismiss">关闭</button>
          <button type="button" class="btn btn-primary" id="btnMaterialLedgerExport">导出 Excel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    global.MobileWorkspace?.enhanceModals?.();
    return modal;
  }

  function isOpen() {
    const modal = document.getElementById("dlgMaterialLedger");
    return !!(modal && !modal.hidden);
  }

  function close() {
    const modal = document.getElementById("dlgMaterialLedger");
    if (!modal) return;
    global.MobileWorkspace?.closeLayer(modal);
    payload = null;
  }

  function sortRows(rows) {
    return [...(rows || [])].sort(
      (a, b) =>
        (Number(b.count) || 0) - (Number(a.count) || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""), "zh")
    );
  }

  function renderIcon(row) {
    if (row?.iconUrl) {
      const icon = document.createElement("img");
      icon.className = "mat-icon";
      icon.src = row.iconUrl;
      icon.alt = "";
      icon.draggable = false;
      icon.addEventListener("error", () => {
        icon.replaceWith(Object.assign(document.createElement("span"), { className: "mat-icon-slot" }));
      });
      return icon;
    }
    const slot = document.createElement("span");
    slot.className = "mat-icon-slot";
    return slot;
  }

  function renderRow(row, showSource) {
    const el = document.createElement("div");
    el.className = "ledger-mat-row";
    el.appendChild(renderIcon(row));
    const copy = document.createElement("div");
    copy.className = "ledger-mat-copy";
    const name = document.createElement("span");
    name.className = "ledger-mat-name";
    name.textContent = row.name || "";
    copy.appendChild(name);
    if (showSource && row.source) {
      const source = document.createElement("span");
      source.className = "ledger-mat-source";
      source.textContent = row.source;
      copy.appendChild(source);
    }
    const count = document.createElement("em");
    count.className = "ledger-mat-count";
    count.textContent = `×${Number(row.count) || 0}`;
    el.append(copy, count);
    return el;
  }

  function fillList(host, rows, options = {}) {
    if (!host) return;
    host.replaceChildren();
    const list = sortRows(rows);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "design-materials-empty";
      empty.textContent = options.empty || "暂无材料";
      host.appendChild(empty);
      return;
    }
    list.forEach((row) => host.appendChild(renderRow(row, !!options.showSource)));
  }

  function summaryOf(groups) {
    const totals = new Map();
    (groups || []).forEach((group) => {
      if (group?.id === "total" || group?.name === "合计") return;
      (group.rows || []).forEach((row) => {
        const name = String(row.name || "");
        if (!name) return;
        totals.set(name, (totals.get(name) || 0) + (Number(row.count) || 0));
      });
    });
    if (!totals.size) {
      (groups || []).forEach((group) => {
        (group.rows || []).forEach((row) => {
          const name = String(row.name || "");
          if (!name) return;
          totals.set(name, (totals.get(name) || 0) + (Number(row.count) || 0));
        });
      });
    }
    const kinds = totals.size;
    let pieces = 0;
    totals.forEach((count) => {
      pieces += count;
    });
    return { kinds, pieces, totals };
  }

  function renderPayload(data) {
    const title = document.getElementById("materialLedgerTitle");
    const summary = document.getElementById("materialLedgerSummary");
    const body = document.getElementById("materialLedgerBody");
    if (title) title.textContent = data?.title || "材料清单";
    const stats = summaryOf(data?.groups || []);
    if (summary) summary.textContent = stats.kinds ? `${stats.kinds} 种 · 共 ${stats.pieces} 件` : "还没有材料";
    if (!body) return;
    body.replaceChildren();
    const groups = (data?.groups || []).filter((group) => (group.rows || []).length);
    if (!groups.length) {
      const empty = document.createElement("p");
      empty.className = "material-ledger-empty";
      empty.textContent = "当前没有可统计的材料。";
      body.appendChild(empty);
      return;
    }
    groups.forEach((group) => {
      const wrap = document.createElement("section");
      wrap.className = "ledger-group";
      const head = document.createElement("h3");
      head.className = "ledger-group-title";
      head.textContent = group.name || "材料";
      wrap.appendChild(head);
      sortRows(group.rows).forEach((row) => wrap.appendChild(renderRow(row, true)));
      body.appendChild(wrap);
    });
  }

  function open(data) {
    ensureDom();
    bind();
    payload = data || { title: "材料清单", groups: [] };
    renderPayload(payload);
    const modal = document.getElementById("dlgMaterialLedger");
    global.MobileWorkspace?.openLayer(modal, document.activeElement);
    document.getElementById("btnMaterialLedgerExport")?.focus({ preventScroll: true });
  }

  function canvasPngBase64(image) {
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const width = image.naturalWidth || image.width || size;
    const height = image.naturalHeight || image.height || size;
    const scale = Math.min(size / Math.max(1, width), size / Math.max(1, height));
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
    return canvas.toDataURL("image/png").split(",", 2)[1] || "";
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  async function iconData(url, cache) {
    if (!url) return "";
    if (cache.has(url)) return cache.get(url);
    const pending = loadImage(url).then((image) => (image ? canvasPngBase64(image) : ""));
    cache.set(url, pending);
    return pending;
  }

  async function exportExcel(data = payload) {
    if (!data || exporting) return;
    const exportBtn = document.getElementById("btnMaterialLedgerExport");
    exporting = true;
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = "正在导出…";
    }
    try {
      const cache = new Map();
      const groups = [];
      for (const group of data.groups || []) {
        const rows = [];
        for (const row of group.rows || []) {
          rows.push({
            name: row.name,
            count: Number(row.count) || 0,
            source: row.source || group.name || "",
            icon: await iconData(row.iconUrl, cache),
          });
        }
        groups.push({ name: group.name || "材料", rows });
      }
      const response = await fetch("/api/export-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title || "材料清单",
          filename: data.filename || data.title || "材料清单",
          groups,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `导出失败 (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const rawName = String(data.filename || data.title || "材料清单").replace(/[\\/:*?"<>|]+/g, "");
      link.href = url;
      link.download = rawName.endsWith(".xlsx") ? rawName : `${rawName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      exporting = false;
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.textContent = "导出 Excel";
      }
    }
  }

  function bind() {
    if (bound) return;
    const modal = ensureDom();
    bound = true;
    document.getElementById("btnMaterialLedgerClose")?.addEventListener("click", close);
    document.getElementById("btnMaterialLedgerDismiss")?.addEventListener("click", close);
    document.getElementById("btnMaterialLedgerExport")?.addEventListener("click", () => {
      exportExcel().catch((error) => {
        if (typeof global.appAlert === "function") {
          global.appAlert(error.message || String(error), { title: "导出失败" });
        } else {
          window.alert(error.message || String(error));
        }
      });
    });
    modal.addEventListener("pointerdown", (event) => {
      if (event.target === modal) close();
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (!isOpen() || event.key !== "Escape") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      },
      true
    );
  }

  global.MaterialLedger = Object.freeze({
    bind,
    open,
    close,
    isOpen,
    fillList,
    renderRow,
    sortRows,
    summaryOf,
    exportExcel,
  });
})(window);
