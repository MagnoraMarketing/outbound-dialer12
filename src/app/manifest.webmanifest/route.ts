// Web app manifest so sellers can install Nordcall ("Hent app") on their phone or desktop.
// The customer portal has its own manifest under /kunde.
export function GET() {
  return Response.json({
    id: "/",
    name: "Nordcall",
    short_name: "Nordcall",
    description: "Dansk CRM og outbound dialer til B2B-salgsteams.",
    lang: "da",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fc",
    theme_color: "#3249ce",
    icons: [
      { src: "/app-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
