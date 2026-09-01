# -*- coding: utf-8 -*-
/** Shared account chip + switch prompt for both desks. */
(function deskAccount() {
  const button = document.getElementById("btnSwitchAccount");
  const nameEl = document.getElementById("deskAccountName");
  if (!button || !nameEl) return;

  function setName(user) {
    const name = String(user || "").trim();
    if (!name) {
      button.hidden = true;
      nameEl.textContent = "";
      button.removeAttribute("aria-label");
      return;
    }
    nameEl.textContent = name;
    button.hidden = false;
    button.title = `当前账号 ${name} · 点此切换`;
    button.setAttribute("aria-label", `当前账号 ${name}，切换账号`);
  }

  async function loadName() {
    try {
      const response = await fetch("/api/whoami", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        setName("");
        return;
      }
      const data = await response.json();
      setName(data.user);
    } catch {
      setName("");
    }
  }

  async function switchAccount() {
    const proceed =
      typeof appConfirm === "function"
        ? await appConfirm("浏览器会再弹出登录框。输入另一个账号密码即可切换。", {
            title: "切换账号",
            okLabel: "切换",
            cancelLabel: "取消",
          })
        : window.confirm("切换账号？浏览器会再问一次账号密码。");
    if (!proceed) return;
    try {
      await fetch("/api/logout", {
        cache: "no-store",
        credentials: "include",
        headers: { Authorization: "Basic " + btoa(`switch:${Date.now()}:x`) },
      });
    } catch {
      /* 401 is expected */
    }
    location.reload();
  }

  button.addEventListener("click", () => {
    switchAccount().catch(() => {});
  });
  loadName();
})();
