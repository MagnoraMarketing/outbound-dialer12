function copenhagenToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function copenhagenMidnightUtc(date: string) {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  const offsetLabel = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Copenhagen", timeZoneName: "shortOffset",
  }).formatToParts(midnight).find((part) => part.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = match
    ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "-" ? -1 : 1)
    : 0;
  return new Date(midnight.getTime() - offset * 60_000);
}

// Week and month boundaries in Danish local time, as UTC instants.
export function periodBoundaries() {
  const today = copenhagenToday();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const monday = new Date(todayDate);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    weekStart: copenhagenMidnightUtc(dateKey(monday)),
    nextWeek: copenhagenMidnightUtc(dateKey(new Date(monday.getTime() + 7 * 86400_000))),
    monthStart: copenhagenMidnightUtc(monthStart),
    nextMonth: copenhagenMidnightUtc(dateKey(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1)))),
  };
}
