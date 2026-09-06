(function (global) {
  const API = "/api/saves/building/papers";
  const MAX_BATCH_BYTES = 6 * 1024 * 1024;

  function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function contentIdFromBase64(data) {
    const text = String(data || "");
    if (global.crypto?.subtle && global.TextEncoder) {
      const bytes = new TextEncoder().encode(text);
      const digest = await global.crypto.subtle.digest("SHA-1", bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
    }
    // crypto.subtle is unavailable on plain HTTP in Safari/Chrome. Keep imports
    // working on the deployed IP with a deterministic 96-bit fallback ID.
    const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b];
    const hashes = seeds.map((seed, lane) => {
      let hash = seed >>> 0;
      for (let i = lane; i < text.length; i += 3) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
        hash ^= hash >>> 13;
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    });
    return hashes.join("");
  }

  function sniffKind(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const headN = Math.min(view.length, 24);
    let offset = 0;
    if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) offset = 3;
    while (offset < headN && (view[offset] === 0x20 || view[offset] === 0x09 || view[offset] === 0x0d || view[offset] === 0x0a)) {
      offset += 1;
    }
    if ((view[offset] === 0x56 || view[offset] === 0x76) && view[offset + 1] === 0x31 && view[offset + 2] === 0x3b) {
      return "v1";
    }
    if (looksLikeTerrainPaper(view, offset)) return "terrain";
    return "unknown";
  }

  function looksLikeTerrainPaper(view, offset = 0) {
    const start = Math.max(0, offset);
    const probe = Math.min(view.length, Math.max(start + 24, 400));
    for (let i = start; i < probe; i++) {
      if (view[i] === 0xc4 && view[i + 1] === 0xa3 && view[i + 2] === 0xb0 && view[i + 3] === 0xe5) return true;
      if (
        view[i] === 0xe6 && view[i + 1] === 0xa8 && view[i + 2] === 0xa1
        && view[i + 3] === 0xe6 && view[i + 4] === 0x9d && view[i + 5] === 0xbf
      ) return true;
    }
    const take = (from, to) => {
      let text = "";
      for (let i = from; i < to; i++) text += String.fromCharCode(view[i]);
      return text;
    };
    const head = take(0, Math.min(view.length, 400));
    if (head.includes("size=") || head.includes("mapflag=") || head.includes("模板")) return true;
    if (view.length > 400) {
      const tail = take(Math.max(0, view.length - 160), view.length);
      if (tail.includes("size=") && tail.includes("mapflag=")) return true;
    }
    return false;
  }

  function kindLabel(kind) {
    if (kind === "desk") return "建筑图纸";
    if (kind === "terrain") return "地形图纸";
    if (kind === "manor") return "庄园图纸";
    return "图纸";
  }

  function resolvePaperKind(item) {
    const kind = String(item?.kind || "").trim();
    if (kind === "desk" || kind === "terrain" || kind === "manor") return kind;
    const meta = String(item?.meta || "");
    if (/地块/.test(meta)) return "terrain";
    if (/庄园/.test(meta)) return "manor";
    return "desk";
  }

  function kindMatchesFilter(kind, filter) {
    const resolved = resolvePaperKind({ kind });
    if (!filter || filter === "all") return true;
    if (filter === "desk") return resolved === "desk" || resolved === "manor";
    if (filter === "terrain") return resolved === "terrain";
    return resolved === filter;
  }

  async function parseFile(buffer) {
    const sniff = sniffKind(buffer);
    if (sniff === "terrain") {
      const response = await fetch("/api/parse-terrain", { method: "POST", body: buffer });
      if (!response.ok) throw new Error("地形图纸解析失败 (" + response.status + ")");
      const doc = await response.json();
      return { ...doc, kind: "terrain" };
    }
    const building = await fetch("/api/parse-building", { method: "POST", body: buffer });
    if (building.ok) return building.json();
    if (sniff === "v1") throw new Error("建筑图纸解析失败 (" + building.status + ")");
    const terrain = await fetch("/api/parse-terrain", { method: "POST", body: buffer });
    if (!terrain.ok) throw new Error("图纸解析失败");
    const doc = await terrain.json();
    return { ...doc, kind: "terrain" };
  }

  async function persist(uploads, { replace = false, groups } = {}) {
    const papers = Array.isArray(uploads) ? uploads : [];
    const batches = [];
    let batch = [];
    let batchBytes = 32;
    papers.forEach((paper) => {
      const extras = JSON.stringify({
        deskLayers: paper.deskLayers,
        deskDocument: paper.deskDocument,
        terrainDocument: paper.terrainDocument,
      });
      const extrasBytes = global.TextEncoder
        ? new TextEncoder().encode(extras).byteLength
        : extras.length * 3;
      const paperBytes =
        String(paper.name || "").length * 3
        + String(paper.data || "").length
        + extrasBytes
        + 256;
      if (paperBytes > MAX_BATCH_BYTES) {
        throw new Error("图纸项目过大，无法安全同步到图纸库。");
      }
      if (batch.length && batchBytes + paperBytes > MAX_BATCH_BYTES) {
        batches.push(batch);
        batch = [];
        batchBytes = 32;
      }
      batch.push(paper);
      batchBytes += paperBytes;
    });
    if (batch.length) batches.push(batch);
    if (!batches.length) {
      const response = await fetch(API, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: !!replace, papers: [], groups }),
      });
      if (!response.ok) throw new Error(`图纸库同步失败 (${response.status})`);
      return Number((await response.json())?.saved || 0);
    }
    let saved = 0;
    for (const [index, chunk] of batches.entries()) {
      const payload = { replace: replace && index === 0, papers: chunk };
      if (groups && index === batches.length - 1) payload.groups = groups;
      const response = await fetch(API, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`图纸库同步失败 (${response.status})`);
      saved += Number((await response.json())?.saved || 0);
    }
    return saved;
  }

  async function fetchLibrary() {
    const response = await fetch(API, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`读取图纸库失败 (${response.status})`);
    const data = await response.json();
    return {
      papers: Array.isArray(data?.papers) ? data.papers : [],
      groups: Array.isArray(data?.groups) ? data.groups : [],
    };
  }

  async function fetchPaper(id) {
    const response = await fetch(`${API}/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`读取图纸失败 (${response.status})`);
    return response.json();
  }

  function thumbUrl(id, stamp) {
    const query = stamp ? `?t=${encodeURIComponent(stamp)}` : "";
    return `${API}/${encodeURIComponent(id)}/thumb${query}`;
  }

  async function putThumb(id, blob, revision = "") {
    if (!id || !blob) return false;
    const headers = { "Content-Type": blob.type || "image/jpeg" };
    if (revision) headers["X-Paper-Revision"] = revision;
    const response = await fetch(`${API}/${encodeURIComponent(id)}/thumb`, {
      method: "PUT",
      credentials: "same-origin",
      headers,
      body: blob,
    });
    return response.ok;
  }

  function canvasToJpegBlob(canvas, quality = 0.72, maxWidth = 480, maxHeight = 320) {
    return new Promise((resolve) => {
      if (!canvas?.toBlob) {
        resolve(null);
        return;
      }
      let output = canvas;
      const scale = Math.min(
        1,
        maxWidth / Math.max(1, Number(canvas.width) || 1),
        maxHeight / Math.max(1, Number(canvas.height) || 1)
      );
      if (scale < 1 && global.document?.createElement) {
        output = global.document.createElement("canvas");
        output.width = Math.max(1, Math.round(canvas.width * scale));
        output.height = Math.max(1, Math.round(canvas.height * scale));
        const context = output.getContext("2d");
        context.imageSmoothingEnabled = true;
        if (context.imageSmoothingQuality) context.imageSmoothingQuality = "high";
        context.drawImage(canvas, 0, 0, output.width, output.height);
      }
      output.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    });
  }

  const SORT_STORAGE_KEY = "manor-paper-library-sort";

  function parsePaperNameDate(name) {
    const stem = String(name || "").replace(/\\/g, "/").replace(/\.txt$/i, "");
    const valid = (year, month, day) => {
      const y = Number(year);
      const mo = Number(month);
      const d = Number(day);
      if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
      const stamp = Date.UTC(y, mo - 1, d);
      const check = new Date(stamp);
      if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
        return 0;
      }
      return stamp;
    };
    const labeled = stem.match(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (labeled) return valid(labeled[1], labeled[2], labeled[3]);
    const separated = stem.match(/((?:19|20)\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/);
    if (separated) return valid(separated[1], separated[2], separated[3]);
    const compactTail = stem.match(/((?:19|20)\d{2})\s*[.\-/]\s*(\d{3,4})(?!\d)/);
    if (compactTail) {
      const digits = compactTail[2];
      if (digits.length === 3) return valid(compactTail[1], digits.slice(0, 1), digits.slice(1));
      return valid(compactTail[1], digits.slice(0, 2), digits.slice(2));
    }
    const packed = stem.match(/((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
    if (packed) return valid(packed[1], packed[2], packed[3]);
    return 0;
  }

  function parseSortValue(value) {
    const [keyRaw, dirRaw] = String(value || "savedAt:desc").split(":");
    return {
      key: keyRaw === "name" ? "name" : "savedAt",
      dir: dirRaw === "asc" ? "asc" : "desc",
    };
  }

  function sortValue(sort) {
    const parsed = parseSortValue(`${sort?.key || "savedAt"}:${sort?.dir || "desc"}`);
    return `${parsed.key}:${parsed.dir}`;
  }

  function loadPaperSort() {
    try {
      return parseSortValue((global.deskGet || ((key) => global.localStorage?.getItem(key)))(SORT_STORAGE_KEY));
    } catch (error) {
      return parseSortValue("");
    }
  }

  function savePaperSort(sort) {
    try {
      (global.deskSet || ((key, value) => global.localStorage?.setItem(key, value)))(SORT_STORAGE_KEY, sortValue(sort));
    } catch (error) {}
  }

  function comparePaperEntries(a, b, sort) {
    const parsed = parseSortValue(sortValue(sort || loadPaperSort()));
    const dir = parsed.dir === "asc" ? 1 : -1;
    const nameCmp = String(a?.name || "").localeCompare(String(b?.name || ""), "zh", {
      numeric: true,
      sensitivity: "base",
    });
    const timeCmp = (Number(a?.savedAt) || 0) - (Number(b?.savedAt) || 0);
    if (parsed.key === "name") {
      if (nameCmp) return nameCmp * dir;
      return timeCmp;
    }
    const aDate = parsePaperNameDate(a?.name);
    const bDate = parsePaperNameDate(b?.name);
    if (aDate && bDate && aDate !== bDate) return (aDate - bDate) * dir;
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    if (timeCmp) return timeCmp * dir;
    return nameCmp;
  }

  function sortedPaperEntries(entries, sort) {
    return [...(entries || [])].sort((left, right) => comparePaperEntries(left, right, sort));
  }

  function escapeAttr(value) {
    const text = String(value || "");
    if (global.CSS?.escape) return CSS.escape(text);
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function reorderPaperCards(grid, entries, sort) {
    if (!grid) return;
    sortedPaperEntries(entries, sort).forEach((entry) => {
      const id = String(entry?.id || "");
      if (!id) return;
      const card = grid.querySelector(`.paper-preview-item[data-id="${escapeAttr(id)}"]`);
      if (card) grid.appendChild(card);
    });
  }

  function bindPaperSortSelect(onChange) {
    const select = global.document?.getElementById("paperLibrarySort");
    const current = loadPaperSort();
    if (!select) return current;
    select.value = sortValue(current);
    select.addEventListener("change", () => {
      savePaperSort(parseSortValue(select.value));
      if (typeof onChange === "function") onChange();
    });
    return current;
  }

  function paperNameStem(name) {
    return String(name || "").replace(/\.txt$/i, "");
  }

  function sanitizePaperFileName(raw) {
    let text = String(raw || "").replace(/\\/g, "/").trim();
    text = text.replace(/[<>:"|?*\u0000-\u001f]+/g, "");
    text = paperNameStem(text).replace(/\.+$/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
    return `${text || "图纸"}.txt`;
  }

  function sanitizePaperGroupName(raw) {
    return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function paperGroupById(groups, groupId) {
    const ident = String(groupId || "");
    if (!ident || ident === "all") return null;
    return (groups || []).find((group) => group && group.id === ident) || null;
  }

  function renamePaperGroup(groups, groupId, rawName) {
    const name = sanitizePaperGroupName(rawName);
    const current = paperGroupById(groups, groupId);
    if (!current || !name) return null;
    return (groups || []).map((group) => (group && group.id === current.id ? { ...group, name } : group));
  }

  function bindPaperGroupTab(button, tab, { selected = false, onSelect, onRename } = {}) {
    button.type = "button";
    button.textContent = tab.name;
    button.classList.toggle("on", !!selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    const canRename = tab.id !== "all" && typeof onRename === "function";
    if (canRename) {
      button.title = "点选筛选 · 双击重命名";
      button.setAttribute("aria-label", `${tab.name}，双击重命名`);
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRename(tab.id);
      });
    }
    button.addEventListener("click", () => {
      if (typeof onSelect === "function") onSelect(tab.id);
    });
    return button;
  }

  function syncPaperGroupRenameButton(groupFilter, groups) {
    const button = global.document?.getElementById("btnPaperLibraryRenameGroup");
    if (!button) return;
    const group = paperGroupById(groups, groupFilter);
    button.hidden = !group;
    if (group) {
      button.title = `重命名「${group.name}」`;
      button.setAttribute("aria-label", `重命名分组 ${group.name}`);
    }
  }

  function isPaperArchived(entry) {
    return !!entry?.archived;
  }

  function paperMatchesArchiveView(entry, archiveView) {
    return isPaperArchived(entry) === !!archiveView;
  }

  function countArchivedPapers(entries) {
    return (entries || []).filter(isPaperArchived).length;
  }

  function syncPaperArchiveButton(button, entry) {
    if (!button) return;
    const archived = isPaperArchived(entry);
    button.textContent = archived ? "恢复" : "归档";
    button.title = archived ? "从归档柜放回图纸库" : "收到归档柜，主列表不再显示";
    button.setAttribute("aria-label", `${button.textContent} ${entry?.name || "图纸"}`);
  }

  function syncPaperArchiveDoor({ archiveView = false, count = 0 } = {}) {
    const panel = global.document?.getElementById("paperLibrary");
    const door = global.document?.getElementById("btnPaperLibraryArchive");
    const countEl = global.document?.getElementById("paperArchiveCount");
    const label = door?.querySelector(".paper-archive-door-label");
    if (panel) panel.classList.toggle("is-archive", !!archiveView);
    if (countEl) {
      countEl.textContent = String(count || 0);
      countEl.hidden = !count;
    }
    if (label) label.textContent = archiveView ? "返回图纸库" : "归档柜";
    if (door) {
      door.hidden = !archiveView && !count;
      door.setAttribute("aria-pressed", archiveView ? "true" : "false");
      door.title = archiveView ? "返回图纸库" : "查看已归档图纸";
    }
    const batch = global.document?.getElementById("btnPaperLibraryBatchArchive");
    if (batch) batch.textContent = archiveView ? "恢复所选" : "归档所选";
  }

  function createPaperNameRow(entry, { onRename, onArchive } = {}) {
    const row = global.document.createElement("div");
    row.className = "paper-card-name";
    const name = global.document.createElement("strong");
    name.textContent = entry?.name || "图纸.txt";
    name.title = name.textContent;
    const rename = global.document.createElement("button");
    rename.type = "button";
    rename.className = "btn paper-card-rename";
    rename.textContent = "重命名";
    rename.title = "修改文件名";
    rename.setAttribute("aria-label", `重命名 ${name.textContent}`);
    rename.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onRename === "function") onRename(entry);
    });
    const archive = global.document.createElement("button");
    archive.type = "button";
    archive.className = "btn paper-card-archive";
    syncPaperArchiveButton(archive, entry);
    archive.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onArchive === "function") onArchive(entry);
    });
    row.append(name, rename, archive);
    return { row, name, rename, archive };
  }

  function paperSelectKey(entry) {
    return String(entry?.contentId || entry?.id || "");
  }

  function createPaperSelectControl(entry, { checked = false, onChange } = {}) {
    const label = global.document.createElement("label");
    label.className = "paper-card-select";
    const input = global.document.createElement("input");
    input.type = "checkbox";
    input.className = "paper-card-select-input";
    input.checked = !!checked;
    input.setAttribute("aria-label", `选择 ${entry?.name || "图纸"}`);
    const mark = global.document.createElement("span");
    mark.className = "paper-card-select-mark";
    mark.setAttribute("aria-hidden", "true");
    const stop = (event) => event.stopPropagation();
    label.addEventListener("click", stop);
    label.addEventListener("pointerdown", stop);
    input.addEventListener("change", () => {
      if (typeof onChange === "function") onChange(!!input.checked);
    });
    label.append(input, mark);
    return { label, input };
  }

  function entryFromIndex(paper) {
    const name = String(paper?.name || "图纸.txt");
    const kind = resolvePaperKind(paper);
    return {
      id: paper?.id || "",
      revision: paper?.revision || "",
      contentId: paper?.id || "",
      file: null,
      documentData: null,
      name,
      search: name.toLowerCase(),
      kind,
      groupId: paper?.group || "",
      count: Number(paper?.count) || 0,
      meta: String(paper?.meta || "") || kindLabel(paper?.kind),
      materials: new Map(),
      unresolved: Number(paper?.unresolved) || 0,
      savedAt: Number(paper?.savedAt) || 0,
      archived: !!paper?.archived,
      archivedAt: Number(paper?.archivedAt) || 0,
      hasThumb: !!paper?.hasThumb,
      thumbAt: Number(paper?.thumbAt) || 0,
      bytes: Number(paper?.bytes) || 0,
    };
  }

  function fileFromPaper(paper) {
    const bytes = base64ToBytes(paper.data);
    const file = new File([bytes], String(paper.name || "图纸.txt"));
    file.paperMeta = {
      id: paper.id,
      revision: paper.revision || "",
      kind: paper.kind,
      group: paper.group || "",
      data: paper.data,
      deskLayers: Array.isArray(paper.deskLayers) ? paper.deskLayers : [],
      deskDocument: paper.deskDocument && typeof paper.deskDocument === "object" ? paper.deskDocument : null,
      terrainDocument: paper.terrainDocument && typeof paper.terrainDocument === "object" ? paper.terrainDocument : null,
    };
    return { file, bytes, data: paper.data };
  }

  function createLazyLoader({ root = null, rootMargin = "180px 0px", concurrency = 2 } = {}) {
    const queue = [];
    let active = 0;
    const observer = new IntersectionObserver((items) => {
      items.forEach((item) => {
        if (!item.isIntersecting) return;
        observer.unobserve(item.target);
        const task = item.target._paperThumbTask;
        if (typeof task === "function") queue.push(task);
        pump();
      });
    }, { root, rootMargin });

    function pump() {
      while (active < concurrency && queue.length) {
        const task = queue.shift();
        active += 1;
        Promise.resolve()
          .then(task)
          .catch((error) => console.warn(error))
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    }

    return {
      watch(element, task) {
        if (!element || typeof task !== "function") return;
        element._paperThumbTask = task;
        observer.observe(element);
      },
      disconnect() {
        observer.disconnect();
        queue.length = 0;
      },
    };
  }

  function thumbLooksLikePlaceholder(image) {
    if (!image || !image.naturalWidth) return false;
    try {
      const width = 24;
      const height = 15;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      let green = 0;
      let blue = 0;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        seen.add((r >> 4 << 8) | (g >> 4 << 4) | (b >> 4));
        if (g > r + 8 && g > b && g < 160 && r < 90) green += 1;
        if (b > r + 8 && b >= g && b < 180 && r < 90) blue += 1;
      }
      const pixels = width * height;
      return (green > pixels * 0.72 || blue > pixels * 0.72) && seen.size < 22;
    } catch {
      return false;
    }
  }

  async function clearLibrary() {
    const response = await fetch(API, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error(`清空图纸库失败 (${response.status})`);
    return response.json();
  }

  global.PaperLibraryCore = {
    API,
    MAX_BATCH_BYTES,
    bytesToBase64,
    base64ToBytes,
    contentIdFromBase64,
    sniffKind,
    looksLikeTerrainPaper,
    kindLabel,
    resolvePaperKind,
    kindMatchesFilter,
    parseFile,
    persist,
    fetchLibrary,
    fetchPaper,
    thumbUrl,
    putThumb,
    canvasToJpegBlob,
    entryFromIndex,
    fileFromPaper,
    createLazyLoader,
    thumbLooksLikePlaceholder,
    clearLibrary,
    parsePaperNameDate,
    parseSortValue,
    sortValue,
    loadPaperSort,
    savePaperSort,
    comparePaperEntries,
    sortedPaperEntries,
    reorderPaperCards,
    bindPaperSortSelect,
    paperNameStem,
    sanitizePaperFileName,
    sanitizePaperGroupName,
    paperGroupById,
    renamePaperGroup,
    bindPaperGroupTab,
    syncPaperGroupRenameButton,
    isPaperArchived,
    paperMatchesArchiveView,
    countArchivedPapers,
    syncPaperArchiveButton,
    syncPaperArchiveDoor,
    createPaperNameRow,
    paperSelectKey,
    createPaperSelectControl,
  };
})(window);
