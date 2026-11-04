import { createFileRoute } from "@tanstack/react-router";
import { getStaff, validMutationOrigin } from "../../../lib/auth.server";
import { ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { handleSmsAction } from "../../../lib/sms-alias.server";

// 배송기사 화면 '문자 붙여넣기': 연관어·주문이력 (관리자 화면과 같은 저장소)
export const Route = createFileRoute("/api/driver/sms")({ server: { handlers: { POST: async ({ request }) => {
  if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
  const staff = await getStaff(request);
  if (!staff) return Response.json({ error: "직원 로그인이 필요합니다." }, { status: 401 });
  await ensureDatabase();
  try {
    const body = await request.json() as Record<string, unknown>;
    const response = await handleSmsAction(cleanText(body.action, 40), body);
    return response ?? Response.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "처리하지 못했습니다." }, { status: 400 });
  }
} } } });
