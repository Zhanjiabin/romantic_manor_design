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
    const coarse = !!global.matchMedia?.("(hover: none), (pointer: coarse)")?.matches;
    const mobile = width <= 1100 || (coarse && width <= 1100);
    const orientation = width > height ? "landscape" : "portrait";
    const tablet = mobile && Math.min(width, height) >= 600;
    return { width, height, coarse, mobile, tablet, orientation };
  }

  function syncViewport(root = document.documentElement) {
    const mode = modeForViewport();
    const viewport = global.visualViewport;
    root.style.setProperty("--visual-vh", `${mode.height}px`);
    root.style.setProperty("--visual-vw", `${mode.width}px`);
    root.style.setProperty("--visual-offset-top", `${Math.round(viewport?.offsetTop || 0)}px`);
    root.style.setProperty("--visual-offset-left", `${Math.round(viewport?.offsetLeft || 0)}px`);
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

  function setSheetInert(options, open) {
    (options?.inert || []).forEach((target) => setInert(resolveNode(target), open));
  }

  function syncBackdrop(options, open) {
    const backdrop = resolveNode(options?.backdrop);
    if (backdrop) backdrop.hidden = !open;
  }

  function registerSheet(options = {}) {
    const id = String(options.id || "");
    const root = resolveNode(options.root);
    if (!id || !root) return null;
    const registered = { mutex: "workspace", resetScroll: true, ...options, id, root };
    sheets.set(id, registered);
    root.dataset.mobileSheetId = id;
    root.setAttribute("aria-hidden", modeForViewport().mobile && !root.classList.contains("open") ? "true" : "false");
    return registered;
  }

  function closeSheet(id, options = {}) {
    const registered = sheetOptions(id);
    if (!registered) return false;
    const wasOpen = activeSheetId === registered.id || registered.root.classList.contains("open");
    registered.root.classList.remove("open");
    registered.root.setAttribute("aria-hidden", "true");
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

  function init(options = {}) {
    if (initialized) return syncViewport(options.root);
    initialized = true;
    const sync = () => syncViewport(options.root);
    global.addEventListener("resize", sync, { passive: true });
    global.addEventListener("orientationchange", () => scheduleSync(options.root), { passive: true });
    global.matchMedia?.("(orientation: landscape)")?.addEventListener?.("change", () => scheduleSync(options.root));
    global.visualViewport?.addEventListener("resize", sync, { passive: true });
    global.visualViewport?.addEventListener("scroll", sync, { passive: true });
    document.addEventListener("focusin", scrollFocusedInput);
    document.addEventListener("keydown", trapTab, true);
    enhanceModals();
    return sync();
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
  });
})(window);
