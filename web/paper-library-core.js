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
    const bytes = new TextEncoder().encode(String(data || ""));
    const digest = await crypto.subtle.digest("SHA-1", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
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
      const paperBytes = String(paper.name || "").length * 3 + String(paper.data || "").length + 64;
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

  async function putThumb(id, blob) {
    if (!id || !blob) return false;
    const response = await fetch(`${API}/${encodeURIComponent(id)}/thumb`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    });
    return response.ok;
  }

  function canvasToJpegBlob(canvas, quality = 0.72) {
    return new Promise((resolve) => {
      if (!canvas?.toBlob) {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    });
  }

  const SORT_STORAGE_KEY = "manor-paper-library-sort";

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

  function entryFromIndex(paper) {
    const name = String(paper?.name || "图纸.txt");
    const kind = resolvePaperKind(paper);
    return {
      id: paper?.id || "",
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
      kind: paper.kind,
      group: paper.group || "",
      data: paper.data,
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
    clearLibrary,
    parseSortValue,
    sortValue,
    loadPaperSort,
    savePaperSort,
    comparePaperEntries,
    sortedPaperEntries,
    reorderPaperCards,
    bindPaperSortSelect,
  };
})(window);
