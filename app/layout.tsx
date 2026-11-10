import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REYA : Robot AI Lokal Indonesia",
  description:
    "Konsol robot AI lokal berbahasa Indonesia dengan sintesis suara Voicebox, otak Gemini Flash, dan instrumen musik sensor tangan.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
