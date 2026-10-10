import type { Metadata } from "next";
import "./globals.css";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Nordcall — B2B salg, der føles enkelt",
  description: "Dansk CRM og outbound dialer til professionelle B2B-salgsteams.",
  metadataBase: new URL(siteUrl()),
  verification: { google: "rrUzVVsXlUpwDO9H4vskRu22xF5bPMupYHMiztYYbME" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
