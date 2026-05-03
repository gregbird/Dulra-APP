import { supabase } from "@/lib/supabase";
import { addWatermark } from "@/lib/watermark";
import { getLocation } from "@/lib/location";

interface UploadPhotoParams {
  localUri: string;
  projectId: string;
  projectName?: string;
  surveyId?: string;
  habitatPolygonId?: string;
  targetNoteId?: string;
  siteId?: string | null;
  /** Tag list (e.g. ['site']) — landed in photos.tags as text[]. */
  tags?: string[] | null;
  /** Optional user-entered caption. NULL means no caption (web shows fallback). */
  caption?: string | null;
}

interface UploadResult {
  publicUrl: string;
  photoId: string;
}

const PHOTO_LOCATION_MAX_AGE_MS = 60_000;

async function uploadFile(uri: string, storagePath: string): Promise<boolean> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const arrayBuffer = await new Response(blob).arrayBuffer();
  const { error } = await supabase.storage
    .from("project-photos")
    .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: false });
  return !error;
}

async function uploadBase64(base64: string, storagePath: string): Promise<boolean> {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const { error } = await supabase.storage
    .from("project-photos")
    .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: false });
  return !error;
}

export async function uploadPhoto(params: UploadPhotoParams): Promise<UploadResult | null> {
  const { localUri, projectId, projectName, surveyId, habitatPolygonId, targetNoteId, siteId, tags, caption } = params;

  // getSession reads cached session without a network round-trip; getUser validates
  // server-side on every call which adds latency and fails offline during bulk photo sync.
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const location = await getLocation({ maxAgeMs: PHOTO_LOCATION_MAX_AGE_MS });
  const timestamp = Date.now();
  const fileName = `${timestamp}-photo.jpg`;
  const watermarkedFileName = `${timestamp}-photo-watermarked.jpg`;

  let context = "general";
  let subPath = siteId ?? "mobile";
  if (surveyId) { context = "survey"; subPath = surveyId; }
  else if (habitatPolygonId) { context = "habitat"; subPath = "mobile"; }
  else if (targetNoteId) { context = "target-note"; subPath = "mobile"; }

  const basePath = `${projectId}/${context}/${subPath}`;
  const storagePath = `${basePath}/${fileName}`;
  const watermarkedStoragePath = `${basePath}/${watermarkedFileName}`;

  const uploaded = await uploadFile(localUri, storagePath);
  if (!uploaded) return null;

  let watermarkedPath: string | null = null;
  try {
    const resp = await fetch(localUri);
    const blob = await resp.blob();
    const reader = new FileReader();
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const wmBase64 = await addWatermark({
      imageBase64,
      dateTime: new Date(),
      latitude: location?.lat ?? null,
      longitude: location?.lng ?? null,
      projectName: projectName ?? "Dulra Survey",
    });

    if (wmBase64) {
      const wmUploaded = await uploadBase64(wmBase64, watermarkedStoragePath);
      if (wmUploaded) watermarkedPath = watermarkedStoragePath;
    }
  } catch {
    // Watermark failed, continue with original only
  }

  const { data: urlData } = supabase.storage.from("project-photos").getPublicUrl(storagePath);
  const locationPoint = location ? `SRID=4326;POINT(${location.lng} ${location.lat})` : null;

  const insertRow: Record<string, unknown> = {
    project_id: projectId,
    survey_id: surveyId ?? null,
    habitat_polygon_id: habitatPolygonId ?? null,
    target_note_id: targetNoteId ?? null,
    storage_path: storagePath,
    watermarked_path: watermarkedPath,
    location: locationPoint,
    taken_at: new Date().toISOString(),
    caption: caption ?? null,
    created_by: userId,
  };
  if (tags && tags.length > 0) insertRow.tags = tags;
  // site_id only attached if explicitly provided — column is nullable and
  // single-site projects auto-resolve at the caller (no value here means
  // "leave NULL" rather than "guess").
  if (siteId) insertRow.site_id = siteId;

  const { data: photoRow, error: insertError } = await supabase
    .from("photos")
    .insert(insertRow)
    .select("id")
    .single();

  if (insertError || !photoRow) return null;
  return { publicUrl: urlData.publicUrl, photoId: photoRow.id };
}
