"use client";

// Lightweight isometric 2D city drawn as SVG: a 5×5 map with crossing roads and
// 16 building plots. Owned assets are placed on plots in the order they were acquired.

export type CityItem = { id: string; asset_key: string; art: string; name: string };

const TILE_W = 128;
const TILE_H = 64;
const SIZE = 5;
const ROAD = 2;

type Face = { top: string; left: string; right: string };
type Art = { h: number; hw: number; colors: Face; windows?: boolean; roof?: "gold" | "dome" | "helipad" | "antenna" | "awning" };

const palette = {
  blue: { top: "#8fa4ff", left: "#5b6fe0", right: "#4054c8" },
  navy: { top: "#5d6b9a", left: "#2e3a63", right: "#222c4d" },
  glass: { top: "#bfe3ff", left: "#6fa8dc", right: "#4f86bd" },
  teal: { top: "#8de0cf", left: "#3fb39c", right: "#2c917e" },
  purple: { top: "#c3a6ff", left: "#8b63e0", right: "#6f48c4" },
  brick: { top: "#f2b391", left: "#d2785a", right: "#b25f44" },
  orange: { top: "#ffd18a", left: "#f2a33a", right: "#d9861d" },
  graphite: { top: "#7c8597", left: "#465063", right: "#353d4d" },
  green: { top: "#a7e3a0", left: "#5fb55a", right: "#4a9946" },
  stone: { top: "#e7e9ef", left: "#c3c8d4", right: "#a9afbd" },
  gold: { top: "#ffe38a", left: "#e8b931", right: "#c9981a" },
};

const arts: Record<string, Art> = {
  office: { h: 42, hw: 34, colors: palette.blue, windows: true },
  office_large: { h: 64, hw: 44, colors: palette.blue, windows: true, roof: "antenna" },
  callcenter: { h: 48, hw: 44, colors: palette.teal, windows: true },
  department: { h: 40, hw: 40, colors: palette.purple, windows: true },
  tower: { h: 124, hw: 30, colors: palette.glass, windows: true, roof: "antenna" },
  block: { h: 72, hw: 46, colors: palette.brick, windows: true },
  hq: { h: 152, hw: 40, colors: palette.navy, windows: true, roof: "gold" },
  lab: { h: 40, hw: 36, colors: palette.green, windows: true, roof: "dome" },
  skyscraper: { h: 212, hw: 28, colors: palette.glass, windows: true, roof: "antenna" },
  helipad: { h: 12, hw: 48, colors: palette.graphite, roof: "helipad" },
  statue: { h: 14, hw: 18, colors: palette.stone, roof: "gold" },
  kiosk: { h: 18, hw: 20, colors: palette.orange, roof: "awning" },
  team: { h: 24, hw: 26, colors: palette.orange, windows: true },
  server: { h: 28, hw: 18, colors: palette.graphite, windows: true },
  box: { h: 30, hw: 30, colors: palette.stone },
};

function tileCenter(row: number, col: number) {
  return { x: (col - row) * (TILE_W / 2), y: (col + row) * (TILE_H / 2) };
}

function diamond(cx: number, cy: number, hw: number, hh = hw / 2) {
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

type Point = { x: number; y: number };
const pts = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

function Box({ cx, cy, art }: { cx: number; cy: number; art: Art }) {
  const { h, hw, colors } = art;
  const hh = hw / 2;
  const left = { x: cx - hw, y: cy }, bottom = { x: cx, y: cy + hh }, right = { x: cx + hw, y: cy }, top = { x: cx, y: cy - hh };
  const up = (p: Point, d = h) => ({ x: p.x, y: p.y - d });
  const windows: React.ReactNode[] = [];
  if (art.windows && h >= 20) {
    const rows = Math.max(1, Math.floor(h / 16));
    const faces: [Point, Point, string][] = [[left, bottom, "rgba(255,255,255,.55)"], [bottom, right, "rgba(255,255,255,.35)"]];
    faces.forEach(([a, b, fill], faceIndex) => {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          const u1 = 0.14 + c * 0.28, u2 = u1 + 0.16;
          const v1 = 6 + r * 16, v2 = v1 + 8;
          const at = (u: number, v: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v });
          windows.push(<polygon key={`${faceIndex}-${r}-${c}`} points={pts([at(u1, v1), at(u2, v1), at(u2, v2), at(u1, v2)])} fill={fill} />);
        }
      }
    });
  }
  const roofTop = { x: cx, y: cy - h };
  return <g>
    <polygon points={pts([left, bottom, up(bottom), up(left)])} fill={colors.left} />
    <polygon points={pts([bottom, right, up(right), up(bottom)])} fill={colors.right} />
    <polygon points={pts([up(left), up(top), up(right), up(bottom)])} fill={colors.top} />
    {windows}
    {art.roof === "gold" && <polygon points={diamond(roofTop.x, roofTop.y - 6, hw * 0.55)} fill={palette.gold.top} stroke={palette.gold.right} strokeWidth={2} />}
    {art.roof === "dome" && <ellipse cx={roofTop.x} cy={roofTop.y - 4} rx={hw * 0.55} ry={hw * 0.4} fill="#e9fbe7" stroke="#5fb55a" strokeWidth={2} />}
    {art.roof === "antenna" && <><line x1={roofTop.x} y1={roofTop.y} x2={roofTop.x} y2={roofTop.y - 26} stroke="#2e3a63" strokeWidth={2} /><circle cx={roofTop.x} cy={roofTop.y - 27} r={3} className="mg-blink" fill="#ff6b6b" /></>}
    {art.roof === "helipad" && <><ellipse cx={roofTop.x} cy={roofTop.y} rx={hw * 0.6} ry={hw * 0.3} fill="none" stroke="#ffe38a" strokeWidth={3} /><text x={roofTop.x} y={roofTop.y + 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#ffe38a">H</text></>}
    {art.roof === "awning" && <polygon points={pts([up(left, h + 4), up(bottom, h + 4), up(bottom, h - 4), up(left, h - 4)])} fill="#ff6b6b" />}
  </g>;
}

function Decoration({ cx, cy, art }: { cx: number; cy: number; art: string }) {
  if (art === "garden") return <g>
    <polygon points={diamond(cx, cy, 50)} fill="#7fcf78" />
    {[[-20, -4], [14, -8], [0, 10], [26, 6], [-30, 8]].map(([dx, dy], index) =>
      <g key={index}><rect x={cx + dx - 2} y={cy + dy - 10} width={4} height={10} fill="#8a5a3c" /><circle cx={cx + dx} cy={cy + dy - 16} r={9} fill={index % 2 ? "#3f9a4a" : "#56b85f"} /></g>)}
  </g>;
  if (art === "fountain") return <g>
    <ellipse cx={cx} cy={cy} rx={40} ry={20} fill="#c3c8d4" />
    <ellipse cx={cx} cy={cy - 2} rx={32} ry={15} fill="#6fc3ff" />
    <rect x={cx - 3} y={cy - 26} width={6} height={24} fill="#e7e9ef" />
    <ellipse cx={cx} cy={cy - 28} rx={12} ry={6} className="mg-water" fill="#a8dcff" />
  </g>;
  return null;
}

export function IsoCity({ items, highlightId, nextPlotLabel }: { items: CityItem[]; highlightId?: string | null; nextPlotLabel?: string | null }) {
  const plots: { row: number; col: number }[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (row !== ROAD && col !== ROAD) plots.push({ row, col });
    }
  }
  // Fill plots from the centre outward so the first office sits next to the crossing.
  plots.sort((a, b) => (Math.abs(a.row - ROAD) + Math.abs(a.col - ROAD)) - (Math.abs(b.row - ROAD) + Math.abs(b.col - ROAD)) || a.row - b.row || a.col - b.col);
  const placed = new Map<string, CityItem>();
  items.slice(0, plots.length).forEach((item, index) => placed.set(`${plots[index].row}-${plots[index].col}`, item));
  const nextPlot = items.length < plots.length ? plots[items.length] : null;

  const tiles: { row: number; col: number }[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) tiles.push({ row, col });
  tiles.sort((a, b) => a.row + a.col - (b.row + b.col) || a.row - b.row);

  const minX = -SIZE * TILE_W / 2 - 10, width = SIZE * TILE_W + 20;
  const minY = -260, height = SIZE * TILE_H + 300;
  return <svg className="mg-city" viewBox={`${minX} ${minY} ${width} ${height}`} role="img" aria-label={`Din virksomhed med ${items.length} bygninger og aktiver`}>
    <polygon points={diamond((SIZE - 1) * 0, (SIZE - 1) * TILE_H / 2, SIZE * TILE_W / 2 + 14)} fill="#2a3a2f" opacity={0.25} transform="translate(0 10)" />
    {tiles.map(({ row, col }) => {
      const { x, y } = tileCenter(row, col);
      const isRoad = row === ROAD || col === ROAD;
      const key = `${row}-${col}`;
      const item = placed.get(key);
      const isNext = nextPlot && nextPlot.row === row && nextPlot.col === col;
      const art = item ? arts[item.art] : undefined;
      return <g key={key}>
        <polygon points={diamond(x, y, TILE_W / 2)} fill={isRoad ? "#5b6377" : (row + col) % 2 ? "#8fd18a" : "#86c981"} stroke="#ffffff" strokeOpacity={0.25} />
        {isRoad && row === ROAD && col !== ROAD && <line x1={x - TILE_W / 4} y1={y + TILE_H / 4} x2={x + TILE_W / 4} y2={y - TILE_H / 4} stroke="#e8edf6" strokeWidth={3} strokeDasharray="10 8" />}
        {isRoad && col === ROAD && row !== ROAD && <line x1={x - TILE_W / 4} y1={y - TILE_H / 4} x2={x + TILE_W / 4} y2={y + TILE_H / 4} stroke="#e8edf6" strokeWidth={3} strokeDasharray="10 8" />}
        {!item && !isRoad && <polygon points={diamond(x, y, TILE_W / 2 - 14)} fill="none" stroke={isNext ? "#ffd166" : "#ffffff"} strokeOpacity={isNext ? 1 : 0.45} strokeWidth={isNext ? 3 : 2} strokeDasharray="8 6" className={isNext ? "mg-next-plot" : undefined} />}
        {isNext && nextPlotLabel && <text x={x} y={y + 5} textAnchor="middle" className="mg-plot-label">{nextPlotLabel}</text>}
        {item && <g className={item.id === highlightId ? "mg-pop" : undefined}>
          <title>{item.name}</title>
          {art ? <Box cx={x} cy={y} art={art} /> : <Decoration cx={x} cy={y} art={item.art} />}
        </g>}
      </g>;
    })}
  </svg>;
}
