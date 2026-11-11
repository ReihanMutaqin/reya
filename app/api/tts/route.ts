import { NextResponse } from "next/server";
import { synthesizeEdgeNeuralTTS } from "./edge-neural";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

const LOCAL_AI_URL =
  process.env.LOCAL_AI_URL || "http://127.0.0.1:8765";

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

function mapProfileToSupertonicSpeaker(profileOrSpeaker?: string): string {
  const norm = (profileOrSpeaker || "").trim();
  const upper = norm.toUpperCase();
  if (["F1", "F2", "F3", "F4", "F5"].includes(upper)) {
    return upper;
  }
  const low = norm.toLowerCase();
  if (low.includes("kalem") || low.includes("lembut") || low === "f5") {
    return "F5";
  }
  if (low.includes("natural") || low.includes("hangat") || low === "f1") {
    return "F1";
  }
  if (low.includes("jernih") || low === "f3") {
    return "F3";
  }
  if (low.includes("dinamis") || low === "f4") {
    return "F4";
  }
  // Default to F2 (Lily Cute — exact voice of CONTOH-SUARA-RAYA-CUTE.wav)
  return "F2";
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
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : typeof data === "object" && data !== null && "profiles" in data
        ? ((data as { profiles?: unknown[] }).profiles ?? [])
        : [];
    const mappedSpeaker = mapProfileToSupertonicSpeaker(requestedProfileId);
    const matched = list.find(
      (item): item is Record<string, unknown> =>
        Boolean(
          item &&
            typeof item === "object" &&
            (item.id === mappedSpeaker || item.profile_id === mappedSpeaker),
        ),
    );
    if (matched) {
      return String(matched.id ?? matched.profile_id);
    }
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

  const speaker = mapProfileToSupertonicSpeaker(profileId);
  const cacheKey = `vb-local:${baseUrl}:${speaker}:${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  try {
    const ping = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(800),
    });
    if (!ping.ok) return null;
  } catch {
    return null;
  }

  const resolvedProfileId =
    (await resolveVoiceboxProfileId(baseUrl, profileId)) || speaker;

  try {
    const speechPayload: Record<string, unknown> = {
      model: "tts-1",
      input: text,
      voice: resolvedProfileId,
      response_format: "wav",
    };

    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speechPayload),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 200) {
        const result = {
          buffer: buf,
          contentType: res.headers.get("content-type") || "audio/wav",
        };
        storeInCache(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Try native /generate route next
  }

  for (const langCode of ["id", "ms", "en"]) {
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
          const result = { buffer: buf, contentType: ct };
          storeInCache(cacheKey, result);
          return result;
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
        const result = {
          buffer: binary.buffer.slice(
            binary.byteOffset,
            binary.byteOffset + binary.byteLength,
          ),
          contentType: "audio/wav",
        };
        storeInCache(cacheKey, result);
        return result;
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
              const result = {
                buffer: buf,
                contentType:
                  audioRes.headers.get("content-type") || "audio/wav",
              };
              storeInCache(cacheKey, result);
              return result;
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

// 2. Local Supertonic 3 Server (Port 8765 — exact CONTOH-SUARA-RAYA-CUTE.wav 44.1kHz engine)
async function tryLocalSupertonicServer(
  text: string,
  profileOrSpeaker?: string,
  instruct?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const speaker = mapProfileToSupertonicSpeaker(profileOrSpeaker);
  const cacheKey = `supertonic-local:${speaker}:${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${LOCAL_AI_URL}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        engine: "supertonic",
        speaker,
        instruction: instruct || undefined,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 200) {
        const result = {
          buffer: buf,
          contentType: res.headers.get("content-type") || "audio/wav",
        };
        storeInCache(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Local AI server not running
  }
  return null;
}

// 3. Pure-TS Voicebox Cloud Neural Engine (non-Google natural fallback when running on Vercel without local daemon)
async function tryVoiceboxCloudNeuralTTS(
  text: string,
  profileOrSpeaker?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const norm = (profileOrSpeaker || "").toLowerCase().trim();

  let voice = "id-ID-GadisNeural";
  let rate = "+0%";
  const pitch = "+0Hz";

  if (norm.includes("imut") || norm.includes("cute") || norm === "f2") {
    voice = "id-ID-GadisNeural";
    rate = "+2%";
  } else if (norm.includes("kalem") || norm === "f1" || norm === "f5") {
    voice = "id-ID-GadisNeural";
    rate = "-4%";
  } else if (norm.includes("ardi") || norm === "m1") {
    voice = "id-ID-ArdiNeural";
    rate = "+4%";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") || "").trim();
  const profileId = url.searchParams.get("profile_id") || "F2";
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

  // 1. Local Voicebox daemon (port 17493)
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
        "X-Voice-Provider": "voicebox-local",
        "Cache-Control": "no-store",
      },
    });
  }

  // 2. Local Supertonic 3 44.1kHz server (port 8765 — exact CONTOH-SUARA-RAYA-CUTE.wav voice)
  const localSt = await tryLocalSupertonicServer(
    text,
    speaker || profileId,
    instruct,
  );
  if (localSt) {
    return new Response(localSt.buffer, {
      status: 200,
      headers: {
        "Content-Type": localSt.contentType,
        "X-Voice-Provider": "voicebox-supertonic3",
        "Cache-Control": "no-store",
      },
    });
  }

  // 3. Voicebox Cloud Neural fallback (only when local daemon & browser ONNX are unavailable)
  const cloudVb = await tryVoiceboxCloudNeuralTTS(text, profileId || speaker);
  if (cloudVb) {
    return new Response(cloudVb.buffer, {
      status: 200,
      headers: {
        "Content-Type": cloudVb.contentType,
        "X-Voice-Provider": "voicebox-cloud",
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

    const profileId = body.profile_id || body.speaker || "F2";
    const voiceboxUrl = body.voicebox_url || DEFAULT_VOICEBOX_URL;

    // 1. Local Voicebox daemon (port 17493)
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
          "X-Voice-Provider": "voicebox-local",
          "Cache-Control": "no-store",
        },
      });
    }

    // 2. Local Supertonic 3 44.1kHz server (port 8765 — exact CONTOH-SUARA-RAYA-CUTE.wav voice)
    const localSt = await tryLocalSupertonicServer(
      text,
      body.speaker || profileId,
      body.instruction,
    );
    if (localSt) {
      return new Response(localSt.buffer, {
        status: 200,
        headers: {
          "Content-Type": localSt.contentType,
          "X-Voice-Provider": "voicebox-supertonic3",
          "Cache-Control": "no-store",
        },
      });
    }

    // 3. Voicebox Cloud Neural fallback (only when local daemon & browser ONNX are unavailable)
    const cloudVb = await tryVoiceboxCloudNeuralTTS(
      text,
      body.speaker || profileId,
    );
    if (cloudVb) {
      return new Response(cloudVb.buffer, {
        status: 200,
        headers: {
          "Content-Type": cloudVb.contentType,
          "X-Voice-Provider": "voicebox-cloud",
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
