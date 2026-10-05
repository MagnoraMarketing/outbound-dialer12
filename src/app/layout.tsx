import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nordcall — B2B salg, der føles enkelt",
  description: "Dansk CRM og outbound dialer til professionelle B2B-salgsteams.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
