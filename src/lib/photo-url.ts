// 상품사진 URL 도우미 (클라이언트/서버 공용)
// 목록·장바구니·카테고리 타일처럼 작게 보이는 곳은 썸네일을, 상세/확대 화면은 원본을 씁니다.
// 썸네일이 아직 없으면 서버가 원본을 대신 보내므로 언제 써도 안전합니다.

export const THUMB_PREFIX = "thumb_";
export const THUMB_MAX_SIZE = 480;

export function photoKeyFromUrl(src: string) {
  const match = /^\/api\/photo\?id=([a-zA-Z0-9._-]+)$/.exec(String(src ?? "").trim());
  return match ? match[1] : "";
}

export function thumbUrl(src: string) {
  return photoKeyFromUrl(src) ? `${src}&size=thumb` : src;
}
