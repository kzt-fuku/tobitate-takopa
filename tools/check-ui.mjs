// 画面の動作確認（iPhone 相当の 375px / 390px）。GitHub API はモックに置き換える。
//   node tools/check-ui.mjs                 … test/fixtures/data.json（架空データ）で確認
//   TAKOPA_DATA=../private/data.json node tools/check-ui.mjs   … 実データで表示だけ確認
// スクリーンショットは SCREENSHOT_DIR（既定: OS の一時ディレクトリ）に保存する。
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "./static-server.mjs";
import { launchOptions } from "./browser.mjs";

const require = createRequire(import.meta.url);
const calc = require("../docs/js/calc.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = process.env.TAKOPA_DATA ? path.resolve(process.env.TAKOPA_DATA) : path.join(ROOT, "test", "fixtures", "data.json");
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "takopa-check");
const VIEWPORT_WIDTHS = [375, 390];
const VALID_TOKEN = "good-token";
const API_PREFIX = "https://api.github.com/repos/kzt-fuku/tobitate-takopa-data/contents/data.json";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const yen = (value) => `${Math.round(value).toLocaleString("ja-JP")}円`;

// GitHub Contents API のモック（sha が古い保存は 409 で拒否する）
function createMock(initial) {
  const mock = { data: structuredClone(initial), sha: "sha-1", puts: 0, seq: 1 };
  mock.setRemote = (data) => {
    mock.data = structuredClone(data);
    mock.seq += 1;
    mock.sha = `sha-${mock.seq}`;
  };
  mock.handle = (request) => {
    const auth = request.headers().authorization;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, PUT" };
    const json = (status, body) => request.respond({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return request.respond({ status: 204, headers: cors });
    if (auth !== `Bearer ${VALID_TOKEN}`) return json(401, { message: "Bad credentials" });
    if (request.method() === "GET") {
      return json(200, { sha: mock.sha, content: Buffer.from(JSON.stringify(mock.data, null, 2)).toString("base64") });
    }
    if (request.method() === "PUT") {
      const body = JSON.parse(request.postData());
      if (body.sha !== mock.sha) return json(409, { message: "sha mismatch" });
      mock.puts += 1;
      mock.setRemote(JSON.parse(Buffer.from(body.content, "base64").toString("utf8")));
      return json(200, { content: { sha: mock.sha } });
    }
    return json(405, {});
  };
  return mock;
}

function inspectLayout() {
  const doc = document.documentElement;
  return { overflow: doc.scrollWidth > window.innerWidth, scrollWidth: doc.scrollWidth, width: window.innerWidth };
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const initial = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const fullFlow = !process.env.TAKOPA_DATA; // 実データでは書き換えを伴う操作はしない
  const server = await startServer(path.join(ROOT, "docs"));
  const browser = await puppeteer.launch(launchOptions());
  const problems = [];

  try {
    for (const width of VIEWPORT_WIDTHS) {
      const label = `${width}px`;
      const fail = (message) => problems.push(`${label}: ${message}`);
      const mock = createMock(initial);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(IPHONE_UA);
      await page.setViewport({ width, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await page.setRequestInterception(true);
      page.on("request", (request) => (request.url().startsWith(API_PREFIX) ? mock.handle(request) : request.continue()));
      page.on("pageerror", (error) => fail(`JS エラー ${error.message}`));
      page.on("dialog", (dialog) => dialog.accept());

      const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());
      const click = (selector) => page.$eval(selector, (el) => el.click());
      const visible = (selector) => page.$eval(selector, (el) => !el.hidden && !el.closest("[hidden]"));
      const openTab = async (tab) => { await click(`.tab[data-tab="${tab}"]`); };
      const checkLayout = async (where) => {
        const layout = await page.evaluate(inspectLayout);
        if (layout.overflow) fail(`${where}: 横スクロールあり (${layout.scrollWidth}px)`);
      };
      const setField = async (key, value) => {
        await page.$eval(`#field-${key}`, (el, v) => {
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, String(value));
      };
      const setCheck = async (key, checked) => {
        await page.$eval(`#field-${key}`, (el, c) => {
          if (el.checked !== c) el.click();
        }, checked);
      };
      const choose = async (value) => {
        await page.$eval(`#form-sheet .choice-button[data-value="${value}"]`, (el) => el.click());
      };
      const submitForm = () => page.$eval("#form-sheet form", (form) => form.requestSubmit());
      const openPerson = (name) => page.evaluate((n) => {
        Array.from(document.querySelectorAll(".person")).find((b) => b.querySelector(".person-name").firstChild.textContent === n).click();
      }, name);

      // 1. 合言葉
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle0" });
      if (!(await visible("#lock"))) fail("合言葉の画面が出ない");
      await checkLayout("合言葉");
      await page.type("#lock-token", "wrong-token");
      await click("#lock-submit");
      await page.waitForFunction(() => !document.getElementById("lock-error").hidden);
      if (!(await text("#lock-error")).includes("合言葉")) fail("間違った合言葉のエラーが出ない");
      await page.type("#lock-token", VALID_TOKEN);
      await click("#lock-submit");
      await page.waitForSelector("#app:not([hidden])");

      // 2. 参加者一覧: 全員表示、色は calc の判定どおり
      const rows = await page.$$eval(".person", (els) => els.map((el) => ({ id: el.dataset.id, color: [...el.classList].find((c) => c.startsWith("color-")) })));
      if (rows.length !== initial.participants.length) fail(`参加者 ${rows.length}人表示（期待 ${initial.participants.length}）`);
      initial.participants.forEach((person) => {
        const row = rows.find((r) => r.id === person.id);
        if (!row || row.color !== `color-${calc.statusColor(person)}`) fail(`${person.name} の色: ${row && row.color}`);
      });
      await checkLayout("参加者");
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-participants.png`), fullPage: true });

      // 3. 各タブの表示
      for (const tab of ["accounting", "shopping", "info"]) {
        await openTab(tab);
        await checkLayout(tab);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-${tab}.png`), fullPage: true });
      }
      await openTab("accounting");
      const expectedIncome = calc.computeAccounting(initial, {}).income;
      const incomeText = await page.$eval(".income-table tfoot .amount", (el) => el.textContent);
      if (incomeText !== yen(expectedIncome)) fail(`収入合計 ${incomeText}（期待 ${yen(expectedIncome)}）`);

      if (!fullFlow) {
        console.log(`${label}: 実データ ${initial.participants.length}人の表示を確認（収入 ${incomeText}）`);
        await context.close();
        continue;
      }

      // 4. 料金を変えると合計が再計算される
      await page.$eval('.price-input[data-kind="stay"][data-category="high"]', (el) => {
        el.value = "4000";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const changed = structuredClone(initial);
      changed.prices.stay.high = 4000;
      const recalculated = await page.$eval(".income-table tfoot .amount", (el) => el.textContent);
      if (recalculated !== yen(calc.computeAccounting(changed, {}).income)) fail(`料金変更後の収入 ${recalculated}`);
      if (!(await page.$eval("#save-status", (el) => el.classList.contains("is-dirty")))) fail("変更後に未保存の表示にならない");

      // 5. 参加者の編集: 未確定の人を確定・11日泊にすると、たこパのみは押せなくなり、色が赤になる
      await openTab("participants");
      await openPerson("大学D");
      await choose("confirmed");
      await setCheck("stay11", true);
      const takoDisabled = await page.$eval("#field-takoOnly", (el) => el.disabled);
      if (!takoDisabled) fail("11日泊にしても「たこパのみ」が押せる");
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-edit.png`) });
      await submitForm();
      const colorD = await page.$eval('.person[data-id="p004"]', (el) => [...el.classList].find((c) => c.startsWith("color-")));
      if (colorD !== "color-red") fail(`編集後の色 ${colorD}`);

      // 6. 参加者の追加（名前なしはエラー）
      await click("#add-person");
      await submitForm();
      if (!(await visible("#form-sheet .form-error"))) fail("名前なしで追加できてしまう");
      await setField("name", "新しい人");
      await choose("confirmed");
      await setCheck("takoOnly", true);
      await submitForm();
      const count = await page.$$eval(".person", (els) => els.length);
      if (count !== initial.participants.length + 1) fail(`追加後 ${count}人`);

      // 7. 保存 → モックに反映
      await click("#save-button");
      await page.waitForFunction(() => document.getElementById("save-status").textContent.startsWith("保存済み"));
      const savedD = mock.data.participants.find((p) => p.id === "p004");
      if (mock.puts !== 1 || !savedD.stay11 || savedD.takoOnly || savedD.status !== "confirmed") fail(`保存内容: puts=${mock.puts} ${JSON.stringify(savedD)}`);
      if (mock.data.prices.stay.high !== 4000 || !mock.data.participants.some((p) => p.name === "新しい人")) fail("料金・追加が保存されていない");

      // 8. 買い物を追加すると会計の食費に入る
      await openTab("shopping");
      await page.evaluate(() => Array.from(document.querySelectorAll(".button")).find((b) => b.textContent.includes("買い物を追加")).click());
      await setField("name", "たこ");
      await setField("actual", "3000");
      await submitForm();
      await openTab("accounting");
      const foodRow = await page.$$eval(".steps tr", (trs) => trs.map((tr) => tr.textContent));
      if (!foodRow.some((t) => t.includes("食費（買い物リスト＋食費）") && t.includes(yen(1000 + 3000)))) fail(`食費: ${foodRow.join(" / ")}`);

      // 9. 集金チェック
      const paidBox = await page.$('.line-list input[type="checkbox"]');
      await paidBox.click();
      const collected = await page.$$eval(".summary-grid dd", (dds) => dds.map((d) => d.textContent));
      if (collected[0] === "0円") fail("支払い済みにしても集金済みが増えない");

      // 10. 競合: ほかの端末が先に保存 → 保存すると選択肢が出る → 最新を使う
      const other = structuredClone(mock.data);
      other.event.title = "ほかの端末で変更";
      mock.setRemote(other);
      await click("#save-button");
      await page.waitForSelector("#conflict-sheet[open]");
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-conflict.png`) });
      await click("#conflict-load");
      await page.waitForFunction(() => document.getElementById("event-title").textContent === "ほかの端末で変更");
      if (await page.$eval("#save-status", (el) => el.classList.contains("is-dirty"))) fail("最新を読み込んでも未保存のまま");

      // 11. 競合: この端末の変更で上書き
      await openTab("info");
      await page.evaluate(() => document.querySelector('[data-section] .button-small').click());
      await setField("body", "上書きした本文");
      await submitForm();
      mock.setRemote(Object.assign(structuredClone(mock.data), { event: { title: "さらに別の変更" } }));
      await click("#save-button");
      await page.waitForSelector("#conflict-sheet[open]");
      await click("#conflict-overwrite");
      await page.waitForFunction(() => document.getElementById("save-status").textContent.startsWith("保存済み"));
      if (mock.data.sections[0].body !== "上書きした本文") fail("上書き保存されていない");

      // 12. 未保存の下書きは再読み込みしても残る。合言葉も残る
      await openTab("participants");
      await openPerson("高校F");
      await setField("note", "下書きのテスト");
      await submitForm();
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForSelector("#app:not([hidden])");
      const note = await page.evaluate(() => JSON.parse(localStorage.getItem("takopa-draft-v1")).data.participants.find((p) => p.id === "p006").note);
      if (note !== "下書きのテスト" || !(await page.$eval("#save-status", (el) => el.classList.contains("is-dirty")))) fail("再読み込みで下書きが消えた");

      // 13. 削除と元に戻す
      await openPerson("高校E");
      await page.$eval("#form-sheet .button-danger", (el) => el.click());
      if ((await page.$$eval(".person", (els) => els.length)) !== initial.participants.length) fail("削除できない");
      await click("#toast-undo");
      if ((await page.$$eval(".person", (els) => els.length)) !== initial.participants.length + 1) fail("削除を元に戻せない");

      console.log(`${label}: 合言葉、一覧の色、料金の再計算、編集・追加・削除、保存、競合（最新を使う・上書き）、下書き、買い物、集金を確認`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`スクリーンショット: ${SCREENSHOT_DIR}`);
  if (problems.length) {
    problems.forEach((p) => console.error("NG:", p));
    process.exitCode = 1;
  } else {
    console.log("OK: 問題なし");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
