import { NextResponse } from "next/server";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";

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
      signal: AbortSignal.timeout(1800),
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
  const resolvedProfileId = await resolveVoiceboxProfileId(baseUrl, profileId);

  // 1. OpenAI-compatible endpoint in jamiepine/voicebox (/v1/audio/speech)
  // Using model="tts-1" instructs Voicebox to pick default_engine_for_profile(profile).
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
  // Note: Voicebox validates language against ^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$
  // so "ms" (Malay/Indonesian) and "en" are valid, whereas "id" returns HTTP 422.
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

function mapSpeakerToGeminiVoice(speaker?: string): string {
  switch (speaker) {
    case "F5":
    case "Serena":
      return "Leda";
    case "F1":
      return "Aoede";
    case "F3":
    case "Aiden":
      return "Kore";
    case "F4":
    case "Ryan":
      return "Callirrhoe";
    case "F2":
    case "Vivian":
    default:
      return "Zephyr";
  }
}

async function tryGeminiNeuralTTS(
  text: string,
  speaker?: string,
  instruct?: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    ""
  ).trim();
  if (!apiKey) return null;

  const cleanText = text.replace(/[*_#`~]/g, "").trim().slice(0, 600);
  if (!cleanText) return null;

  const voiceName = mapSpeakerToGeminiVoice(speaker);
  const styleHint =
    instruct?.trim() ||
    "bicara dengan nada ramah, ekspresif, hangat, dan natural dalam Bahasa Indonesia sehari-hari";

  try {
    const res = await fetch(GEMINI_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Ucapkan kalimat berikut (${styleHint}): ${cleanText}`,
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
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;

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
    if (!b64 || b64.length < 100) return null;

    const pcmBytes = Buffer.from(b64, "base64");
    const wavArrayBuffer = pcm16ToWav(pcmBytes, 24000, 1);

    return {
      buffer: wavArrayBuffer,
      contentType: "audio/wav",
    };
  } catch {
    return null;
  }
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

  // 2. Natural Neural TTS via Argon Gemini 2.5 Flash Audio (Zephyr / Leda / Aoede)
  const geminiAudio = await tryGeminiNeuralTTS(text, speaker, instruct);
  if (geminiAudio) {
    return new Response(geminiAudio.buffer, {
      status: 200,
      headers: {
        "Content-Type": geminiAudio.contentType,
        "X-Voice-Provider": "gemini-neural-tts",
        "Cache-Control": "no-store",
      },
    });
  }

  // 3. Last-resort fallback
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

    // 1. Try jamiepine/voicebox local studio server first when selected
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
            "Cache-Control": "no-store",
          },
        });
      }
    }

    // 2. Natural Neural TTS via Argon Gemini 2.5 Flash Audio
    const geminiAudio = await tryGeminiNeuralTTS(
      text,
      body.speaker || profileId,
      body.instruction,
    );
    if (geminiAudio) {
      return new Response(geminiAudio.buffer, {
        status: 200,
        headers: {
          "Content-Type": geminiAudio.contentType,
          "X-Voice-Provider": "gemini-neural-tts",
          "Cache-Control": "no-store",
        },
      });
    }

    // 3. Last-resort fallback
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
