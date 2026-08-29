const DESIGN_W = 570;
const DESIGN_H = 550;
const CATEGORY_ORDER = ["套件", "装饰", "门窗", "地面", "屋顶", "墙壁"];

const state = {
  catalog: null,
  uidCatalog: null,
  packs: [],
  pack: null,
  category: "套件",
  component: null,
  base: null,
  records: [],
  source: null,
  selected: -1,
  dragging: null,
  images: new Map(),
  history: [],
};

const canvas = document.getElementById("buildingView");
const ctx = canvas.getContext("2d");

async function bootBuilding() {
  const [catalog, uidCatalog] = await Promise.all([
    fetch("/api/editor-catalog").then((response) => response.json()),
    fetch("/data/building_uid_map.json")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .catch(() => ({ packs: [] })),
  ]);
  state.catalog = catalog;
  state.uidCatalog = uidCatalog;
  state.packs = catalog.building.packs.filter((pack) => pack.kind === "theme");
  state.pack = state.packs[0] || null;
  state.base = catalog.building.bases.find((base) => base.kind === 0) || catalog.building.bases[0];
  bindBuilding();
  fillThemes();
  fillCategories();
  fillComponents();
  fillBases();
  updateBase();
  scaleBuilding();
  renderBuilding();
}

function scaleBuilding() {
  const element = document.getElementById("buildingScale");
  const scale = Math.min(window.innerWidth / 800, window.innerHeight / 600);
  element.style.zoom = String(Math.max(0.1, scale));
}

function uidPack() {
  return (state.uidCatalog.packs || []).find((pack) => pack.pack === state.pack?.key);
}

function componentUid(componentId) {
  const component = state.pack?.components.find((row) => row.id === componentId);
  return component?.kind === "sprite" ? componentId : null;
}

function componentByUid(uid, pack = state.pack) {
  const direct = pack?.components.find(
    (component) => component.kind === "sprite" && component.id === uid
  );
  if (direct) return direct;
  const solved = (state.uidCatalog.packs || []).find((row) => row.pack === pack?.key);
  const componentId = solved?.mapping?.[String(uid)]?.componentId;
  return pack?.components.find((component) => component.id === componentId) || null;
}

function spriteUrl(component, pack = state.pack, frame = 0) {
  if (!component || component.kind !== "sprite" || !component.file) return "";
  const path = `/bdesign/ale/${pack.kind === "item" ? "item" : "res"}/${encodeURIComponent(pack.key)}/${component.file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}.png`;
  const frameCount = Math.max(1, component.asset?.frames || 1);
  return `${path}?f=${Math.max(0, Number(frame) || 0) % frameCount}`;
}

function buildingBaseUrl(base) {
  if (!base?.baseImage) return "";
  const path = base.baseImage
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/bdesign/imgs/${path}.png?f=0`;
}

function loadImage(url) {
  if (!url) return null;
  if (state.images.has(url)) return state.images.get(url);
  const image = new Image();
  image.onload = renderBuilding;
  image.src = url;
  state.images.set(url, image);
  return image;
}

function fillThemes() {
  const list = document.getElementById("themeList");
  list.innerHTML = "";
  state.packs.forEach((pack) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = pack.name;
    button.className = pack === state.pack ? "on" : "";
    button.onclick = () => {
      state.pack = pack;
      state.component = null;
      fillThemes();
      fillComponents();
      renderBuilding();
    };
    list.appendChild(button);
  });
}

function fillCategories() {
  const list = document.getElementById("componentKinds");
  list.innerHTML = "";
  CATEGORY_ORDER.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category;
    button.className = category === state.category ? "on" : "";
    button.onclick = () => {
      state.category = category;
      state.component = null;
      fillCategories();
      fillComponents();
    };
    list.appendChild(button);
  });
}

function fillComponents() {
  const list = document.getElementById("componentList");
  list.innerHTML = "";
  if (!state.pack) return;
  const components = state.pack.components.filter(
    (component) => component.category === state.category
  );
  components.forEach((component) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "component-card" + (component === state.component ? " on" : "");
    const image = document.createElement("img");
    if (component.kind === "sprite") image.src = spriteUrl(component);
    const label = document.createElement("span");
    const uid = componentUid(component.id);
    label.textContent = component.id + (component.kind === "kit" ? " · 套件" : uid == null ? " · 缺失" : "");
    button.title =
      `${component.category} ${component.id}\n` +
      component.materials.map((item) => `${item.name}×${item.count}`).join(" ");
    button.append(image, label);
    button.onclick = () => {
      state.component = component;
      document.getElementById("selectedComponent").textContent =
        `${state.pack.name} / ${component.category} ${component.id}`;
      updateCurrentMaterials(component);
      fillComponents();
    };
    list.appendChild(button);
  });
}

function fillBases() {
  const list = document.getElementById("baseDialogList");
  list.innerHTML = "";
  state.catalog.building.bases.forEach((base) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "base-card";
    const image = document.createElement("img");
    image.src = buildingBaseUrl(base);
    const label = document.createElement("span");
    label.textContent = `${base.name} ${base.footprint?.join("×") || ""}`;
    button.append(image, label);
    button.onclick = () => {
      state.base = base;
      document.getElementById("baseDialog").hidden = true;
      updateBase();
      renderBuilding();
    };
    list.appendChild(button);
  });
}

function updateBase() {
  const base = state.base;
  if (!base) return;
  document.getElementById("currentBase").textContent = base.name;
  document.getElementById("buildingName").textContent = base.name;
  document.getElementById("buildingPut").textContent = base.footprint?.join("×") || "0×0";
  document.getElementById("buildingSpace").textContent = base.insideSpace || "0";
  document.getElementById("buildingOutside").textContent = base.outsideSpace || "0";
  const materialText = base.baseMaterials
    .map((item) => `${item.name}×${item.count}`)
    .join("　");
  document.getElementById("allMaterials").textContent = materialText;
  const preview = buildingBaseUrl(base);
  if (preview) loadImage(preview);
}

function updateCurrentMaterials(component) {
  document.getElementById("currentMaterials").textContent = component
    ? component.materials.map((item) => `${item.name}×${item.count}`).join("　")
    : "";
}

function rawXToCanvas(raw) {
  return raw;
}

function canvasXToRaw(x) {
  return Math.max(0, Math.min(0x7fff, Math.round(x)));
}

function frameGeometry(component, stateValue = 0) {
  const frames = component?.asset?.frameTable || [];
  const frame = frames.length ? frames[Math.max(0, Number(stateValue) || 0) % frames.length] : null;
  return {
    width: frame?.width || component?.asset?.width || 0,
    height: frame?.height || component?.asset?.height || 0,
  };
}

function recordBox(record) {
  const component = record.component || componentByUid(record.mat, record.pack || state.pack);
  const geometry = frameGeometry(component, record.state ?? record.flip ?? 0);
  return {
    x: rawXToCanvas(record.x),
    y: record.y,
    width: geometry.width,
    height: geometry.height,
    hotX: rawXToCanvas(record.x),
    hotY: record.y,
  };
}

function drawBase() {
  const background = loadImage("/bdesign/imgs/glsbg.gif");
  const pattern =
    background?.complete && background.naturalWidth ? ctx.createPattern(background, "repeat") : null;
  ctx.fillStyle = pattern || "#0a1519";
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  const base = state.base;
  const src = buildingBaseUrl(base);
  if (!src) return;
  const image = loadImage(src);
  if (!image?.complete || !image.naturalWidth) return;
  const frame = base?.assets?.baseImage?.frameTable?.[0];
  const x = Number.isFinite(frame?.valueA)
    ? frame.valueA
    : Math.round((DESIGN_W - image.naturalWidth) / 2);
  const y = Number.isFinite(frame?.valueB)
    ? frame.valueB
    : Math.max(52, DESIGN_H - image.naturalHeight - 16);
  ctx.drawImage(image, x, y);
}

function renderBuilding() {
  ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
  drawBase();
  state.records.forEach((record, index) => {
    const component = record.component || componentByUid(record.mat, record.pack || state.pack);
    const pack = record.pack || state.pack;
    const url = spriteUrl(component, pack, record.state ?? record.flip ?? 0);
    const image = loadImage(url);
    const box = recordBox({ ...record, component, pack });
    if (image?.complete && image.naturalWidth) {
      ctx.drawImage(image, box.x, box.y);
    } else {
      ctx.fillStyle = "#d75d44";
      ctx.fillRect(box.hotX - 4, box.hotY - 4, 8, 8);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(record.mat), box.hotX + 6, box.hotY);
    }
    if (index === state.selected) {
      ctx.strokeStyle = "#ffed4a";
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(box.x - 1, box.y - 1, Math.max(8, box.width + 2), Math.max(8, box.height + 2));
      ctx.setLineDash([]);
    }
  });
  updateAllMaterials();
}

function updateAllMaterials() {
  const totals = new Map();
  (state.base?.baseMaterials || []).forEach((item) => totals.set(item.name, item.count));
  state.records.forEach((record) => {
    const component = record.component || componentByUid(record.mat, record.pack || state.pack);
    (component?.materials || []).forEach((item) => {
      totals.set(item.name, (totals.get(item.name) || 0) + item.count);
    });
  });
  document.getElementById("allMaterials").textContent = [...totals]
    .map(([name, count]) => `${name}×${count}`)
    .join("　");
}

function hitRecord(x, y) {
  for (let index = state.records.length - 1; index >= 0; index--) {
    const box = recordBox(state.records[index]);
    if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
      return index;
    }
  }
  return -1;
}

function pushHistory() {
  state.history.push(JSON.stringify(state.records));
  if (state.history.length > 50) state.history.shift();
}

function addComponent(x, y) {
  if (!state.component) return;
  if (state.component.kind === "kit") {
    addKitComponent(state.component, x, y);
    return;
  }
  const uid = componentUid(state.component.id);
  if (uid == null) {
    alert("原版素材表中没有这个组件对应的图像记录。");
    return;
  }
  pushHistory();
  state.records.push({
    mode: "desk",
    x: canvasXToRaw(x),
    y: Math.round(y),
    mat: uid,
    state: 0,
    component: state.component,
    pack: state.pack,
  });
  state.selected = state.records.length - 1;
  renderBuilding();
}

function addKitComponent(kit, x, y) {
  let parsed;
  try {
    parsed = parseV1(kit.paper);
  } catch (error) {
    alert("套件图纸解析失败：" + (error.message || error));
    return;
  }
  const records = parsed.records
    .map((record) => ({
      ...record,
      mode: "desk",
      component: componentByUid(record.mat),
      pack: state.pack,
    }))
    .filter((record) => record.component);
  if (!records.length) {
    alert("套件没有可用的原版组件。");
    return;
  }

  const boxes = records.map(recordBox);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const dx = x - (left + right) / 2;
  const dy = y - (top + bottom) / 2;
  const group = `${Date.now()}-${state.records.length}`;

  pushHistory();
  records.forEach((record) => {
    record.x = canvasXToRaw(rawXToCanvas(record.x) + dx);
    record.y = Math.max(0, Math.min(0x7fff, Math.round(record.y + dy)));
    record.group = group;
    state.records.push(record);
  });
  state.selected = state.records.length - 1;
  renderBuilding();
}

function runLayerCommand(command) {
  const index = state.selected;
  if (index < 0 || index >= state.records.length) return;
  pushHistory();
  const [record] = state.records.splice(index, 1);
  if (command === "delete") {
    state.selected = -1;
  } else if (command === "bottom") {
    state.records.unshift(record);
    state.selected = 0;
  } else if (command === "top") {
    state.records.push(record);
    state.selected = state.records.length - 1;
  } else if (command === "down") {
    const target = Math.max(0, index - 1);
    state.records.splice(target, 0, record);
    state.selected = target;
  } else if (command === "up") {
    const target = Math.min(state.records.length, index + 1);
    state.records.splice(target, 0, record);
    state.selected = target;
  } else if (command === "flip") {
    const component = record.component || componentByUid(record.mat, record.pack || state.pack);
    const frameCount = Math.max(1, component?.asset?.frames || 1);
    record.state = ((record.state ?? record.flip ?? 0) + 1) % frameCount;
    delete record.flip;
    state.records.splice(index, 0, record);
    state.selected = index;
  } else {
    state.records.splice(index, 0, record);
    alert("套件拆散只对原版 6xx 套件有效；当前对象已经是独立组件。");
  }
  renderBuilding();
}

async function importDesign(file) {
  const response = await fetch("/api/parse-building-desk", {
    method: "POST",
    body: await file.arrayBuffer(),
  });
  if (!response.ok) throw new Error("建筑图纸解析失败 (" + response.status + ")");
  const documentData = await response.json();
  pushHistory();
  state.source = documentData._source || null;
  state.records = documentData.records.map((record) => ({
    ...record,
    component: componentByUid(record.mat),
    pack: state.pack,
  }));
  state.selected = -1;
  renderBuilding();
}

async function exportDesign() {
  const payload = {
    kind: "desk",
    records: state.records.map(({ component, pack, ...record }) => record),
    _source: state.source,
  };
  const response = await fetch("/api/format-building", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("建筑图纸生成失败 (" + response.status + ")");
  const blob = await response.blob();
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "build.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function bindBuilding() {
  window.addEventListener("resize", scaleBuilding);
  document.getElementById("btnChooseBase").onclick = () => {
    document.getElementById("baseDialog").hidden = false;
  };
  document.getElementById("btnBaseDialogClose").onclick = () => {
    document.getElementById("baseDialog").hidden = true;
  };
  document.getElementById("btnImportDesign").onclick = () => {
    document.getElementById("buildingFile").click();
  };
  document.getElementById("buildingFile").onchange = async (event) => {
    if (!event.target.files[0]) return;
    try {
      await importDesign(event.target.files[0]);
    } catch (error) {
      alert(error.message || String(error));
    }
    event.target.value = "";
  };
  document.getElementById("btnSaveDesign").onclick = () => {
    exportDesign().catch((error) => alert(error.message || String(error)));
  };
  document.getElementById("btnMakeBuilding").onclick = () => {
    exportDesign().catch((error) => alert(error.message || String(error)));
  };
  document.querySelectorAll(".layer-tools button").forEach((button) => {
    button.onclick = () => runLayerCommand(button.dataset.command);
  });
  canvas.onmousedown = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const hit = hitRecord(x, y);
    if (hit >= 0) {
      state.selected = hit;
      const record = state.records[hit];
      state.dragging = { x, y, rawX: record.x, rawY: record.y };
      renderBuilding();
    } else {
      addComponent(x, y);
    }
  };
  canvas.onmousemove = (event) => {
    if (!state.dragging || state.selected < 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const record = state.records[state.selected];
    record.x = canvasXToRaw(rawXToCanvas(state.dragging.rawX) + x - state.dragging.x);
    record.y = Math.max(
      0,
      Math.min(0x7fff, Math.round(state.dragging.rawY + y - state.dragging.y))
    );
    renderBuilding();
  };
  window.addEventListener("mouseup", () => {
    state.dragging = null;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Delete") runLayerCommand("delete");
    if (event.key.toLowerCase() === "f") runLayerCommand("flip");
    if (event.ctrlKey && event.key.toLowerCase() === "z" && state.history.length) {
      state.records = JSON.parse(state.history.pop());
      state.selected = -1;
      renderBuilding();
    }
  });
}

bootBuilding().catch((error) => {
  console.error(error);
  alert("建筑设计桌启动失败：" + (error.message || error));
});
