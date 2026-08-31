(function initBuildingPreview(global) {
  "use strict";

  const DESIGN_W = 570;
  const DESIGN_H = 550;
  const NATIVE_LAYER_W = 1690;
  const NATIVE_LAYER_H = 1030;
  const DEFAULT_GRASS = "/bdesign/imgs/glsbg.gif";
  const imageCache = new Map();
  let catalogPromise = null;

  function encodedPath(value) {
    return String(value || "").split("/").map(encodeURIComponent).join("/");
  }

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    imageCache.set(src, promise);
    return promise;
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = Promise.all([
        fetch("/api/editor-catalog").then((response) => {
          if (!response.ok) throw new Error(`素材目录读取失败 (${response.status})`);
          return response.json();
        }),
        fetch("/data/building_pack_uids.json").then((response) => {
          if (!response.ok) throw new Error(`建筑 UID 映射读取失败 (${response.status})`);
          return response.json();
        }),
      ]).then(([catalog, uidTable]) => ({
        catalog,
        bases: catalog.building?.bases || [],
        packs: new Map((catalog.building?.packs || []).map((pack) => [pack.key, pack])),
        mapping: uidTable.mapping || {},
        aliases: uidTable.aliases || {},
      }));
    }
    return catalogPromise;
  }

  function baseByNo(previewCatalog, baseNo) {
    const value = Number(baseNo);
    return (previewCatalog?.bases || []).find((base) => Number(base.no) === value) || null;
  }

  function resolveComponent(mat, previewCatalog, localPackKey = "") {
    const value = Math.max(0, Math.round(Number(mat) || 0));
    if (!value) return null;
    const local = value < 1000 ? value : value % 1000;
    const uid = value < 1000 ? 0 : Math.floor(value / 1000);
    const packKey = value < 1000
      ? localPackKey
      : previewCatalog.mapping[String(uid)] || previewCatalog.aliases[String(uid)] || "";
    const pack = previewCatalog.packs.get(packKey);
    if (!pack) return null;
    const component = (pack.components || []).find(
      (row) => row.kind === "sprite" && Number(row.id) === local
    );
    if (!component) return null;
    const stem = String(component.file || "").toLowerCase().replace(/\.ale$/, "");
    if (/^try\d+$/.test(stem)) return null;
    return { component, pack };
  }

  function spriteUrl(component, pack, stateValue = 0) {
    if (!component?.file || !pack) return "";
    const frameCount = Math.max(1, Number(component.asset?.frames) || 1);
    const frame = Math.max(0, Number(stateValue) || 0) % frameCount;
    const folder = pack.kind === "item" ? "item" : "res";
    return `/bdesign/ale/${folder}/${encodeURIComponent(pack.key)}/${encodedPath(component.file)}.png?f=${frame}`;
  }

  function baseImageUrl(base) {
    return base?.baseImage ? `/bdesign/imgs/${encodedPath(base.baseImage)}.png?f=0` : "";
  }

  function maskImageUrl(base) {
    if (!base?.maskImage) return "";
    const path = encodedPath(base.maskImage);
    return String(base.maskImage).toLowerCase().endsWith(".ale")
      ? `/bdesign/imgs/${path}.png?f=0`
      : `/bdesign/imgs/${path}`;
  }

  function frameGeometry(component, stateValue = 0) {
    const frames = component?.asset?.frameTable || [];
    const frame = frames.length
      ? frames[Math.max(0, Number(stateValue) || 0) % frames.length]
      : null;
    return {
      width: Number(frame?.width || component?.asset?.width || 0),
      height: Number(frame?.height || component?.asset?.height || 0),
    };
  }

  function opaqueBottomVertex(image, threshold = 32) {
    if (!image?.width || !image?.height) return null;
    const sheet = document.createElement("canvas");
    sheet.width = image.naturalWidth || image.width;
    sheet.height = image.naturalHeight || image.height;
    const ctx = sheet.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, sheet.width, sheet.height).data;
    } catch {
      return { x: Math.round(sheet.width / 2), y: sheet.height - 1 };
    }
    for (let y = sheet.height - 1; y >= 0; y -= 1) {
      let left = -1;
      let right = -1;
      const row = y * sheet.width * 4;
      for (let x = 0; x < sheet.width; x += 1) {
        const index = row + x * 4;
        const cover =
          (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) * pixels[index + 3]) / 255;
        if (cover < threshold) continue;
        if (left < 0) left = x;
        right = x;
      }
      if (left >= 0) return { x: (left + right) >> 1, y };
    }
    return null;
  }

  function floorSnugInMask(floor, mask) {
    const floorWidth = floor?.naturalWidth || floor?.width || 0;
    const floorHeight = floor?.naturalHeight || floor?.height || 0;
    const maskWidth = mask?.naturalWidth || mask?.width || floorWidth;
    const maskHeight = mask?.naturalHeight || mask?.height || floorHeight;
    const maskBottom = opaqueBottomVertex(mask, 32);
    const floorBottom = opaqueBottomVertex(floor, 96);
    if (maskBottom && floorBottom) {
      return { x: maskBottom.x - floorBottom.x, y: maskBottom.y - floorBottom.y };
    }
    return {
      x: Math.round((maskWidth - floorWidth) / 2),
      y: Math.max(0, maskHeight - floorHeight),
    };
  }

  function nativeHalfDelta(a, b) {
    return Math.trunc((Number(a) - Number(b)) / 2);
  }

  function nativeMaskOriginForLayer(layerW, layerH, maskW, maskH) {
    return {
      x: nativeHalfDelta(layerW, maskW || 0),
      y: nativeHalfDelta(layerH, maskH || 0),
    };
  }

  function nativePaperFloorOrigin(base, maskOrigin) {
    const anchor = base?.anchor;
    const frame = base?.assets?.baseImage?.frameTable?.[0];
    if (
      !maskOrigin ||
      !Array.isArray(anchor) ||
      !Number.isFinite(Number(anchor[0])) ||
      !Number.isFinite(Number(anchor[1])) ||
      !Number.isFinite(Number(frame?.anchorX)) ||
      !Number.isFinite(Number(frame?.anchorY))
    ) return null;
    return {
      x: maskOrigin.x + Number(anchor[0]) + Number(frame.anchorX),
      y: maskOrigin.y + Number(anchor[1]) + Number(frame.anchorY),
    };
  }

  function alphaBounds(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let data;
    try {
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    }
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      const row = y * canvas.width * 4;
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[row + x * 4 + 3] < 2) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) {
      return { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    }
    return { left, top, right: right + 1, bottom: bottom + 1 };
  }

  function colorDistanceSq(data, offset, color) {
    const dr = data[offset] - color[0];
    const dg = data[offset + 1] - color[1];
    const db = data[offset + 2] - color[2];
    return dr * dr + dg * dg + db * db;
  }

  function dominantOpaqueBorder(data, width, height) {
    const buckets = new Map();
    let opaque = 0;
    const add = (x, y) => {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 245) return;
      opaque += 1;
      const key = `${data[offset] >> 4},${data[offset + 1] >> 4},${data[offset + 2] >> 4}`;
      let row = buckets.get(key);
      if (!row) {
        row = { count: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, row);
      }
      row.count += 1;
      row.r += data[offset];
      row.g += data[offset + 1];
      row.b += data[offset + 2];
    };
    for (let x = 0; x < width; x += 1) {
      add(x, 0);
      if (height > 1) add(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      add(0, y);
      if (width > 1) add(width - 1, y);
    }
    const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    if (!best || opaque < Math.max(8, (width + height) * 0.8) || best.count / opaque < 0.68) return null;
    return {
      color: [best.r / best.count, best.g / best.count, best.b / best.count],
      confidence: best.count / opaque,
    };
  }

  function removeConnectedBackground(imageData, width, height, tolerance = 38) {
    const data = imageData.data;
    const sample = dominantOpaqueBorder(data, width, height);
    if (!sample) return 0;
    const threshold = tolerance * tolerance * 3;
    const seen = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let read = 0;
    let write = 0;
    const enqueue = (x, y) => {
      const index = y * width + x;
      if (seen[index]) return;
      const offset = index * 4;
      if (data[offset + 3] < 2 || colorDistanceSq(data, offset, sample.color) > threshold) return;
      seen[index] = 1;
      queue[write++] = index;
    };
    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      if (height > 1) enqueue(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(0, y);
      if (width > 1) enqueue(width - 1, y);
    }
    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) enqueue(x - 1, y);
      if (x + 1 < width) enqueue(x + 1, y);
      if (y > 0) enqueue(x, y - 1);
      if (y + 1 < height) enqueue(x, y + 1);
    }
    if (write < width * height * 0.025) return 0;
    for (let index = 0; index < seen.length; index += 1) {
      if (seen[index]) data[index * 4 + 3] = 0;
    }
    return write;
  }

  function prepareImageBitmap(image, options = {}) {
    const width = image?.naturalWidth || image?.width || 0;
    const height = image?.naturalHeight || image?.height || 0;
    if (!width || !height) return null;
    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const sourceCtx = source.getContext("2d", { willReadFrequently: true });
    sourceCtx.clearRect(0, 0, width, height);
    sourceCtx.drawImage(image, 0, 0, width, height);
    let removedBackground = 0;
    if (options.removeConnectedBackground !== false) {
      try {
        const imageData = sourceCtx.getImageData(0, 0, width, height);
        removedBackground = removeConnectedBackground(imageData, width, height, options.tolerance || 38);
        if (removedBackground) sourceCtx.putImageData(imageData, 0, 0);
      } catch {
        removedBackground = 0;
      }
    }
    if (!opaqueBottomVertex(source, 8)) return null;
    const bounds = alphaBounds(source);
    const bitmap = document.createElement("canvas");
    bitmap.width = Math.max(1, bounds.right - bounds.left);
    bitmap.height = Math.max(1, bounds.bottom - bounds.top);
    bitmap.getContext("2d").drawImage(
      source,
      bounds.left,
      bounds.top,
      bitmap.width,
      bitmap.height,
      0,
      0,
      bitmap.width,
      bitmap.height
    );
    const groundAnchor = opaqueBottomVertex(bitmap, 8) || {
      x: Math.round(bitmap.width / 2),
      y: bitmap.height - 1,
    };
    return { bitmap, groundAnchor, alphaBounds: bounds, removedBackground };
  }

  function drawMaskGrass(target, mask, grass, x, y) {
    if (!mask?.width) return;
    const layer = document.createElement("canvas");
    layer.width = mask.naturalWidth || mask.width;
    layer.height = mask.naturalHeight || mask.height;
    const ctx = layer.getContext("2d");
    if (grass?.width) {
      const width = grass.naturalWidth || grass.width;
      const height = grass.naturalHeight || grass.height;
      for (let yy = 0; yy < layer.height; yy += height) {
        for (let xx = 0; xx < layer.width; xx += width) ctx.drawImage(grass, xx, yy);
      }
    } else {
      ctx.fillStyle = "#2f6a38";
      ctx.fillRect(0, 0, layer.width, layer.height);
    }
    ctx.fillStyle = "rgba(255,255,220,.08)";
    ctx.fillRect(0, 0, layer.width, layer.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    target.drawImage(layer, x, y);
  }

  async function renderPaper(options = {}) {
    const previewCatalog = options.previewCatalog || await loadCatalog();
    const documentData = options.documentData || { records: [] };
    const base = options.base || baseByNo(previewCatalog, options.baseNo);
    if (!base) throw new Error("必须先选择建筑户型");
    const includeMaskGrass = options.includeMaskGrass !== false && options.purpose !== "terrain";
    const [floor, mask, grass] = await Promise.all([
      loadImage(baseImageUrl(base)),
      loadImage(maskImageUrl(base)),
      includeMaskGrass ? loadImage(options.grassUrl || DEFAULT_GRASS) : Promise.resolve(null),
    ]);
    if (!floor?.width) throw new Error(`户型「${base.name || base.no}」的地基图片无法读取`);

    const floorWidth = floor.naturalWidth || floor.width;
    const floorHeight = floor.naturalHeight || floor.height;
    const maskWidth = mask?.naturalWidth || mask?.width || floorWidth;
    const maskHeight = mask?.naturalHeight || mask?.height || floorHeight;
    const snug = floorSnugInMask(floor, mask);
    const frame = base.assets?.baseImage?.frameTable?.[0] || {};
    const anchor = Array.isArray(base.anchor) ? base.anchor : [0, 0];
    const nativeMaskX = nativeHalfDelta(NATIVE_LAYER_W, maskWidth);
    const nativeMaskY = nativeHalfDelta(NATIVE_LAYER_H, maskHeight);
    const nativeFloorX = nativeMaskX + Number(anchor[0] || 0) + Number(frame.anchorX || 0);
    const nativeFloorY = nativeMaskY + Number(anchor[1] || 0) + Number(frame.anchorY || 0);
    const designMaskX = Math.round((Math.max(DESIGN_W, maskWidth) - maskWidth) / 2);
    const designMaskY = Math.round((Math.max(DESIGN_H, maskHeight) - maskHeight) / 2);
    const fromEditor = options.coordinateSpace === "editor";
    const contentDx = fromEditor ? -designMaskX : snug.x - nativeFloorX;
    const contentDy = fromEditor ? -designMaskY : snug.y - nativeFloorY;

    const unresolved = [];
    const rows = await Promise.all(
      (documentData.records || [])
        .filter((record) => Number(record.mat))
        .map(async (record) => {
          const solved = resolveComponent(record.mat, previewCatalog, options.localPackKey || "");
          if (!solved) {
            unresolved.push(Number(record.mat) || 0);
            return null;
          }
          const stateValue = record.state ?? record.flip ?? 0;
          const geometry = frameGeometry(solved.component, stateValue);
          const image = await loadImage(spriteUrl(solved.component, solved.pack, stateValue));
          if (!image?.width) {
            unresolved.push(Number(record.mat) || 0);
            return null;
          }
          return {
            record,
            image,
            width: geometry.width || image.naturalWidth || image.width,
            height: geometry.height || image.naturalHeight || image.height,
          };
        })
    );
    const visible = rows.filter(Boolean);

    let left = includeMaskGrass ? Math.min(0, snug.x) : snug.x;
    let top = includeMaskGrass ? Math.min(0, snug.y) : snug.y;
    let right = includeMaskGrass ? Math.max(maskWidth, snug.x + floorWidth) : snug.x + floorWidth;
    let bottom = includeMaskGrass ? Math.max(maskHeight, snug.y + floorHeight) : snug.y + floorHeight;
    visible.forEach((row) => {
      const x = Number(row.record.x) + contentDx;
      const y = Number(row.record.y) + contentDy;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + row.width);
      bottom = Math.max(bottom, y + row.height);
    });
    const margin = 8;
    const originX = Math.floor(left) - margin;
    const originY = Math.floor(top) - margin;
    const scene = document.createElement("canvas");
    scene.width = Math.max(1, Math.ceil(right) - originX + margin);
    scene.height = Math.max(1, Math.ceil(bottom) - originY + margin);
    const ctx = scene.getContext("2d");
    if (includeMaskGrass) drawMaskGrass(ctx, mask, grass, -originX, -originY);
    ctx.drawImage(floor, snug.x - originX, snug.y - originY, floorWidth, floorHeight);
    visible.forEach((row) => {
      ctx.drawImage(
        row.image,
        Number(row.record.x) + contentDx - originX,
        Number(row.record.y) + contentDy - originY,
        row.width,
        row.height
      );
    });

    const floorFront = opaqueBottomVertex(floor, 96) || {
      x: Math.round(floorWidth / 2),
      y: floorHeight - 1,
    };
    const rawGroundAnchor = {
      x: snug.x + floorFront.x - originX,
      y: snug.y + floorFront.y - originY,
    };
    const bounds = alphaBounds(scene);
    const bitmap = document.createElement("canvas");
    bitmap.width = Math.max(1, bounds.right - bounds.left);
    bitmap.height = Math.max(1, bounds.bottom - bounds.top);
    bitmap.getContext("2d").drawImage(
      scene,
      bounds.left,
      bounds.top,
      bitmap.width,
      bitmap.height,
      0,
      0,
      bitmap.width,
      bitmap.height
    );
    return {
      bitmap,
      base,
      baseNo: Number(base.no),
      footprint: Array.isArray(base.footprint) ? [...base.footprint] : [3, 3],
      groundAnchor: {
        x: rawGroundAnchor.x - bounds.left,
        y: rawGroundAnchor.y - bounds.top,
      },
      alphaBounds: bounds,
      resolved: visible.length,
      unresolved,
      contentOffset: { x: contentDx, y: contentDy },
      transparent: !includeMaskGrass,
    };
  }

  global.BuildingPreview = Object.freeze({
    DESIGN_W,
    DESIGN_H,
    NATIVE_LAYER_W,
    NATIVE_LAYER_H,
    loadCatalog,
    loadImage,
    baseByNo,
    resolveComponent,
    spriteUrl,
    baseImageUrl,
    maskImageUrl,
    frameGeometry,
    opaqueBottomVertex,
    floorSnugInMask,
    nativeHalfDelta,
    nativeMaskOriginForLayer,
    nativePaperFloorOrigin,
    alphaBounds,
    prepareImageBitmap,
    renderPaper,
  });
})(window);
