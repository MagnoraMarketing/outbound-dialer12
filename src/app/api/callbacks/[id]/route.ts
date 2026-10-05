import { NextResponse } from "next/server";
import { apiError, requireContext, writeAudit } from "@/lib/http";

export async function PATCH(_request: Request, route: { params: Promise<{ id: string }> }) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { id } = await route.params;
  const { context } = result;
  const { data, error } = await context.supabase.from("callbacks")
    .update({ completed_at: new Date().toISOString() }).eq("id", id).is("completed_at", null)
    .select("id, lead_id, callback_at").maybeSingle();
  if (error || !data) {
    if (error) console.error("Callback completion failed", error.message);
    return apiError("Callback kunne ikke markeres som gennemført.", error ? 400 : 404);
  }
  const { error: leadError } = await context.supabase.from("leads")
    .update({ status: "to_call", next_follow_up_at: null })
    .eq("id", data.lead_id).eq("next_follow_up_at", data.callback_at);
  if (leadError) {
    console.error("Completed callback lead update failed", leadError.message);
    return apiError("Callback blev gennemført, men virksomhedens opfølgningsstatus kunne ikke opdateres.", 500);
  }
  await writeAudit(context, "callback_completed", "callback", id, { lead_id: data.lead_id });
  return NextResponse.json({ success: true });
}
