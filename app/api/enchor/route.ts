export const runtime = "nodejs";

type ScaleNoteId = "do" | "re" | "mi" | "fa" | "sol" | "la" | "si" | "do_high";

export interface EnchorNoteItem {
  id: ScaleNoteId;
  dur: number;
  gap: number;
  freq?: number;
  lyric?: string;
}

export interface EnchorLyricLine {
  timeMs: number;
  text: string;
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

  const bpmMatch = chartText.match(/\d+\s*=\s*B\s+(\d+)/);
  const milliBpm = bpmMatch ? Number(bpmMatch[1]) : 120000;
  const bpm = Math.max(60, Math.min(220, milliBpm / 1000));
  const msPerTick = 60000 / (bpm * resolution);

  // 1. Parse Lyrics from [Events]
  const rawLyrics: Array<{ tick: number; word: string }> = [];
  const eventsSection = chartText.match(/\[Events\]\s*\{([\s\S]*?)\}/i)?.[1] ?? "";
  const lyricRegex = /(\d+)\s*=\s*E\s*"lyric\s+([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = lyricRegex.exec(eventsSection)) !== null) {
    const tick = Number(match[1]);
    const cleaned = cleanLyricSyllable(match[2]);
    if (cleaned && cleaned !== "+") {
      rawLyrics.push({ tick, word: cleaned });
    }
  }

  const lyrics: EnchorLyricLine[] = [];
  let currentWords: string[] = [];
  let lineStartTick = 0;

  for (let i = 0; i < rawLyrics.length; i++) {
    const item = rawLyrics[i];
    if (currentWords.length === 0) lineStartTick = item.tick;

    const prev = currentWords[currentWords.length - 1];
    if (prev && prev.endsWith("-")) {
      currentWords[currentWords.length - 1] =
        prev.slice(0, -1) + item.word.replace(/^-/, "");
    } else {
      currentWords.push(item.word.replace(/-$/, "-"));
    }

    const nextTick = rawLyrics[i + 1]?.tick ?? Infinity;
    const isLineBreak =
      currentWords.length >= 6 ||
      (nextTick - item.tick) * msPerTick > 1800 ||
      /[.!?]$/.test(item.word);

    if (isLineBreak) {
      const text = currentWords
        .join(" ")
        .replace(/- /g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        lyrics.push({
          timeMs: Math.round(lineStartTick * msPerTick),
          text,
        });
      }
      currentWords = [];
    }
  }
  if (currentWords.length > 0) {
    const text = currentWords.join(" ").replace(/- /g, "").trim();
    if (text) {
      lyrics.push({ timeMs: Math.round(lineStartTick * msPerTick), text });
    }
  }

  // 2. Parse Notes from the best available instrument track
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

  const parsedTicks: Array<{ tick: number; fret: number; lenTicks: number }> = [];
  const noteRegex = /(\d+)\s*=\s*N\s+([0-7])\s+(\d+)/g;
  let lastTick = -9999;
  while ((match = noteRegex.exec(noteBlock)) !== null) {
    const tick = Number(match[1]);
    const fret = Number(match[2]);
    const lenTicks = Number(match[3]);
    // Avoid chord duplicates on the exact same tick or ultra-fast trills < 90ms
    if ((tick - lastTick) * msPerTick < 110) continue;
    lastTick = tick;
    parsedTicks.push({ tick, fret, lenTicks });
    if (parsedTicks.length >= 64) break;
  }

  const notes: EnchorNoteItem[] = parsedTicks.map((item, idx) => {
    const next = parsedTicks[idx + 1];
    const rawGapMs = next
      ? Math.round((next.tick - item.tick) * msPerTick)
      : 420;
    const gap = Math.max(170, Math.min(680, rawGapMs));
    const rawDurSec = Math.max(0.24, (item.lenTicks * msPerTick) / 1000);
    const dur = Math.round(Math.min(1.1, Math.max(0.28, rawDurSec)) * 100) / 100;

    // Pair with nearby lyric syllable if available
    const nearLyric = rawLyrics.find(
      (l) => Math.abs(l.tick - item.tick) * msPerTick < 400,
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

  return { lyrics: lyrics.slice(0, 24), notes };
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
      if ((n.tick - lastTick) * msPerTick < 120) continue;
      lastTick = n.tick;
      deduped.push(n);
      if (deduped.length >= 64) break;
    }

    for (let i = 0; i < deduped.length; i++) {
      const cur = deduped[i];
      const next = deduped[i + 1];
      const rawGap = next
        ? Math.round((next.tick - cur.tick) * msPerTick)
        : 420;
      const gap = Math.max(180, Math.min(680, rawGap));
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

  return { lyrics: lyrics.slice(0, 24), notes };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "search";

  // 1. Stream & Unmask Audio directly from Enchor SNG CDN
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

    // Fetch up to 4.5MB of the audio stream (covers entire song or long preview)
    const maxAudioBytes = Math.min(audioEntry.size, 4_500_000);
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
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // 2. Search Enchor.us API & Extract Singing Melody + Synced Lyrics
  const query = (searchParams.get("q") || "bohemian rhapsody").trim();
  const targetMd5 = searchParams.get("md5") || "";

  try {
    const searchRes = await fetch("https://api.enchor.us/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: query, page: 1 }),
      signal: AbortSignal.timeout(5000),
    });

    if (!searchRes.ok) {
      return Response.json(
        { error: "Enchor API tidak merespons" },
        { status: 502 },
      );
    }

    const payload = (await searchRes.json()) as {
      found?: number;
      data?: Array<Record<string, unknown>>;
    };

    const rawItems = Array.isArray(payload.data) ? payload.data : [];
    const summaries: EnchorSongSummary[] = rawItems.slice(0, 12).map((item) => {
      const notesData = (item.notesData as Record<string, unknown>) || {};
      const albumArtMd5 =
        typeof item.albumArtMd5 === "string" && item.albumArtMd5
          ? item.albumArtMd5
          : null;
      return {
        chartId: Number(item.chartId ?? 0),
        name: String(item.name ?? "Lagu Enchor"),
        artist: String(item.artist ?? "Unknown Artist"),
        album: String(item.album ?? ""),
        genre: String(item.genre ?? ""),
        year: String(item.year ?? ""),
        charter: String(item.charter ?? ""),
        md5: String(item.md5 ?? ""),
        albumArtUrl: albumArtMd5
          ? `https://files.enchor.us/${albumArtMd5}.jpg`
          : null,
        songLengthMs: Number(item.song_length ?? 180000),
        previewStartMs: Number(item.preview_start_time ?? 0),
        hasLyrics: Boolean(notesData.hasLyrics),
        hasVocals: Boolean(notesData.hasVocals),
        instruments: Array.isArray(notesData.instruments)
          ? (notesData.instruments as string[])
          : [],
      };
    });

    // Sort so charts with lyrics/vocals come first when picking default
    const sorted = [...summaries].sort((a, b) => {
      const scoreA = (a.hasLyrics ? 2 : 0) + (a.hasVocals ? 2 : 0);
      const scoreB = (b.hasLyrics ? 2 : 0) + (b.hasVocals ? 2 : 0);
      return scoreB - scoreA;
    });

    const chosen =
      (targetMd5 ? summaries.find((s) => s.md5 === targetMd5) : null) ??
      sorted[0] ??
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
    let audioUrl: string | null = null;
    let vocalAudioUrl: string | null = null;

    const sngIndex = await fetchSngIndex(chosen.md5);
    if (sngIndex) {
      const hasSongAudio =
        sngIndex.files.find((f) => /^song\.(opus|ogg|mp3)$/i.test(f.name)) ??
        sngIndex.files.find((f) => /^vocals\.(opus|ogg|mp3)$/i.test(f.name)) ??
        sngIndex.files.find((f) => /^(guitar|keys|rhythm)\.(opus|ogg|mp3)$/i.test(f.name));
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
      const midEntry = sngIndex.files.find((f) => /notes\.mid$/i.test(f.name));

      if (chartEntry) {
        const buf = await fetchUnmaskedSngEntry(
          chosen.md5,
          chartEntry,
          sngIndex.xorMask,
          300_000,
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
          300_000,
        );
        if (buf) {
          const parsed = parseMidiVocalsAndNotes(buf);
          if (lyrics.length === 0) lyrics = parsed.lyrics;
          if (notes.length === 0) notes = parsed.notes;
        }
      }
    }

    if (notes.length === 0) {
      const fallbackFreqs: Array<{ id: ScaleNoteId; freq: number }> = [
        { id: "do", freq: 261.63 },
        { id: "re", freq: 293.66 },
        { id: "mi", freq: 329.63 },
        { id: "sol", freq: 392.0 },
        { id: "la", freq: 440.0 },
        { id: "do_high", freq: 523.25 },
        { id: "la", freq: 440.0 },
        { id: "sol", freq: 392.0 },
        { id: "mi", freq: 329.63 },
        { id: "re", freq: 293.66 },
        { id: "do", freq: 261.63 },
      ];
      const syllables = ["La~", "Na~", "Mi~", "Lu~", "La~", "Du~"];
      notes = Array.from({ length: 24 }, (_, idx) => {
        const pick =
          fallbackFreqs[(idx + chosen.name.charCodeAt(idx % chosen.name.length)) % fallbackFreqs.length];
        return {
          id: pick.id,
          freq: pick.freq,
          dur: idx % 4 === 3 ? 0.55 : 0.34,
          gap: idx % 4 === 3 ? 460 : 280,
          lyric: syllables[idx % syllables.length],
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
      found: payload.found ?? summaries.length,
      results: sorted,
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
            : "Gagal mengambil data dari Enchor.us",
      },
      { status: 500 },
    );
  }
}
