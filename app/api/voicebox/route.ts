import { NextResponse } from "next/server";

const DEFAULT_VOICEBOX_URL =
  process.env.VOICEBOX_URL ||
  process.env.NEXT_PUBLIC_VOICEBOX_URL ||
  "http://127.0.0.1:17493";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = (url.searchParams.get("url") || DEFAULT_VOICEBOX_URL).replace(
    /\/+$/,
    "",
  );

  try {
    const res = await fetch(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(2200),
    });
    if (!res.ok) {
      return NextResponse.json({
        online: false,
        url: baseUrl,
        profiles: [],
      });
    }
    const data = (await res.json()) as unknown;
    const rawList = Array.isArray(data)
      ? data
      : typeof data === "object" && data !== null && "profiles" in data
      ? ((data as { profiles?: unknown[] }).profiles ?? [])
      : [];

    const profiles = rawList
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: String(item.id ?? item.profile_id ?? "default"),
        name: String(item.name ?? item.id ?? "Profil Voicebox"),
        language: String(item.language ?? "id"),
        description: String(item.description ?? "Profil suara lokal Voicebox"),
      }));

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

