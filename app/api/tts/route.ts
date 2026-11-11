import { NextResponse } from "next/server";
import { synthesizeEdgeNeuralTTS } from "./edge-neural";

// LRU cache for synthesized speech to provide instant online playback
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

// 100% Online Voicebox Cloud Neural Engine (non-Google natural fallback)
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

  if (!text) {
    return NextResponse.json(
      { error: "Parameter text wajib diisi" },
      { status: 400 },
    );
  }

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
      profile_id?: string;
      speaker?: string;
    };
    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Teks kosong" }, { status: 400 });
    }

    const profileId = body.profile_id || body.speaker || "F2";
    const cloudVb = await tryVoiceboxCloudNeuralTTS(text, profileId);
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
