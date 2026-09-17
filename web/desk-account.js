/** Shared account chip, full backup, storage prefix, and switch prompt. */
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

  function backupButtons() {
    return [...document.querySelectorAll("[data-desk-backup]")];
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
    backupButtons().forEach((button) => {
      button.hidden = !auth;
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

  function backupDialog() {
    return document.getElementById("dlgDeskBackup");
  }

  function formatBytes(n) {
    const size = Number(n) || 0;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatWhen(ms) {
    const at = Number(ms) || 0;
    if (!at) return "";
    const d = new Date(at);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function setBackupStatus(text) {
    const node = document.getElementById("deskBackupStatus");
    if (node) node.textContent = text || "";
  }

  function ensureBackupDialog() {
    if (backupDialog()) return;
    const wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "dlgDeskBackup";
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="modal-card modal-narrow desk-backup-card" role="dialog" aria-modal="true" aria-labelledby="deskBackupTitle">
        <div class="modal-cap">
          <span id="deskBackupTitle">全量备份</span>
          <button type="button" class="icon-x" data-close-backup aria-label="关闭"></button>
        </div>
        <div class="modal-body desk-backup-body">
          <p class="desk-backup-note">把当前账号的地形、建筑、图纸库、衣服作品和底板复制成一个压缩包。只写备份目录，不会改、不会覆盖正在用的数据。这里没有还原。</p>
          <button type="button" class="btn btn-primary btn-block" id="btnCreateDeskBackup">生成并下载</button>
          <p class="desk-backup-status" id="deskBackupStatus"></p>
          <div class="desk-backup-head">已有备份</div>
          <div class="desk-backup-list" id="deskBackupList"></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (event) => {
      if (event.target === wrap) closeBackupDialog();
    });
    wrap.querySelector("[data-close-backup]")?.addEventListener("click", () => closeBackupDialog());
    wrap.querySelector("#btnCreateDeskBackup")?.addEventListener("click", () => {
      createAndDownloadBackup().catch((error) => setBackupStatus(String(error.message || error)));
    });
    wrap.querySelector("#deskBackupList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-download-backup]");
      if (!button) return;
      downloadBackup(button.getAttribute("data-download-backup")).catch((error) => {
        setBackupStatus(String(error.message || error));
      });
    });
  }

  function openBackupDialog() {
    ensureBackupDialog();
    const modal = backupDialog();
    if (!modal) return;
    setBackupStatus("");
    refreshBackupList().catch((error) => setBackupStatus(String(error.message || error)));
    if (window.MobileWorkspace?.openLayer) window.MobileWorkspace.openLayer(modal, document.activeElement);
    else modal.hidden = false;
  }

  function closeBackupDialog() {
    const modal = backupDialog();
    if (!modal) return;
    if (window.MobileWorkspace?.closeLayer) window.MobileWorkspace.closeLayer(modal);
    else modal.hidden = true;
  }

  async function refreshBackupList() {
    const list = document.getElementById("deskBackupList");
    if (!list) return;
    const res = await fetch("/api/saves/backup", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error("读备份列表失败");
    const data = await res.json();
    const items = Array.isArray(data?.backups) ? data.backups : [];
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "desk-backup-empty";
      empty.textContent = "还没有备份包。";
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "desk-backup-row";
      const meta = document.createElement("div");
      meta.className = "desk-backup-meta";
      const name = document.createElement("strong");
      name.textContent = item.name || item.id;
      const sub = document.createElement("span");
      sub.textContent = `${formatWhen(item.createdAt)} · ${formatBytes(item.bytes)}`;
      meta.append(name, sub);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-compact";
      button.dataset.downloadBackup = item.id || item.name;
      button.textContent = "下载";
      row.append(meta, button);
      list.append(row);
    });
  }

  async function downloadBackup(id) {
    const ident = String(id || "").trim();
    if (!ident) return;
    setBackupStatus("正在下载…");
    const res = await fetch("/api/saves/backup/" + encodeURIComponent(ident), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("下载失败");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ident;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setBackupStatus("已开始下载 " + ident);
  }

  async function createAndDownloadBackup() {
    const button = document.getElementById("btnCreateDeskBackup");
    if (button) button.disabled = true;
    setBackupStatus("正在打包当前账号全部数据，不会改原文件…");
    try {
      const res = await fetch("/api/saves/backup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("生成备份失败");
      const info = await res.json();
      await refreshBackupList();
      if (info?.id) await downloadBackup(info.id);
      else setBackupStatus("备份已生成");
    } finally {
      if (button) button.disabled = false;
    }
  }

  switchButtons().forEach((button) => {
    button.addEventListener("click", () => {
      switchAccount().catch(() => {});
    });
  });
  backupButtons().forEach((button) => {
    button.addEventListener("click", () => openBackupDialog());
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = backupDialog();
    if (modal && !modal.hidden) closeBackupDialog();
  });
  window.deskAccountReady = loadName();
})();
