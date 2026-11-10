import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

// Models supporting high-quality Gemini Neural TTS with AUDIO modality
// flash-lite is placed first for lowest conversational latency
const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-tts",
];

// Temporarily skip models that exceeded free-tier quota (429) to avoid latency on subsequent calls
const exhaustedModels = new Map<string, number>();

// LRU cache for synthesized speech to provide instant playback and prevent quota exhaustion
const ttsCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
const MAX_CACHE_SIZE = 120;

function pcm16ToWav(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
): ArrayBuffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.byteLength;
  const wavBuffer = Buffer.alloc(44 + dataSize);

  wavBuffer.write("RIFF", 0, "ascii");
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write("WAVE", 8, "ascii");
  wavBuffer.write("fmt ", 12, "ascii");
  wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  wavBuffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36, "ascii");
  wavBuffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength,
  );
}

async function resolveVoiceboxProfileId(
  baseUrl: string,
  requestedProfileId: string,
): Promise<string | undefined> {
  if (requestedProfileId && requestedProfileId !== "default") {
    return requestedProfileId;
  }
  try {
    const res = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(350),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : typeof data === "object" && data !== null && "profiles" in data
      ? ((data as { profiles?: unknown[] }).profiles ?? [])
      : [];
    const first = list.find(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && (item.id || item.profile_id)),
    );
    if (first) {
      return String(first.id ?? first.profile_id);
    }
  } catch {
    // Voicebox server offline
  }
  return undefined;
}

async function tryVoiceboxTTS(
  text: string,
  voiceboxUrl: string,
  profileId: string,
  instruct?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const baseUrl = (voiceboxUrl || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");

  // Instant reachability check: if port is not actively listening, skip immediately
  try {
    const ping = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(350),
    });
    if (!ping.ok) return null;
  } catch {
    return null;
  }

  const resolvedProfileId = await resolveVoiceboxProfileId(baseUrl, profileId);

  // 1. OpenAI-compatible endpoint in jamiepine/voicebox (/v1/audio/speech)
  try {
    const speechPayload: Record<string, unknown> = {
      model: "tts-1",
      input: text,
      response_format: "wav",
    };
    if (resolvedProfileId) {
      speechPayload.voice = resolvedProfileId;
    }

    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speechPayload),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 200) {
        return {
          buffer: buf,
          contentType: res.headers.get("content-type") || "audio/wav",
        };
      }
    }
  } catch {
    // Try native /generate route next
  }

  // 2. Native /generate endpoint in jamiepine/voicebox
  if (!resolvedProfileId) {
    return null;
  }

  for (const langCode of ["ms", "en"]) {
    try {
      const genRes = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          profile_id: resolvedProfileId,
          language: langCode,
          instruct: instruct || undefined,
        }),
        signal: AbortSignal.timeout(16000),
      });

      if (!genRes.ok) continue;

      const ct = genRes.headers.get("content-type") || "";
      if (ct.includes("audio/")) {
        const buf = await genRes.arrayBuffer();
        if (buf.byteLength > 200) {
          return { buffer: buf, contentType: ct };
        }
      }

      const data = (await genRes.json()) as {
        id?: string;
        generation_id?: string;
        audio?: string;
        audio_base64?: string;
      };

      const b64 = data.audio || data.audio_base64;
      if (typeof b64 === "string" && b64.length > 100) {
        const binary = Buffer.from(b64, "base64");
        return {
          buffer: binary.buffer.slice(
            binary.byteOffset,
            binary.byteOffset + binary.byteLength,
          ),
          contentType: "audio/wav",
        };
      }

      const genId = data.id || data.generation_id;
      if (genId) {
        for (const pathSuffix of [
          `/audio/${genId}`,
          `/history/${genId}/export-audio`,
        ]) {
          const audioRes = await fetch(`${baseUrl}${pathSuffix}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (audioRes.ok) {
            const buf = await audioRes.arrayBuffer();
            if (buf.byteLength > 200) {
              return {
                buffer: buf,
                contentType:
                  audioRes.headers.get("content-type") || "audio/wav",
              };
            }
          }
        }
      }
    } catch {
      break;
    }
  }

  return null;
}

// Maps user speaker selection to Gemini prebuilt neural voices
// "Aoede" is the premier bright, cheerful, lively soprano feminine voice.
// "Zephyr" is the warm, natural, friendly conversational feminine voice.
function mapSpeakerToGeminiVoice(speaker?: string): string {
  const norm = (speaker || "").toLowerCase().trim();
  if (norm.includes("zephyr") || norm === "f1") {
    return "Zephyr";
  }
  if (norm.includes("kore") || norm === "f3" || norm.includes("aiden")) {
    return "Kore";
  }
  if (norm.includes("leda") || norm === "f5" || norm.includes("serena")) {
    return "Leda";
  }
  if (norm.includes("callirrhoe") || norm === "f4" || norm.includes("ryan")) {
    return "Callirrhoe";
  }
  if (norm.includes("puck")) {
    return "Puck";
  }
  // Default to Aoede for bright, cheerful, natural persona ("yang ceria nya")
  return "Aoede";
}

async function tryGeminiNeuralTTS(
  text: string,
  speaker?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    ""
  ).trim();
  if (!apiKey) return null;

  const cleanText = text
    .replace(/[*_#`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  if (!cleanText) return null;

  const voiceName = mapSpeakerToGeminiVoice(speaker);
  const cacheKey = `gemini:${voiceName}:${cleanText}`;

  // Return cached audio if available
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Iterate over available Gemini TTS models in sequence
  for (const model of GEMINI_TTS_MODELS) {
    if ((exhaustedModels.get(model) || 0) > Date.now()) {
      continue;
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: cleanText,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(3500),
      });

      if (!res.ok) {
        if (res.status === 429) {
          exhaustedModels.set(model, Date.now() + 120000);
        }
        continue;
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: {
                mimeType?: string;
                data?: string;
              };
            }>;
          };
        }>;
      };

      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const b64 = inlineData?.data;
      if (!b64 || b64.length < 100) continue;

      const pcmBytes = Buffer.from(b64, "base64");
      const wavArrayBuffer = pcm16ToWav(pcmBytes, 24000, 1);

      const result = {
        buffer: wavArrayBuffer,
        contentType: "audio/wav",
      };

      // Store in memory cache
      if (ttsCache.size >= MAX_CACHE_SIZE) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey) ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, result);

      return result;
    } catch {
      // Continue to next model on network error / timeout
      continue;
    }
  }

  return null;
}

// Local Edge-TTS worker using Microsoft Neural Voice (id-ID-GadisNeural)
// Gadis is an extraordinarily natural, cheerful, expressive young female Indonesian neural voice.
async function tryLocalEdgeNeuralTTS(
  text: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const cleanText = text
    .replace(/[*_#`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!cleanText) return null;

  const cacheKey = `edge:gadis:${cleanText}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  const pyCode = `
import asyncio, sys, os, tempfile, edge_tts
async def run():
    tmp = tempfile.mktemp(suffix='.mp3')
    comm = edge_tts.Communicate(sys.argv[1], 'id-ID-GadisNeural')
    await comm.save(tmp)
    data = open(tmp, 'rb').read()
    try: os.remove(tmp)
    except: pass
    sys.stdout.buffer.write(data)
asyncio.run(run())
`;

  try {
    const { stdout } = await execFileAsync("python", ["-c", pyCode, cleanText], {
      encoding: "buffer",
      maxBuffer: 15 * 1024 * 1024,
      timeout: 4500,
    });

    if (stdout && stdout.length > 500) {
      const arrayBuf = stdout.buffer.slice(
        stdout.byteOffset,
        stdout.byteOffset + stdout.byteLength,
      );
      const result = {
        buffer: arrayBuf,
        contentType: "audio/mpeg",
      };
      if (ttsCache.size >= MAX_CACHE_SIZE) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey) ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, result);
      return result;
    }
  } catch {
    // Local Python edge_tts unavailable
  }

  return null;
}

async function tryFallbackIndoTTS(
  text: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    const cleanQuery = text.replace(/[*_#`~]/g, "").slice(0, 300);
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanQuery)}&tl=id&client=tw-ob`;
    const ttsRes = await fetch(ttsUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (ttsRes.ok) {
      const buf = await ttsRes.arrayBuffer();
      if (buf.byteLength > 100) {
        return { buffer: buf, contentType: "audio/mpeg" };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") || "").trim();
  const engine = url.searchParams.get("engine") || "voicebox";
  const profileId = url.searchParams.get("profile_id") || "default";
  const speaker = url.searchParams.get("speaker") || profileId;
  const instruct = url.searchParams.get("instruction") || undefined;
  const voiceboxUrl = url.searchParams.get("voicebox_url") || DEFAULT_VOICEBOX_URL;

  if (!text) {
    return NextResponse.json(
      { error: "Parameter text wajib diisi" },
      { status: 400 },
    );
  }

  // 1. Try jamiepine/voicebox local studio server first when selected
  if (engine === "voicebox") {
    const vbAudio = await tryVoiceboxTTS(text, voiceboxUrl, profileId, instruct);
    if (vbAudio) {
      return new Response(vbAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": vbAudio.contentType,
          "X-Voice-Provider": "voicebox",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  // 2. High-quality Gemini Neural Audio TTS (Aoede - Ceria & Ekspresif / Zephyr - Hangat)
  const geminiAudio = await tryGeminiNeuralTTS(text, speaker);
  if (geminiAudio) {
    return new Response(geminiAudio.buffer, {
      status: 200,
      headers: {
        "Content-Type": geminiAudio.contentType,
        "X-Voice-Provider": "gemini-neural-tts",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // 3. Local Neural Edge-TTS (id-ID-GadisNeural: young cheerful Indonesian female voice)
  const edgeAudio = await tryLocalEdgeNeuralTTS(text);
  if (edgeAudio) {
    return new Response(edgeAudio.buffer, {
      status: 200,
      headers: {
        "Content-Type": edgeAudio.contentType,
        "X-Voice-Provider": "edge-neural-gadis",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // 4. Catastrophic safety net fallback
  const fallbackAudio = await tryFallbackIndoTTS(text);
  if (fallbackAudio) {
    return new Response(fallbackAudio.buffer, {
      status: 200,
      headers: {
        "Content-Type": fallbackAudio.contentType,
        "X-Voice-Provider": "indo-fallback",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return NextResponse.json({ error: "TTS tidak tersedia" }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      engine?: string;
      profile_id?: string;
      speaker?: string;
      instruction?: string;
      voicebox_url?: string;
      voicebox_online?: boolean;
    };
    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Teks kosong" }, { status: 400 });
    }

    const profileId = body.profile_id || body.speaker || "default";
    const voiceboxUrl = body.voicebox_url || DEFAULT_VOICEBOX_URL;
    const voiceboxOnline = body.voicebox_online ?? (body.engine === "voicebox" ? undefined : false);

    // 1. Try jamiepine/voicebox local studio server ONLY when selected and online
    if (body.engine === "voicebox" && voiceboxOnline !== false) {
      const vbAudio = await tryVoiceboxTTS(
        text,
        voiceboxUrl,
        profileId,
        body.instruction,
      );
      if (vbAudio) {
        return new Response(vbAudio.buffer, {
          status: 200,
          headers: {
            "Content-Type": vbAudio.contentType,
            "X-Voice-Provider": "voicebox",
            "Cache-Control": "no-store",
          },
        });
      }
    }

    // 2. High-quality Gemini Neural Audio TTS (Aoede - Ceria & Ekspresif / Zephyr - Hangat)
    const geminiAudio = await tryGeminiNeuralTTS(
      text,
      body.speaker || profileId,
    );
    if (geminiAudio) {
      return new Response(geminiAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": geminiAudio.contentType,
          "X-Voice-Provider": "gemini-neural-tts",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // 3. Local Neural Edge-TTS (id-ID-GadisNeural: young cheerful Indonesian female voice)
    const edgeAudio = await tryLocalEdgeNeuralTTS(text);
    if (edgeAudio) {
      return new Response(edgeAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": edgeAudio.contentType,
          "X-Voice-Provider": "edge-neural-gadis",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // 4. Catastrophic safety net fallback
    const fallbackAudio = await tryFallbackIndoTTS(text);
    if (fallbackAudio) {
      return new Response(fallbackAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": fallbackAudio.contentType,
          "X-Voice-Provider": "indo-fallback",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return NextResponse.json({ error: "Gagal membuat suara" }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
}
