import { NextResponse } from "next/server";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  "";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  process.env.NEXT_PUBLIC_GEMINI_MODEL ||
  "gemini-flash-latest";

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ||
  "";

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ||
  process.env.NEXT_PUBLIC_OPENROUTER_MODEL ||
  "google/gemma-4-26b-a4b-it:free";

const SYSTEM_PROMPT =
  "Kamu adalah REYA, robot AI perempuan yang ceria, hangat, ramah, dan pintar. " +
  "Aturan bicara REYA: " +
  "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, dan akrab (gunakan kata 'aku' dan 'kamu'). " +
  "2. Jangan gunakan bahasa kaku seperti 'Anda', 'Saya siap membantu', atau 'Sebagai AI'. " +
  "3. Jawab singkat, jelas, dan ekspresif (1 sampai 2 kalimat pendek) layaknya ngobrol langsung lewat suara.";

function cleanReply(raw: string): string {
  return raw
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/^(?:Here's a thinking process|Thinking Process:)[\s\S]*?\n\n/i, "")
    .replace(/\*.*?\*/g, "")
    .replace(/[#_`]/g, "")
    .replace(/\u2014/g, ", ")
    .trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: Array<{ role: string; content: string }>;
      text?: string;
    };

    const messages = body.messages ?? (body.text ? [{ role: "user", content: body.text }] : []);
    if (!messages.length) {
      return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
    }

    const historyText = messages
      .slice(-8)
      .map((m) => `${m.role === "assistant" ? "REYA" : "Pengguna"}: ${m.content}`)
      .join("\n");

    const fullPrompt = `${SYSTEM_PROMPT}\n\nPercakapan:\n${historyText}\nREYA:`;

    if (GEMINI_API_KEY) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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
            }),
            signal: AbortSignal.timeout(14000),
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
              model: GEMINI_MODEL,
              provider: "gemini-argon",
            });
          }
        }
      } catch {
        // Fall through to backup provider
      }
    }

    if (OPENROUTER_API_KEY) {
      try {
        const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3088",
            "X-Title": "REYA Robot AI",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...messages.slice(-8),
            ],
            max_tokens: 140,
            temperature: 0.75,
          }),
          signal: AbortSignal.timeout(14000),
        });

        if (orRes.ok) {
          const data = (await orRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const cleaned = cleanReply(data.choices?.[0]?.message?.content ?? "");
          if (cleaned) {
            return NextResponse.json({
              message: cleaned,
              model: OPENROUTER_MODEL,
              provider: "openrouter",
            });
          }
        }
      } catch {
        // Fall through
      }
    }

    return NextResponse.json(
      { error: "Layanan AI sedang tidak terjangkau" },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}
