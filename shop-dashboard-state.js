import { authenticatedAccount } from "./owner-auth.js";

export async function handleShopDashboardState(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/api/shop/dashboard/state") return null;
  if (!["GET", "POST", "PUT"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const db = env.DAGA_APP_DB;
  if (!db) return json({ error: "application_database_not_configured" }, 503);
  const account = await authenticatedAccount(request, db);
  if (!account || !["store_owner", "manager", "employee"].includes(account.role) || !account.store_id) {
    return json({ error: "approved_shop_account_required" }, 401);
  }
  const store = await db.prepare("SELECT id,status,owner_account_id FROM daga_stores WHERE id=? AND status='approved'").bind(account.store_id).first();
  if (!store) return json({ error: "approved_store_required" }, 403);
  if (account.role !== "store_owner") {
    const member = await db.prepare("SELECT status FROM daga_store_memberships WHERE account_id=? AND store_id=? LIMIT 1").bind(account.id, store.id).first().catch(() => null);
    if (!member || member.status !== "active") return json({ error: "active_store_membership_required" }, 403);
  } else if (store.owner_account_id !== account.id) {
    return json({ error: "store_owner_scope_mismatch" }, 403);
  }

  if (request.method === "GET") {
    const row = await db.prepare("SELECT revision,payload_json,updated_at FROM daga_shop_dashboard_state WHERE store_id=?").bind(store.id).first();
    if (!row) return json({ ok: true, exists: false, revision: 0, state: null });
    let state;
    try { state = JSON.parse(row.payload_json); } catch (_) { return json({ error: "stored_dashboard_state_corrupt" }, 500); }
    return json({ ok: true, exists: true, revision: Number(row.revision), updatedAt: row.updated_at, state });
  }

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "invalid_json" }, 400); }
  const state = body?.state;
  const invalid = validateState(state);
  if (invalid) return json({ error: "invalid_dashboard_state", detail: invalid }, 400);
  const payload = JSON.stringify(state);
  if (new TextEncoder().encode(payload).byteLength > 900000) return json({ error: "dashboard_state_too_large" }, 413);
  const now = new Date().toISOString();
  if (request.method === "POST") {
    const inserted = await db.prepare("INSERT INTO daga_shop_dashboard_state (store_id,revision,payload_json,updated_by,updated_at) VALUES (?,1,?,?,?) ON CONFLICT(store_id) DO NOTHING RETURNING revision,updated_at")
      .bind(store.id, payload, account.id, now).first();
    if (!inserted) {
      const current = await db.prepare("SELECT revision,updated_at FROM daga_shop_dashboard_state WHERE store_id=?").bind(store.id).first();
      return json({ error: "dashboard_state_already_exists", revision: Number(current?.revision || 0), updatedAt: current?.updated_at || null }, 409);
    }
    await audit(db, account.id, store.id, "dashboard_state_imported", { revision: 1, bytes: payload.length });
    return json({ ok: true, revision: 1, updatedAt: inserted.updated_at });
  }
  const expected = Number(body?.expectedRevision);
  if (!Number.isSafeInteger(expected) || expected < 1) return json({ error: "invalid_expected_revision" }, 400);
  const updated = await db.prepare("UPDATE daga_shop_dashboard_state SET revision=revision+1,payload_json=?,updated_by=?,updated_at=? WHERE store_id=? AND revision=? RETURNING revision,updated_at")
    .bind(payload, account.id, now, store.id, expected).first();
  if (!updated) {
    const current = await db.prepare("SELECT revision,updated_at FROM daga_shop_dashboard_state WHERE store_id=?").bind(store.id).first();
    return json({ error: "dashboard_state_revision_conflict", revision: Number(current?.revision || 0), updatedAt: current?.updated_at || null }, 409);
  }
  await audit(db, account.id, store.id, "dashboard_state_updated", { revision: Number(updated.revision), bytes: payload.length });
  return json({ ok: true, revision: Number(updated.revision), updatedAt: updated.updated_at });
}

function validateState(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return "state must be an object";
  if (!Array.isArray(s.cols) || s.cols.length < 1 || s.cols.length > 30) return "cols must contain 1 to 30 columns";
  if (!Array.isArray(s.ledger) || s.ledger.length > 2000) return "ledger limit exceeded";
  if (!Array.isArray(s.closedDays) || s.closedDays.length > 400) return "closedDays limit exceeded";
  for (const c of s.cols) {
    if (!c || typeof c !== "object" || typeof c.name !== "string" || c.name.length > 80 || !Array.isArray(c.entries) || c.entries.length > 10000) return "invalid column";
    for (const e of c.entries) if (!Array.isArray(e) || typeof e[0] !== "string" || e[0].length > 160 || String(e[1] ?? "").length > 80) return "invalid entry";
  }
  for (const l of s.ledger) if (!l || typeof l !== "object" || String(l.action || "").length > 120 || String(l.details || "").length > 2000) return "invalid ledger item";
  return null;
}
async function audit(db, actor, store, action, details) {
  await db.prepare("INSERT INTO daga_audit_log (id,actor_account_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor, action, "daga_shop_dashboard_state", store, JSON.stringify(details), new Date().toISOString()).run();
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "https://dagamobile10-creator.github.io", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Vary": "Origin" } });
}
