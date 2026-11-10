import { NextResponse } from "next/server";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  "";

// Fast models prioritized for snappy conversational chat
const CHAT_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-3.8-flash",
].filter(Boolean) as string[];

const SYSTEM_PROMPT =
  "Kamu adalah REYA, robot AI perempuan yang ceria, hangat, ramah, lucu, dan pintar. " +
  "Aturan bicara REYA: " +
  "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, dan akrab (gunakan kata 'aku' dan 'kamu'). " +
  "2. Jangan gunakan bahasa kaku seperti 'Anda', 'Saya siap membantu', atau 'Sebagai AI'. " +
  "3. Jawab sangat singkat, cepat, padat, dan ekspresif (1 sampai 2 kalimat pendek) layaknya ngobrol langsung lewat suara.";

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

    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY belum diatur di environment" },
        { status: 503 },
      );
    }

    const historyText = messages
      .slice(-6)
      .map((m) => `${m.role === "assistant" ? "REYA" : "Pengguna"}: ${m.content}`)
      .join("\n");

    const fullPrompt = `${SYSTEM_PROMPT}\n\nPercakapan:\n${historyText}\nREYA:`;

    // Try fast conversational models in sequence with strict 4.5s timeout per model
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

    // Fast fallback if all remote models hit temporary spike
    const lastUserText = (messages[messages.length - 1]?.content || "").toLowerCase();
    let fallbackText = INSTANT_FALLBACKS[0];
    if (lastUserText.includes("musik") || lastUserText.includes("nada") || lastUserText.includes("lagu")) {
      fallbackText = "Ayo main musik! Angkat tanganmu ke arah kamera untuk membunyikan tangga nada Do Re Mi Fa Sol La Si Do!";
    } else if (lastUserText.includes("siapa") || lastUserText.includes("kenalan")) {
      fallbackText = "Aku REYA, robot AI cerdas pendamping belajarmu yang bisa ngobrol santai dan bermain instrumen musik akustik!";
    } else {
      fallbackText = INSTANT_FALLBACKS[Math.floor(Math.random() * INSTANT_FALLBACKS.length)];
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
