// Public base URL for absolute links (sitemap, calendar feeds, e-mails).
export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured?.startsWith("https://")) return configured;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return configured || "https://outbound-dialer12.vercel.app";
}
