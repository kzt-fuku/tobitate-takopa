// データの読み込み・保存（GitHub Contents API）と、端末内の下書き。
// 保存は sha による楽観的排他: 他の端末が先に保存していたら上書きせず ConflictError を返す。
(function (global) {
  "use strict";

  const TOKEN_KEY = "takopa-token";
  const DRAFT_KEY = "takopa-draft-v1";
  const REQUEST_TIMEOUT_MS = 15000;

  class StoreError extends Error {
    constructor(kind, message) {
      super(message);
      this.kind = kind; // "auth" | "notfound" | "conflict" | "network" | "server"
    }
  }

  const config = global.TAKOPA_CONFIG;
  let token = readStorage(TOKEN_KEY) || "";
  let remoteSha = null;
  let working = null; // 編集中のデータ
  let dirty = false;
  const listeners = [];

  function readStorage(key) {
    try { return global.localStorage.getItem(key); } catch { return null; }
  }

  function writeStorage(key, value) {
    try {
      if (value === null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, value);
    } catch (error) {
      console.warn("localStorage unavailable:", error);
    }
  }

  // UTF-8 の JSON を base64 にする（GitHub API の content 形式）
  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(binary);
  }

  function decodeBase64(base64) {
    const binary = atob(base64.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function contentsUrl() {
    return `${config.apiBase}/repos/${config.owner}/${config.repo}/contents/${config.path}`;
  }

  async function request(method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      const url = method === "GET" ? `${contentsUrl()}?ref=${encodeURIComponent(config.branch)}` : contentsUrl();
      response = await fetch(url, {
        method,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new StoreError("network", error.name === "AbortError" ? "通信がタイムアウトしました" : "通信できませんでした");
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return response.json();
    if (response.status === 401) throw new StoreError("auth", "合言葉が違うか、有効期限が切れています");
    if (response.status === 403) throw new StoreError("auth", "この合言葉には書き込みの権限がありません（または利用回数の上限）");
    if (response.status === 404) throw new StoreError("notfound", "データが見つかりません（合言葉の権限を確認してください）");
    if (response.status === 409 || response.status === 422) throw new StoreError("conflict", "他の端末で先に保存されています");
    throw new StoreError("server", `GitHub の応答エラー（${response.status}）`);
  }

  async function fetchRemote() {
    const json = await request("GET");
    return { sha: json.sha, data: JSON.parse(decodeBase64(json.content)) };
  }

  function saveDraft() {
    if (dirty) writeStorage(DRAFT_KEY, JSON.stringify({ baseSha: remoteSha, data: working, savedAt: Date.now() }));
    else writeStorage(DRAFT_KEY, null);
  }

  function readDraft() {
    try {
      const raw = readStorage(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function notify() {
    listeners.forEach((listener) => listener({ data: working, dirty }));
  }

  // 起動時・再読み込み時。端末に未保存の下書きがあれば、その扱いを result.draftConflict で返す
  async function load() {
    const remote = await fetchRemote();
    remoteSha = remote.sha;
    const draft = readDraft();
    if (draft && draft.data) {
      if (draft.baseSha === remote.sha) {
        working = draft.data;
        dirty = true;
        notify();
        return { restoredDraft: true };
      }
      // 下書きの元になった版より新しい保存がある
      working = remote.data;
      dirty = false;
      notify();
      return { draftConflict: draft };
    }
    working = remote.data;
    dirty = false;
    notify();
    return {};
  }

  // 他の端末の最新を読み込む（未保存の変更は破棄）
  async function reload() {
    const remote = await fetchRemote();
    remoteSha = remote.sha;
    working = remote.data;
    dirty = false;
    saveDraft();
    notify();
  }

  function restoreDraftOver(draft) {
    working = draft.data;
    dirty = true;
    saveDraft();
    notify();
  }

  async function save(label) {
    const content = encodeBase64(JSON.stringify(working, null, 2) + "\n");
    const json = await request("PUT", {
      message: `データを更新（${label || "主催者ページ"}）`,
      content,
      sha: remoteSha,
      branch: config.branch,
    });
    remoteSha = json.content.sha;
    dirty = false;
    saveDraft();
    notify();
  }

  // 競合時に自分の変更で上書きする: 最新の sha だけ取り直して保存
  async function overwrite(label) {
    const remote = await fetchRemote();
    remoteSha = remote.sha;
    await save(label);
  }

  // データを変更する。mutator は working を直接書き換える
  function update(mutator) {
    mutator(working);
    dirty = true;
    saveDraft();
    notify();
  }

  // 他の端末で保存されたかだけを確かめる（画面に戻ったとき用）
  async function remoteChanged() {
    const remote = await fetchRemote();
    return remote.sha !== remoteSha ? remote : null;
  }

  function applyRemote(remote) {
    remoteSha = remote.sha;
    working = remote.data;
    dirty = false;
    saveDraft();
    notify();
  }

  global.TakopaStore = {
    StoreError,
    hasToken: () => Boolean(token),
    setToken(value) {
      token = value.trim();
      writeStorage(TOKEN_KEY, token);
    },
    // この端末から合言葉と下書きを消す
    forget() {
      token = "";
      writeStorage(TOKEN_KEY, null);
      writeStorage(DRAFT_KEY, null);
      working = null;
      dirty = false;
    },
    load,
    reload,
    restoreDraftOver,
    save,
    overwrite,
    update,
    remoteChanged,
    applyRemote,
    get data() { return working; },
    get dirty() { return dirty; },
    subscribe(listener) { listeners.push(listener); },
  };
})(window);
