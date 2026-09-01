/** Design-desk login form. Stay valid JS — no Python headers. */
(function loginPage() {
  const form = document.getElementById("loginForm");
  const userEl = document.getElementById("loginUser");
  const passwordEl = document.getElementById("loginPassword");
  const nextEl = document.getElementById("loginNext");
  const errorEl = document.getElementById("loginError");
  const submitEl = document.getElementById("loginSubmit");
  if (!form || !userEl || !passwordEl || !nextEl || !errorEl || !submitEl) return;

  const params = new URLSearchParams(location.search);
  const nextPath = params.get("next") || "/";
  nextEl.value = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  function showError(message) {
    const text = String(message || "").trim();
    errorEl.hidden = !text;
    errorEl.textContent = text;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    submitEl.disabled = true;
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: userEl.value.trim(),
          password: passwordEl.value,
          next: nextEl.value,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        showError(data.error || "登录失败");
        return;
      }
      location.replace(data.next || nextEl.value || "/");
    } catch {
      showError("网络不通，请再试一次");
    } finally {
      submitEl.disabled = false;
    }
  });

  userEl.focus();
})();
