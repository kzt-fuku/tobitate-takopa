// 起動・合言葉・タブ切り替え・保存（他端末との同期）
(function () {
  "use strict";

  const store = window.TakopaStore;
  const { toast, setupSheet, openSheet, closeSheet } = window.TakopaUI;
  const views = window.TakopaViews;

  const TABS = ["participants", "accounting", "shopping", "info"];
  const DEFAULT_TAB = "participants";

  const lock = document.getElementById("lock");
  const lockForm = document.getElementById("lock-form");
  const lockToken = document.getElementById("lock-token");
  const lockError = document.getElementById("lock-error");
  const lockSubmit = document.getElementById("lock-submit");
  const bootStatus = document.getElementById("boot-status");
  const app = document.getElementById("app");
  const panel = document.getElementById("tab-panel");
  const saveStatus = document.getElementById("save-status");
  const saveButton = document.getElementById("save-button");
  const reloadButton = document.getElementById("reload-button");
  const conflictSheet = document.getElementById("conflict-sheet");

  let currentTab = DEFAULT_TAB;
  let busy = false;

  document.querySelectorAll("dialog").forEach(setupSheet);

  // ---------- 画面 ----------

  const ctx = {
    update: (mutator) => store.update(mutator),
    rerender: () => render(),
    forget: () => {
      if (store.dirty && !window.confirm("保存していない変更があります。削除すると変更は失われます。削除しますか？")) return;
      store.forget();
      showLock("この端末から合言葉を削除しました。");
    },
  };

  function render() {
    if (!store.data) return;
    document.getElementById("event-title").textContent = (store.data.event && store.data.event.title) || "主催者ページ";
    document.querySelectorAll(".tab").forEach((tab) => {
      const selected = tab.dataset.tab === currentTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.classList.toggle("is-active", selected);
    });
    views[currentTab](panel, store.data, ctx);
  }

  function selectTab(tab) {
    currentTab = TABS.includes(tab) ? tab : DEFAULT_TAB;
    if (location.hash !== `#${currentTab}`) history.replaceState(null, "", `#${currentTab}`);
    render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));

  function updateSaveBar() {
    if (busy) return;
    saveStatus.textContent = store.dirty ? "保存していない変更があります" : "保存済み（ほかの端末にも反映）";
    saveStatus.classList.toggle("is-dirty", store.dirty);
    saveButton.disabled = !store.dirty;
  }

  function setBusy(message) {
    busy = Boolean(message);
    saveButton.disabled = busy || !store.dirty;
    reloadButton.disabled = busy;
    if (message) {
      saveStatus.textContent = message;
      saveStatus.classList.remove("is-dirty");
    } else {
      updateSaveBar();
    }
  }

  store.subscribe(() => {
    render();
    updateSaveBar();
  });

  // ---------- 合言葉 ----------

  function showLock(message) {
    app.hidden = true;
    bootStatus.hidden = true;
    lock.hidden = false;
    lockError.textContent = message || "";
    lockError.hidden = !message;
    lockToken.value = "";
  }

  async function start() {
    bootStatus.hidden = false;
    lock.hidden = true;
    try {
      const result = await store.load();
      bootStatus.hidden = true;
      app.hidden = false;
      selectTab(location.hash.slice(1));
      updateSaveBar();
      if (result.restoredDraft) toast("この端末の未保存の変更を復元しました");
      if (result.draftConflict) showConflict("draft", result.draftConflict);
    } catch (error) {
      console.error("load failed:", error);
      if (error.kind === "auth" || error.kind === "notfound") {
        store.forget();
        showLock(error.message);
      } else {
        bootStatus.textContent = `${error.message}。通信状況を確認して、ページを再読み込みしてください。`;
        bootStatus.classList.add("is-error");
      }
    }
  }

  lockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = lockToken.value.trim();
    if (!value) return;
    lockSubmit.disabled = true;
    store.setToken(value);
    await start();
    lockSubmit.disabled = false;
  });

  // ---------- 保存・読み込み・競合 ----------

  function saveLabel() {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  let pendingDraft = null;
  function showConflict(kind, draft) {
    pendingDraft = draft || null;
    document.getElementById("conflict-text").textContent = kind === "draft"
      ? "この端末に保存していない変更が残っていますが、そのあと別の端末で保存されています。どちらを使いますか？"
      : "この端末で編集している間に、別の端末で保存されました。どちらを使いますか？";
    openSheet(conflictSheet);
  }

  document.getElementById("conflict-load").addEventListener("click", async () => {
    closeSheet(conflictSheet);
    pendingDraft = null;
    await run("読み込み中…", () => store.reload(), "最新の内容を読み込みました");
  });

  document.getElementById("conflict-overwrite").addEventListener("click", async () => {
    closeSheet(conflictSheet);
    if (pendingDraft) {
      store.restoreDraftOver(pendingDraft);
      pendingDraft = null;
    }
    await run("保存中…", () => store.overwrite(saveLabel()), "上書き保存しました");
  });

  document.getElementById("conflict-cancel").addEventListener("click", () => {
    closeSheet(conflictSheet);
    if (pendingDraft) {
      // 下書きは選ぶまで残しておく（最新を表示しつつ、次回起動時にもう一度聞く）
      pendingDraft = null;
    }
  });

  async function run(message, action, doneMessage) {
    setBusy(message);
    try {
      await action();
      if (doneMessage) toast(doneMessage);
      return true;
    } catch (error) {
      console.error(error);
      if (error.kind === "conflict") showConflict("save");
      else if (error.kind === "auth") toast(`${error.message}。「情報」タブから合言葉を入れ直してください`);
      else toast(`${error.message}。もう一度お試しください`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  saveButton.addEventListener("click", () => run("保存中…", () => store.save(saveLabel()), "保存しました。ほかの端末にも反映されます"));

  reloadButton.addEventListener("click", async () => {
    if (store.dirty) {
      showConflict("save");
      return;
    }
    await run("読み込み中…", () => store.reload(), "最新の内容を読み込みました");
  });

  // 画面に戻ってきたとき、変更がなければ他の端末の保存を自動で読み込む
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || app.hidden || busy || store.dirty || !store.hasToken()) return;
    try {
      const remote = await store.remoteChanged();
      if (remote && !store.dirty) {
        store.applyRemote(remote);
        toast("ほかの端末で保存された内容を読み込みました");
      }
    } catch (error) {
      console.warn("remote check failed:", error);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (store.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  window.addEventListener("hashchange", () => {
    if (!app.hidden) selectTab(location.hash.slice(1));
  });

  if (store.hasToken()) start();
  else showLock();
})();
