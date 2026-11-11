import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

export interface EnchorSearchItem {
  id: string;
  md5: string;
  name: string;
  artist: string;
  album: string;
  charter: string;
  songLengthMs: number;
  hasLyrics: boolean;
  coverUrl?: string;
  previewUrl?: string;
  source?: "bitchord" | "spotify" | "apple" | "audius";
  popularity?: number;
  videoId?: string;
  saavnId?: string;
  saavnStreamUrl?: string;
  appleTrackId?: string;
  isrc?: string;
}

export interface LyricSyllable {
  text: string;
  beginMs: number;
  endMs: number;
}

export interface EnchorLyricLine {
  timeMs: number;
  endMs?: number;
  text: string;
  syllables?: LyricSyllable[];
}

export interface EnchorSongNote {
  note: string;
  dur: number;
  lyric?: string;
  timeMs: number;
}

export interface EnchorSongPayload {
  id: string;
  md5: string;
  name: string;
  artist: string;
  album: string;
  charter: string;
  songLengthMs: number;
  coverUrl: string;
  audioUrl: string | null;
  audioMime: string | null;
  lyrics: EnchorLyricLine[];
  melody: EnchorSongNote[];
  lyricsProvider?: string;
  audioProvider?: string;
}

const SCALE_NOTES = ["C", "D", "E", "F", "G", "A", "B", "C'"] as const;
const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ANDROID_VR_UA =
  "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

// ============================================================================
// 1. BITCHORD PURE-JS DES-ECB DECRYPTOR (JioSaavnService.kt port, key 38346591)
// ============================================================================

const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2,
  59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39,
  31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37,
  29, 21, 13, 5, 28, 20, 12, 4,
];
const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4,
  26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40,
  51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
  12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
  22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
const DES_S = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];
const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes[i >> 3] = b;
  }
  return bytes;
}

const desPermute = (bits: number[], table: number[]) => table.map((i) => bits[i - 1]);
const desRotL = (bits: number[], n: number) => bits.slice(n).concat(bits.slice(0, n));

const SAAVN_SUBKEYS: number[][] = (() => {
  const keyBits = desPermute(bytesToBits(Buffer.from("38346591", "utf8")), DES_PC1);
  let C = keyBits.slice(0, 28);
  let D = keyBits.slice(28, 56);
  return DES_SHIFTS.map((sh) => {
    C = desRotL(C, sh);
    D = desRotL(D, sh);
    return desPermute(C.concat(D), DES_PC2);
  });
})();

function decryptSaavnMediaUrl(encryptedB64: string, supports320: boolean): string | null {
  if (!encryptedB64 || !encryptedB64.trim()) return null;
  try {
    const data = Buffer.from(encryptedB64.trim(), "base64");
    if (data.length < 8 || data.length % 8 !== 0) return null;
    const out: number[] = [];
    for (let off = 0; off < data.length; off += 8) {
      const block = desPermute(bytesToBits(data.subarray(off, off + 8)), DES_IP);
      let L = block.slice(0, 32);
      let R = block.slice(32, 64);
      for (let r = 15; r >= 0; r--) {
        const exp = desPermute(R, DES_E);
        const x = exp.map((b, i) => b ^ SAAVN_SUBKEYS[r][i]);
        const sOut: number[] = [];
        for (let sb = 0; sb < 8; sb++) {
          const chunk = x.slice(sb * 6, sb * 6 + 6);
          const row = (chunk[0] << 1) | chunk[5];
          const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
          const val = DES_S[sb][row * 16 + col];
          sOut.push((val >> 3) & 1, (val >> 2) & 1, (val >> 1) & 1, val & 1);
        }
        const f = desPermute(sOut, DES_P);
        const nextR = L.map((b, i) => b ^ f[i]);
        L = R;
        R = nextR;
      }
      out.push(...bitsToBytes(desPermute(R.concat(L), DES_FP)));
    }
    const buf = Buffer.from(out);
    const pad = buf[buf.length - 1];
    const unpadded = pad >= 1 && pad <= 8 ? buf.subarray(0, buf.length - pad) : buf;
    const decrypted = unpadded.toString("utf8").trim().replace(/^http:\/\//i, "https://");
    if (!decrypted.startsWith("https://")) return null;
    if (supports320) {
      return decrypted.replace(/_(48|96|160)\.(mp4|aac|mp3)(?=[?#]|$)/i, "_320.$2");
    }
    return decrypted;
  } catch {
    return null;
  }
}

// ============================================================================
// 2. BITCHORD TRACK MATCHER (Port of BitChord/web/app/src/data/match/trackMatcher.ts)
// ============================================================================

export interface MatchCandidate {
  title: string;
  artist: string;
  durationSec: number | null;
  album?: string | null;
}

export interface MatchTarget {
  title: string;
  artist?: string;
  durationSec?: number | null;
  album?: string | null;
}

const VERSION_WORDS = new Set([
  "remix", "remixes", "rmx", "refix", "flip", "bootleg", "mashup", "medley",
  "live", "concert", "unplugged", "acoustic", "instrumental", "karaoke",
  "vocals", "vocal", "acapella", "acappella", "backing", "stems", "stem",
  "cover", "demo", "reprise", "remake", "rework", "extended", "edit",
  "version", "mix", "dub", "vip", "session", "sessions",
  "sped", "slowed", "reverb", "nightcore", "lofi", "orchestral", "symphonic",
]);

const NOISE_WORDS = new Set([
  "official", "video", "audio", "lyrics", "lyric", "lyrical", "visualizer",
  "song", "songs", "full", "music", "the", "and", "from", "feat", "ft",
  "featuring", "with", "new", "latest", "free", "download", "remaster",
  "remastered", "explicit", "clean", "bonus", "track", "deluxe", "original",
  "album", "single", "hd", "hq", "4k", "mp3",
]);

const NEUTRAL_SEGMENTS = new Set([
  "albumversion", "originalversion", "originalmix", "singleversion",
  "radioversion", "radioedit", "stereoversion", "monoversion",
  "studioversion", "fullversion", "standardversion", "explicitversion",
  "deluxeversion", "originaltrack",
]);

const ARTIST_SEPARATORS = /\s*(?:[,&/;·|、，×]|\band\b|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/i;

function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ");
}

function stripNonAlnum(w: string): string {
  return w.replace(/[^\p{L}\p{N}]/gu, "");
}

function wordsOf(text: string): string[] {
  return text
    .split(/[\s.·~〜]+/u)
    .map(stripNonAlnum)
    .filter((w) => w.length > 0);
}

interface ParsedTitle {
  words: string[];
  core: string;
  versions: Set<string>;
}

function classifySegment(seg: string, versions: Set<string>) {
  const w = wordsOf(seg);
  if (!w.length) return;
  if (NEUTRAL_SEGMENTS.has(w.join(""))) return;
  for (const token of w) {
    if (VERSION_WORDS.has(token)) versions.add(token);
  }
}

export function parseTitleForMatch(raw: string): ParsedTitle {
  const versions = new Set<string>();
  let text = normalizeText(raw);

  for (let pass = 0; pass < 3; pass++) {
    text = text.replace(/[([]([^()[\]]*)[)\]]/g, (_, inner: string) => {
      classifySegment(inner, versions);
      return " ";
    });
  }

  const dashMatch = /\s+[-–—|]+\s+/.exec(text);
  if (dashMatch) {
    const tail = text.slice(dashMatch.index + dashMatch[0].length);
    classifySegment(tail, versions);
    text = text.slice(0, dashMatch.index);
  }

  text = text.replace(/\b(feat|ft|featuring|with)\b.*/gi, " ");
  const words = wordsOf(text).filter((w) => !NOISE_WORDS.has(w));
  for (const w of words) {
    if (VERSION_WORDS.has(w)) versions.add(w);
  }
  const coreWords = words.filter((w) => !VERSION_WORDS.has(w));
  const core = (coreWords.length ? coreWords : words).join("");
  return { words, core, versions };
}

function artistWordSets(artist: string): string[][] {
  const out: string[][] = [];
  for (const part of normalizeText(artist).split(ARTIST_SEPARATORS)) {
    const w = wordsOf(part.replace(/ - topic$/i, "")).filter((x) => x.length > 1);
    if (w.length) out.push(w);
  }
  return out;
}

export function sharesArtist(wanted: string, got: string): boolean {
  const wSets = artistWordSets(wanted);
  const gSets = artistWordSets(got);
  if (!wSets.length || !gSets.length) return false;
  return wSets.some((w) =>
    gSets.some((g) => {
      const wStr = w.join(" ");
      const gStr = g.join(" ");
      return wStr === gStr || wStr.includes(gStr) || gStr.includes(wStr);
    }),
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function scoreCandidate(candidate: MatchCandidate, target: MatchTarget): number | null {
  const wanted = parseTitleForMatch(target.title);
  const got = parseTitleForMatch(candidate.title);
  if (!wanted.core || !got.core) return null;

  const isTitleMatch =
    wanted.core === got.core ||
    (wanted.core.length > 3 &&
      got.core.length > 3 &&
      (wanted.core.includes(got.core) || got.core.includes(wanted.core)));
  if (!isTitleMatch) return null;

  const albumMarks = candidate.album ? parseTitleForMatch(candidate.album).versions : new Set<string>();
  const effectiveVersions = new Set([...got.versions]);
  for (const m of albumMarks) {
    if (wanted.versions.has(m) || m === "instrumental" || m === "karaoke") {
      effectiveVersions.add(m);
    }
  }
  if (!sameSet(wanted.versions, effectiveVersions)) return null;

  const hasArtistTarget = Boolean(target.artist && target.artist.trim());
  const artistMatched = hasArtistTarget ? sharesArtist(target.artist!, candidate.artist) : true;

  const wantDur = target.durationSec && target.durationSec > 0 ? Math.round(target.durationSec) : null;
  const gotDur = candidate.durationSec && candidate.durationSec > 0 ? Math.round(candidate.durationSec) : null;
  let durPts = 0;
  if (wantDur !== null && gotDur !== null) {
    const drift = Math.abs(wantDur - gotDur);
    if (drift > 30) return null;
    durPts = drift <= 3 ? 40 : 15;
  }

  if (hasArtistTarget && !artistMatched) {
    if (wantDur !== null && gotDur !== null && Math.abs(wantDur - gotDur) <= 2) {
      return 70 + durPts;
    }
    return null;
  }

  return 100 + (artistMatched ? 25 : 0) + durPts;
}

export function bestCandidate<T extends MatchCandidate>(candidates: T[], target: MatchTarget): T | null {
  const scored = candidates
    .map((c) => ({ c, s: scoreCandidate(c, target) }))
    .filter((x): x is { c: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.c ?? null;
}

export function forLyricsSearch(title: string): string {
  return (
    title
      .replace(/\s*[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi, " ")
      .replace(/\s+(feat|ft|featuring)\.?\s+.*$/gi, " ")
      .replace(
        /\s*[([]\s*(official\s*)?(music\s*)?(video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|full\s*song)\s*[)\]]/gi,
        " ",
      )
      .replace(/\s*[([]\s*official\s*[)\]]/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || title.trim()
  );
}

export function artistForLyricsSearch(artist: string): string {
  return artist.replace(/ - Topic$/i, "").split(ARTIST_SEPARATORS)[0]?.trim() || artist.trim();
}

export function decodeEntities(text: string): string {
  if (!text || !text.includes("&")) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const cp = Number(dec);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    })
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ============================================================================
// 3. BITCHORD YOUTUBE INNERTUBE (Innertube.kt + InnertubeParser.kt + ANDROID_VR)
// ============================================================================

let cachedVisitorData: { value: string; at: number } | null = null;

async function ensureVisitorData(): Promise<string | undefined> {
  if (cachedVisitorData && Date.now() - cachedVisitorData.at < 30 * 60_000) {
    return cachedVisitorData.value;
  }
  try {
    const res = await fetch("https://www.youtube.com/sw.js_data", {
      headers: { "User-Agent": WEB_USER_AGENT },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    const match = text.match(/Cg[A-Za-z0-9_%-]{40,}/);
    if (match?.[0]) {
      cachedVisitorData = { value: match[0], at: Date.now() };
      return match[0];
    }
  } catch {
    // Ignore
  }
  return undefined;
}

function collectRenderers(root: unknown, name: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(root)) {
    for (const item of root) collectRenderers(item, name, out);
  } else if (root && typeof root === "object") {
    const obj = root as Record<string, unknown>;
    if (obj[name] && typeof obj[name] === "object" && !Array.isArray(obj[name])) {
      out.push(obj[name] as Record<string, unknown>);
    }
    for (const val of Object.values(obj)) {
      collectRenderers(val, name, out);
    }
  }
  return out;
}

function runsToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { runs?: { text?: string }[]; simpleText?: string };
  if (Array.isArray(n.runs)) return n.runs.map((r) => r.text ?? "").join("");
  return typeof n.simpleText === "string" ? n.simpleText : "";
}

function parseDurationTextSec(text: string): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  if (m[3] !== undefined) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

async function searchYouTubeMusicSongs(query: string): Promise<EnchorSearchItem[]> {
  try {
    const visitorData = await ensureVisitorData();
    const res = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Origin": "https://music.youtube.com",
        Origin: "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": WEB_USER_AGENT,
        ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20250101.01.00",
            hl: "en",
            gl: "ID",
            ...(visitorData ? { visitorData } : {}),
          },
        },
        query,
        params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D", // Songs filter
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const rows = collectRenderers(data, "musicResponsiveListItemRenderer");
    const items: EnchorSearchItem[] = [];
    const seen = new Set<string>();

    for (const r of rows) {
      const playlistItemData = r.playlistItemData as { videoId?: string } | undefined;
      const videoId = playlistItemData?.videoId;
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);

      const flexCols = Array.isArray(r.flexColumns) ? (r.flexColumns as Record<string, unknown>[]) : [];
      const col0 = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer as { text?: unknown } | undefined;
      const col1 = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer as { text?: unknown } | undefined;
      const title = decodeEntities(runsToText(col0?.text).trim());
      if (!title) continue;

      const subtitle = decodeEntities(runsToText(col1?.text).trim());
      const parts = subtitle.split(" • ").map((p) => p.trim()).filter(Boolean);
      const durStr = [...parts].reverse().find((p) => /^\d+:\d{2}(?::\d{2})?$/.test(p));
      const durSec = (durStr ? parseDurationTextSec(durStr) : null) ?? 210;

      const nonMeta = parts.filter(
        (p) =>
          p !== durStr &&
          !/^(song|video|album|artist|playlist|episode|single|ep)$/i.test(p) &&
          !/\b(plays|views|ribu|juta|jt|rb)\b/i.test(p),
      );
      const artist = nonMeta[0] || "Artis Musik";
      const album = nonMeta[1] || title;

      const thumbObj = r.thumbnail as {
        musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url?: string; width?: number }[] } };
      } | undefined;
      const thumbs = thumbObj?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
      const bestThumb = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;

      items.push({
        id: `ytm-${videoId}`,
        md5: `ytm-${videoId}`,
        name: title,
        artist,
        album,
        charter: "BitChord YT Music (Full Audio + Word-Sync)",
        songLengthMs: durSec * 1000,
        hasLyrics: true,
        coverUrl: bestThumb,
        source: "bitchord",
        popularity: 95,
        videoId,
      });
    }
    return items;
  } catch {
    return [];
  }
}

const ytStreamUrlCache = new Map<string, { url: string; mime: string; at: number }>();

async function resolveYouTubeAndroidVrUrl(videoId: string): Promise<{ url: string; mime: string } | null> {
  const cached = ytStreamUrlCache.get(videoId);
  if (cached && Date.now() - cached.at < 15 * 60_000) {
    return { url: cached.url, mime: cached.mime };
  }

  const visitorData = await ensureVisitorData();
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ANDROID_VR_UA,
        ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: "1.65.10",
            ...(visitorData ? { visitorData } : {}),
            hl: "en",
            gl: "ID",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      playabilityStatus?: { status?: string };
      streamingData?: {
        adaptiveFormats?: Array<{
          itag?: number;
          url?: string;
          mimeType?: string;
          bitrate?: number;
        }>;
      };
    };
    if (data.playabilityStatus?.status !== "OK") return null;
    const formats = (data.streamingData?.adaptiveFormats ?? []).filter(
      (f) => f.url && f.mimeType?.startsWith("audio/"),
    );
    if (!formats.length) return null;

    // Prefer itag 140 / 139 (audio/mp4 AAC) for universal Safari/Chrome/Mobile support
    const mp4 =
      formats.find((f) => f.itag === 140) ||
      formats.find((f) => f.mimeType?.includes("mp4")) ||
      formats[0]!;
    const picked = {
      url: mp4.url!,
      mime: mp4.mimeType?.includes("mp4") ? "audio/mp4" : "audio/webm",
    };
    ytStreamUrlCache.set(videoId, { ...picked, at: Date.now() });
    return picked;
  } catch {
    return null;
  }
}

// ============================================================================
// 4. BITCHORD JIOSAAVN SERVICE (JioSaavnService.kt port — 320kbps Full MP4)
// ============================================================================

interface SaavnRawItem {
  id?: string;
  title?: string;
  image?: string;
  explicit_content?: string;
  more_info?: {
    album?: string;
    duration?: string;
    encrypted_media_url?: string;
    "320kbps"?: string;
    artistMap?: {
      primary_artists?: Array<{ id?: string; name?: string }>;
    };
  };
}

async function searchJioSaavnSongs(query: string, limit = 10): Promise<EnchorSearchItem[]> {
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=android&q=${encodeURIComponent(query)}&p=1&n=${limit}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": WEB_USER_AGENT,
        "X-Forwarded-For": "49.36.0.1",
        "X-Real-IP": "49.36.0.1",
        "Accept-Language": "en-IN,en;q=0.9",
        Cookie: "explicit_content=1",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: SaavnRawItem[] };
    const results = data.results ?? [];
    const out: EnchorSearchItem[] = [];

    for (const raw of results) {
      if (!raw.id || !raw.title) continue;
      const title = decodeEntities(raw.title.trim());
      const artists =
        raw.more_info?.artistMap?.primary_artists
          ?.map((a) => decodeEntities((a.name || "").trim()))
          .filter(Boolean)
          .join(", ") || "Artis Musik";
      const album = decodeEntities((raw.more_info?.album || title).trim());
      const durSec = Number.parseInt(raw.more_info?.duration || "0", 10) || 210;
      const supports320 = String(raw.more_info?.["320kbps"] || "").toLowerCase() === "true";
      const streamUrl = raw.more_info?.encrypted_media_url
        ? decryptSaavnMediaUrl(raw.more_info.encrypted_media_url, supports320)
        : null;
      if (!streamUrl) continue;

      const coverUrl = (raw.image || "")
        .replace(/150x150|50x50/g, "500x500")
        .replace(/^http:\/\//i, "https://");

      out.push({
        id: `saavn-${raw.id}`,
        md5: `saavn-${raw.id}`,
        name: title,
        artist: artists,
        album,
        charter: `BitChord (${supports320 ? "320kbps" : "160kbps"} Full + Word-Sync)`,
        songLengthMs: durSec * 1000,
        hasLyrics: true,
        coverUrl: coverUrl || undefined,
        previewUrl: streamUrl,
        saavnId: raw.id,
        saavnStreamUrl: durSec >= 80 ? streamUrl : undefined,
        source: "bitchord",
        popularity: durSec >= 90 ? 78 : 55,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ============================================================================
// 5. APPLE MUSIC / DEEZER / AUDIUS CATALOG SEARCH
// ============================================================================

async function searchAppleCatalog(query: string, country = "US"): Promise<EnchorSearchItem[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&country=${country}&limit=15`,
      { headers: { "User-Agent": WEB_USER_AGENT }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? [])
      .filter((t) => Boolean(t.trackName && t.artistName))
      .map((t, idx) => {
        const trackId = String(t.trackId || idx);
        return {
          id: `apple-${trackId}`,
          md5: `apple-${trackId}`,
          name: String(t.trackName),
          artist: String(t.artistName),
          album: String(t.collectionName || "Single"),
          charter: "Apple Music + BitChord Word-Sync",
          songLengthMs: typeof t.trackTimeMillis === "number" ? t.trackTimeMillis : 210000,
          hasLyrics: true,
          coverUrl:
            typeof t.artworkUrl100 === "string"
              ? t.artworkUrl100.replace("100x100bb", "500x500bb")
              : undefined,
          previewUrl: typeof t.previewUrl === "string" ? t.previewUrl : undefined,
          appleTrackId: trackId,
          source: "apple" as const,
          popularity: 85 - idx,
        };
      });
  } catch {
    return [];
  }
}

async function searchDeezerCatalog(query: string): Promise<EnchorSearchItem[]> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=15`,
      { headers: { "User-Agent": WEB_USER_AGENT }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return (data.data ?? [])
      .filter((t) => Boolean(t.title && t.artist))
      .map((t) => {
        const artistObj = t.artist as { name?: string } | undefined;
        const albumObj = t.album as { title?: string; cover_xl?: string; cover_big?: string } | undefined;
        const durSec = typeof t.duration === "number" && t.duration > 0 ? t.duration : 210;
        const rank = typeof t.rank === "number" ? Math.min(100, Math.round(t.rank / 10000)) : 80;
        const idStr = String(t.id);
        return {
          id: `dz-${idStr}`,
          md5: `dz-${idStr}`,
          name: String(t.title),
          artist: String(artistObj?.name || "Artis"),
          album: String(albumObj?.title || "Single"),
          charter: "Spotify / Deezer + BitChord Word-Sync",
          songLengthMs: durSec * 1000,
          hasLyrics: true,
          coverUrl: albumObj?.cover_xl || albumObj?.cover_big,
          previewUrl: typeof t.preview === "string" ? t.preview : undefined,
          source: "spotify" as const,
          popularity: rank,
        };
      });
  } catch {
    return [];
  }
}

async function searchAudiusCatalog(query: string): Promise<EnchorSearchItem[]> {
  try {
    const res = await fetch(
      `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=REYA_AI`,
      { signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return (data.data ?? []).slice(0, 8).map((t) => {
      const idStr = String(t.id || "");
      const userObj = t.user as { name?: string; handle?: string } | undefined;
      const artObj = t.artwork as { "480x480"?: string; "150x150"?: string } | undefined;
      const durSec = typeof t.duration === "number" && t.duration > 0 ? t.duration : 180;
      return {
        id: `audius-${idStr}`,
        md5: `audius-${idStr}`,
        name: String(t.title || "Track"),
        artist: String(userObj?.name || userObj?.handle || "Audius Artist"),
        album: "Audius Stream",
        charter: "Audius Open Stream (Full Audio)",
        songLengthMs: durSec * 1000,
        hasLyrics: true,
        coverUrl: artObj?.["480x480"] || artObj?.["150x150"],
        previewUrl: `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(idStr)}/stream?app_name=REYA_AI`,
        source: "audius" as const,
        popularity: 60,
      };
    });
  } catch {
    return [];
  }
}

// ============================================================================
// 6. BITCHORD MULTI-PROVIDER LYRICS ENGINE
//    Port of BitChord/web/app/src/lyrics/{providers,repository,parse}.ts
// ============================================================================

function parseTtmlTimestampMs(raw?: string | null): number | null {
  const val = raw?.trim();
  if (!val) return null;
  if (val.endsWith("ms")) {
    const ms = Number.parseFloat(val.slice(0, -2));
    return Number.isFinite(ms) ? Math.round(ms) : null;
  }
  const clean = val.replace(/s$/i, "");
  const parts = clean.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p)) || parts.length > 3) return null;
  const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  return Math.round(seconds * 1000);
}

export function parseBitChordTTML(ttml: string): EnchorLyricLine[] {
  const lines: EnchorLyricLine[] = [];
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(ttml)) !== null) {
    const pAttrs = pMatch[1] || "";
    const pInner = pMatch[2] || "";

    const pBegin = parseTtmlTimestampMs(/\bbegin="([^"]+)"/i.exec(pAttrs)?.[1]);
    const pEnd = parseTtmlTimestampMs(/\bend="([^"]+)"/i.exec(pAttrs)?.[1]);

    // Skip translation/romanization paragraphs if marked on <p>
    const pRole = /\bttm:role="([^"]+)"/i.exec(pAttrs)?.[1];
    if (pRole === "x-translation" || pRole === "x-roman") continue;

    // Remove background/translation nested spans before extracting lead spans
    const cleanedInner = pInner.replace(
      /<span\b[^>]*\bttm:role="(?:x-translation|x-roman|x-bg)"[^>]*>[\s\S]*?<\/span>/gi,
      "",
    );

    const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>(\s*)/gi;
    const syllables: LyricSyllable[] = [];
    let sMatch: RegExpExecArray | null;

    while ((sMatch = spanRegex.exec(cleanedInner)) !== null) {
      const sAttrs = sMatch[1] || "";
      const role = /\bttm:role="([^"]+)"/i.exec(sAttrs)?.[1];
      if (role === "x-translation" || role === "x-roman" || role === "x-bg") continue;

      const sBegin = parseTtmlTimestampMs(/\bbegin="([^"]+)"/i.exec(sAttrs)?.[1]);
      const sEnd = parseTtmlTimestampMs(/\bend="([^"]+)"/i.exec(sAttrs)?.[1]);
      const trailingSpace = sMatch[3] ? " " : "";
      const rawText = decodeEntities((sMatch[2] || "").replace(/<[^>]+>/g, "")) + trailingSpace;

      if (rawText.trim() && sBegin !== null) {
        syllables.push({
          text: rawText,
          beginMs: sBegin,
          endMs: sEnd !== null && sEnd > sBegin ? sEnd : sBegin + 260,
        });
      }
    }

    const plainText = decodeEntities(
      cleanedInner
        .replace(/<\/span>\s+<span/gi, "</span> <span")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );

    if (!plainText) continue;

    const lineStart = pBegin ?? syllables[0]?.beginMs ?? null;
    if (lineStart === null) continue;
    const lineEnd =
      pEnd ??
      (syllables.length > 0 ? syllables[syllables.length - 1]!.endMs : lineStart + 2800);

    lines.push({
      timeMs: lineStart,
      endMs: lineEnd,
      text: plainText,
      syllables: syllables.length > 0 ? syllables : undefined,
    });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function parseLyricsPlusJson(raw: string): EnchorLyricLine[] {
  try {
    const obj = JSON.parse(raw) as {
      lyrics?: Array<{
        time?: number;
        duration?: number;
        text?: string;
        syllabus?: Array<{ time?: number; duration?: number; text?: string }>;
      }>;
    };
    if (!Array.isArray(obj.lyrics) || !obj.lyrics.length) return [];
    const out: EnchorLyricLine[] = [];
    for (const row of obj.lyrics) {
      const timeMs = typeof row.time === "number" ? Math.round(row.time) : 0;
      const durMs = typeof row.duration === "number" ? Math.round(row.duration) : 2500;
      const syllables: LyricSyllable[] = [];
      for (const s of row.syllabus ?? []) {
        const st = typeof s.time === "number" ? Math.round(s.time) : timeMs;
        const sd = typeof s.duration === "number" ? Math.round(s.duration) : 240;
        const txt = decodeEntities(String(s.text ?? ""));
        if (txt.trim()) {
          syllables.push({ text: txt, beginMs: st, endMs: st + Math.max(80, sd) });
        }
      }
      const lineText = decodeEntities(
        (row.text || syllables.map((s) => s.text).join("")).replace(/\s+/g, " ").trim(),
      );
      if (!lineText) continue;
      out.push({
        timeMs,
        endMs: timeMs + Math.max(400, durMs),
        text: lineText,
        syllables: syllables.length > 0 ? syllables : undefined,
      });
    }
    return out.sort((a, b) => a.timeMs - b.timeMs);
  } catch {
    return [];
  }
}

export function parseSyncedLrc(lrc: string): EnchorLyricLine[] {
  const lines: EnchorLyricLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const m = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/.exec(rawLine.trim());
    if (!m) continue;
    const mins = Number.parseInt(m[1]!, 10);
    const secs = Number.parseInt(m[2]!, 10);
    const fracRaw = m[3] || "0";
    const fracMs =
      fracRaw.length === 1
        ? Number.parseInt(fracRaw, 10) * 100
        : fracRaw.length === 2
          ? Number.parseInt(fracRaw, 10) * 10
          : Number.parseInt(fracRaw.slice(0, 3), 10);
    const lineTimeMs = mins * 60_000 + secs * 1000 + fracMs;
    const content = m[4] || "";

    // Check Enhanced LRC word tags: <mm:ss.xx>word
    const wordRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
    const syllables: LyricSyllable[] = [];
    let wMatch: RegExpExecArray | null;
    while ((wMatch = wordRegex.exec(content)) !== null) {
      const wMin = Number.parseInt(wMatch[1]!, 10);
      const wSec = Number.parseInt(wMatch[2]!, 10);
      const wFracRaw = wMatch[3] || "0";
      const wFracMs =
        wFracRaw.length === 1
          ? Number.parseInt(wFracRaw, 10) * 100
          : wFracRaw.length === 2
            ? Number.parseInt(wFracRaw, 10) * 10
            : Number.parseInt(wFracRaw.slice(0, 3), 10);
      const beginMs = wMin * 60_000 + wSec * 1000 + wFracMs;
      const wText = decodeEntities(wMatch[4] || "");
      if (wText.trim()) {
        syllables.push({ text: wText, beginMs, endMs: beginMs + 280 });
      }
    }
    for (let i = 0; i < syllables.length - 1; i++) {
      if (syllables[i + 1]!.beginMs > syllables[i]!.beginMs) {
        syllables[i]!.endMs = syllables[i + 1]!.beginMs;
      }
    }

    const cleanText = decodeEntities(
      content
        .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
        .replace(/^<R>/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cleanText && !cleanText.startsWith("[")) {
      lines.push({
        timeMs: lineTimeMs,
        endMs: syllables.length > 0 ? syllables[syllables.length - 1]!.endMs : undefined,
        text: cleanText,
        syllables: syllables.length > 0 ? syllables : undefined,
      });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function buildFallbackSyllables(lines: EnchorLyricLine[], songLengthMs: number): EnchorLyricLine[] {
  return lines.map((line, idx) => {
    const nextLine = lines[idx + 1];
    const lineEndMs =
      line.endMs && line.endMs > line.timeMs
        ? line.endMs
        : nextLine
          ? Math.min(line.timeMs + 4200, Math.max(line.timeMs + 500, nextLine.timeMs - 100))
          : Math.min(songLengthMs, line.timeMs + 3200);

    if (line.syllables && line.syllables.length > 0) {
      return { ...line, endMs: lineEndMs };
    }

    const words = line.text.split(/\s+/).filter(Boolean);
    if (!words.length) return { ...line, endMs: lineEndMs };

    const totalChars = Math.max(1, words.reduce((acc, w) => acc + w.length, 0));
    const spanMs = Math.max(300, lineEndMs - line.timeMs);
    let cursorMs = line.timeMs;

    const syllables: LyricSyllable[] = words.map((word, wIdx) => {
      const share = Math.max(90, Math.round((word.length / totalChars) * spanMs));
      const beginMs = cursorMs;
      const endMs =
        wIdx === words.length - 1 ? lineEndMs : Math.min(lineEndMs, beginMs + share);
      cursorMs = endMs;
      return {
        text: wIdx < words.length - 1 ? `${word} ` : word,
        beginMs,
        endMs,
      };
    });

    return {
      ...line,
      endMs: lineEndMs,
      syllables,
    };
  });
}

function parseAnyProviderBody(raw: string): EnchorLyricLine[] {
  if (!raw || !raw.trim()) return [];
  let content = raw.trim();

  // Check if LyricsPlus v2 JSON
  if (content.startsWith("{") && content.includes('"lyrics"') && content.includes('"syllabus"')) {
    const lp = parseLyricsPlusJson(content);
    if (lp.length >= 3) return lp;
  }

  // Unwrap JSON envelope if present (e.g. BetterLyrics `{"ttml":"<tt..."}`)
  if (content.startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      for (const key of ["ttml", "ttmlContent", "syncedLyrics", "lyrics", "lrc", "content", "data"]) {
        if (typeof parsed[key] === "string" && (parsed[key] as string).trim()) {
          content = (parsed[key] as string).trim();
          break;
        }
      }
    } catch {
      // Keep raw string
    }
  }

  if (/&lt;tt/i.test(content)) {
    content = decodeEntities(content);
  }

  if (/<tt(?:\s|>)/i.test(content) || /http:\/\/www\.w3\.org\/ns\/ttml/i.test(content)) {
    const ttmlLines = parseBitChordTTML(content);
    if (ttmlLines.length >= 3) return ttmlLines;
  }

  const lrcLines = parseSyncedLrc(content);
  if (lrcLines.length >= 3) return lrcLines;

  return [];
}

// ---- BitChord Provider 1: BiniLyrics ISRC + TTML (lyrics-api.binimum.org) ----
interface BiniIdentification {
  isrc: string | null;
  lyricsUrl: string | null;
}

async function biniIdentify(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
): Promise<BiniIdentification> {
  try {
    const params = new URLSearchParams({
      track: forLyricsSearch(title),
      artist: artistForLyricsSearch(artist),
    });
    if (album?.trim()) params.set("album", album.trim());
    if (durationSec && durationSec > 0) params.set("duration", String(Math.round(durationSec)));

    const res = await fetch(`https://lyrics-api.binimum.org/?${params.toString()}`, {
      headers: { "User-Agent": WEB_USER_AGENT },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { isrc: null, lyricsUrl: null };
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        artist_name?: string;
        album_name?: string;
        duration?: number;
        isrc?: string;
        lyricsUrl?: string;
      }>;
    };
    const rows = (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      artist: r.artist_name ?? "",
      album: r.album_name ?? null,
      durationSec: r.duration && r.duration > 0 ? Math.round(r.duration) : null,
      isrc: r.isrc?.trim() || null,
      lyricsUrl: r.lyricsUrl?.trim() || null,
    }));
    const hit =
      bestCandidate(rows, { title, artist, album: album ?? null, durationSec: durationSec ?? null }) ??
      rows[0];
    return { isrc: hit?.isrc ?? null, lyricsUrl: hit?.lyricsUrl ?? null };
  } catch {
    return { isrc: null, lyricsUrl: null };
  }
}

// ---- BitChord Provider 2: lrc.red TTML (https://lrc.red) ----
async function fetchLrcRedLyrics(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
  knownIsrc?: string | null,
  knownLyricsUrl?: string | null,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  try {
    if (knownLyricsUrl) {
      const r = await fetch(knownLyricsUrl, {
        headers: { "User-Agent": WEB_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const lines = parseAnyProviderBody(await r.text());
        if (lines.length >= 3) return { lines, provider: "BitChord BiniLyrics / lrc.red TTML" };
      }
    }
    if (knownIsrc) {
      const r = await fetch(`https://lrc.red/s/${encodeURIComponent(knownIsrc)}.ttml`, {
        headers: { "User-Agent": WEB_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const lines = parseAnyProviderBody(await r.text());
        if (lines.length >= 3) return { lines, provider: "BitChord lrc.red TTML" };
      }
    }

    const q = `${forLyricsSearch(title)} ${artistForLyricsSearch(artist)}`.trim();
    const sRes = await fetch(`https://lrc.red/search.json?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": WEB_USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    if (!sRes.ok) return null;
    const sData = (await sRes.json()) as {
      hits?: Array<{ isrc?: string; title?: string; artist?: string; album?: string; duration?: number }>;
    };
    const hits = (sData.hits ?? [])
      .filter((h) => Boolean(h.isrc && h.title))
      .map((h) => ({
        isrc: h.isrc!,
        title: h.title!,
        artist: h.artist ?? "",
        album: h.album ?? null,
        durationSec: h.duration && h.duration > 0 ? Math.round(h.duration) : null,
      }));
    const best =
      bestCandidate(hits, { title, artist, album: album ?? null, durationSec: durationSec ?? null }) ??
      hits[0];
    if (!best?.isrc) return null;

    const ttmlRes = await fetch(`https://lrc.red/s/${encodeURIComponent(best.isrc)}.ttml`, {
      headers: { "User-Agent": WEB_USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    if (!ttmlRes.ok) return null;
    const lines = parseAnyProviderBody(await ttmlRes.text());
    return lines.length >= 3 ? { lines, provider: "BitChord lrc.red TTML" } : null;
  } catch {
    return null;
  }
}

// ---- BitChord Provider 3: BetterLyrics (lyrics-api.boidu.dev) ----
async function fetchBetterLyrics(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  const params = new URLSearchParams({
    s: forLyricsSearch(title),
    a: artistForLyricsSearch(artist),
  });
  if (durationSec && durationSec > 0) params.set("d", String(Math.round(durationSec)));
  if (album?.trim()) params.set("al", album.trim());

  for (const endpoint of ["getLyrics", "qq/getLyrics"]) {
    try {
      const res = await fetch(`https://lyrics-api.boidu.dev/${endpoint}?${params.toString()}`, {
        headers: { "User-Agent": WEB_USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const lines = parseAnyProviderBody(await res.text());
      if (lines.length >= 3) {
        return { lines, provider: "BitChord BetterLyrics TTML" };
      }
    } catch {
      // Next endpoint
    }
  }
  return null;
}

// ---- BitChord Provider 4: LyricsPlus (lyricsplus.prjktla.my.id & binimum) ----
async function fetchLyricsPlus(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
  isrc?: string | null,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  const params = new URLSearchParams({
    title: forLyricsSearch(title),
    artist: artistForLyricsSearch(artist),
    source: "apple,lyricsplus,musixmatch,spotify,musixmatch-word",
  });
  if (durationSec && durationSec > 0) params.set("duration", String(Math.round(durationSec)));
  if (album?.trim()) params.set("album", album.trim());
  if (isrc) params.set("isrc", isrc);

  for (const base of [
    "https://lyricsplus.prjktla.my.id",
    "https://lyricsplus.binimum.org",
    "https://lyricsplus-seven.vercel.app",
  ]) {
    try {
      const res = await fetch(`${base}/v2/lyrics/get?${params.toString()}`, {
        headers: { "User-Agent": WEB_USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const lines = parseAnyProviderBody(await res.text());
      if (lines.length >= 3) {
        return { lines, provider: "BitChord LyricsPlus Word-Sync" };
      }
    } catch {
      // Try next mirror
    }
  }
  return null;
}

// ---- BitChord Provider 5: Unison (unison.boidu.dev) & PaxSenix (lyrics.paxsenix.org) ----
async function fetchUnisonOrPaxSenix(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
  appleTrackId?: string,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  // Try PaxSenix Apple Music TTML if appleTrackId is known
  if (appleTrackId) {
    try {
      const paxRes = await fetch(
        `https://lyrics.paxsenix.org/apple-music/lyrics?id=${encodeURIComponent(appleTrackId)}&ttml=true`,
        { headers: { "User-Agent": WEB_USER_AGENT }, signal: AbortSignal.timeout(3500) },
      );
      if (paxRes.ok) {
        const lines = parseAnyProviderBody(await paxRes.text());
        if (lines.length >= 3) return { lines, provider: "BitChord PaxSenix Apple TTML" };
      }
    } catch {
      // Ignore
    }
  }

  try {
    const params = new URLSearchParams({
      song: forLyricsSearch(title),
      artist: artistForLyricsSearch(artist),
    });
    if (album?.trim()) params.set("album", album.trim());
    if (durationSec && durationSec > 0) params.set("duration", String(Math.round(durationSec)));

    const res = await fetch(`https://unison.boidu.dev/lyrics?${params.toString()}`, {
      headers: { "User-Agent": WEB_USER_AGENT },
      signal: AbortSignal.timeout(3800),
    });
    if (res.ok) {
      const lines = parseAnyProviderBody(await res.text());
      if (lines.length >= 3) return { lines, provider: "BitChord Unison Word-Sync" };
    }
  } catch {
    // Ignore
  }
  return null;
}

// ---- BitChord Provider 6: Musixmatch RichSync + Subtitles (providers.ts port) ----
const MXM_BASE = "https://apic.musixmatch.com/ws/1.1";
const MXM_FALLBACK_SECRET = "f09016176ba43a1cfd1031fbd6b3d26c";
let mxmTokenCache: { token: string; at: number } | null = null;

function mxmSignUrl(unsignedUrl: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const sig = crypto
    .createHmac("sha256", MXM_FALLBACK_SECRET)
    .update(`${unsignedUrl}${y}${m}${d}`)
    .digest("base64");
  return `${unsignedUrl}&signature=${encodeURIComponent(sig)}&signature_protocol=sha256`;
}

async function getMxmToken(): Promise<string | null> {
  if (mxmTokenCache && Date.now() - mxmTokenCache.at < 50 * 60_000) {
    return mxmTokenCache.token;
  }
  try {
    const unsigned = `${MXM_BASE}/token.get?app_id=web-desktop-app-v1.0&format=json&t=${Date.now()}`;
    const res = await fetch(mxmSignUrl(unsigned), {
      headers: { "User-Agent": WEB_USER_AGENT, Cookie: "x-mxm-token-guid=" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { body?: { user_token?: string } } };
    const token = data.message?.body?.user_token;
    if (token && token !== "UpgradeOnlyUpgradeOnlyUpgradeOnlyUpgradeOnly") {
      mxmTokenCache = { token, at: Date.now() };
      return token;
    }
  } catch {
    // Ignore
  }
  return null;
}

async function fetchMusixmatchLyrics(
  title: string,
  artist: string,
  durationSec?: number,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  try {
    const usertoken = await getMxmToken();
    if (!usertoken) return null;

    const searchParams = new URLSearchParams({
      app_id: "web-desktop-app-v1.0",
      format: "json",
      usertoken,
      q_track: forLyricsSearch(title),
      q_artist: artistForLyricsSearch(artist),
      page_size: "5",
      page: "1",
      f_has_lyrics: "1",
      t: String(Date.now()),
    });
    const searchRes = await fetch(mxmSignUrl(`${MXM_BASE}/track.search?${searchParams.toString()}`), {
      headers: { "User-Agent": WEB_USER_AGENT, Cookie: "x-mxm-token-guid=" },
      signal: AbortSignal.timeout(3500),
    });
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      message?: {
        body?: {
          track_list?: Array<{
            track?: {
              track_id?: number;
              commontrack_id?: number;
              track_name?: string;
              artist_name?: string;
              track_length?: number;
              has_richsync?: number;
              has_subtitles?: number;
            };
          }>;
        };
      };
    };
    const tracks = (searchData.message?.body?.track_list ?? [])
      .map((w) => w.track)
      .filter((t): t is NonNullable<typeof t> => Boolean(t?.track_id));
    if (!tracks.length) return null;

    const picked =
      bestCandidate(
        tracks.map((t) => ({
          title: t.track_name ?? "",
          artist: t.artist_name ?? "",
          durationSec: t.track_length ?? null,
          raw: t,
        })),
        { title, artist, durationSec: durationSec ?? null },
      )?.raw ?? tracks[0]!;

    // 1. Try RichSync word-by-word first
    if (picked.has_richsync && picked.track_id) {
      const rsParams = new URLSearchParams({
        app_id: "web-desktop-app-v1.0",
        format: "json",
        usertoken,
        track_id: String(picked.track_id),
        t: String(Date.now()),
      });
      const rsRes = await fetch(mxmSignUrl(`${MXM_BASE}/track.richsync.get?${rsParams.toString()}`), {
        headers: { "User-Agent": WEB_USER_AGENT, Cookie: "x-mxm-token-guid=" },
        signal: AbortSignal.timeout(3500),
      });
      if (rsRes.ok) {
        const rsData = (await rsRes.json()) as {
          message?: { body?: { richsync?: { richsync_body?: string } } };
        };
        const bodyStr = rsData.message?.body?.richsync?.richsync_body;
        if (bodyStr) {
          const rows = JSON.parse(bodyStr) as Array<{
            ts?: number;
            te?: number;
            x?: string;
            l?: Array<{ c?: string; o?: number }>;
          }>;
          const out: EnchorLyricLine[] = [];
          for (const r of rows) {
            if (typeof r.ts !== "number" || !r.x?.trim()) continue;
            const startMs = Math.round(r.ts * 1000);
            const endMs = typeof r.te === "number" ? Math.round(r.te * 1000) : startMs + 2500;
            const syllables: LyricSyllable[] = [];
            const pieces = r.l ?? [];
            for (let i = 0; i < pieces.length; i++) {
              const p = pieces[i]!;
              if (!p.c || !p.c.trim()) continue;
              const bMs = startMs + Math.round((p.o ?? 0) * 1000);
              const nextP = pieces[i + 1];
              const eMs = nextP ? startMs + Math.round((nextP.o ?? 0) * 1000) : endMs;
              const trailing = pieces[i + 1]?.c === " " ? " " : "";
              syllables.push({
                text: `${p.c}${trailing}`,
                beginMs: bMs,
                endMs: Math.max(bMs + 80, eMs),
              });
            }
            out.push({
              timeMs: startMs,
              endMs,
              text: r.x.trim(),
              syllables: syllables.length > 0 ? syllables : undefined,
            });
          }
          if (out.length >= 3) return { lines: out, provider: "BitChord Musixmatch RichSync" };
        }
      }
    }

    // 2. Fallback to Musixmatch Subtitles (LRC)
    if (picked.commontrack_id) {
      const subParams = new URLSearchParams({
        app_id: "web-desktop-app-v1.0",
        format: "json",
        usertoken,
        commontrack_id: String(picked.commontrack_id),
        subtitle_format: "lrc",
        t: String(Date.now()),
      });
      const subRes = await fetch(mxmSignUrl(`${MXM_BASE}/track.subtitle.get?${subParams.toString()}`), {
        headers: { "User-Agent": WEB_USER_AGENT, Cookie: "x-mxm-token-guid=" },
        signal: AbortSignal.timeout(3500),
      });
      if (subRes.ok) {
        const subData = (await subRes.json()) as {
          message?: { body?: { subtitle?: { subtitle_body?: string } } };
        };
        const subBody = subData.message?.body?.subtitle?.subtitle_body;
        if (subBody) {
          const lines = parseSyncedLrc(subBody);
          if (lines.length >= 3) return { lines, provider: "BitChord Musixmatch LRC" };
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

// ---- BitChord Provider 7: LRCLIB (lrclib.net) ----
async function fetchLrcLibLyrics(
  title: string,
  artist: string,
  album?: string,
  durationSec?: number,
): Promise<{ lines: EnchorLyricLine[]; provider: string } | null> {
  const cleanTitle = forLyricsSearch(title);
  const cleanArtist = artistForLyricsSearch(artist);

  try {
    const getParams = new URLSearchParams({
      track_name: cleanTitle,
      artist_name: cleanArtist,
    });
    if (album?.trim()) getParams.set("album_name", album.trim());
    if (durationSec && durationSec > 0) getParams.set("duration", String(Math.round(durationSec)));

    const directRes = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
      headers: { "User-Agent": "BitChord-REYA/2.0" },
      signal: AbortSignal.timeout(3500),
    });
    if (directRes.ok) {
      const item = (await directRes.json()) as { syncedLyrics?: string };
      if (item.syncedLyrics) {
        const parsed = parseSyncedLrc(item.syncedLyrics);
        if (parsed.length >= 3) return { lines: parsed, provider: "BitChord LRCLIB Synced" };
      }
    }
  } catch {
    // Fallback to search
  }

  try {
    const q = `${cleanTitle} ${cleanArtist}`.trim();
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": "BitChord-REYA/2.0" },
      signal: AbortSignal.timeout(3800),
    });
    if (!res.ok) return null;
    const items = (await res.json()) as Array<{
      trackName?: string;
      artistName?: string;
      albumName?: string;
      duration?: number;
      syncedLyrics?: string;
    }>;
    const syncedItems = items.filter((i) => typeof i.syncedLyrics === "string" && i.syncedLyrics.trim());
    if (!syncedItems.length) return null;

    const picked =
      bestCandidate(
        syncedItems.map((i) => ({
          title: i.trackName ?? "",
          artist: i.artistName ?? "",
          album: i.albumName ?? null,
          durationSec: i.duration ? Math.round(i.duration) : null,
          raw: i,
        })),
        { title, artist, album: album ?? null, durationSec: durationSec ?? null },
      )?.raw ?? syncedItems[0]!;

    if (picked.syncedLyrics) {
      const parsed = parseSyncedLrc(picked.syncedLyrics);
      if (parsed.length >= 3) return { lines: parsed, provider: "BitChord LRCLIB Synced" };
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * BitChord's Parallel Lyrics Race (Port of LyricsRepository.race):
 * Runs BiniIdentify (ISRC), lrc.red TTML, BetterLyrics TTML, LyricsPlus v2,
 * Unison/PaxSenix, Musixmatch RichSync, and LRCLIB concurrently.
 * Prefers word/syllable-synced results (`syllables` present) over line-only results.
 */
async function fetchBitChordLyricsRace(
  title: string,
  artist: string,
  songLengthMs: number,
  album?: string,
  appleTrackId?: string,
): Promise<{ lines: EnchorLyricLine[]; provider: string }> {
  const durationSec = songLengthMs > 0 ? Math.round(songLengthMs / 1000) : undefined;
  const biniPromise = biniIdentify(title, artist, album, durationSec);

  const candidates = await Promise.all([
    (async () => {
      const id = await biniPromise;
      return fetchLrcRedLyrics(title, artist, album, durationSec, id.isrc, id.lyricsUrl);
    })(),
    fetchBetterLyrics(title, artist, album, durationSec),
    (async () => {
      const id = await biniPromise;
      return fetchLyricsPlus(title, artist, album, durationSec, id.isrc);
    })(),
    fetchUnisonOrPaxSenix(title, artist, album, durationSec, appleTrackId),
    fetchMusixmatchLyrics(title, artist, durationSec),
    fetchLrcLibLyrics(title, artist, album, durationSec),
  ]);

  const valid = candidates.filter(
    (c): c is { lines: EnchorLyricLine[]; provider: string } => Boolean(c && c.lines.length >= 3),
  );

  // Prefer word/syllable-synced lyrics first (as BitChord's LyricsRepository.race does)
  const wordSynced = valid.find((c) => c.lines.some((l) => l.syllables && l.syllables.length > 0));
  const winner = wordSynced ?? valid[0];

  if (winner) {
    return {
      lines: buildFallbackSyllables(winner.lines, songLengthMs),
      provider: winner.provider,
    };
  }

  // Built-in full lyrics for classic Indonesian songs
  const tLower = title.toLowerCase();
  if (tLower.includes("balonku")) {
    const balonLines = [
      "Balonku ada lima, rupa-rupa warnanya",
      "Hijau, kuning, kelabu, merah muda dan biru",
      "Meletus balon hijau, DOR! Hatiku sangat kacau",
      "Balonku tinggal empat, kupegang erat-erat",
    ];
    const fullBalon: EnchorLyricLine[] = [];
    const totalMs = Math.max(songLengthMs, 120_000);
    let cur = 2000;
    let idx = 0;
    while (cur < totalMs - 4000) {
      const text = balonLines[idx % balonLines.length]!;
      fullBalon.push({ timeMs: cur, endMs: cur + 4800, text });
      cur += 5200;
      idx++;
    }
    return {
      lines: buildFallbackSyllables(fullBalon, totalMs),
      provider: "BitChord Indonesian Classics",
    };
  }

  // Fallback generated lyrics spanning the ENTIRE song duration so karaoke never stops early!
  const totalMs = Math.max(songLengthMs, 180_000);
  const loopPhrases = [
    `♪ ${title} - ${artist} ♪`,
    "Mari bernyanyi bersama REYA mengikuti irama",
    `${title} mengalun indah menemani harimu`,
    "Rasakan setiap nada dan ketukan musiknya ♪",
    `Suara musik ${artist} terus mengalun merdu`,
    "La la la~ REYA bernyanyi bersamamu sampai selesai ♪",
  ];
  const fallbackRaw: EnchorLyricLine[] = [];
  let cursorMs = 1000;
  let phraseIdx = 0;
  while (cursorMs < totalMs - 3500) {
    const text = loopPhrases[phraseIdx % loopPhrases.length]!;
    fallbackRaw.push({
      timeMs: cursorMs,
      endMs: cursorMs + 4800,
      text,
    });
    cursorMs += 5500;
    phraseIdx++;
  }
  return {
    lines: buildFallbackSyllables(fallbackRaw, totalMs),
    provider: "BitChord Auto-Sync",
  };
}

// ============================================================================
// 7. MELODY GENERATOR FROM LYRICS FOR REYA SYNTH / PIANO HANDS
// ============================================================================

function buildMelodyFromLyrics(
  lyrics: EnchorLyricLine[],
  songName: string,
  songLengthMs: number,
): EnchorSongNote[] {
  const notes: EnchorSongNote[] = [];
  let seed = 0;
  for (let i = 0; i < songName.length; i++) {
    seed = (seed * 31 + songName.charCodeAt(i)) >>> 0;
  }

  const maxLines = Math.min(lyrics.length, 140);
  for (let i = 0; i < maxLines; i++) {
    const line = lyrics[i]!;
    const nextLine = lyrics[i + 1];
    const spanMs = nextLine
      ? Math.max(600, Math.min(4000, nextLine.timeMs - line.timeMs))
      : 2400;

    if (line.syllables && line.syllables.length > 0) {
      for (let w = 0; w < line.syllables.length; w++) {
        const syl = line.syllables[w]!;
        const idx = (seed + i * 3 + w * 2) % SCALE_NOTES.length;
        const durSec = Math.max(0.16, Math.min(0.85, (syl.endMs - syl.beginMs) / 1000));
        notes.push({
          note: SCALE_NOTES[idx]!,
          dur: Number(durSec.toFixed(2)),
          lyric: syl.text.trim(),
          timeMs: syl.beginMs,
        });
      }
      continue;
    }

    const words = line.text.split(/\s+/).filter(Boolean).slice(0, 8);
    if (words.length === 0) continue;
    const stepMs = Math.max(180, Math.floor(spanMs / words.length));
    const durSec = Number(Math.max(0.22, Math.min(0.65, stepMs / 1000)).toFixed(2));

    for (let w = 0; w < words.length; w++) {
      const idx = (seed + i * 3 + w * 2) % SCALE_NOTES.length;
      notes.push({
        note: SCALE_NOTES[idx]!,
        dur: durSec,
        lyric: words[w],
        timeMs: line.timeMs + w * stepMs,
      });
    }
  }

  if (notes.length === 0) {
    const totalSteps = Math.min(48, Math.max(16, Math.floor(songLengthMs / 1000)));
    for (let i = 0; i < totalSteps; i++) {
      const idx = (seed + i * 2) % SCALE_NOTES.length;
      notes.push({
        note: SCALE_NOTES[idx]!,
        dur: 0.42,
        lyric: i === 0 ? songName : undefined,
        timeMs: i * 450,
      });
    }
  }

  return notes;
}

// ============================================================================
// 8. BITCHORD FULL-TRACK AUDIO RESOLVER (JioSaavn 320kbps + Archive.org CDN + YT Music)
// ============================================================================

async function resolveArchiveOrgFullAudio(
  name: string,
  artist: string,
): Promise<{ audioUrl: string; durationMs: number } | null> {
  const cleanTitle = forLyricsSearch(name);
  const cleanArtist = artistForLyricsSearch(artist);
  const queries = [
    `${cleanTitle} ${cleanArtist}`,
    cleanTitle,
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const searchUrl =
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${q} AND mediatype:audio`)}` +
        `&fl[]=identifier,title,creator&rows=6&output=json`;
      const sRes = await fetch(searchUrl, {
        headers: { "User-Agent": WEB_USER_AGENT },
        signal: AbortSignal.timeout(4500),
      });
      if (!sRes.ok) continue;
      const sData = (await sRes.json()) as {
        response?: { docs?: Array<{ identifier?: string; title?: string }> };
      };
      const docs = (sData.response?.docs ?? []).filter((d) => {
        if (!d.identifier) return false;
        const t = (d.title || "").toLowerCase();
        // Skip DJ remix / 30 detik clips unless user asked for remix
        if (!name.toLowerCase().includes("remix") && /\b(dj|remix|30\s*detik|jedag\s*jedug)\b/i.test(t)) {
          return false;
        }
        return true;
      });

      const metas = await Promise.all(
        docs.slice(0, 4).map(async (d) => {
          try {
            const mRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(d.identifier!)}`, {
              headers: { "User-Agent": WEB_USER_AGENT },
              signal: AbortSignal.timeout(4000),
            });
            if (!mRes.ok) return null;
            const mData = (await mRes.json()) as {
              files?: Array<{ name?: string; length?: string; size?: string }>;
            };
            return { id: d.identifier!, files: mData.files ?? [] };
          } catch {
            return null;
          }
        }),
      );

      for (const m of metas) {
        if (!m) continue;
        for (const f of m.files) {
          const fname = f.name || "";
          if (!/\.(mp3|m4a)$/i.test(fname)) continue;
          const sizeBytes = Number.parseInt(f.size || "0", 10);
          const lenSec = Number.parseFloat(f.length || "0");
          // Require full-length song (>= 90 seconds or >= 900KB, <= 25MB)
          if (sizeBytes >= 900_000 && sizeBytes <= 25_000_000 && (lenSec === 0 || lenSec >= 85)) {
            const audioUrl = `https://archive.org/download/${encodeURIComponent(m.id)}/${encodeURIComponent(fname)}`;
            const durationMs = lenSec >= 85 ? Math.round(lenSec * 1000) : Math.round((sizeBytes / 16000) * 1000);
            return { audioUrl, durationMs };
          }
        }
      }
    } catch {
      // Try next query
    }
  }
  return null;
}

async function resolveBitChordAudio(
  name: string,
  artist: string,
  songLengthMs: number,
  preferredSaavnUrl?: string,
  preferredVideoId?: string,
  fallbackPreviewUrl?: string,
): Promise<{ audioUrl: string | null; audioMime: string | null; durationMs: number; provider: string }> {
  const targetSec = songLengthMs > 35_000 ? Math.round(songLengthMs / 1000) : null;

  // 1. Direct JioSaavn 320kbps stream if already verified and full-length (>= 85s)
  if (preferredSaavnUrl && songLengthMs >= 85_000) {
    return {
      audioUrl: preferredSaavnUrl,
      audioMime: "audio/mp4",
      durationMs: songLengthMs,
      provider: "BitChord JioSaavn 320kbps",
    };
  }

  // 2. Search JioSaavn and verify with BitChord's TrackMatcher (rejects remixes/covers & short clips!)
  const saavnCandidates = (
    await searchJioSaavnSongs(`${forLyricsSearch(name)} ${artistForLyricsSearch(artist)}`, 8)
  ).filter((c) => c.songLengthMs >= 85_000);

  const matchedSaavn = bestCandidate(
    saavnCandidates.map((c) => ({
      title: c.name,
      artist: c.artist,
      album: c.album,
      durationSec: Math.round(c.songLengthMs / 1000),
      item: c,
    })),
    { title: name, artist, durationSec: targetSec },
  )?.item;

  if (matchedSaavn?.saavnStreamUrl) {
    return {
      audioUrl: matchedSaavn.saavnStreamUrl,
      audioMime: "audio/mp4",
      durationMs: matchedSaavn.songLengthMs || songLengthMs,
      provider: "BitChord JioSaavn 320kbps",
    };
  }

  // 3. Archive.org Full-Track Audio CDN (100% full MP3 for Indonesian & global tracks, works on Vercel!)
  const archiveHit = await resolveArchiveOrgFullAudio(name, artist);
  if (archiveHit) {
    return {
      audioUrl: archiveHit.audioUrl,
      audioMime: "audio/mpeg",
      durationMs: archiveHit.durationMs || songLengthMs,
      provider: "BitChord Full-Track CDN",
    };
  }

  // 4. BitChord YouTube Music InnerTube (ANDROID_VR 1.65.10 full stream via proxy)
  let videoId = preferredVideoId;
  let ytmDurationMs = songLengthMs;
  if (!videoId) {
    const ytmHits = await searchYouTubeMusicSongs(`${forLyricsSearch(name)} ${artistForLyricsSearch(artist)}`);
    const matchedYtm =
      bestCandidate(
        ytmHits.map((c) => ({
          title: c.name,
          artist: c.artist,
          album: c.album,
          durationSec: Math.round(c.songLengthMs / 1000),
          item: c,
        })),
        { title: name, artist, durationSec: targetSec },
      )?.item ?? ytmHits[0];
    if (matchedYtm?.videoId) {
      videoId = matchedYtm.videoId;
      ytmDurationMs = matchedYtm.songLengthMs || songLengthMs;
    }
  }

  if (videoId) {
    const vr = await resolveYouTubeAndroidVrUrl(videoId);
    if (vr) {
      return {
        audioUrl: `/api/enchor?action=ytstream&videoId=${encodeURIComponent(videoId)}`,
        audioMime: vr.mime,
        durationMs: ytmDurationMs,
        provider: "BitChord YouTube Music (ANDROID_VR Full)",
      };
    }
  }

  // 5. Broad JioSaavn full-track title match (>= 95s) before ever using a short preview
  const broadSaavn = [
    ...saavnCandidates,
    ...(await searchJioSaavnSongs(forLyricsSearch(name), 6)),
  ].find(
    (c) =>
      c.saavnStreamUrl &&
      c.songLengthMs >= 95_000 &&
      normalizeText(c.name).includes(normalizeText(forLyricsSearch(name))),
  );
  if (broadSaavn?.saavnStreamUrl) {
    return {
      audioUrl: broadSaavn.saavnStreamUrl,
      audioMime: "audio/mp4",
      durationMs: broadSaavn.songLengthMs || songLengthMs,
      provider: "BitChord JioSaavn 320kbps",
    };
  }

  // 6. Fallback to previewUrl only as last resort
  if (fallbackPreviewUrl) {
    return {
      audioUrl: fallbackPreviewUrl,
      audioMime: "audio/mp4",
      durationMs: songLengthMs,
      provider: "BitChord Stream",
    };
  }

  return {
    audioUrl: null,
    audioMime: null,
    durationMs: songLengthMs,
    provider: "BitChord Synth",
  };
}

// ============================================================================
// 9. UNIFIED BITCHORD CATALOG SEARCH (Zero Enchor.us!)
// ============================================================================

async function searchBitChordCatalog(query: string): Promise<EnchorSearchItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const [ytmItems, saavnItems, deezerItems, appleIdItems, appleUsItems, audiusItems] =
    await Promise.all([
      searchYouTubeMusicSongs(cleanQuery),
      searchJioSaavnSongs(cleanQuery, 10),
      searchDeezerCatalog(cleanQuery),
      searchAppleCatalog(cleanQuery, "ID"),
      searchAppleCatalog(cleanQuery, "US"),
      searchAudiusCatalog(cleanQuery),
    ]);

  // Interleave & deduplicate using BitChord's TrackMatcher identity
  const merged = new Map<string, EnchorSearchItem>();
  const allRaw = [
    ...ytmItems,
    ...deezerItems,
    ...appleIdItems,
    ...appleUsItems,
    ...saavnItems,
    ...audiusItems,
  ];

  for (const item of allRaw) {
    const parsedTitle = parseTitleForMatch(item.name);
    const primArtist = artistForLyricsSearch(item.artist).toLowerCase().replace(/[^a-z0-9]/g, "");
    const verKey = [...parsedTitle.versions].sort().join(",");
    const key = `${parsedTitle.core || item.name.toLowerCase()}::${primArtist}::${verKey}`;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
      continue;
    }

    // Consensus boost when multiple catalogs agree on the same song + artist!
    existing.popularity = (existing.popularity ?? 70) + 35;

    // Enrich existing entry with missing cross-source IDs and high-res artwork
    if (!existing.videoId && item.videoId) existing.videoId = item.videoId;
    if (!existing.saavnStreamUrl && item.saavnStreamUrl) {
      if (item.songLengthMs >= 85_000 && Math.abs(existing.songLengthMs - item.songLengthMs) <= 15_000) {
        existing.saavnStreamUrl = item.saavnStreamUrl;
        existing.saavnId = item.saavnId;
        existing.charter = item.charter;
      }
    }
    if (!existing.appleTrackId && item.appleTrackId) existing.appleTrackId = item.appleTrackId;
    if (!existing.coverUrl && item.coverUrl) existing.coverUrl = item.coverUrl;
    if (!existing.previewUrl && item.previewUrl) existing.previewUrl = item.previewUrl;
  }

  // Score against the user's query so exact title/artist matches appear at the very top
  const qNorm = normalizeText(cleanQuery);
  const qTokens = wordsOf(qNorm);

  const ranked = [...merged.values()].sort((a, b) => {
    const scoreItem = (it: EnchorSearchItem) => {
      const n = normalizeText(it.name);
      const ar = normalizeText(it.artist);
      const combined = `${n} ${ar}`;
      let pts = it.popularity ?? 50;
      if (n === qNorm) pts += 300;
      else if (n.startsWith(qNorm)) pts += 180;
      else if (combined.includes(qNorm)) pts += 120;
      const matchedTokens = qTokens.filter((t) => combined.includes(t)).length;
      pts += matchedTokens * 45;
      if (it.saavnStreamUrl) pts += 35;
      if (it.videoId) pts += 25;
      return pts;
    };
    return scoreItem(b) - scoreItem(a);
  });

  return ranked.slice(0, 32);
}

// ============================================================================
// 10. HTTP GET ROUTE HANDLER
// ============================================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "play";

  // ── Action 1: Direct YouTube Music ANDROID_VR Audio Stream Proxy ──────────
  if (action === "ytstream") {
    const videoId = (searchParams.get("videoId") || "").trim();
    if (!videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }
    const resolved = await resolveYouTubeAndroidVrUrl(videoId);
    if (!resolved) {
      return NextResponse.json({ error: "Stream unavailable" }, { status: 404 });
    }

    const rangeHeader = request.headers.get("range");
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": ANDROID_VR_UA,
    };
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    try {
      const upstream = await fetch(resolved.url, {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        ytStreamUrlCache.delete(videoId);
        return NextResponse.json({ error: `Upstream HTTP ${upstream.status}` }, { status: 502 });
      }

      const resHeaders = new Headers();
      resHeaders.set("Content-Type", resolved.mime);
      resHeaders.set("Accept-Ranges", "bytes");
      resHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
      const contentLen = upstream.headers.get("content-length");
      if (contentLen) resHeaders.set("Content-Length", contentLen);
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) resHeaders.set("Content-Range", contentRange);

      return new Response(upstream.body, {
        status: upstream.status,
        headers: resHeaders,
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }
  }

  const query = (searchParams.get("q") || "Wildflower Billie Eilish").trim();
  const targetId = searchParams.get("id") || searchParams.get("md5") || "";

  const NOTE_FREQ_MAP: Record<string, { id: string; freq: number }> = {
    Do: { id: "do", freq: 261.63 },
    Re: { id: "re", freq: 293.66 },
    Mi: { id: "mi", freq: 329.63 },
    Fa: { id: "fa", freq: 349.23 },
    Sol: { id: "sol", freq: 392.0 },
    La: { id: "la", freq: 440.0 },
    Si: { id: "si", freq: 493.88 },
    "Do'": { id: "do_high", freq: 523.25 },
  };

  try {
    const items = await searchBitChordCatalog(query);
    const results = items.map((item, idx) => ({
      chartId: idx + 1,
      name: item.name,
      artist: item.artist,
      album: item.album,
      genre: "Music",
      year: "",
      charter: item.charter,
      md5: item.md5,
      albumArtUrl: item.coverUrl || null,
      songLengthMs: item.songLengthMs,
      previewStartMs: 0,
      hasLyrics: item.hasLyrics,
      hasVocals: true,
      source: item.source,
    }));

    // ── Action 2: Search Catalog Only ──────────────────────────────────────
    if (action === "search") {
      return NextResponse.json({
        query,
        count: items.length,
        items,
        results,
      });
    }

    // ── Action 3: Load Full Song + BitChord Word-Synced Lyrics ─────────────
    if (items.length === 0) {
      return NextResponse.json(
        { error: `Lagu "${query}" tidak ditemukan di katalog BitChord.` },
        { status: 404 },
      );
    }

    const chosen =
      (targetId
        ? items.find((i) => i.id === targetId || i.md5 === targetId)
        : undefined) || items[0]!;

    // Run BitChord Audio Resolver & BitChord Multi-Provider Lyrics Race in parallel!
    const [audioResult, lyricsResult] = await Promise.all([
      resolveBitChordAudio(
        chosen.name,
        chosen.artist,
        chosen.songLengthMs,
        chosen.saavnStreamUrl,
        chosen.videoId,
        chosen.previewUrl,
      ),
      fetchBitChordLyricsRace(
        chosen.name,
        chosen.artist,
        chosen.songLengthMs,
        chosen.album,
        chosen.appleTrackId,
      ),
    ]);

    const finalDurationMs = audioResult.durationMs || chosen.songLengthMs || 210_000;
    const melody = buildMelodyFromLyrics(lyricsResult.lines, chosen.name, finalDurationMs);

    // Ensure melody starts at timeMs = 0 so cumulative gaps align 1:1 with syllable timestamps
    const timelineMelody: EnchorSongNote[] =
      melody.length > 0 && melody[0]!.timeMs > 120
        ? [{ note: "Do", dur: 0.25, lyric: "♪", timeMs: 0 }, ...melody]
        : melody;

    const mappedNotes = timelineMelody.map((m, idx) => {
      const nextTimeMs = timelineMelody[idx + 1]?.timeMs ?? m.timeMs + Math.round(m.dur * 1000);
      const gap = Math.max(80, nextTimeMs - m.timeMs);
      const mapped = NOTE_FREQ_MAP[m.note] ?? { id: "do", freq: 261.63 };
      return {
        id: mapped.id,
        dur: m.dur,
        gap,
        freq: mapped.freq,
        lyric: m.lyric,
        timeMs: m.timeMs,
      };
    });

    const coverUrl =
      chosen.coverUrl ||
      `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(chosen.name)}`;
    const charterLabel = `${audioResult.provider} · ${lyricsResult.provider}`;

    const payload: EnchorSongPayload = {
      id: chosen.id,
      md5: chosen.md5,
      name: chosen.name,
      artist: chosen.artist,
      album: chosen.album,
      charter: charterLabel,
      songLengthMs: finalDurationMs,
      coverUrl,
      audioUrl: audioResult.audioUrl,
      audioMime: audioResult.audioMime,
      lyrics: lyricsResult.lines,
      melody,
      lyricsProvider: lyricsResult.provider,
      audioProvider: audioResult.provider,
    };

    const selected = {
      name: chosen.name,
      artist: chosen.artist,
      album: chosen.album,
      genre: "Music",
      charter: charterLabel,
      md5: chosen.md5,
      albumArtUrl: coverUrl,
      audioUrl: audioResult.audioUrl,
      vocalAudioUrl: audioResult.audioUrl,
      lyrics: lyricsResult.lines,
      notes: mappedNotes,
    };

    return NextResponse.json({
      query,
      items,
      results,
      song: payload,
      selected,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Gagal memuat lagu BitChord: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
