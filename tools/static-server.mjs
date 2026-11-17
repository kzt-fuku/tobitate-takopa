// 検証・PDF 生成用の最小限の静的ファイルサーバー（127.0.0.1 のみで待ち受け）。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function startServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = createServer(async (request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");
    try {
      const body = await readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }).end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
