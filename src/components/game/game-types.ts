// Shared shapes and formatting for the Magnora Empire UI.

export const vkr = (value: number) => `${Math.round(value).toLocaleString("da-DK")} vkr.`;
export const dkk = (value: number) => `${value.toLocaleString("da-DK", { maximumFractionDigits: 0 })} DKK`;

export const categoryLabels: Record<string, string> = {
  office: "Kontorer", building: "Erhvervsbygninger", staff: "Medarbejdere", tech: "Teknologi", department: "Afdelinger",
  decor: "Dekorationer", headquarters: "Hovedkontor", special: "Specialbygninger", prestige: "Prestige",
};

export type GameAsset = {
  key: string; name: string; description: string; category: string; price: number; value: number;
  min_level: number; max_per_user: number | null; transferable: boolean; art: string; sort: number;
};
export type GameLevel = { level: number; title: string; min_company_value: number; required_asset: string | null; description: string };
export type InventoryItem = { id: string; asset_key: string; acquired_at: string; acquired_price: number; acquired_via: string; listed: boolean };
export type Achievement = {
  key: string; title: string; description: string; requirement_type: string; threshold: number;
  required_asset: string | null; reward: number; completed_at: string | null;
};
export type Transaction = { id: string; kind: string; amount: number; balance_after: number; description: string; created_at: string };
export type GameState = {
  profile: {
    company_name: string; level: number; xp: number; balance: number; lifetime_earned: number; verified_earnings_dkk: number;
    market_ready_at: string | null; market_unlocked_at: string | null; public_profile: boolean; company_value: number; net_worth: number;
  };
  stats: { approved_meetings: number; approved_sales: number; approved_upsells: number; owned_assets: number };
  market: { threshold_dkk: number; ready: boolean; ready_at: string | null; unlocked: boolean; unlocked_at: string | null; remaining_dkk: number; percent: number };
  rewards: { meeting_approved: number; meeting_held: number; sale_approved: number; upsell_approved: number };
  levels: GameLevel[];
  assets: GameAsset[];
  inventory: InventoryItem[];
  achievements: Achievement[];
  transactions: Transaction[];
};
