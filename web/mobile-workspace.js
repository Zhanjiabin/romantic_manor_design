(function initMobileWorkspace(global) {
  "use strict";

  const listeners = new Set();
  const sheets = new Map();
  const modalReturnFocus = new WeakMap();
  let activeModal = null;
  let activeSheetId = "";
  let initialized = false;
  let lastModeKey = "";
  let orientationTimer = 0;

  function navInfo() {
    const nav = global.navigator || {};
    return {
      userAgent: String(nav.userAgent || ""),
      platform: String(nav.platform || ""),
      maxTouchPoints: Number(nav.maxTouchPoints) || 0,
    };
  }

  function isIPadOS() {
    const nav = navInfo();
    // iPadOS 13+ reports as Macintosh + touch, even with a keyboard/trackpad.
    return nav.maxTouchPoints > 1 && /iPad|Macintosh/i.test(`${nav.platform} ${nav.userAgent}`);
  }

  function modeForViewport() {
    const innerW = Math.round(global.innerWidth || 1024);
    const innerH = Math.round(global.innerHeight || 768);
    const viewport = global.visualViewport;
    let width = Math.round(viewport?.width || innerW);
    let height = Math.round(viewport?.height || innerH);
    if ((width > height) !== (innerW > innerH)) {
      width = innerW;
      height = innerH;
    }
    const pointerCoarse = !!global.matchMedia?.("(pointer: coarse)")?.matches;
    const hoverNone = !!global.matchMedia?.("(hover: none)")?.matches;
    const iPadOS = isIPadOS();
    const coarse = pointerCoarse || hoverNone || iPadOS;
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    const tablet = iPadOS || (shortSide >= 600 && longSide <= 1400 && (coarse || width <= 1024));
    const mobile = width <= 900 || tablet || (coarse && width <= 1180);
    const orientation = width > height ? "landscape" : "portrait";
    return { width, height, coarse, mobile, tablet, orientation, iPadOS };
  }

  let lastViewportKey = "";

  function syncViewport(root = document.documentElement) {
    const mode = modeForViewport();
    const viewport = global.visualViewport;
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    const offsetLeft = Math.round(viewport?.offsetLeft || 0);
    // iOS fires visualViewport scroll continuously; skip the style writes
    // (each one dirties layout) when nothing actually changed.
    const viewportKey = `${mode.width}x${mode.height}@${offsetTop},${offsetLeft}`;
    if (viewportKey === lastViewportKey && root.dataset.workspaceMode) {
      const sameMode = `${mode.mobile}:${mode.tablet}:${mode.orientation}` === lastModeKey;
      if (sameMode) return mode;
    }
    lastViewportKey = viewportKey;
    root.style.setProperty("--visual-vh", `${mode.height}px`);
    root.style.setProperty("--visual-vw", `${mode.width}px`);
    root.style.setProperty("--visual-offset-top", `${offsetTop}px`);
    root.style.setProperty("--visual-offset-left", `${offsetLeft}px`);
    root.classList.toggle("is-mobile-workspace", mode.mobile);
    root.classList.toggle("is-touch-workspace", mode.coarse);
    root.classList.toggle("is-tablet-workspace", mode.tablet);
    root.classList.toggle("mobile-portrait", mode.mobile && mode.orientation === "portrait");
    root.classList.toggle("mobile-landscape", mode.mobile && mode.orientation === "landscape");
    root.dataset.workspaceMode = mode.mobile
      ? (mode.tablet ? `tablet-${mode.orientation}` : `mobile-${mode.orientation}`)
      : "desktop";
    const modeKey = `${mode.mobile}:${mode.tablet}:${mode.orientation}`;
    if (modeKey !== lastModeKey) {
      lastModeKey = modeKey;
      listeners.forEach((listener) => listener(mode));
    }
    return mode;
  }

  function focusables(root) {
    if (!root) return [];
    return [...root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((node) => !node.hidden && node.offsetParent !== null && !node.closest("[inert]"));
  }

  function resolveNode(value) {
    if (!value) return null;
    if (typeof value === "string") return document.querySelector(value);
    return value;
  }

  function sheetOptions(id) {
    return sheets.get(String(id || "")) || null;
  }

  function setSheetExpanded(options, expanded) {
    const trigger = resolveNode(options?.trigger);
    trigger?.setAttribute("aria-expanded", String(!!expanded));
    trigger?.classList.toggle("on", !!expanded);
  }

  function sheetCoversWorkspace() {
    return modeForViewport().mobile && !modeForViewport().tablet;
  }

  function setSheetInert(options, open) {
    const cover = open && sheetCoversWorkspace();
    (options?.inert || []).forEach((target) => setInert(resolveNode(target), cover));
  }

  function syncBackdrop(options, open) {
    const backdrop = resolveNode(options?.backdrop);
    if (backdrop) backdrop.hidden = !open || !sheetCoversWorkspace();
  }

  function registerSheet(options = {}) {
    const id = String(options.id || "");
    const root = resolveNode(options.root);
    if (!id || !root) return null;
    const registered = { mutex: "workspace", resetScroll: true, ...options, id, root };
    sheets.set(id, registered);
    root.dataset.mobileSheetId = id;
    root.setAttribute("aria-hidden", sheetCoversWorkspace() && !root.classList.contains("open") ? "true" : "false");
    return registered;
  }

  function closeSheet(id, options = {}) {
    const registered = sheetOptions(id);
    if (!registered) return false;
    const wasOpen = activeSheetId === registered.id || registered.root.classList.contains("open");
    registered.root.classList.remove("open");
    registered.root.setAttribute("aria-hidden", sheetCoversWorkspace() ? "true" : "false");
    setSheetExpanded(registered, false);
    setSheetInert(registered, false);
    syncBackdrop(registered, false);
    if (activeSheetId === registered.id) activeSheetId = "";
    if (activeModal === registered.root) activeModal = null;
    registered.onClose?.();
    if (wasOpen && options.restoreFocus !== false) {
      const trigger = resolveNode(options.trigger) || resolveNode(registered.trigger);
      trigger?.focus?.({ preventScroll: true });
    }
    return wasOpen;
  }

  function openSheet(id, options = {}) {
    const registered = sheetOptions(id);
    if (!registered) return false;
    sheets.forEach((other) => {
      if (other.id !== registered.id && other.mutex === registered.mutex) {
        closeSheet(other.id, { restoreFocus: false });
      }
    });
    activeSheetId = registered.id;
    registered.root.classList.add("open");
    registered.root.setAttribute("aria-hidden", "false");
    setSheetExpanded(registered, true);
    setSheetInert(registered, true);
    syncBackdrop(registered, true);
    if (registered.resetScroll !== false && options.resetScroll !== false) {
      registered.root.scrollTop = 0;
      const scroller = registered.root.querySelector("[data-mobile-sheet-scroll]");
      if (scroller) scroller.scrollTop = 0;
    }
    modalReturnFocus.set(registered.root, resolveNode(options.trigger) || resolveNode(registered.trigger) || document.activeElement);
    activeModal = registered.root;
    registered.onOpen?.(options);
    requestAnimationFrame(() => {
      const target =
        registered.root.querySelector(registered.initialFocus || "[data-mobile-initial-focus]") ||
        focusables(registered.root)[0];
      target?.focus?.({ preventScroll: true });
    });
    return true;
  }

  function toggleSheet(id, options = {}) {
    return activeSheetId === id
      ? closeSheet(id, options)
      : openSheet(id, options);
  }

  function closeTopSheet(options = {}) {
    return activeSheetId ? closeSheet(activeSheetId, options) : false;
  }

  function setInert(node, value) {
    if (!node) return;
    node.inert = !!value;
    if (value) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  }

  function openLayer(layer, trigger) {
    if (!layer) return;
    modalReturnFocus.set(layer, trigger || document.activeElement);
    layer.hidden = false;
    layer.setAttribute("aria-hidden", "false");
    activeModal = layer;
    requestAnimationFrame(() => {
      const target = layer.querySelector("[autofocus], [data-mobile-initial-focus]") || focusables(layer)[0];
      target?.focus({ preventScroll: true });
    });
  }

  function closeLayer(layer) {
    if (!layer) return;
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    if (activeModal === layer) activeModal = sheetOptions(activeSheetId)?.root || null;
    const target = modalReturnFocus.get(layer);
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function trapTab(event) {
    if (event.key !== "Tab" || !activeModal || activeModal.hidden) return;
    const items = focusables(activeModal);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function enhanceModals(selector = ".modal") {
    document.querySelectorAll(selector).forEach((modal) => {
      const card = modal.querySelector(".modal-card") || modal;
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-hidden", modal.hidden ? "true" : "false");
      if (modal.dataset.mobileModalBound) return;
      modal.dataset.mobileModalBound = "1";
      modal.addEventListener("pointerdown", (event) => {
        if (event.target !== modal || modal.dataset.dismissible === "false") return;
        const close = modal.querySelector("[data-close], .icon-x");
        close?.click();
      });
    });
  }

  function scrollFocusedInput(event) {
    const target = event.target;
    if (!target?.matches?.("input, textarea, select, [contenteditable]")) return;
    if (!modeForViewport().mobile) return;
    setTimeout(() => target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }), 120);
  }

  function scheduleSync(root) {
    syncViewport(root);
    global.clearTimeout(orientationTimer);
    orientationTimer = global.setTimeout(() => syncViewport(root), 280);
  }

  let syncRaf = 0;

  function init(options = {}) {
    if (initialized) return syncViewport(options.root);
    initialized = true;
    const sync = () => {
      if (syncRaf) return;
      syncRaf = global.requestAnimationFrame(() => {
        syncRaf = 0;
        syncViewport(options.root);
      });
    };
    global.addEventListener("resize", sync, { passive: true });
    global.addEventListener("orientationchange", () => scheduleSync(options.root), { passive: true });
    global.matchMedia?.("(orientation: landscape)")?.addEventListener?.("change", () => scheduleSync(options.root));
    global.visualViewport?.addEventListener("resize", sync, { passive: true });
    global.visualViewport?.addEventListener("scroll", sync, { passive: true });
    document.addEventListener("focusin", scrollFocusedInput);
    document.addEventListener("keydown", trapTab, true);
    guardBrowserChrome();
    enhanceModals();
    return syncViewport(options.root);
  }

  function isEditableTarget(node) {
    return !!node?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
  }

  function guardBrowserChrome() {
    if (guardBrowserChrome.done) return;
    guardBrowserChrome.done = true;
    const block = (event) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", block, true);
    document.addEventListener("selectstart", block, true);
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function bindNudgeStepControl(options) {
    const button = options?.button;
    const pad = options?.pad;
    if (!button || !pad) return;
    const unit = options.unit || "px";
    const min = options.min ?? 1;
    const max = options.max ?? 128;
    const presets = options.presets || [1, 2, 4, 5, 8, 10, 16];
    const fallback = clampInt(options.fallback ?? 1, min, max, 1);
    const getValue = () => clampInt(options.getValue?.(), min, max, fallback);
    const setValue = (value) => options.setValue?.(clampInt(value, min, max, fallback));
    const mode = modeForViewport();
    const blockSystemKeyboard = !!(mode.mobile || mode.coarse);

    let pop = pad.querySelector(".nudge-step-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "nudge-step-pop";
      pop.hidden = true;
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "设置步长");
      const row = document.createElement("div");
      row.className = "nudge-step-row";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "nudge-step-adj";
      minus.setAttribute("aria-label", "减小步长");
      minus.textContent = "−";
      const valueNode = document.createElement(blockSystemKeyboard ? "div" : "input");
      valueNode.className = "nudge-step-input";
      valueNode.setAttribute("aria-label", `步长（${unit}）`);
      if (blockSystemKeyboard) {
        valueNode.classList.add("nudge-step-input-display");
        valueNode.setAttribute("aria-live", "polite");
      } else {
        valueNode.type = "number";
        valueNode.min = String(min);
        valueNode.max = String(max);
        valueNode.step = "1";
        valueNode.inputMode = "numeric";
      }
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "nudge-step-adj";
      plus.setAttribute("aria-label", "增大步长");
      plus.textContent = "+";
      row.append(minus, valueNode, plus);
      const chips = document.createElement("div");
      chips.className = "nudge-step-presets";
      presets.forEach((preset) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "nudge-step-preset";
        chip.dataset.step = String(preset);
        chip.textContent = String(preset);
        chips.append(chip);
      });
      pop.append(row, chips);
      pad.append(pop);
    }

    const input = pop.querySelector(".nudge-step-input");
    const syncDisplay = () => {
      const next = String(getValue());
      if (input instanceof HTMLInputElement) input.value = next;
      else input.textContent = next;
    };
    const closePop = () => {
      pop.hidden = true;
      pad.classList.remove("is-editing-step");
      button.setAttribute("aria-expanded", "false");
    };
    const openPop = () => {
      syncDisplay();
      pop.hidden = false;
      pad.classList.add("is-editing-step");
      button.setAttribute("aria-expanded", "true");
      if (input instanceof HTMLInputElement) {
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      }
    };
    const commit = (value) => {
      setValue(value);
      syncDisplay();
    };

    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (pop.hidden) openPop();
      else closePop();
    });
    pop.addEventListener("pointerdown", (event) => event.stopPropagation());
    pop.addEventListener("click", (event) => {
      const adj = event.target.closest(".nudge-step-adj");
      if (adj) {
        const next = getValue() + (adj.textContent === "+" ? 1 : -1);
        commit(next);
        return;
      }
      const preset = event.target.closest(".nudge-step-preset");
      if (preset) commit(preset.dataset.step);
    });
    if (input instanceof HTMLInputElement) {
      input.addEventListener("change", () => commit(input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(input.value);
          closePop();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closePop();
        }
      });
    }
    document.addEventListener("pointerdown", (event) => {
      if (pop.hidden) return;
      if (pad.contains(event.target)) return;
      closePop();
    });
  }

  function onModeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.MobileWorkspace = Object.freeze({
    init,
    syncViewport,
    modeForViewport,
    onModeChange,
    focusables,
    setInert,
    registerSheet,
    openSheet,
    closeSheet,
    toggleSheet,
    closeTopSheet,
    activeSheet: () => activeSheetId,
    openLayer,
    closeLayer,
    enhanceModals,
    bindNudgeStepControl,
  });
})(window);
