import { db, ensureDatabase } from "./db.server";
import type { StaffSession } from "./auth.server";

export type AuditActor = { type: "staff" | "admin" | "customer" | "system"; id?: string; name?: string };

export async function writeAudit(input: {
  actor?: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const actor = input.actor ?? { type: "system" as const };
  await db().prepare(`
    INSERT INTO audit_logs(actor_type,actor_id,actor_name,action,entity_type,entity_id,summary,metadata_json)
    VALUES(?,?,?,?,?,?,?,?)
  `).bind(
    actor.type,
    actor.id ?? "",
    actor.name ?? "",
    input.action,
    input.entityType ?? "",
    input.entityId ?? "",
    input.summary.slice(0, 500),
    JSON.stringify(input.metadata ?? {}),
  ).run();
}

export function staffActor(staff: StaffSession): AuditActor {
  return { type: "staff", id: staff.id, name: staff.displayName };
}
