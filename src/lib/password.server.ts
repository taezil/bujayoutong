// 비밀번호/토큰 해시 유틸. DB에 의존하지 않으므로 auth.server.ts 와 db.server.ts 양쪽에서 사용합니다.
const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toHex(value);
}

export async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** PBKDF2-SHA256, 100,000회. 기존 관리자/직원/거래처 해시와 동일한 방식 */
export async function derivePassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** 길이가 같은 hex 문자열을 시간 차이 없이 비교 */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  if (!salt || !hash) return false;
  return safeEqual(await derivePassword(password, salt), hash);
}

/** 거래처 계정 비밀번호 생성 (salt/hash). 2~64자 */
export async function makeCustomerPasswordCredential(password: string) {
  const value = String(password ?? "").trim();
  if (value.length < 2 || value.length > 64) throw new Error("비밀번호는 2~64자로 설정해 주세요.");
  const salt = randomHex(16);
  const hash = await derivePassword(value, salt);
  return { salt, hash };
}
