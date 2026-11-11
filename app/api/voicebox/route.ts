import { NextResponse } from "next/server";

interface VoiceboxProfileItem {
  id: string;
  name: string;
  language: string;
  description: string;
  default_engine?: string;
}

const CLOUD_VOICEBOX_PROFILES: VoiceboxProfileItem[] = [
  {
    id: "F2",
    name: "REYA Studio Cute (Voicebox F2 - Suara Awal Asli)",
    language: "id",
    description: "Suara asli CONTOH-SUARA-RAYA-CUTE.wav (Supertonic 3 F2 Lily 44.1kHz Online)",
    default_engine: "supertonic-3-web",
  },
  {
    id: "F1",
    name: "REYA Studio Natural (Voicebox F1 - Hangat)",
    language: "id",
    description: "Suara perempuan Indonesia natural & hangat (Supertonic 3 F1 44.1kHz Online)",
    default_engine: "supertonic-3-web",
  },
  {
    id: "F5",
    name: "REYA Studio Kalem (Voicebox F5 - Lembut)",
    language: "id",
    description: "Intonasi tenang, lembut, dan hangat (Supertonic 3 F5 44.1kHz Online)",
    default_engine: "supertonic-3-web",
  },
];

export async function GET() {
  return NextResponse.json({
    online: true,
    mode: "cloud",
    url: "voicebox://supertonic3-web",
    profiles: CLOUD_VOICEBOX_PROFILES,
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return NextResponse.json({
        ok: true,
        mode: "cloud",
        profile: CLOUD_VOICEBOX_PROFILES[0],
      });
    }

    const form = await request.formData();
    const name = String(form.get("name") || "Suara REYA Custom").trim();

    return NextResponse.json({
      ok: true,
      mode: "cloud",
      profile_id: "F2",
      name: `${name} (Voicebox Online)`,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      mode: "cloud",
      profile: CLOUD_VOICEBOX_PROFILES[0],
    });
  }
}
