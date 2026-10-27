// 거래처 로그인 아이디 규칙 (서버/클라이언트 공용, DB 의존성 없음)
//
// - 거래처명에 블록-로트 번호가 있으면 하이픈을 뺀 숫자가 아이디: "120-13" → "12013", "1-18" → "118"
// - 블록-로트 번호가 없으면 얼마에요 거래처코드(5자리)가 아이디
// - 숫자 아이디가 다른 거래처와 겹치면 거래처코드를 아이디로 사용 (provisioning 단계에서 처리)
// - 비밀번호 기본값은 아이디와 동일

// lookbehind 문법은 구형 iOS Safari에서 스크립트 전체가 깨지므로 사용하지 않음
const BLOCK_LOT = /(?:^|\D)(\d{1,3})\s*[-–—]\s*(\d{1,3})(?!\d)/;

/** 사용자가 입력한 아이디를 비교용 형태로 정리: 공백·하이픈 제거, 소문자 */
export function normalizeLoginId(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s\-–—]+/g, "");
}

/** 거래처명에서 "120-13" 형태의 블록-로트 번호를 찾음. 없으면 "" */
export function blockLotFromName(name: string) {
  const match = String(name ?? "").match(BLOCK_LOT);
  return match ? `${match[1]}-${match[2]}` : "";
}

/** 거래처 1곳의 기본 로그인 아이디 후보 */
export function suggestedLoginId(name: string, code: string) {
  const blockLot = blockLotFromName(name);
  if (blockLot) return blockLot.replace("-", "");
  return normalizeLoginId(code);
}

/** 화면/문자에 쓰는 짧은 발주처 표기: "120-13" 또는 업체명 */
export function customerShortLabel(customer: { name?: string; code?: string } | null | undefined) {
  const name = String(customer?.name ?? "").trim();
  return blockLotFromName(name) || name || String(customer?.code ?? "").trim() || "부자유통";
}

/** 문자 발주 제목: "[120-13 발주]" / "[업체명 발주]" */
export function orderTitle(customer: { name?: string; code?: string } | null | undefined) {
  return `[${customerShortLabel(customer)} 발주]`;
}
