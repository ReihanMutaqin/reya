import { NextResponse } from "next/server";
import { synthesizeEdgeNeuralTTS } from "./edge-neural";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-3.8-flash-tts",
];

const exhaustedModels = new Map<string, number>();

// LRU cache for synthesized speech to provide instant playback
const ttsCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
const MAX_CACHE_SIZE = 150;

function storeInCache(
  key: string,
  val: { buffer: ArrayBuffer; contentType: string },
) {
  if (ttsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = ttsCache.keys().next().value;
    if (firstKey) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, val);
}

function pcm16ToWav(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
): ArrayBuffer {
  // If the buffer already starts with a RIFF WAV header, return it untouched
  if (
    pcmBuffer.byteLength > 44 &&
    pcmBuffer.subarray(0, 4).toString("ascii") === "RIFF"
  ) {
    return pcmBuffer.buffer.slice(
      pcmBuffer.byteOffset,
      pcmBuffer.byteOffset + pcmBuffer.byteLength,
    );
  }

  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.byteLength;
  const wavBuffer = Buffer.alloc(44 + dataSize);

  wavBuffer.write("RIFF", 0, "ascii");
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write("WAVE", 8, "ascii");
  wavBuffer.write("fmt ", 12, "ascii");
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
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
  if (
    requestedProfileId &&
    requestedProfileId !== "default" &&
    !requestedProfileId.startsWith("reya-")
  ) {
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
    // Local Voicebox daemon offline
  }
  return undefined;
}

async function tryLocalVoiceboxDaemon(
  text: string,
  voiceboxUrl: string,
  profileId: string,
  instruct?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const baseUrl = (voiceboxUrl || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");
  if (baseUrl.startsWith("voicebox://")) return null;

  try {
    const ping = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(350),
    });
    if (!ping.ok) return null;
  } catch {
    return null;
  }

  const resolvedProfileId = await resolveVoiceboxProfileId(baseUrl, profileId);

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
      signal: AbortSignal.timeout(12000),
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
        signal: AbortSignal.timeout(14000),
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
            signal: AbortSignal.timeout(6000),
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

// Pure-TS Voicebox Cloud Neural Engine (runs 100% natively on Vercel Node.js with zero Python!)
async function tryVoiceboxCloudNeuralTTS(
  text: string,
  profileOrSpeaker?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const norm = (profileOrSpeaker || "").toLowerCase().trim();

  let voice = "id-ID-GadisNeural";
  let rate = "+6%";
  let pitch = "+4Hz";

  if (norm.includes("imut") || norm.includes("cute") || norm === "f2") {
    voice = "id-ID-GadisNeural";
    rate = "+8%";
    pitch = "+6Hz";
  } else if (norm.includes("kalem") || norm === "f1" || norm.includes("zephyr")) {
    voice = "id-ID-GadisNeural";
    rate = "+2%";
    pitch = "+1Hz";
  } else if (norm.includes("ardi") || norm === "m1") {
    voice = "id-ID-ArdiNeural";
    rate = "+4%";
    pitch = "+0Hz";
  }

  const cacheKey = `vbcloud:${voice}:${rate}:${pitch}:${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  const synthesized = await synthesizeEdgeNeuralTTS(text, voice, rate, pitch);
  if (synthesized) {
    storeInCache(cacheKey, synthesized);
    return synthesized;
  }

  return null;
}

function mapSpeakerToGeminiVoice(speaker?: string): string {
  const norm = (speaker || "").toLowerCase().trim();
  if (norm.includes("zephyr") || norm === "f1" || norm.includes("kalem")) {
    return "Zephyr";
  }
  if (norm.includes("kore") || norm === "f3") {
    return "Kore";
  }
  if (norm.includes("leda") || norm === "f5") {
    return "Leda";
  }
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
    .replace(/[*_#`~[\]♪♫]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  if (!cleanText) return null;

  const voiceName = mapSpeakerToGeminiVoice(speaker);
  const cacheKey = `gemini:${voiceName}:${cleanText}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

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
          contents: [{ parts: [{ text: cleanText }] }],
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
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        if (res.status === 429) {
          exhaustedModels.set(model, Date.now() + 180000);
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
      storeInCache(cacheKey, result);
      return result;
    } catch {
      continue;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") || "").trim();
  const profileId = url.searchParams.get("profile_id") || "reya-gadis-ceria";
  const speaker = url.searchParams.get("speaker") || profileId;
  const instruct = url.searchParams.get("instruction") || undefined;
  const voiceboxUrl =
    url.searchParams.get("voicebox_url") || DEFAULT_VOICEBOX_URL;

  if (!text) {
    return NextResponse.json(
      { error: "Parameter text wajib diisi" },
      { status: 400 },
    );
  }

  // 1. Local jamiepine/voicebox daemon if running
  const localVb = await tryLocalVoiceboxDaemon(
    text,
    voiceboxUrl,
    profileId,
    instruct,
  );
  if (localVb) {
    return new Response(localVb.buffer, {
      status: 200,
      headers: {
        "Content-Type": localVb.contentType,
        "X-Voice-Provider": "voicebox",
        "Cache-Control": "no-store",
      },
    });
  }

  // 2. Voicebox Cloud Neural Engine (Pure-TS Gadis Neural 24kHz — always online on Vercel!)
  const cloudVb = await tryVoiceboxCloudNeuralTTS(text, profileId || speaker);
  if (cloudVb) {
    return new Response(cloudVb.buffer, {
      status: 200,
      headers: {
        "Content-Type": cloudVb.contentType,
        "X-Voice-Provider": "voicebox",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // 3. Gemini Neural Audio TTS backup
  const geminiAudio = await tryGeminiNeuralTTS(text, speaker);
  if (geminiAudio) {
    return new Response(geminiAudio.buffer, {
      status: 200,
      headers: {
        "Content-Type": geminiAudio.contentType,
        "X-Voice-Provider": "voicebox",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return NextResponse.json({ error: "Voicebox TTS tidak tersedia" }, { status: 503 });
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
    };
    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Teks kosong" }, { status: 400 });
    }

    const profileId = body.profile_id || body.speaker || "reya-gadis-ceria";
    const voiceboxUrl = body.voicebox_url || DEFAULT_VOICEBOX_URL;

    // 1. Local jamiepine/voicebox daemon if running
    const localVb = await tryLocalVoiceboxDaemon(
      text,
      voiceboxUrl,
      profileId,
      body.instruction,
    );
    if (localVb) {
      return new Response(localVb.buffer, {
        status: 200,
        headers: {
          "Content-Type": localVb.contentType,
          "X-Voice-Provider": "voicebox",
          "Cache-Control": "no-store",
        },
      });
    }

    // 2. Voicebox Cloud Neural Engine (Pure-TS Gadis Neural 24kHz — always online on Vercel!)
    const cloudVb = await tryVoiceboxCloudNeuralTTS(
      text,
      body.speaker || profileId,
    );
    if (cloudVb) {
      return new Response(cloudVb.buffer, {
        status: 200,
        headers: {
          "Content-Type": cloudVb.contentType,
          "X-Voice-Provider": "voicebox",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // 3. Gemini Neural Audio TTS backup
    const geminiAudio = await tryGeminiNeuralTTS(
      text,
      body.speaker || profileId,
    );
    if (geminiAudio) {
      return new Response(geminiAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": geminiAudio.contentType,
          "X-Voice-Provider": "voicebox",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return NextResponse.json(
      { error: "Gagal membuat suara Voicebox" },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
}
