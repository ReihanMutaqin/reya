import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the REYA application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang=["']id["']/i);
  assert.match(html, /<title>REYA[^<]*Robot AI Lokal Indonesia<\/title>/i);
  assert.match(html, /ROBOT AI LOKAL/i);
  assert.match(html, /Studio Suara/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
});

test("integrates Voicebox and Gemini Flash alongside Natural Indo", async () => {
  const [page, layout, server] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-ai/server.py", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useState<VoiceEngine>\("voicebox"\)/);
  assert.match(page, /useState\("F2"\)/);
  assert.match(page, />\s*Voicebox Studio\s*<\/button>/);
  assert.match(page, />\s*Natural Indo\s*<\/button>/);
  assert.match(page, /gemini-flash-latest/);
  assert.match(page, /Mainkan Musik/);
  assert.match(page, /handleHandMusic/);
  assert.match(layout, /title:\s*"REYA : Robot AI Lokal Indonesia"/);
  assert.match(server, /engine:\s*Literal\["supertonic",\s*"qwen",\s*"voicebox"\]\s*=\s*"supertonic"/);
  assert.match(server, /speaker:\s*str\s*=\s*"F2"/);
  assert.match(server, /lang="id"/);
  assert.match(server, /else 1\.06/);
});
