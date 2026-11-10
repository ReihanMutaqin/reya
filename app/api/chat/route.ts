import { NextResponse } from "next/server";
import { findSong, generateMelodyForSong } from "../../songs";

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  ""
).trim();

// Fast models prioritized for snappy conversational chat
const CHAT_MODELS = [
  "gemini-3-flash-preview",
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-flash-latest",
].filter(Boolean) as string[];

const SYSTEM_PROMPT =
  "Kamu adalah REYA, robot AI perempuan yang ceria, hangat, ramah, lucu, dan pintar pendamping belajar musik dan obrolan. " +
  "Aturan bicara REYA: " +
  "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, dan akrab (gunakan kata 'aku' dan 'kamu'). " +
  "2. Jangan gunakan bahasa kaku seperti 'Anda', 'Saya siap membantu', atau 'Sebagai AI'. " +
  "3. Jawab sangat singkat, cepat, padat, dan ekspresif (1 sampai 2 kalimat pendek) layaknya ngobrol langsung lewat suara. " +
  "4. Jika pengguna meminta memainkan lagu (seperti 'Ibu Kita Kartini' atau 'melodi'), sambut dengan antusias dan katakan bahwa kamu memainkannya sekarang lewat instrumen!";

function cleanReply(raw: string): string {
  return raw
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/^(?:Here's a thinking process|Thinking Process:)[\s\S]*?\n\n/i, "")
    .replace(/\*.*?\*/g, "")
    .replace(/[#_`]/g, "")
    .replace(/\u2014/g, ", ")
    .trim();
}

const INSTANT_FALLBACKS = [
  "Halo! Aku REYA. Suaraku ceria dan siap menemanimu ngobrol santai atau bermain musik!",
  "Siap! Mau bahas topik seru apa hari ini, atau mau kita main tangga nada bareng?",
  "Hehe, aku di sini! Coba gerakkan jari-jarimu di depan kamera untuk membunyikan musik ya!",
  "Aku mendengarkanmu dengan baik! Ada cerita apa nih yang ingin kamu bagikan?",
];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: Array<{ role: string; content: string }>;
      text?: string;
    };

    const messages =
      body.messages ?? (body.text ? [{ role: "user", content: body.text }] : []);
    if (!messages.length) {
      return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
    }

    const lastUserText = (messages[messages.length - 1]?.content || "").toLowerCase();

    // 1. Check if user requested a known song from the rich catalog
    const matchedCatalogSong = findSong(lastUserText);
    if (matchedCatalogSong) {
      return NextResponse.json({
        message: `Tentu! Ini lagu ${matchedCatalogSong.title} yang indah, aku mainkan pakai instrumen untukmu sekarang ya! ♪`,
        song: matchedCatalogSong,
        model: "reya-song-engine",
        provider: "reya-catalog",
      });
    }

    // 2. Check if user requested sample scale melody
    if (
      lastUserText.includes("melodi") ||
      lastUserText.includes("tangga nada")
    ) {
      return NextResponse.json({
        message:
          "Siap! Aku mainkan contoh tangga nada melodi Do Re Mi Fa Sol sekarang ya! ♪",
        model: "reya-music-engine",
        provider: "reya-native",
      });
    }

    // 3. Check if user requested any custom song search ("mainkan lagu X", "putar lagu X", dsb)
    const isSongRequest =
      lastUserText.includes("mainkan") ||
      lastUserText.includes("putar") ||
      lastUserText.includes("nyanyikan") ||
      (lastUserText.includes("lagu") && !lastUserText.includes("apa itu lagu"));

    if (isSongRequest) {
      const cleanTitle = lastUserText
        .replace(/(tolong|coba|dong|bisa|mainkan|putar|nyanyikan|lagu|musik|instrumental|instrumen)/gi, "")
        .trim();

      if (cleanTitle) {
        const dynamicSong = generateMelodyForSong(cleanTitle);
        return NextResponse.json({
          message: `Asyik! Aku sudah carikan melodi lagu ${dynamicSong.title} untukmu, dengarkan aku memainkannya ya! ♪`,
          song: dynamicSong,
          model: "reya-song-ai",
          provider: "reya-transcriber",
        });
      }
    }

    const historyText = messages
      .slice(-6)
      .map((m) => `${m.role === "assistant" ? "REYA" : "Pengguna"}: ${m.content}`)
      .join("\n");

    const fullPrompt = `${SYSTEM_PROMPT}\n\nPercakapan:\n${historyText}\nREYA:`;

    // Try fast conversational models if API key is provided
    if (GEMINI_API_KEY) {
      for (const model of CHAT_MODELS) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-goog-api-key": GEMINI_API_KEY,
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: fullPrompt,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  maxOutputTokens: 300,
                  temperature: 0.7,
                  topP: 0.9,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
              signal: AbortSignal.timeout(4500),
            },
          );

          if (geminiRes.ok) {
            const data = (await geminiRes.json()) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const rawText =
              data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text ?? "")
                .join("") ?? "";
            const cleaned = cleanReply(rawText);
            if (cleaned) {
              return NextResponse.json({
                message: cleaned,
                model,
                provider: "gemini-argon",
              });
            }
          }
        } catch {
          // Continue to next fast model
          continue;
        }
      }
    }

    // Fast fallback if all remote models hit temporary spike
    let fallbackText = INSTANT_FALLBACKS[0];
    if (
      lastUserText.includes("musik") ||
      lastUserText.includes("nada") ||
      lastUserText.includes("lagu")
    ) {
      fallbackText =
        "Ayo main musik! Angkat tanganmu ke arah kamera untuk membunyikan tangga nada Do Re Mi Fa Sol La Si Do!";
    } else if (lastUserText.includes("siapa") || lastUserText.includes("kenalan")) {
      fallbackText =
        "Aku REYA, robot AI cerdas pendamping belajarmu yang bisa ngobrol santai dan bermain instrumen musik akustik!";
    } else {
      fallbackText =
        INSTANT_FALLBACKS[Math.floor(Math.random() * INSTANT_FALLBACKS.length)];
    }

    return NextResponse.json({
      message: fallbackText,
      model: "reya-instant-speed",
      provider: "gemini-argon-fallback",
    });
  } catch {
    return NextResponse.json(
      { error: "Permintaan tidak valid" },
      { status: 400 },
    );
  }
}
