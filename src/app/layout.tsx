import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Nordcall — B2B salg, der føles enkelt",
  description: "Dansk CRM og outbound dialer til professionelle B2B-salgsteams.",
  metadataBase: new URL(siteUrl()),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>
        {children}
        {/* Google tag (gtag.js) */}
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-7MJM7Y9FVY" strategy="afterInteractive" />
        <Script id="google-gtag" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-7MJM7Y9FVY');
        `}</Script>
      </body>
    </html>
  );
}
