// 관리자 브라우저에서 상품사진 썸네일을 만들어 R2에 올립니다. (Cloudflare 이미지 변환 설정 없이 동작)
import { THUMB_MAX_SIZE, photoKeyFromUrl } from "./photo-url";

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** 긴 변 기준 THUMB_MAX_SIZE 로 줄인 사진. 원본이 더 작고 가벼우면 원본 그대로 */
export async function makeThumbnail(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return source;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await canvasToBlob(canvas, "image/webp", 0.8);
    // 사파리 등 webp 저장을 못 하면 jpeg
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
    if (!blob) return source;
    const sourceOk = ["image/jpeg", "image/png", "image/webp"].includes(source.type);
    return sourceOk && source.size <= blob.size ? source : blob;
  } finally {
    bitmap.close();
  }
}

export async function uploadThumbnail(originalKey: string, thumb: Blob) {
  const form = new FormData();
  const ext = thumb.type === "image/png" ? "png" : thumb.type === "image/jpeg" ? "jpg" : "webp";
  form.append("file", new File([thumb], `thumb.${ext}`, { type: thumb.type }));
  form.append("thumbOf", originalKey);
  const response = await fetch("/api/photo", { method: "POST", body: form });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || "썸네일 업로드 실패");
  }
}

/** 업로드한 사진 파일로 바로 썸네일 생성 (실패해도 원본 업로드에는 영향 없음) */
export async function createThumbnailForUpload(photoUrl: string, file: Blob) {
  const key = photoKeyFromUrl(photoUrl);
  if (!key) return;
  try {
    await uploadThumbnail(key, await makeThumbnail(file));
  } catch (error) {
    console.warn("thumbnail upload skipped", error);
  }
}

export type ThumbnailProgress = { done: number; total: number; failed: number; originalBytes: number; thumbBytes: number };

/** 아직 썸네일이 없는 사진들에 대해 일괄 생성 */
export async function generateMissingThumbnails(photoUrls: string[], onProgress: (progress: ThumbnailProgress) => void) {
  const listResponse = await fetch("/api/photo?thumbList=1", { cache: "no-store" });
  if (!listResponse.ok) throw new Error("썸네일 목록을 불러오지 못했습니다.");
  const existing = new Set(((await listResponse.json()) as { thumbs: string[] }).thumbs);
  const keys = Array.from(new Set(photoUrls.map(photoKeyFromUrl).filter(Boolean))).filter((key) => !existing.has(key));

  const progress: ThumbnailProgress = { done: 0, total: keys.length, failed: 0, originalBytes: 0, thumbBytes: 0 };
  onProgress({ ...progress });
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      try {
        const response = await fetch(`/api/photo?id=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const original = await response.blob();
        const thumb = await makeThumbnail(original);
        await uploadThumbnail(key, thumb);
        progress.originalBytes += original.size;
        progress.thumbBytes += thumb.size;
      } catch {
        progress.failed += 1;
      }
      progress.done += 1;
      onProgress({ ...progress });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return progress;
}
