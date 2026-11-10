import { NextResponse } from "next/server";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

async function tryVoiceboxTTS(
  text: string,
  voiceboxUrl: string,
  profileId: string,
  instruct?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const baseUrl = (voiceboxUrl || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");

  // 1. Try OpenAI-compatible endpoint in jamiepine/voicebox (/v1/audio/speech)
  try {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen",
        input: text,
        voice: profileId || "default",
        response_format: "wav",
      }),
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

  // 2. Try native /generate endpoint in jamiepine/voicebox
  try {
    const genRes = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        profile_id: profileId || "default",
        language: "id",
        instruct: instruct || undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (genRes.ok) {
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
                contentType: audioRes.headers.get("content-type") || "audio/wav",
              };
            }
          }
        }
      }
    }
  } catch {
    // Voicebox server not reachable
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
  const voiceboxUrl = url.searchParams.get("voicebox_url") || DEFAULT_VOICEBOX_URL;

  if (!text) {
    return NextResponse.json({ error: "Parameter text wajib diisi" }, { status: 400 });
  }

  if (engine === "voicebox") {
    const vbAudio = await tryVoiceboxTTS(text, voiceboxUrl, profileId);
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
    };
    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Teks kosong" }, { status: 400 });
    }

    const profileId = body.profile_id || body.speaker || "default";
    const voiceboxUrl = body.voicebox_url || DEFAULT_VOICEBOX_URL;

    if (!body.engine || body.engine === "voicebox") {
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
          },
        });
      }
    }

    const fallbackAudio = await tryFallbackIndoTTS(text);
    if (fallbackAudio) {
      return new Response(fallbackAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": fallbackAudio.contentType,
          "X-Voice-Provider": "indo-fallback",
        },
      });
    }

    return NextResponse.json({ error: "Gagal membuat suara" }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
}

