import fs from "node:fs/promises";
import path from "node:path";

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("../dist/server/index.js").then((m) => m.default);
  }
  return workerPromise;
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export default async function handler(req, res) {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const fullUrl = `${proto}://${host}${req.url}`;
    const urlObj = new URL(req.url, `${proto}://${host}`);
    const pathname = urlObj.pathname;
    const ext = path.extname(pathname).toLowerCase();

    // 1. Direct Static File Serving for CSS, JS, WASM, Models, etc.
    if (ext && MIME_TYPES[ext]) {
      // Check in dist/client first
      try {
        const clientPath = path.join(process.cwd(), "dist/client", pathname);
        const data = await fs.readFile(clientPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", MIME_TYPES[ext]);
        res.setHeader("Cache-Control", pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "public, max-age=86400");
        return res.end(data);
      } catch {}

      // Check in public folder
      try {
        const publicPath = path.join(process.cwd(), "public", pathname);
        const data = await fs.readFile(publicPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", MIME_TYPES[ext]);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.end(data);
      } catch {}
    }

    // 2. SSR Rendering via worker.fetch
    const worker = await getWorker();

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) {
        if (Array.isArray(v)) {
          v.forEach((val) => headers.append(k, val));
        } else {
          headers.set(k, v);
        }
      }
    }

    const webReq = new Request(fullUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      duplex: "half",
    });

    const webRes = await worker.fetch(
      webReq,
      {
        ASSETS: {
          fetch: async (assetReq) => {
            const url = new URL(assetReq.url);
            try {
              const filePath = path.join(process.cwd(), "dist/client", url.pathname);
              const data = await fs.readFile(filePath);
              const assetExt = path.extname(url.pathname).toLowerCase();
              const headers = new Headers();
              if (MIME_TYPES[assetExt]) headers.set("Content-Type", MIME_TYPES[assetExt]);
              return new Response(data, { headers });
            } catch {
              try {
                const publicPath = path.join(process.cwd(), "public", url.pathname);
                const publicData = await fs.readFile(publicPath);
                const assetExt = path.extname(url.pathname).toLowerCase();
                const headers = new Headers();
                if (MIME_TYPES[assetExt]) headers.set("Content-Type", MIME_TYPES[assetExt]);
                return new Response(publicData, { headers });
              } catch {
                return new Response("Not found", { status: 404 });
              }
            }
          },
        },
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      }
    );

    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    const arrayBuffer = await webRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Vercel handler error:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}
