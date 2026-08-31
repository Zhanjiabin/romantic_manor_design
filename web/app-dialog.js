let appDialogPending = null;
let appDialogBound = false;
let appDialogMode = "alert";
let appDialogDismiss = "cancel";

function isAppDialogOpen() {
  const modal = document.getElementById("dlgApp");
  return !!(modal && !modal.hidden);
}

function dialogFocusables() {
  const modal = document.getElementById("dlgApp");
  if (!modal || modal.hidden) return [];
  const field = document.getElementById("dlgAppField");
  const nodes = [
    document.getElementById("dlgAppClose"),
    field && !field.hidden ? document.getElementById("dlgAppInput") : null,
    document.getElementById("dlgAppCancel"),
    document.getElementById("dlgAppOk"),
  ];
  return nodes.filter((node) => node && !node.hidden);
}

function settleAppDialog(action) {
  const pending = appDialogPending;
  if (!pending) {
    const modal = document.getElementById("dlgApp");
    if (modal) modal.hidden = true;
    return;
  }
  const input = document.getElementById("dlgAppInput");
  let result;
  if (appDialogMode === "prompt") {
    result = action === "ok" ? input?.value ?? "" : null;
  } else if (appDialogMode === "confirm") {
    if (action === "ok") result = true;
    else if (action === "cancel") result = false;
    else result = appDialogDismiss === "abort" ? null : false;
  } else {
    result = true;
  }
  appDialogPending = null;
  const modal = document.getElementById("dlgApp");
  if (modal) modal.hidden = true;
  pending(result);
}

function bindAppDialog() {
  if (appDialogBound) return;
  const modal = document.getElementById("dlgApp");
  if (!modal) return;
  appDialogBound = true;
  document.getElementById("dlgAppOk")?.addEventListener("click", () => settleAppDialog("ok"));
  document.getElementById("dlgAppCancel")?.addEventListener("click", () => settleAppDialog("cancel"));
  document.getElementById("dlgAppClose")?.addEventListener("click", () => settleAppDialog("dismiss"));
  modal.addEventListener("click", (event) => {
    if (event.target.id === "dlgApp") settleAppDialog("dismiss");
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isAppDialogOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        settleAppDialog("dismiss");
        return;
      }
      if (event.key === "Enter" && event.target?.id !== "dlgAppInput") {
        event.preventDefault();
        event.stopImmediatePropagation();
        settleAppDialog("ok");
        return;
      }
      if (event.key === "Enter" && event.target?.id === "dlgAppInput") {
        event.preventDefault();
        event.stopImmediatePropagation();
        settleAppDialog("ok");
        return;
      }
      if (event.key === "Tab") {
        const nodes = dialogFocusables();
        if (!nodes.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const index = nodes.indexOf(document.activeElement);
        const next = event.shiftKey
          ? nodes[(index <= 0 ? nodes.length : index) - 1]
          : nodes[(index + 1) % nodes.length];
        next.focus();
        return;
      }
      if (event.target?.id !== "dlgAppInput") {
        event.stopImmediatePropagation();
      }
    },
    true
  );
}

function openAppDialog(options = {}) {
  bindAppDialog();
  const modal = document.getElementById("dlgApp");
  if (!modal) {
    return Promise.resolve(options.kind === "confirm" ? false : options.kind === "prompt" ? null : true);
  }
  if (appDialogPending) settleAppDialog("dismiss");
  appDialogMode = options.kind || "alert";
  appDialogDismiss = options.dismiss || "cancel";
  const title = document.getElementById("dlgAppTitle");
  const message = document.getElementById("dlgAppMessage");
  const field = document.getElementById("dlgAppField");
  const input = document.getElementById("dlgAppInput");
  const cancel = document.getElementById("dlgAppCancel");
  const ok = document.getElementById("dlgAppOk");
  title.textContent =
    options.title ||
    (appDialogMode === "prompt" ? "请输入" : appDialogMode === "confirm" ? "请确认" : "提示");
  message.textContent = options.message || "";
  message.hidden = !options.message;
  field.hidden = appDialogMode !== "prompt";
  cancel.hidden = appDialogMode === "alert";
  document.getElementById("dlgAppFieldLabel").textContent = options.fieldLabel || "名称";
  if (input) {
    input.value = options.value || "";
    input.placeholder = options.placeholder || "";
  }
  cancel.textContent = options.cancelLabel || "取消";
  ok.textContent = options.okLabel || (appDialogMode === "alert" ? "知道了" : "确定");
  ok.classList.toggle("btn-danger", !!options.danger);
  ok.classList.toggle("btn-primary", !options.danger);
  modal.hidden = false;
  requestAnimationFrame(() => {
    if (appDialogMode === "prompt") {
      input?.focus();
      input?.select();
    } else {
      ok?.focus();
    }
  });
  return new Promise((resolve) => {
    appDialogPending = resolve;
  });
}

function appAlert(message, options = {}) {
  return openAppDialog({
    kind: "alert",
    message,
    title: options.title || "提示",
    okLabel: options.okLabel,
  });
}

function appConfirm(message, options = {}) {
  return openAppDialog({
    kind: "confirm",
    message,
    title: options.title || "请确认",
    okLabel: options.okLabel || "确定",
    cancelLabel: options.cancelLabel || "取消",
    danger: !!options.danger,
    dismiss: options.dismiss || "cancel",
  });
}

function appPrompt(message, options = {}) {
  return openAppDialog({
    kind: "prompt",
    message,
    title: options.title || "请输入",
    fieldLabel: options.fieldLabel || "名称",
    value: options.value || "",
    placeholder: options.placeholder || "",
    okLabel: options.okLabel || "确定",
    cancelLabel: options.cancelLabel || "取消",
  });
}
