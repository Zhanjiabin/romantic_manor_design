/** Shared account chip, storage prefix, and switch prompt for both desks. */
(function deskAccount() {
  window.deskUser = "";
  window.deskStorageKey = function deskStorageKey(key) {
    const user = String(window.deskUser || "").trim();
    return user ? "manor-u:" + encodeURIComponent(user) + ":" + key : key;
  };
  window.deskGet = function deskGet(key) {
    try {
      return localStorage.getItem(window.deskStorageKey(key));
    } catch {
      return null;
    }
  };
  window.deskSet = function deskSet(key, value) {
    localStorage.setItem(window.deskStorageKey(key), value);
  };

  function switchButtons() {
    return [...document.querySelectorAll("[data-account-switch]")];
  }

  function setAccount(auth, user) {
    const name = String(user || "").trim();
    window.deskUser = name;
    switchButtons().forEach((button) => {
      const nameEl = button.querySelector(".desk-account-name");
      const kicker = button.querySelector(".top-account-kicker");
      if (!auth) {
        button.hidden = true;
        if (nameEl) nameEl.textContent = "";
        if (kicker) kicker.hidden = false;
        button.removeAttribute("aria-label");
        button.title = "切换账号";
        return;
      }
      button.hidden = false;
      if (name) {
        if (nameEl) nameEl.textContent = name;
        if (kicker) kicker.hidden = false;
        button.title = `当前账号 ${name} · 点此切换`;
        button.setAttribute("aria-label", `当前账号 ${name}，切换账号`);
      } else {
        if (nameEl) nameEl.textContent = "切换账号";
        if (kicker) kicker.hidden = true;
        button.title = "切换账号";
        button.setAttribute("aria-label", "切换账号");
      }
    });
  }

  async function loadName() {
    try {
      const response = await fetch("/api/whoami", { credentials: "include", cache: "no-store" });
      if (!response.ok) {
        setAccount(false, "");
        return "";
      }
      const data = await response.json();
      const user = String(data.user || "").trim();
      setAccount(!!data.auth, user);
      return user;
    } catch {
      setAccount(false, "");
      return "";
    }
  }

  async function switchAccount() {
    const proceed =
      typeof appConfirm === "function"
        ? await appConfirm("会退出当前账号，回到登录页。再用另一个账号登录即可。", {
            title: "切换账号",
            okLabel: "切换",
            cancelLabel: "取消",
          })
        : window.confirm("退出当前账号并回到登录页？");
    if (!proceed) return;
    try {
      await fetch("/api/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
    } catch {
      /* still go to login */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace("/login?next=" + next);
  }

  switchButtons().forEach((button) => {
    button.addEventListener("click", () => {
      switchAccount().catch(() => {});
    });
  });
  window.deskAccountReady = loadName();
})();
