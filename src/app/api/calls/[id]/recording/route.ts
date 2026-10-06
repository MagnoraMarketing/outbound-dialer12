import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext } from "@/lib/http";

const recordingBucket = "call-recordings";
const maxRecordingBytes = 50 * 1024 * 1024;
const supportedTypes = new Set(["audio/webm", "audio/mp4", "audio/ogg"]);

type RouteContext = { params: Promise<{ id: string }> };

async function ownedCall(route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return { response: result.response } as const;
  const { id } = await route.params;
  const { data: call, error } = await result.context.supabase.from("calls")
    .select("id, team_id, user_id, recording_enabled, recording_url")
    .eq("id", id).maybeSingle();
  if (error || !call) return { response: apiError("Opkaldet blev ikke fundet.", error ? 500 : 404) } as const;
  if (call.user_id !== result.context.user.id) {
    return { response: apiError("Du kan kun gemme optagelser af dine egne opkald.", 403) } as const;
  }
  if (!call.recording_enabled) {
    return { response: apiError("Optagelse var ikke aktiveret for dette opkald.", 403) } as const;
  }
  return { context: result.context, call } as const;
}

export async function POST(request: Request, route: RouteContext) {
  const ownership = await ownedCall(route);
  if ("response" in ownership) return ownership.response;
  const { context, call } = ownership;
  const body = await readJson(request);
  if (body?.action === "prepare") {
    if (call.recording_url) return apiError("Der findes allerede en optagelse til dette opkald.", 409);
    const mediaType = typeof body.content_type === "string" ? body.content_type.split(";")[0] : "";
    if (!supportedTypes.has(mediaType)) return apiError("Optagelsen skal være WebM, MP4 eller Ogg-lyd.");
    const extension = mediaType === "audio/mp4" ? "m4a" : mediaType === "audio/ogg" ? "ogg" : "webm";
    const path = `${call.team_id}/${call.id}.${extension}`;
    try {
      const { data, error } = await createSupabaseAdminClient()
        .storage.from(recordingBucket).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.token) {
        console.error("Call recording upload authorization failed", error?.message);
        return apiError("Sikker upload af optagelsen kunne ikke klargøres.", 502);
      }
      return NextResponse.json({ data: { path: data.path, token: data.token, content_type: mediaType } });
    } catch (error) {
      console.error("Call recording storage is not configured", error);
      return apiError("Sikker lagring af opkaldsoptagelser er ikke konfigureret.", 503);
    }
  }

  if (body?.action !== "finalize" || typeof body.path !== "string") {
    return apiError("Ugyldig anmodning om opkaldsoptagelse.");
  }
  const validPathPrefix = `${call.team_id}/${call.id}.`;
  if (!body.path.startsWith(validPathPrefix)) return apiError("Optagelsen hører ikke til dette opkald.", 403);
  if (call.recording_url) return apiError("Der findes allerede en optagelse til dette opkald.", 409);

  try {
    const admin = createSupabaseAdminClient();
    const folder = `${call.team_id}`;
    const { data: objects, error: listError } = await admin.storage.from(recordingBucket)
      .list(folder, { search: call.id });
    if (listError) {
      console.error("Uploaded call recording could not be verified", listError.message);
      return apiError("Den uploadede optagelse kunne ikke kontrolleres.", 502);
    }
    const object = (objects ?? []).find((item) => `${folder}/${item.name}` === body.path);
    const size = Number(object?.metadata?.size);
    const contentType = typeof object?.metadata?.mimetype === "string" ? object.metadata.mimetype : "";
    if (!object || !Number.isFinite(size) || size <= 0 || size > maxRecordingBytes || !supportedTypes.has(contentType)) {
      return apiError("Den uploadede optagelse er ugyldig eller overskrider grænsen på 50 MB.", 422);
    }
    const { data: updatedCall, error: updateError } = await admin.from("calls").update({ recording_url: body.path })
      .eq("id", call.id).eq("team_id", call.team_id).eq("user_id", context.user.id)
      .eq("recording_enabled", true).select("id").maybeSingle();
    if (updateError || !updatedCall) {
      console.error("Call recording reference update failed", updateError?.message ?? "Call was not updated");
      return apiError("Optagelsen blev uploadet, men opkaldets historik kunne ikke opdateres.", 500);
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Call recording finalization failed", error);
    return apiError("Optagelsens sikre lagring kunne ikke afsluttes.", 503);
  }
}

export async function GET(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan afspille optagelser.", 403);
  const { id } = await route.params;
  const { data: call, error } = await context.supabase.from("calls")
    .select("team_id, recording_url").eq("id", id).maybeSingle();
  if (error || !call) return apiError("Opkaldet blev ikke fundet.", error ? 500 : 404);
  if (!call.recording_url) return apiError("Der er ingen optagelse af dette opkald.", 404);
  try {
    const { data, error: signedUrlError } = await createSupabaseAdminClient()
      .storage.from(recordingBucket).createSignedUrl(call.recording_url, 3600);
    if (signedUrlError || !data?.signedUrl) {
      console.error("Call recording playback URL failed", signedUrlError?.message);
      return apiError("Optagelsen kunne ikke åbnes.", 502);
    }
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
  } catch (storageError) {
    console.error("Call recording playback is not configured", storageError);
    return apiError("Sikker afspilning af optagelser er ikke konfigureret.", 503);
  }
}
