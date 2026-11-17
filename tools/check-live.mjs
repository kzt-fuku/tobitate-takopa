// 公開ページ × 本物の GitHub API での確認。本番データ（main）は変更しない:
// データ用リポジトリに一時ブランチを作り、ページの読み書き先をそのブランチに差し替えて試し、最後に削除する。
//   TAKOPA_TOKEN=... node tools/check-live.mjs [ページの URL]
// 参加者名などは出力しない（件数と結果だけ）。
import puppeteer from "puppeteer-core";
import { launchOptions } from "./browser.mjs";

const PAGE_URL = process.argv[2] || "https://kzt-fuku.github.io/tobitate-takopa/";
const TOKEN = process.env.TAKOPA_TOKEN;
const OWNER = "kzt-fuku";
const REPO = "tobitate-takopa-data";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const BRANCH = `ui-test-${Date.now()}`;

if (!TOKEN) {
  console.error("TAKOPA_TOKEN にトークンを指定してください");
  process.exit(1);
}

async function gh(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok && response.status !== 204) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function readBranch(branch) {
  const json = await gh("GET", `/contents/data.json?ref=${branch}`);
  return { sha: json.sha, data: JSON.parse(Buffer.from(json.content, "base64").toString("utf8")) };
}

async function writeBranch(branch, data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");
  return gh("PUT", "/contents/data.json", { message, content, sha, branch });
}

async function main() {
  const problems = [];
  const fail = (message) => problems.push(message);
  const mainBefore = await readBranch("main");
  const head = await gh("GET", "/git/ref/heads/main");
  await gh("POST", "/git/refs", { ref: `refs/heads/${BRANCH}`, sha: head.object.sha });
  console.log(`一時ブランチ ${BRANCH} を作成`);

  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    // ページの読み書き先を一時ブランチに差し替える
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(`${API}/contents/data.json`)) return request.continue();
      if (request.method() === "GET") return request.continue({ url: url.replace(/ref=main\b/, `ref=${BRANCH}`) });
      if (request.method() === "PUT") {
        const body = JSON.parse(request.postData());
        body.branch = BRANCH;
        return request.continue({ postData: JSON.stringify(body) });
      }
      return request.continue();
    });
    page.on("pageerror", (error) => fail(`JS エラー ${error.message}`));

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    const version = await page.$eval('meta[name="app-version"]', (el) => el.content);
    await page.evaluate((token) => localStorage.setItem("takopa-token", token), TOKEN);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("#app:not([hidden])", { timeout: 20000 });
    const count = await page.$$eval(".person", (els) => els.length);
    if (count !== mainBefore.data.participants.length) fail(`参加者 ${count}人表示（データは ${mainBefore.data.participants.length}人）`);
    console.log(`公開ページ v${version} で本物の API から ${count}人を読み込み`);

    // 保存: 買い物の1品目を購入済みにする
    await page.$eval('.tab[data-tab="shopping"]', (el) => el.click());
    const firstId = mainBefore.data.shopping[0].id;
    await page.$eval(".shop-item .row-check", (el) => el.click());
    await page.$eval("#save-button", (el) => el.click());
    await page.waitForFunction(() => document.getElementById("save-status").textContent.startsWith("保存済み"), { timeout: 20000 });
    const afterSave = await readBranch(BRANCH);
    if (!afterSave.data.shopping.find((b) => b.id === firstId).purchased) fail("保存が一時ブランチに反映されていない");
    else console.log("保存 → GitHub に反映を確認");

    // 競合: ほかの端末が先に保存 → この端末で保存すると選択肢が出る
    const other = structuredClone(afterSave.data);
    other.event.title = `${other.event.title}（別端末テスト）`;
    await writeBranch(BRANCH, other, afterSave.sha, "別端末からの保存（テスト）");
    await page.$eval(".shop-item .row-check", (el) => el.click());
    await page.$eval("#save-button", (el) => el.click());
    await page.waitForSelector("#conflict-sheet[open]", { timeout: 20000 });
    await page.$eval("#conflict-load", (el) => el.click());
    await page.waitForFunction((t) => document.getElementById("event-title").textContent === t, { timeout: 20000 }, other.event.title);
    console.log("競合の検出 → 最新の読み込みを確認");

    const mainAfter = await readBranch("main");
    if (mainAfter.sha !== mainBefore.sha) fail("本番データ（main）が変わってしまった");
  } finally {
    await browser.close();
    await gh("DELETE", `/git/refs/heads/${BRANCH}`);
    console.log(`一時ブランチ ${BRANCH} を削除`);
  }

  if (problems.length) {
    problems.forEach((p) => console.error("NG:", p));
    process.exitCode = 1;
  } else {
    console.log("OK: 本番データは変更なし");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
