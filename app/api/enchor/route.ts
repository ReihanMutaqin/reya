export const runtime = "nodejs";

type ScaleNoteId = "do" | "re" | "mi" | "fa" | "sol" | "la" | "si" | "do_high";

export interface EnchorNoteItem {
  id: ScaleNoteId;
  dur: number;
  gap: number;
  freq?: number;
  lyric?: string;
}

export interface EnchorLyricSyllable {
  text: string;
  beginMs: number;
  endMs: number;
}

export interface EnchorLyricLine {
  timeMs: number;
  endMs?: number;
  text: string;
  syllables?: EnchorLyricSyllable[];
}

export interface EnchorSongSummary {
  chartId: number;
  name: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  charter: string;
  md5: string;
  albumArtUrl: string | null;
  songLengthMs: number;
  previewStartMs: number;
  hasLyrics: boolean;
  hasVocals: boolean;
  instruments: string[];
  directAudioUrl?: string | null;
  source?: "enchor" | "global";
}

interface SngFileEntry {
  name: string;
  size: number;
  offset: number;
}

const SCALE_IDS: ScaleNoteId[] = [
  "do",
  "re",
  "mi",
  "fa",
  "sol",
  "la",
  "si",
  "do_high",
];

// Maps any MIDI note (e.g. 48..84) to the closest ScaleNoteId and frequency (clamped to a cute singing register 261Hz..587Hz)
function midiToScaleAndFreq(midiNote: number): { id: ScaleNoteId; freq: number } {
  const pc = ((midiNote % 12) + 12) % 12;
  const pcToIdx: Record<number, number> = {
    0: 0, // C -> do
    1: 0,
    2: 1, // D -> re
    3: 1,
    4: 2, // E -> mi
    5: 3, // F -> fa
    6: 3,
    7: 4, // G -> sol
    8: 4,
    9: 5, // A -> la
    10: 5,
    11: 6, // B -> si
  };
  let idx = pcToIdx[pc] ?? 0;
  if (midiNote >= 72 && pc === 0) idx = 7; // High C -> do_high

  // Keep vocal frequency in a pleasant female robot singing register (C4=60 to D5=74)
  let foldedMidi = midiNote;
  while (foldedMidi < 60) foldedMidi += 12;
  while (foldedMidi > 76) foldedMidi -= 12;
  const freq = Math.round(440 * Math.pow(2, (foldedMidi - 69) / 12) * 100) / 100;

  return { id: SCALE_IDS[idx], freq };
}

function unmaskSngBuffer(
  buf: Buffer,
  xorMask: Buffer,
  fileOffsetInEntry = 0,
): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const pos = fileOffsetInEntry + i;
    out[i] = buf[i] ^ xorMask[pos & 0x0f] ^ (pos & 0xff);
  }
  return out;
}

async function fetchSngIndex(
  md5: string,
): Promise<{ xorMask: Buffer; files: SngFileEntry[] } | null> {
  try {
    const res = await fetch(`https://files.enchor.us/${md5}.sng`, {
      headers: { Range: "bytes=0-16383" },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok && res.status !== 206) return null;
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length < 42 || b.subarray(0, 6).toString("ascii") !== "SNGPKG") {
      return null;
    }

    const xorMask = Buffer.from(b.subarray(10, 26));
    const metaLen = Number(b.readBigUInt64LE(26));
    const fileSectionOffset = 34 + metaLen;
    if (fileSectionOffset + 16 > b.length) return null;

    const fileCount = Number(b.readBigUInt64LE(fileSectionOffset + 8));
    let pos = fileSectionOffset + 16;
    const files: SngFileEntry[] = [];

    for (let i = 0; i < fileCount && pos < b.length; i++) {
      const nameLen = b.readUInt8(pos);
      pos += 1;
      if (pos + nameLen + 16 > b.length) break;
      const name = b.subarray(pos, pos + nameLen).toString("utf8");
      pos += nameLen;
      const size = Number(b.readBigUInt64LE(pos));
      pos += 8;
      const offset = Number(b.readBigUInt64LE(pos));
      pos += 8;
      files.push({ name, size, offset });
    }

    return { xorMask, files };
  } catch {
    return null;
  }
}

async function fetchUnmaskedSngEntry(
  md5: string,
  entry: SngFileEntry,
  xorMask: Buffer,
  maxBytes = 350_000,
): Promise<Buffer | null> {
  try {
    const readSize = Math.min(entry.size, maxBytes);
    const endByte = entry.offset + readSize - 1;
    const res = await fetch(`https://files.enchor.us/${md5}.sng`, {
      headers: { Range: `bytes=${entry.offset}-${endByte}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 206) return null;
    const masked = Buffer.from(await res.arrayBuffer());
    return unmaskSngBuffer(masked, xorMask, 0);
  } catch {
    return null;
  }
}

function cleanLyricSyllable(raw: string): string {
  return raw
    .replace(/\[.*?\]/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[$#^=%]/g, "")
    .trim();
}

function parseNotesChart(chartText: string): {
  lyrics: EnchorLyricLine[];
  notes: EnchorNoteItem[];
} {
  const resMatch = chartText.match(/Resolution\s*=\s*(\d+)/i);
  const resolution = resMatch ? Math.max(48, Number(resMatch[1])) : 192;

  // Build full SyncTrack tempo map for accurate timestamps across the entire song
  const syncSection =
    chartText.match(/\[SyncTrack\]\s*\{([\s\S]*?)\}/i)?.[1] ?? "";
  const tempoEvents: Array<{ tick: number; bpm: number; timeMs: number }> = [];
  const bpmRegex = /(\d+)\s*=\s*B\s+(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = bpmRegex.exec(syncSection)) !== null) {
    const tick = Number(match[1]);
    const bpm = Math.max(40, Math.min(260, Number(match[2]) / 1000));
    if (tempoEvents.length === 0) {
      tempoEvents.push({ tick: 0, bpm, timeMs: 0 });
    } else {
      const prev = tempoEvents[tempoEvents.length - 1];
      const deltaTicks = Math.max(0, tick - prev.tick);
      const deltaMs = (deltaTicks * 60000) / (prev.bpm * resolution);
      tempoEvents.push({ tick, bpm, timeMs: prev.timeMs + deltaMs });
    }
  }
  if (tempoEvents.length === 0) {
    tempoEvents.push({ tick: 0, bpm: 120, timeMs: 0 });
  }

  const tickToMs = (tick: number): number => {
    let ev = tempoEvents[0];
    for (let i = 1; i < tempoEvents.length; i++) {
      if (tempoEvents[i].tick <= tick) ev = tempoEvents[i];
      else break;
    }
    const deltaTicks = Math.max(0, tick - ev.tick);
    return Math.round(ev.timeMs + (deltaTicks * 60000) / (ev.bpm * resolution));
  };

  // 1. Parse ALL Lyrics from [Events] across the entire song
  const rawLyrics: Array<{ tick: number; timeMs: number; word: string }> = [];
  const eventsSection = chartText.match(/\[Events\]\s*\{([\s\S]*?)\}/i)?.[1] ?? "";
  const lyricRegex = /(\d+)\s*=\s*E\s*"lyric\s+([^"]+)"/gi;
  while ((match = lyricRegex.exec(eventsSection)) !== null) {
    const tick = Number(match[1]);
    const cleaned = cleanLyricSyllable(match[2]);
    if (cleaned && cleaned !== "+") {
      rawLyrics.push({ tick, timeMs: tickToMs(tick), word: cleaned });
    }
  }

  const lyrics: EnchorLyricLine[] = [];
  let currentWords: string[] = [];
  let lineStartMs = 0;

  for (let i = 0; i < rawLyrics.length; i++) {
    const item = rawLyrics[i];
    if (currentWords.length === 0) lineStartMs = item.timeMs;

    const prev = currentWords[currentWords.length - 1];
    if (prev && prev.endsWith("-")) {
      currentWords[currentWords.length - 1] =
        prev.slice(0, -1) + item.word.replace(/^-/, "");
    } else {
      currentWords.push(item.word.replace(/-$/, "-"));
    }

    const nextMs = rawLyrics[i + 1]?.timeMs ?? Infinity;
    const isLineBreak =
      currentWords.length >= 7 ||
      nextMs - item.timeMs > 1600 ||
      /[.!?]$/.test(item.word);

    if (isLineBreak) {
      const text = currentWords
        .join(" ")
        .replace(/- /g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        lyrics.push({
          timeMs: lineStartMs,
          text,
        });
      }
      currentWords = [];
    }
  }
  if (currentWords.length > 0) {
    const text = currentWords.join(" ").replace(/- /g, "").trim();
    if (text) {
      lyrics.push({ timeMs: lineStartMs, text });
    }
  }

  // 2. Parse Notes from the best available instrument track across the full song
  const sectionOrder = [
    "ExpertSingle",
    "HardSingle",
    "MediumSingle",
    "EasySingle",
    "ExpertKeyboard",
    "ExpertDrums",
  ];
  let noteBlock = "";
  for (const sec of sectionOrder) {
    const found = chartText.match(new RegExp(`\\[${sec}\\]\\s*\\{([\\s\\S]*?)\\}`, "i"))?.[1];
    if (found && /\d+\s*=\s*N\s+\d+/.test(found)) {
      noteBlock = found;
      break;
    }
  }

  const fretToScale: Record<number, { id: ScaleNoteId; freq: number }> = {
    0: { id: "do", freq: 261.63 },
    1: { id: "re", freq: 293.66 },
    2: { id: "mi", freq: 329.63 },
    3: { id: "sol", freq: 392.0 },
    4: { id: "la", freq: 440.0 },
    5: { id: "si", freq: 493.88 },
    6: { id: "do_high", freq: 523.25 },
    7: { id: "fa", freq: 349.23 },
  };

  const parsedTicks: Array<{
    tick: number;
    timeMs: number;
    fret: number;
    lenMs: number;
  }> = [];
  const noteRegex = /(\d+)\s*=\s*N\s+([0-7])\s+(\d+)/g;
  let lastMs = -9999;
  while ((match = noteRegex.exec(noteBlock)) !== null) {
    const tick = Number(match[1]);
    const fret = Number(match[2]);
    const lenTicks = Number(match[3]);
    const timeMs = tickToMs(tick);
    if (timeMs - lastMs < 160) continue;
    lastMs = timeMs;
    const endMs = tickToMs(tick + lenTicks);
    parsedTicks.push({
      tick,
      timeMs,
      fret,
      lenMs: Math.max(220, endMs - timeMs),
    });
    if (parsedTicks.length >= 600) break;
  }

  const notes: EnchorNoteItem[] = parsedTicks.map((item, idx) => {
    const next = parsedTicks[idx + 1];
    const rawGapMs = next ? Math.round(next.timeMs - item.timeMs) : 420;
    const gap = Math.max(170, Math.min(850, rawGapMs));
    const rawDurSec = Math.max(0.24, item.lenMs / 1000);
    const dur = Math.round(Math.min(1.1, Math.max(0.28, rawDurSec)) * 100) / 100;

    // Pair with nearby lyric syllable if available
    const nearLyric = rawLyrics.find(
      (l) => Math.abs(l.timeMs - item.timeMs) < 420,
    );
    const mapped = fretToScale[item.fret] ?? fretToScale[0];
    return {
      id: mapped.id,
      freq: mapped.freq,
      dur,
      gap,
      lyric: nearLyric?.word.replace(/-$/, ""),
    };
  });

  return { lyrics, notes };
}

function readVarLen(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { value, next: pos };
}

function parseMidiVocalsAndNotes(mid: Buffer): {
  lyrics: EnchorLyricLine[];
  notes: EnchorNoteItem[];
} {
  if (mid.length < 14 || mid.subarray(0, 4).toString("ascii") !== "MThd") {
    return { lyrics: [], notes: [] };
  }
  const numTracks = mid.readUInt16BE(10);
  const division = mid.readUInt16BE(12) || 480;
  const msPerTick = 500 / division; // ~120 BPM baseline

  interface MidiTrackData {
    name: string;
    lyrics: Array<{ tick: number; text: string }>;
    notes: Array<{ tick: number; midi: number; durTicks: number }>;
  }

  const tracks: MidiTrackData[] = [];
  let pos = 14;

  for (let t = 0; t < numTracks && pos + 8 <= mid.length; t++) {
    const chunkId = mid.subarray(pos, pos + 4).toString("ascii");
    const chunkLen = mid.readUInt32BE(pos + 4);
    pos += 8;
    const end = Math.min(mid.length, pos + chunkLen);
    if (chunkId !== "MTrk") {
      pos = end;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    let trackName = "";
    const trackLyrics: Array<{ tick: number; text: string }> = [];
    const trackNotes: Array<{ tick: number; midi: number; durTicks: number }> = [];
    const activeNotes = new Map<number, number>();

    let p = pos;
    while (p < end) {
      const delta = readVarLen(mid, p);
      tick += delta.value;
      p = delta.next;
      if (p >= end) break;

      let status = mid[p];
      if (status < 0x80) {
        status = runningStatus;
      } else {
        p++;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        if (p >= end) break;
        const metaType = mid[p++];
        const lenInfo = readVarLen(mid, p);
        p = lenInfo.next;
        const dataBuf = mid.subarray(p, Math.min(end, p + lenInfo.value));
        p += lenInfo.value;

        if (metaType === 0x03) {
          trackName = dataBuf.toString("utf8").trim();
        } else if (metaType === 0x05 || metaType === 0x01) {
          const raw = dataBuf.toString("utf8");
          if (!raw.startsWith("[") && !raw.startsWith("section")) {
            const clean = cleanLyricSyllable(raw);
            if (clean && clean !== "+") {
              trackLyrics.push({ tick, text: clean });
            }
          }
        }
      } else if (status === 0xf0 || status === 0xf7) {
        const lenInfo = readVarLen(mid, p);
        p = lenInfo.next + lenInfo.value;
      } else {
        const eventType = status & 0xf0;
        if (eventType === 0x90 && p + 1 < end) {
          const noteNum = mid[p++];
          const vel = mid[p++];
          if (vel > 0) {
            activeNotes.set(noteNum, tick);
          } else {
            const start = activeNotes.get(noteNum);
            if (start !== undefined) {
              trackNotes.push({ tick: start, midi: noteNum, durTicks: Math.max(60, tick - start) });
              activeNotes.delete(noteNum);
            }
          }
        } else if (eventType === 0x80 && p + 1 < end) {
          const noteNum = mid[p++];
          p++;
          const start = activeNotes.get(noteNum);
          if (start !== undefined) {
            trackNotes.push({ tick: start, midi: noteNum, durTicks: Math.max(60, tick - start) });
            activeNotes.delete(noteNum);
          }
        } else if (eventType === 0xc0 || eventType === 0xd0) {
          p += 1;
        } else {
          p += 2;
        }
      }
    }

    tracks.push({ name: trackName, lyrics: trackLyrics, notes: trackNotes });
    pos = end;
  }

  const vocalTrack =
    tracks.find((tr) => /VOCAL/i.test(tr.name) && tr.lyrics.length > 0) ??
    tracks.find((tr) => tr.lyrics.length > 0);

  const lyrics: EnchorLyricLine[] = [];
  if (vocalTrack && vocalTrack.lyrics.length > 0) {
    let words: string[] = [];
    let startTick = 0;
    for (let i = 0; i < vocalTrack.lyrics.length; i++) {
      const item = vocalTrack.lyrics[i];
      if (words.length === 0) startTick = item.tick;
      const prev = words[words.length - 1];
      if (prev && prev.endsWith("-")) {
        words[words.length - 1] = prev.slice(0, -1) + item.text.replace(/^-/, "");
      } else {
        words.push(item.text);
      }
      const nextTick = vocalTrack.lyrics[i + 1]?.tick ?? Infinity;
      if (
        words.length >= 6 ||
        (nextTick - item.tick) * msPerTick > 1600 ||
        /[.!?]$/.test(item.text)
      ) {
        const line = words.join(" ").replace(/- /g, "").trim();
        if (line) {
          lyrics.push({ timeMs: Math.round(startTick * msPerTick), text: line });
        }
        words = [];
      }
    }
    if (words.length > 0) {
      const line = words.join(" ").replace(/- /g, "").trim();
      if (line) {
        lyrics.push({ timeMs: Math.round(startTick * msPerTick), text: line });
      }
    }
  }

  // Pick vocal melody notes (MIDI 36..84) or lead instrument notes
  const melodySource =
    tracks.find(
      (tr) =>
        /VOCAL/i.test(tr.name) &&
        tr.notes.some((n) => n.midi >= 36 && n.midi <= 84),
    ) ??
    tracks.find(
      (tr) =>
        /KEYS|GUITAR/i.test(tr.name) && tr.notes.length > 8,
    ) ??
    tracks.find((tr) => tr.notes.length > 8);

  const notes: EnchorNoteItem[] = [];
  if (melodySource) {
    const filtered = melodySource.notes
      .filter((n) => n.midi >= 36 && n.midi <= 96)
      .sort((a, b) => a.tick - b.tick);

    const deduped: typeof filtered = [];
    let lastTick = -9999;
    for (const n of filtered) {
      if ((n.tick - lastTick) * msPerTick < 150) continue;
      lastTick = n.tick;
      deduped.push(n);
      if (deduped.length >= 600) break;
    }

    for (let i = 0; i < deduped.length; i++) {
      const cur = deduped[i];
      const next = deduped[i + 1];
      const rawGap = next
        ? Math.round((next.tick - cur.tick) * msPerTick)
        : 420;
      const gap = Math.max(180, Math.min(850, rawGap));
      const dur =
        Math.round(
          Math.min(1.1, Math.max(0.28, (cur.durTicks * msPerTick) / 1000)) * 100,
        ) / 100;
      const mapped = midiToScaleAndFreq(cur.midi);
      const nearSyl = vocalTrack?.lyrics.find(
        (l) => Math.abs(l.tick - cur.tick) * msPerTick < 320,
      );
      notes.push({
        id: mapped.id,
        freq: mapped.freq,
        dur,
        gap,
        lyric: nearSyl?.text.replace(/-$/, ""),
      });
    }
  }

  return { lyrics, notes };
}

async function fetchFullTrackAudioUrl(
  title: string,
  artist: string,
): Promise<string | null> {
  try {
    const words = `${title} ${artist}`
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const qStr = `(${words.join(" AND ")}) AND mediatype:audio`;
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      qStr,
    )}&fl[]=identifier,title,creator&rows=8&output=json`;

    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      response?: {
        docs?: Array<{ identifier: string; title?: string; creator?: string }>;
      };
    };
    const docs = d.response?.docs || [];
    const tNorm = title.toLowerCase();
    const aNorm = artist.toLowerCase();

    // Prefer docs where both song title and artist appear
    const sorted = docs.filter((item) => {
      const text = `${item.title || ""} ${item.creator || ""}`.toLowerCase();
      return (
        text.includes(tNorm) &&
        (text.includes(aNorm) ||
          aNorm.split(/\s+/).some((w) => w.length > 3 && text.includes(w)))
      );
    });

    for (const doc of sorted) {
      const metaRes = await fetch(
        `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
        { signal: AbortSignal.timeout(3500) },
      );
      if (!metaRes.ok) continue;
      const meta = (await metaRes.json()) as {
        files?: Array<{ name: string; length?: string | number }>;
      };
      const candidate = meta.files?.find(
        (f) =>
          (f.name.endsWith(".m4a") ||
            f.name.endsWith(".mp3") ||
            f.name.endsWith(".ogg")) &&
          Number(f.length || 0) > 120 &&
          Number(f.length || 0) < 660,
      );
      if (candidate) {
        return `https://archive.org/download/${encodeURIComponent(
          doc.identifier,
        )}/${encodeURIComponent(candidate.name)}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "search";

  // 1. Stream & Unmask Full Audio directly from Enchor SNG CDN
  if (action === "audio") {
    const md5 = searchParams.get("md5") || "";
    const preferredFile = searchParams.get("file") || "";
    if (!/^[a-f0-9]{32}$/i.test(md5)) {
      return Response.json({ error: "Invalid md5" }, { status: 400 });
    }

    const index = await fetchSngIndex(md5);
    if (!index) {
      return Response.json({ error: "SNG index not found" }, { status: 404 });
    }

    const audioEntry =
      index.files.find((f) => f.name === preferredFile) ??
      index.files.find((f) => /^song\.(opus|ogg|mp3)$/i.test(f.name)) ??
      index.files.find((f) => /^vocals\.(opus|ogg|mp3)$/i.test(f.name)) ??
      index.files.find((f) => /^guitar\.(opus|ogg|mp3)$/i.test(f.name)) ??
      index.files.find((f) => /\.(opus|ogg|mp3)$/i.test(f.name));

    if (!audioEntry) {
      return Response.json({ error: "No audio stream in SNG" }, { status: 404 });
    }

    // Stream full song audio entry (up to 25MB) so songs never cut off early
    const maxAudioBytes = Math.min(audioEntry.size, 25_000_000);
    const unmasked = await fetchUnmaskedSngEntry(
      md5,
      audioEntry,
      index.xorMask,
      maxAudioBytes,
    );
    if (!unmasked) {
      return Response.json({ error: "Failed to stream SNG audio" }, { status: 502 });
    }

    const contentType = audioEntry.name.endsWith(".mp3")
      ? "audio/mpeg"
      : "audio/ogg";

    return new Response(new Uint8Array(unmasked), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(unmasked.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // 2. Search Spotify & Deezer Global Catalog + BitChord Syllable Lyrics
  const query = (searchParams.get("q") || "bohemian rhapsody").trim();
  const targetMd5 = searchParams.get("md5") || "";

  const parseTimestamp = (ts: string): number => {
    if (!ts) return 0;
    if (ts.includes(":")) {
      const parts = ts.split(":");
      if (parts.length === 2) {
        return Math.round((Number(parts[0]) * 60 + Number(parts[1])) * 1000);
      }
      if (parts.length === 3) {
        return Math.round(
          (Number(parts[0]) * 3600 +
            Number(parts[1]) * 60 +
            Number(parts[2])) *
            1000,
        );
      }
    }
    return Math.round(Number(ts) * 1000);
  };

  const parseTtmlLyrics = (ttmlText: string): EnchorLyricLine[] => {
    const lines: EnchorLyricLine[] = [];
    const pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRegex.exec(ttmlText)) !== null) {
      const pAttrs = pMatch[1];
      const pBody = pMatch[2];
      const pBeginMatch = pAttrs.match(/begin="([^"]+)"/);
      const pEndMatch = pAttrs.match(/end="([^"]+)"/);
      const pBeginMs = parseTimestamp(pBeginMatch ? pBeginMatch[1] : "0");
      const pEndMs = pEndMatch ? parseTimestamp(pEndMatch[1]) : pBeginMs + 3200;

      const syllables: EnchorLyricSyllable[] = [];
      const spanRegex = /<span\s+([^>]*?)>([\s\S]*?)<\/span>/gi;
      let sMatch: RegExpExecArray | null;
      let cleanLineText = "";
      while ((sMatch = spanRegex.exec(pBody)) !== null) {
        const sAttrs = sMatch[1];
        const sText = sMatch[2].replace(/<[^>]+>/g, "").trim();
        if (!sText) continue;
        const sBeginMatch = sAttrs.match(/begin="([^"]+)"/);
        const sEndMatch = sAttrs.match(/end="([^"]+)"/);
        const sBeginMs = parseTimestamp(sBeginMatch ? sBeginMatch[1] : "0");
        const sEndMs = sEndMatch ? parseTimestamp(sEndMatch[1]) : sBeginMs + 400;
        syllables.push({ text: sText, beginMs: sBeginMs, endMs: sEndMs });
        cleanLineText += (cleanLineText ? " " : "") + sText;
      }

      if (!cleanLineText) {
        cleanLineText = pBody
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      if (cleanLineText) {
        lines.push({
          timeMs: pBeginMs,
          endMs: pEndMs,
          text: cleanLineText,
          syllables: syllables.length > 0 ? syllables : undefined,
        });
      }
    }
    return lines;
  };

  const parseLrcToLines = (lrcText: string): EnchorLyricLine[] => {
    const lines: EnchorLyricLine[] = [];
    const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(lrcText)) !== null) {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
      const text = m[4].trim();
      if (text) {
        lines.push({
          timeMs: mins * 60000 + secs * 1000 + frac,
          text,
        });
      }
    }
    return lines;
  };

  try {
    const [dzRes, itunesRes] = await Promise.allSettled([
      fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=15`,
        { signal: AbortSignal.timeout(3800) },
      ),
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`,
        { signal: AbortSignal.timeout(3800) },
      ),
    ]);

    const summaries: EnchorSongSummary[] = [];

    // 1. Deezer global catalog (ranked by global popularity/chart rank like Spotify)
    if (dzRes.status === "fulfilled" && dzRes.value.ok) {
      const dzData = (await dzRes.value.json()) as {
        data?: Array<{
          id: number;
          title: string;
          artist?: { name: string };
          album?: { title: string; cover_medium?: string };
          duration: number;
          preview?: string;
          rank?: number;
        }>;
      };
      for (const item of dzData.data ?? []) {
        if (!item.title || !item.artist?.name) continue;
        summaries.push({
          chartId: item.id,
          name: item.title,
          artist: item.artist.name,
          album: item.album?.title ?? "",
          genre: "Pop / Hits",
          year: "",
          charter: "BitChord Music",
          md5: `dz-${item.id}`,
          albumArtUrl: item.album?.cover_medium ?? null,
          songLengthMs: (item.duration || 180) * 1000,
          previewStartMs: 0,
          hasLyrics: true,
          hasVocals: true,
          instruments: ["vocals", "instruments"],
          directAudioUrl: item.preview ?? null,
          source: "global",
        });
      }
    }

    // 2. iTunes global catalog
    if (itunesRes.status === "fulfilled" && itunesRes.value.ok) {
      const itunesData = (await itunesRes.value.json()) as {
        results?: Array<Record<string, unknown>>;
      };
      for (const tr of itunesData.results ?? []) {
        const trackId = Number(tr.trackId ?? 0);
        const trackName = String(tr.trackName ?? "");
        const artistName = String(tr.artistName ?? "");
        const previewUrl =
          typeof tr.previewUrl === "string" ? tr.previewUrl : null;
        if (!trackName || !artistName) continue;

        // Skip if Deezer already added the exact song
        const alreadyIn = summaries.some(
          (s) =>
            s.name.toLowerCase().replace(/\s*\(.*?\)/g, "").trim() ===
              trackName.toLowerCase().replace(/\s*\(.*?\)/g, "").trim() &&
            s.artist.toLowerCase().trim() === artistName.toLowerCase().trim(),
        );
        if (alreadyIn) continue;

        const artUrl =
          typeof tr.artworkUrl100 === "string"
            ? tr.artworkUrl100.replace("100x100bb", "300x300bb")
            : null;

        summaries.push({
          chartId: trackId,
          name: trackName,
          artist: artistName,
          album: String(tr.collectionName ?? ""),
          genre: String(tr.primaryGenreName ?? "Music"),
          year: String(tr.releaseDate ?? "").slice(0, 4),
          charter: "BitChord Music",
          md5: `itunes-${trackId}`,
          albumArtUrl: artUrl,
          songLengthMs: Number(tr.trackTimeMillis ?? 180000),
          previewStartMs: 0,
          hasLyrics: true,
          hasVocals: true,
          instruments: ["vocals", "instruments"],
          directAudioUrl: previewUrl,
          source: "global",
        });
      }
    }

    // Filter strictly like Spotify: EVERY significant word in the query must match in (title + artist)
    const qWords = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    const filtered = summaries.filter((c) => {
      if (qWords.length === 0) return true;
      const combined = `${c.name} ${c.artist}`.toLowerCase();
      return qWords.every((w) => combined.includes(w));
    });

    const candidatesToRank = filtered.length > 0 ? filtered : summaries;

    // Spotify-like Ranking & Scoring
    const scoreSpotify = (item: EnchorSongSummary): number => {
      const qNorm = query.toLowerCase().trim();
      const n = item.name.toLowerCase().trim();
      const a = item.artist.toLowerCase().trim();
      const cleanTitle = n
        .replace(/\s*\(.*?\)/g, "")
        .replace(/\s*\[.*?\]/g, "")
        .trim();

      let s = 0;
      if (cleanTitle === qNorm) s += 300;
      else if (cleanTitle.startsWith(qNorm)) s += 160;
      else if (cleanTitle.includes(qNorm)) s += 90;

      if (a === qNorm || a.includes(qNorm)) s += 80;

      // Penalize live bootlegs, karaoke, or tribute covers when official track exists
      if (
        /\b(live|concert|tribute|karaoke|spanish mix|tribute band)\b/i.test(n) &&
        !/\b(live|concert|cover)\b/i.test(qNorm)
      ) {
        s -= 85;
      }
      return s;
    };

    // Deduplicate so only the best version of each title+artist appears
    const seen = new Set<string>();
    const ranked: EnchorSongSummary[] = [];
    for (const item of [...candidatesToRank].sort(
      (a, b) => scoreSpotify(b) - scoreSpotify(a),
    )) {
      const key = `${item.name
        .toLowerCase()
        .replace(/\s*\(.*?\)/g, "")
        .trim()}:::${item.artist.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranked.push(item);
      }
    }

    const chosen =
      (targetMd5 ? ranked.find((s) => s.md5 === targetMd5) : null) ??
      ranked[0] ??
      null;

    if (!chosen) {
      return Response.json({
        found: 0,
        results: [],
        selected: null,
      });
    }

    let lyrics: EnchorLyricLine[] = [];
    let notes: EnchorNoteItem[] = [];
    let audioUrl: string | null = chosen.directAudioUrl ?? null;
    let vocalAudioUrl: string | null = chosen.directAudioUrl ?? null;

    if (chosen.source === "global") {
      const fullAudio = await fetchFullTrackAudioUrl(chosen.name, chosen.artist);
      if (fullAudio) {
        audioUrl = fullAudio;
        vocalAudioUrl = fullAudio;
      }
    }

    // 1. BitChord Engine: High-precision Syllable-timed TTML Lyrics from BiniLyrics / LRC.red
    try {
      const biniRes = await fetch(
        `https://lyrics-api.binimum.org/search?q=${encodeURIComponent(
          `${chosen.name} ${chosen.artist}`,
        )}`,
        { signal: AbortSignal.timeout(3500) },
      );
      if (biniRes.ok) {
        const biniData = (await biniRes.json()) as {
          results?: Array<{
            track_name?: string;
            artist_name?: string;
            lyricsUrl?: string;
            timing_type?: string;
          }>;
        };
        const cName = chosen.name.toLowerCase();
        const cArtist = chosen.artist.toLowerCase();
        const match =
          biniData.results?.find(
            (r) =>
              r.lyricsUrl &&
              String(r.track_name || "").toLowerCase().includes(cName) &&
              String(r.artist_name || "").toLowerCase().includes(cArtist),
          ) ??
          biniData.results?.find(
            (r) =>
              r.lyricsUrl &&
              (String(r.track_name || "").toLowerCase().includes(cName) ||
                String(r.artist_name || "").toLowerCase().includes(cArtist)),
          ) ??
          biniData.results?.[0];

        if (match?.lyricsUrl) {
          const ttmlRes = await fetch(match.lyricsUrl, {
            signal: AbortSignal.timeout(4000),
          });
          if (ttmlRes.ok) {
            const ttmlText = await ttmlRes.text();
            const parsedTtml = parseTtmlLyrics(ttmlText);
            if (parsedTtml.length > 0) {
              lyrics = parsedTtml;
            }
          }
        }
      }
    } catch {
      // Fall through to Enchor SNG and LRCLIB
    }

    // 2. Fallback: Enchor SNG chart/mid lyrics if BiniLyrics has no match
    if (lyrics.length === 0 && chosen.source === "enchor" && /^[a-f0-9]{32}$/i.test(chosen.md5)) {
      const sngIndex = await fetchSngIndex(chosen.md5);
      if (sngIndex) {
        const hasSongAudio =
          sngIndex.files.find((f) => /^song\.(opus|ogg|mp3)$/i.test(f.name)) ??
          sngIndex.files.find((f) => /^vocals\.(opus|ogg|mp3)$/i.test(f.name)) ??
          sngIndex.files.find((f) =>
            /^(guitar|keys|rhythm)\.(opus|ogg|mp3)$/i.test(f.name),
          );
        const hasVocalAudio = sngIndex.files.find((f) =>
          /^vocals\.(opus|ogg|mp3)$/i.test(f.name),
        );

        if (hasSongAudio) {
          audioUrl = `/api/enchor?action=audio&md5=${chosen.md5}&file=${encodeURIComponent(hasSongAudio.name)}`;
        }
        if (hasVocalAudio) {
          vocalAudioUrl = `/api/enchor?action=audio&md5=${chosen.md5}&file=${encodeURIComponent(hasVocalAudio.name)}`;
        }

        const chartEntry = sngIndex.files.find((f) =>
          /notes\.chart$/i.test(f.name),
        );
        const midEntry = sngIndex.files.find((f) =>
          /notes\.mid$/i.test(f.name),
        );

        if (chartEntry) {
          const buf = await fetchUnmaskedSngEntry(
            chosen.md5,
            chartEntry,
            sngIndex.xorMask,
            2_000_000,
          );
          if (buf) {
            const parsed = parseNotesChart(buf.toString("utf8"));
            lyrics = parsed.lyrics;
            notes = parsed.notes;
          }
        }

        if ((lyrics.length === 0 || notes.length === 0) && midEntry) {
          const buf = await fetchUnmaskedSngEntry(
            chosen.md5,
            midEntry,
            sngIndex.xorMask,
            2_000_000,
          );
          if (buf) {
            const parsed = parseMidiVocalsAndNotes(buf);
            if (lyrics.length === 0) lyrics = parsed.lyrics;
            if (notes.length === 0) notes = parsed.notes;
          }
        }
      }
    }

    // Enrich full synced lyrics from LRCLIB matching both song title and artist
    if (lyrics.length === 0) {
      let lrcCandidates: Array<Record<string, unknown>> = [];
      try {
        const specificLrcRes = await fetch(
          `https://lrclib.net/api/search?q=${encodeURIComponent(`${chosen.name} ${chosen.artist}`)}`,
          { signal: AbortSignal.timeout(3200) },
        );
        if (specificLrcRes.ok) {
          const list = (await specificLrcRes.json()) as Array<
            Record<string, unknown>
          >;
          if (Array.isArray(list)) lrcCandidates = list;
        }
      } catch {
        // Fallback to initial lrcRes
      }

      if (
        lrcCandidates.length === 0 &&
        lrcRes.status === "fulfilled" &&
        lrcRes.value.ok
      ) {
        const list = (await lrcRes.value.json()) as Array<
          Record<string, unknown>
        >;
        if (Array.isArray(list)) lrcCandidates = list;
      }

      if (lrcCandidates.length > 0) {
        const cName = chosen.name.toLowerCase();
        const cArtist = chosen.artist.toLowerCase();
        const bestLrc =
          lrcCandidates.find(
            (item) =>
              typeof item.syncedLyrics === "string" &&
              String(item.trackName ?? "").toLowerCase().includes(cName) &&
              String(item.artistName ?? "").toLowerCase().includes(cArtist),
          ) ??
          lrcCandidates.find(
            (item) =>
              typeof item.syncedLyrics === "string" &&
              String(item.artistName ?? "").toLowerCase().includes(cArtist),
          ) ??
          lrcCandidates.find(
            (item) =>
              typeof item.syncedLyrics === "string" &&
              String(item.trackName ?? "").toLowerCase().includes(cName),
          ) ??
          lrcCandidates.find((item) => typeof item.syncedLyrics === "string") ??
          lrcCandidates[0];

        if (typeof bestLrc?.syncedLyrics === "string") {
          const parsedLrc = parseLrcToLines(bestLrc.syncedLyrics);
          // For Enchor SNG full audio, keep exact timestamps; for global preview tracks, start at first lyric line
          const offsetMs =
            chosen.source === "enchor" ? 0 : (parsedLrc[0]?.timeMs ?? 0);
          lyrics = parsedLrc.map((line) => ({
            timeMs: Math.max(0, line.timeMs - offsetMs),
            text: line.text,
          }));
        } else if (typeof bestLrc?.plainLyrics === "string") {
          lyrics = bestLrc.plainLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((text, idx) => ({ timeMs: idx * 3200, text }));
        }
      }
    }

    if (notes.length === 0) {
      const fallbackFreqs: Array<{ id: ScaleNoteId; freq: number }> = [
        { id: "mi", freq: 329.63 },
        { id: "sol", freq: 392.0 },
        { id: "la", freq: 440.0 },
        { id: "sol", freq: 392.0 },
        { id: "mi", freq: 329.63 },
        { id: "re", freq: 293.66 },
        { id: "do", freq: 261.63 },
        { id: "re", freq: 293.66 },
        { id: "mi", freq: 329.63 },
        { id: "fa", freq: 349.23 },
        { id: "sol", freq: 392.0 },
        { id: "do_high", freq: 523.25 },
      ];
      const lyricWords = lyrics
        .flatMap((l) => l.text.split(/\s+/))
        .filter(Boolean);
      const syllables = ["La~", "Na~", "Mi~", "Lu~", "La~", "Du~"];

      // Generate enough notes to span the entire song duration (e.g. 240..500 notes)
      const lastLyricMs =
        lyrics.length > 0 ? lyrics[lyrics.length - 1].timeMs + 6000 : 120_000;
      const totalSongMs = Math.max(
        lastLyricMs,
        Math.min(chosen.songLengthMs || 180_000, 300_000),
      );
      const avgGapMs = 360;
      const noteCount = Math.max(
        180,
        Math.min(600, Math.ceil(totalSongMs / avgGapMs)),
      );

      notes = Array.from({ length: noteCount }, (_, idx) => {
        const pick =
          fallbackFreqs[
            (idx + chosen.name.charCodeAt(idx % chosen.name.length)) %
              fallbackFreqs.length
          ];
        return {
          id: pick.id,
          freq: pick.freq,
          dur: idx % 4 === 3 ? 0.52 : 0.34,
          gap: idx % 4 === 3 ? 440 : 320,
          lyric:
            lyricWords[idx % Math.max(1, lyricWords.length)] ||
            syllables[idx % syllables.length],
        };
      });
    }

    if (lyrics.length === 0) {
      lyrics = [
        { timeMs: 0, text: `♪ ${chosen.name} - ${chosen.artist} ♪` },
        { timeMs: 2500, text: "La la la~ bernyanyi bersama REYA! ♫" },
        { timeMs: 5500, text: `Irama ${chosen.genre || "musik"} yang seru~ ♪` },
        { timeMs: 8500, text: "Do Re Mi Fa Sol~ goyang bareng! ★" },
      ];
    }

    return Response.json({
      found: ranked.length,
      results: ranked.slice(0, 10),
      selected: {
        ...chosen,
        audioUrl: audioUrl ?? vocalAudioUrl,
        vocalAudioUrl,
        lyrics,
        notes,
      },
    });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal mengambil data lagu BitChord",
      },
      { status: 500 },
    );
  }
}
