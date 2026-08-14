import fs from "node:fs/promises";
import path from "node:path";

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("../dist/server/index.js").then((m) => m.default);
  }
  return workerPromise;
}

export default async function handler(req, res) {
  try {
    const worker = await getWorker();
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const fullUrl = `${proto}://${host}${req.url}`;

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
              return new Response(data);
            } catch {
              try {
                const publicPath = path.join(process.cwd(), "public", url.pathname);
                const publicData = await fs.readFile(publicPath);
                return new Response(publicData);
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
