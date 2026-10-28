// Every seller starts on the standard budget until an administrator sets their own.
export const DEFAULT_MEETINGS_PER_DAY = 2;
export const DEFAULT_COMMISSION_PER_MEETING = 1000;
export const WORKDAYS_PER_WEEK = 5;

export type BudgetTargetRow = {
  id?: string;
  user_id: string;
  campaign_id: string | null;
  weekly_target?: number | null;
  weekly_meeting_target?: number | null;
  weekly_sale_target?: number | null;
  commission_per_meeting?: number | string | null;
  commission_per_sale?: number | string | null;
  updated_at?: string | null;
};

export type BudgetAgreement = {
  source: "custom" | "default";
  weekly_meeting_target: number;
  weekly_sale_target: number;
  commission_per_meeting: number;
  commission_per_sale: number;
  updated_at: string | null;
};

export const DEFAULT_AGREEMENT: BudgetAgreement = {
  source: "default",
  weekly_meeting_target: DEFAULT_MEETINGS_PER_DAY * WORKDAYS_PER_WEEK,
  weekly_sale_target: 0,
  commission_per_meeting: DEFAULT_COMMISSION_PER_MEETING,
  commission_per_sale: 0,
  updated_at: null,
};

// A seller's budget is their overall (all campaigns) row. Older per-campaign rows
// still count, newest first, so budgets saved before the overall row keep working.
export function resolveAgreement(rows: BudgetTargetRow[], userId: string): BudgetAgreement {
  const own = rows.filter((row) => row.user_id === userId);
  const row = own.find((item) => item.campaign_id === null)
    ?? own.filter((item) => item.campaign_id !== null)
      .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")))[0];
  if (!row) return DEFAULT_AGREEMENT;
  const meetingRate = Number(row.commission_per_meeting ?? 0);
  const saleRate = Number(row.commission_per_sale ?? 0);
  // Rows saved without commission (by sellers, who may not set rates) use the standard rate.
  const unpriced = meetingRate === 0 && saleRate === 0;
  return {
    source: "custom",
    weekly_meeting_target: Number(row.weekly_meeting_target || row.weekly_target || 0),
    weekly_sale_target: Number(row.weekly_sale_target ?? 0),
    commission_per_meeting: unpriced ? DEFAULT_COMMISSION_PER_MEETING : meetingRate,
    commission_per_sale: saleRate,
    updated_at: row.updated_at ?? null,
  };
}
