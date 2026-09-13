(function clothTryOn() {
  "use strict";

  const VS = `
    attribute vec3 aPos;
    attribute vec3 aNrm;
    attribute vec2 aUv;
    uniform mat4 uMVP;
    uniform mat3 uN;
    varying vec2 vUv;
    varying vec3 vN;
    void main() {
      gl_Position = uMVP * vec4(aPos, 1.0);
      vN = uN * aNrm;
      vUv = aUv;
    }
  `;

  const FS = `
    precision mediump float;
    varying vec2 vUv;
    varying vec3 vN;
    uniform sampler2D uTex;
    uniform vec3 uLight;
    uniform float uCutBlack;
    void main() {
      vec3 n = normalize(vN);
      float ndl = 0.55 + 0.45 * max(dot(n, uLight), 0.0);
      vec4 c = texture2D(uTex, vUv);
      if (c.a < 0.08) discard;
      if (uCutBlack > 0.5 && (c.r + c.g + c.b) < 0.18) discard;
      gl_FragColor = vec4(c.rgb * ndl, 1.0);
    }
  `;

  const SLOT_ORDER = { skin: 0, cloth: 1, hair: 2, head: 3 };
  const BODY_KINDS = new Set(["female-short", "female-long", "female-skirt", "male-short", "male-long"]);

  let manifest = null;
  let manifestPromise = null;
  let gl = null;
  let program = null;
  let loc = null;
  let parts = [];
  let textures = new Map();
  let yaw = Math.PI;
  let dragging = false;
  let lastX = 0;
  let pointers = new Set();
  let raf = 0;
  let canvasEl = null;
  let hintEl = null;
  let canvasBound = false;
  let openGen = 0;
  let currentGender = "female";
  let currentBody = "female-short";
  let resizeObs = null;

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetch("/data/cloth/preview/manifest.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("preview manifest " + res.status);
        return res.json();
      })
      .then((doc) => {
        manifest = doc;
        return doc;
      })
      .catch((err) => {
        manifestPromise = null;
        throw err;
      });
    return manifestPromise;
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader");
    }
    return sh;
  }

  function initGl(canvas) {
    gl = canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL 不可用");
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "program");
    }
    loc = {
      aPos: gl.getAttribLocation(program, "aPos"),
      aNrm: gl.getAttribLocation(program, "aNrm"),
      aUv: gl.getAttribLocation(program, "aUv"),
      uMVP: gl.getUniformLocation(program, "uMVP"),
      uN: gl.getUniformLocation(program, "uN"),
      uTex: gl.getUniformLocation(program, "uTex"),
      uLight: gl.getUniformLocation(program, "uLight"),
      uCutBlack: gl.getUniformLocation(program, "uCutBlack"),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.07, 0.07, 0.11, 1);
  }

  function buffer(data, target) {
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return { buf, count: data.length };
  }

  function makePart(part) {
    return {
      slot: part.slot,
      texture: part.texture,
      pos: buffer(new Float32Array(part.positions), gl.ARRAY_BUFFER),
      nrm: buffer(new Float32Array(part.normals), gl.ARRAY_BUFFER),
      uv: buffer(new Float32Array(part.uvs), gl.ARRAY_BUFFER),
      idx: buffer(new Uint16Array(part.indices), gl.ELEMENT_ARRAY_BUFFER),
      count: part.indices.length,
    };
  }

  function texFromImage(image) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return tex;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("tex " + url));
      img.src = url;
    });
  }

  async function texFromSrc(src) {
    if (!src) return null;
    if (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement) return texFromImage(src);
    if (typeof src === "string") return texFromImage(await loadImage(src));
    return null;
  }

  function bindAttr(index, spec, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, spec.buf);
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
  }

  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function mat4Multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) * nf;
    o[11] = -1;
    o[14] = 2 * far * near * nf;
    return o;
  }

  function lookAt(eye, center, up) {
    const zx = eye[0] - center[0];
    const zy = eye[1] - center[1];
    const zz = eye[2] - center[2];
    let zlen = Math.hypot(zx, zy, zz) || 1;
    const z0 = zx / zlen;
    const z1 = zy / zlen;
    const z2 = zz / zlen;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    const xlen = Math.hypot(x0, x1, x2) || 1;
    x0 /= xlen;
    x1 /= xlen;
    x2 /= xlen;
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
    const o = mat4Identity();
    o[0] = x0;
    o[1] = y0;
    o[2] = z0;
    o[4] = x1;
    o[5] = y1;
    o[6] = z1;
    o[8] = x2;
    o[9] = y2;
    o[10] = z2;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    return o;
  }

  function rotateZ(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const o = mat4Identity();
    o[0] = c;
    o[1] = s;
    o[4] = -s;
    o[5] = c;
    return o;
  }

  function normalFromModel(m) {
    return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
  }

  function sizeCanvas() {
    if (!gl || !canvasEl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(160, canvasEl.clientWidth || 280);
    const cssH = Math.max(240, canvasEl.clientHeight || 440);
    const nextW = Math.round(cssW * dpr);
    const nextH = Math.round(cssH * dpr);
    if (canvasEl.width !== nextW || canvasEl.height !== nextH) {
      canvasEl.width = nextW;
      canvasEl.height = nextH;
    }
    gl.viewport(0, 0, canvasEl.width, canvasEl.height);
  }

  function texForPart(part) {
    if (part.slot === "cloth") return textures.get("slot:cloth") || textures.get(part.texture);
    if (part.slot === "hair") return textures.get("slot:hair") || textures.get(part.texture);
    if (part.slot === "head") return textures.get("slot:expression") || textures.get(part.texture);
    return textures.get(part.texture);
  }

  function drawMesh(part, cutBlack, forceTex) {
    const tex = forceTex || texForPart(part);
    if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(loc.uCutBlack, cutBlack ? 1 : 0);
    bindAttr(loc.aPos, part.pos, 3);
    bindAttr(loc.aNrm, part.nrm, 3);
    bindAttr(loc.aUv, part.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.idx.buf);
    gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
  }

  function draw() {
    if (!gl || !program) return;
    sizeCanvas();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    const aspect = canvasEl.width / Math.max(1, canvasEl.height);
    const proj = perspective(30 * Math.PI / 180, aspect, 8, 900);
    const view = lookAt([0, 300, 86], [0, 0, 78], [0, 0, 1]);
    const model = rotateZ(yaw);
    const mvp = mat4Multiply(proj, mat4Multiply(view, model));
    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    gl.uniformMatrix3fv(loc.uN, false, normalFromModel(model));
    gl.uniform3f(loc.uLight, 0.12, 0.86, 0.48);
    gl.uniform1i(loc.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    const heads = [];
    parts.forEach((part) => {
      if (part.slot === "hair") gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      if (part.slot === "head") {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-12, -16);
        heads.push(part);
      } else {
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      drawMesh(part, false);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
    const face = textures.get("slot:face");
    if (face && heads.length) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-18, -24);
      gl.enable(gl.CULL_FACE);
      heads.forEach((part) => drawMesh(part, true, face));
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function onPointerDown(event) {
    pointers.add(event.pointerId);
    if (pointers.size >= 2) {
      dragging = false;
      return;
    }
    dragging = true;
    lastX = event.clientX;
    canvasEl.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || pointers.size !== 1) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    yaw += dx * 0.012;
    requestDraw();
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) dragging = false;
  }

  function onViewportResize() {
    requestDraw();
  }

  function bindCanvas() {
    if (canvasBound || !canvasEl) return;
    canvasEl.style.touchAction = "none";
    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerUp);
    canvasEl.addEventListener("pointerleave", onPointerUp);
    window.addEventListener("resize", onViewportResize);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    if (typeof ResizeObserver === "function") {
      resizeObs = new ResizeObserver(() => requestDraw());
      resizeObs.observe(canvasEl);
    }
    canvasBound = true;
  }

  function unbindCanvas() {
    if (!canvasBound || !canvasEl) return;
    canvasEl.removeEventListener("pointerdown", onPointerDown);
    canvasEl.removeEventListener("pointermove", onPointerMove);
    canvasEl.removeEventListener("pointerup", onPointerUp);
    canvasEl.removeEventListener("pointercancel", onPointerUp);
    canvasEl.removeEventListener("pointerleave", onPointerUp);
    window.removeEventListener("resize", onViewportResize);
    window.visualViewport?.removeEventListener("resize", onViewportResize);
    if (resizeObs) {
      resizeObs.disconnect();
      resizeObs = null;
    }
    canvasBound = false;
  }

  function tryOnKind(kindId, gender) {
    if (BODY_KINDS.has(kindId)) return kindId;
    return gender === "male" ? "male-short" : "female-short";
  }

  function disposeMeshes() {
    if (!gl) return;
    parts.forEach((part) => {
      gl.deleteBuffer(part.pos.buf);
      gl.deleteBuffer(part.nrm.buf);
      gl.deleteBuffer(part.uv.buf);
      gl.deleteBuffer(part.idx.buf);
    });
    parts = [];
  }

  function disposeAll() {
    disposeMeshes();
    textures.forEach((tex) => gl.deleteTexture(tex));
    textures.clear();
  }

  function buildParts(bodyKind, gender) {
    const info = manifest.kinds[bodyKind];
    if (!info) throw new Error("没有这款身体");
    const shared = [manifest.shared[`${gender}-head`], manifest.shared[`${gender}-hair`]];
    return info.body.concat(shared).sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9)).map(makePart);
  }

  async function loadDefaultTextures(bodyKind, gender) {
    const info = manifest.kinds[bodyKind];
    const urls = {
      [`${gender}-skin.jpg`]: "/data/cloth/preview/" + gender + "-skin.jpg",
      [`${gender}-head.jpg`]: "/data/cloth/preview/" + gender + "-head.jpg",
      [`${gender}-hair.jpg`]: "/data/cloth/preview/" + gender + "-hair.jpg",
      cloth: "/data/cloth/preview/" + info.defaultCloth,
    };
    for (const [key, url] of Object.entries(urls)) {
      if (key !== "cloth" && textures.has(key)) continue;
      const tex = await texFromSrc(url);
      if (!tex) continue;
      if (key === "cloth") {
        const prev = textures.get("cloth");
        if (prev) gl.deleteTexture(prev);
      }
      textures.set(key, tex);
    }
  }

  async function applySlot(name, src) {
    const prev = textures.get("slot:" + name);
    if (!src) {
      if (prev) gl.deleteTexture(prev);
      textures.delete("slot:" + name);
      return;
    }
    const tex = await texFromSrc(src);
    if (!tex) return;
    if (prev) gl.deleteTexture(prev);
    textures.set("slot:" + name, tex);
  }

  async function open(options) {
    const gen = ++openGen;
    canvasEl = document.getElementById("previewCanvas");
    hintEl = document.getElementById("previewHint");
    if (!canvasEl) return;
    yaw = Math.PI;
    await loadManifest();
    if (gen !== openGen) return;
    if (!gl || gl.isContextLost()) initGl(canvasEl);
    disposeAll();
    sizeCanvas();
    currentGender = options.gender === "male" ? "male" : "female";
    currentBody = tryOnKind(options.bodyKind || options.kindId, currentGender);
    parts = buildParts(currentBody, currentGender);
    await loadDefaultTextures(currentBody, currentGender);
    if (gen !== openGen) return;
    const slots = options.slots || {};
    await applySlot("cloth", slots.cloth);
    await applySlot("hair", slots.hair);
    await applySlot("expression", slots.expression);
    await applySlot("face", slots.face);
    if (gen !== openGen) return;
    bindCanvas();
    if (hintEl) hintEl.textContent = "拖动看正反面。衣服、头巾、表情和面饰都可以一起选。";
    draw();
    requestAnimationFrame(() => draw());
  }

  async function setBodyKind(bodyKind, gender) {
    if (!gl || !manifest) return;
    currentGender = gender === "male" || String(bodyKind || "").startsWith("male") ? "male" : "female";
    currentBody = tryOnKind(bodyKind, currentGender);
    disposeMeshes();
    parts = buildParts(currentBody, currentGender);
    await loadDefaultTextures(currentBody, currentGender);
    draw();
  }

  async function setSlot(name, src) {
    if (!gl) return;
    await applySlot(name, src);
    draw();
  }

  function close() {
    openGen += 1;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    dragging = false;
    pointers.clear();
    unbindCanvas();
    disposeAll();
  }

  window.ClothTryOn = {
    open,
    close,
    loadManifest,
    setBodyKind,
    setSlot,
    setYaw(value) {
      yaw = Number(value) || 0;
      draw();
    },
  };
})();
