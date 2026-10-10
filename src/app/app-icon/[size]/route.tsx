import { ImageResponse } from "next/og";

type RouteContext = { params: Promise<{ size: string }> };

// PNG app icon (the Nordcall bars) in the sizes the manifest and iOS ask for.
export async function GET(_request: Request, route: RouteContext) {
  const { size: raw } = await route.params;
  const size = [180, 192, 512].includes(Number(raw.replace(/\.png$/, ""))) ? Number(raw.replace(/\.png$/, "")) : 192;
  const bar = (height: number, opacity: number) => <div style={{
    width: size * 0.09, height: size * height, borderRadius: size * 0.05, background: "white", opacity,
  }} />;
  return new ImageResponse(
    <div style={{
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: size * 0.06,
      background: "linear-gradient(145deg, #596ce7, #3249ce)",
    }}>
      {bar(0.26, 0.76)}{bar(0.46, 1)}{bar(0.33, 0.86)}
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
