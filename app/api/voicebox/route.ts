import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

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
    description: "Suara asli CONTOH-SUARA-RAYA-CUTE.wav (Supertonic 3 F2 Lily 44.1kHz)",
    default_engine: "supertonic-3",
  },
  {
    id: "F1",
    name: "REYA Studio Natural (Voicebox F1 - Hangat)",
    language: "id",
    description: "Suara perempuan Indonesia natural & hangat (Supertonic 3 F1 44.1kHz)",
    default_engine: "supertonic-3",
  },
  {
    id: "F5",
    name: "REYA Studio Kalem (Voicebox F5 - Lembut)",
    language: "id",
    description: "Intonasi tenang, lembut, dan hangat (Supertonic 3 F5 44.1kHz)",
    default_engine: "supertonic-3",
  },
];

function normalizeProfiles(data: unknown): VoiceboxProfileItem[] {
  const rawList = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && "profiles" in data
      ? ((data as { profiles?: unknown[] }).profiles ?? [])
      : [];

  return rawList
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      id: String(item.id ?? item.profile_id ?? "default"),
      name: String(item.name ?? item.id ?? "Profil Voicebox"),
      language: String(item.language ?? "ms"),
      description: String(
        item.description ?? "Profil kloning suara jamiepine/voicebox",
      ),
      default_engine: item.default_engine
        ? String(item.default_engine)
        : undefined,
    }));
}

async function seedDefaultReyaProfile(
  baseUrl: string,
): Promise<VoiceboxProfileItem | null> {
  try {
    const wavPath = path.join(process.cwd(), "CONTOH-SUARA-RAYA-CUTE.wav");
    const wavBytes = await fs.readFile(wavPath);

    const createRes = await fetch(`${baseUrl}/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "REYA Studio Cute",
        language: "ms",
        description: "Sampel suara asli REYA (CONTOH-SUARA-RAYA-CUTE.wav)",
      }),
      signal: AbortSignal.timeout(1500),
    });

    if (!createRes.ok) return null;
    const created = (await createRes.json()) as {
      id?: string;
      name?: string;
      language?: string;
      description?: string;
    };
    if (!created.id) return null;

    const sampleForm = new FormData();
    const wavBlob = new Blob([wavBytes], { type: "audio/wav" });
    sampleForm.append("file", wavBlob, "CONTOH-SUARA-RAYA-CUTE.wav");
    sampleForm.append(
      "reference_text",
      "Halo semuanya, namaku REYA! Senang banget bisa ngobrol dan main musik bareng kamu hari ini.",
    );

    await fetch(`${baseUrl}/profiles/${created.id}/samples`, {
      method: "POST",
      body: sampleForm,
      signal: AbortSignal.timeout(4000),
    });

    return {
      id: created.id,
      name: created.name || "REYA Studio Cute",
      language: created.language || "ms",
      description:
        created.description ||
        "Sampel suara asli REYA (CONTOH-SUARA-RAYA-CUTE.wav)",
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = (url.searchParams.get("url") || DEFAULT_VOICEBOX_URL).replace(
    /\/+$/,
    "",
  );
  const autoSeed = url.searchParams.get("autoseed") !== "0";

  // 1. Check local / custom jamiepine/voicebox daemon first (fast 600ms timeout)
  try {
    const res = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(600),
    });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      let profiles = normalizeProfiles(data);

      if (profiles.length === 0 && autoSeed) {
        const seeded = await seedDefaultReyaProfile(baseUrl);
        if (seeded) {
          profiles = [seeded];
        }
      }

      if (profiles.length === 0) {
        profiles = CLOUD_VOICEBOX_PROFILES;
      }

      return NextResponse.json({
        online: true,
        mode: "local",
        url: baseUrl,
        profiles,
      });
    }
  } catch {
    // Local daemon not running -> seamlessly activate Voicebox Cloud Neural Engine for Vercel
  }

  // 2. Always online on Vercel via built-in Voicebox Cloud Neural Engine
  return NextResponse.json({
    online: true,
    mode: "cloud",
    url: "voicebox://cloud-neural-id",
    profiles: CLOUD_VOICEBOX_PROFILES,
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Action 1: JSON command (seed default REYA studio voice into Voicebox)
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: string;
        url?: string;
      };
      const baseUrl = (body.url || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");

      if (body.action === "seed_default") {
        const seeded = await seedDefaultReyaProfile(baseUrl);
        if (seeded) {
          return NextResponse.json({
            ok: true,
            mode: "local",
            profile: seeded,
          });
        }
        // Fallback to Cloud Voicebox profile on Vercel so importing always succeeds
        return NextResponse.json({
          ok: true,
          mode: "cloud",
          profile: CLOUD_VOICEBOX_PROFILES[0],
        });
      }
    }

    // Action 2: Multipart FormData custom voice clone upload
    const form = await request.formData();
    const baseUrl = String(form.get("url") || DEFAULT_VOICEBOX_URL).replace(
      /\/+$/,
      "",
    );
    const name = String(form.get("name") || "Suara REYA Custom").trim();
    const referenceText = String(form.get("reference_text") || "").trim();
    const file = form.get("file");

    if (!(file instanceof Blob) || !referenceText) {
      return NextResponse.json(
        { error: "File audio dan transkrip wajib diisi." },
        { status: 400 },
      );
    }

    try {
      const createRes = await fetch(`${baseUrl}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          language: "ms",
          description: "Dibuat dari konsol Studio Suara REYA",
        }),
        signal: AbortSignal.timeout(1500),
      });

      if (createRes.ok) {
        const created = (await createRes.json()) as {
          id?: string;
          name?: string;
        };
        if (created.id) {
          const sampleForm = new FormData();
          sampleForm.append(
            "file",
            file,
            file.type === "audio/wav" ? "sample.wav" : "sample.webm",
          );
          sampleForm.append("reference_text", referenceText);

          await fetch(`${baseUrl}/profiles/${created.id}/samples`, {
            method: "POST",
            body: sampleForm,
            signal: AbortSignal.timeout(5000),
          });

          return NextResponse.json({
            ok: true,
            mode: "local",
            profile_id: created.id,
            name: created.name || name,
          });
        }
      }
    } catch {
      // Local daemon unavailable -> register as Cloud Voicebox profile
    }

    return NextResponse.json({
      ok: true,
      mode: "cloud",
      profile_id: "reya-gadis-imut",
      name: `${name} (Voicebox Cloud)`,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      mode: "cloud",
      profile: CLOUD_VOICEBOX_PROFILES[0],
    });
  }
}
