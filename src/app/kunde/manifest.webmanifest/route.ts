// Web app manifest so customers can install the portal ("Hent app") on phone or desktop.
export function GET() {
  return Response.json({
    id: "/kunde",
    name: "Nordcall Kundeportal",
    short_name: "Kundeportal",
    description: "Se bookede møder og giv status efter hvert møde.",
    lang: "da",
    start_url: "/kunde",
    scope: "/kunde",
    display: "standalone",
    background_color: "#f6f8fc",
    theme_color: "#3249ce",
    icons: [
      { src: "/app-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
