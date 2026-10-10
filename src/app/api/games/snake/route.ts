import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext } from "@/lib/http";

// Each food takes the snake at least a few steps to reach, so a score that
// arrives faster than this is not a real game.
const MIN_MS_PER_POINT = 250;
const MAX_SCORE = 100000;
const MAX_GAMES_PER_MINUTE = 6;
// A made-up rival on every leaderboard: high, but beatable with a good run.
const CHALLENGER = { name: "Snake-mesteren", score: 30 };

type ScoreRow = { user_id: string; score: number; created_at: string };

function admin() {
  try {
    return createSupabaseAdminClient();
  } catch (error) {
    console.error("Snake service client setup failed", error);
    return null;
  }
}

function startOfDayCopenhagen() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
  // Danish midnight is 22:00 or 23:00 UTC the day before; a two-hour margin keeps the board inclusive.
  return new Date(new Date(`${today}T00:00:00Z`).getTime() - 2 * 3600_000);
}

function best(rows: ScoreRow[], names: Map<string, string>, me: string) {
  const top = new Map<string, ScoreRow>();
  for (const row of rows) {
    const current = top.get(row.user_id);
    if (!current || row.score > current.score) top.set(row.user_id, row);
  }
  const players = [...top.values()].map((row) => ({
    user_id: row.user_id, name: names.get(row.user_id) || "Kollega", score: row.score, at: row.created_at, me: row.user_id === me, challenger: false,
  }));
  const challenger = { user_id: "challenger", name: CHALLENGER.name, score: CHALLENGER.score, at: "", me: false, challenger: true };
  // Ties go to the real player, so matching the champion is enough to pass.
  return [...players, challenger].sort((a, b) => b.score - a.score || Number(a.challenger) - Number(b.challenger) || a.at.localeCompare(b.at))
    .slice(0, 20).map((row, index) => ({ ...row, rank: index + 1 }));
}

// Team leaderboards for today, this week and all time, plus the player's own best.
export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const client = admin();
  if (!client) return apiError("Spillet er ikke klar endnu.", 503);
  const teamId = context.profile.team_id;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [all, recent, profiles, latest] = await Promise.all([
    client.from("snake_scores").select("user_id, score, created_at").eq("team_id", teamId).order("score", { ascending: false }).limit(500),
    client.from("snake_scores").select("user_id, score, created_at").eq("team_id", teamId).gte("created_at", weekAgo).order("score", { ascending: false }).limit(1000),
    client.from("profiles").select("id, full_name").eq("team_id", teamId),
    client.from("snake_scores").select("user_id, score, created_at").eq("team_id", teamId).order("created_at", { ascending: false }).limit(8),
  ]);
  const failed = [all, recent, profiles, latest].find((query) => query.error);
  if (failed?.error) {
    console.error("Snake leaderboard query failed", failed.error.message);
    return apiError("Ranglisten kunne ikke hentes.", 500);
  }
  const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.full_name]));
  const me = context.user.id;
  const dayStart = startOfDayCopenhagen().getTime();
  const recentRows = (recent.data ?? []) as ScoreRow[];
  const allRows = (all.data ?? []) as ScoreRow[];
  return NextResponse.json({
    today: best(recentRows.filter((row) => new Date(row.created_at).getTime() >= dayStart), names, me),
    week: best(recentRows, names, me),
    all: best(allRows, names, me),
    challenger: CHALLENGER,
    personal_best: allRows.filter((row) => row.user_id === me).reduce((top, row) => Math.max(top, row.score), 0),
    latest: ((latest.data ?? []) as ScoreRow[]).map((row) => ({ name: names.get(row.user_id) || "Kollega", score: row.score, at: row.created_at, me: row.user_id === me })),
  });
}

// Saves a finished game. The score is shared with the team right away.
export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const body = await readJson(request);
  const score = Number(body?.score);
  const duration = Number(body?.duration_ms);
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return apiError("Ugyldig score.");
  if (!Number.isInteger(duration) || duration < 0 || duration > 86_400_000) return apiError("Ugyldig spilletid.");
  if (score > 0 && duration < score * MIN_MS_PER_POINT) return apiError("Scoren kunne ikke godkendes.", 422);
  const client = admin();
  if (!client) return apiError("Spillet er ikke klar endnu.", 503);
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await client.from("snake_scores").select("id", { count: "exact", head: true })
    .eq("user_id", context.user.id).gte("created_at", minuteAgo);
  if ((count ?? 0) >= MAX_GAMES_PER_MINUTE) return apiError("Du har spillet mange spil på kort tid. Prøv igen om lidt.", 429);
  const { data: previous } = await client.from("snake_scores").select("score").eq("user_id", context.user.id)
    .order("score", { ascending: false }).limit(1).maybeSingle();
  const { error } = await client.from("snake_scores").insert({
    team_id: context.profile.team_id, user_id: context.user.id, score, duration_ms: duration,
  });
  if (error) {
    console.error("Snake score insert failed", error.message);
    return apiError("Scoren kunne ikke gemmes.", 500);
  }
  return NextResponse.json({ success: true, personal_best: score > Number(previous?.score ?? -1) }, { status: 201 });
}
