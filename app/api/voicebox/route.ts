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
        item.description ?? "Profil kloning suara lokal jamiepine/voicebox",
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

    // Note: jamiepine/voicebox validates language against:
    // ^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$
    // "ms" is used for Malay/Indonesian in Chatterbox Multilingual & OmniVoice.
    const createRes = await fetch(`${baseUrl}/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "REYA Studio Cute",
        language: "ms",
        description: "Sampel suara asli REYA (CONTOH-SUARA-RAYA-CUTE.wav)",
      }),
      signal: AbortSignal.timeout(5000),
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
      signal: AbortSignal.timeout(10000),
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

  try {
    const res = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return NextResponse.json({
        online: false,
        url: baseUrl,
        profiles: [],
      });
    }

    const data = (await res.json()) as unknown;
    let profiles = normalizeProfiles(data);

    // Automatically seed REYA's studio sample into Voicebox if Voicebox is online with 0 profiles
    if (profiles.length === 0 && autoSeed) {
      const seeded = await seedDefaultReyaProfile(baseUrl);
      if (seeded) {
        profiles = [seeded];
      }
    }

    return NextResponse.json({
      online: true,
      url: baseUrl,
      profiles,
    });
  } catch {
    return NextResponse.json({
      online: false,
      url: baseUrl,
      profiles: [],
    });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Action 1: JSON command (e.g. seed default REYA studio voice into Voicebox)
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: string;
        url?: string;
      };
      const baseUrl = (body.url || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");

      if (body.action === "seed_default") {
        const seeded = await seedDefaultReyaProfile(baseUrl);
        if (!seeded) {
          return NextResponse.json(
            {
              error:
                "Gagal mengimpor sampel REYA ke Voicebox. Pastikan aplikasi Voicebox aktif di port 17493.",
            },
            { status: 502 },
          );
        }
        return NextResponse.json({
          ok: true,
          profile: seeded,
        });
      }
    }

    // Action 2: Multipart FormData custom voice clone upload to jamiepine/voicebox
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

    const createRes = await fetch(`${baseUrl}/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        language: "ms",
        description: "Dibuat dari konsol Studio Suara REYA",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return NextResponse.json(
        { error: `Voicebox menolak pembuatan profil: ${errText}` },
        { status: createRes.status },
      );
    }

    const created = (await createRes.json()) as { id?: string; name?: string };
    if (!created.id) {
      return NextResponse.json(
        { error: "ID profil tidak ditemukan dari Voicebox." },
        { status: 502 },
      );
    }

    const sampleForm = new FormData();
    sampleForm.append(
      "file",
      file,
      file.type === "audio/wav" ? "sample.wav" : "sample.webm",
    );
    sampleForm.append("reference_text", referenceText);

    const sampleRes = await fetch(`${baseUrl}/profiles/${created.id}/samples`, {
      method: "POST",
      body: sampleForm,
      signal: AbortSignal.timeout(12000),
    });

    if (!sampleRes.ok) {
      const errText = await sampleRes.text();
      return NextResponse.json(
        { error: `Gagal mengunggah sampel ke Voicebox: ${errText}` },
        { status: sampleRes.status },
      );
    }

    return NextResponse.json({
      ok: true,
      profile_id: created.id,
      name: created.name || name,
    });
  } catch {
    return NextResponse.json(
      { error: "Tidak dapat terhubung ke server Voicebox." },
      { status: 502 },
    );
  }
}
