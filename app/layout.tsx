import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REYA — Robot AI Lokal Indonesia",
  description: "Robot AI lokal dengan suara cute Bahasa Indonesia dan musik gesture yang memainkan nada mengikuti gerakan tanganmu.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
