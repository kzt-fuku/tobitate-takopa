// puppeteer-core で使う Chrome の場所。CHROME_PATH で上書きできる。
import { existsSync } from "node:fs";

const DEFAULT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
];

export function launchOptions() {
  const executablePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATHS.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error("Chrome が見つかりません。CHROME_PATH に実行ファイルのパスを指定してください。");
  }
  return { executablePath, headless: true };
}
