import QRCode from "qrcode";
import { siteUrl } from "@/lib/site-url";

// QR code on the login screen: scanning it on a phone opens Nordcall with the
// "Hent app" install steps shown, so the seller can add it to the home screen.
export async function GET() {
  const svg = await QRCode.toString(`${siteUrl()}/?app=1`, {
    type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#1b2540", light: "#ffffff" },
  });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
