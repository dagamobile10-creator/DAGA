import { authenticatedAccount } from "./owner-auth.js";

const MAX_LEDGER_BYTES = 180000;
const MAX_LEDGER_ROWS = 3000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://dagamobile10-creator.github.io",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function validPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Array.isArray(value.cols) || value.cols.length !== 10) return false;
  if (!Array.isArray(value.ledger) || value.ledger.length > MAX_LEDGER_ROWS) return false;
  if (!Array.isArray(value.closedDays) || value.closedDays.length > 500) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_LEDGER_BYTES; }
  catch (_) { return false; }
}

async function readJson(request) {
  const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { error: "application_json_required", status: 415 };
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > MAX_LEDGER_BYTES) return { error: "request_body_too_large", status: 413 };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_LEDGER_BYTES) return { error: "request_body_too_large", status: 413 };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "json_object_required", status: 400 };
    return { value };
  } catch (_) { return { error: "invalid_json", status: 400 }; }
}

async function resolveStoreAccess(db, account, storeId) {
  if (!storeId || storeId.length > 128) return null;
  const store = await db.prepare("SELECT id,owner_account_id,display_name,status FROM daga_stores WHERE id=? LIMIT 1").bind(storeId).first();
  if (!store || store.status !== "approved") return null;
  if (account.role === "store_owner" && store.owner_account_id === account.id) {
    return { store, role: "store_owner", canRead: true, canWrite: true };
  }
  const membership = await db.prepare("SELECT role,status,permissions_json FROM daga_store_memberships WHERE store_id=? AND account_id=? LIMIT 1")
    .bind(store.id, account.id).first();
  if (!membership || membership.status !== "active" || !["manager", "employee"].includes(membership.role)) return null;
  let permissions = {};
  try { permissions = JSON.parse(membership.permissions_json || "{}"); } catch (_) {}
  return {
    store,
    role: membership.role,
    canRead: permissions.viewReports === true,
    canWrite: false
  };
}

export async function handleCompanyLedger(request, env, url) {
  if (!url.pathname.startsWith("/api/company/ledger")) return null;
  if (!["GET", "POST"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  if (!env.DAGA_APP_DB) return json({ error: "ledger_storage_not_configured" }, 503);
  const account = await authenticatedAccount(request, env.DAGA_APP_DB);
  if (!account) return json({ error: "unauthorized" }, 401);

  let body = null;
  if (request.method === "POST") {
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    body = parsed.value;
  }
  const storeId = String(request.method === "GET" ? url.searchParams.get("storeId") || "" : body.storeId || "").trim();
  const access = await resolveStoreAccess(env.DAGA_APP_DB, account, storeId);
  if (!access) return json({ error: "company_access_denied" }, 403);
  if (!access.canRead) return json({ error: "ledger_read_permission_required" }, 403);

  if (request.method === "GET") {
    const row = await env.DAGA_APP_DB.prepare("SELECT payload_json,updated_at FROM daga_store_ledgers WHERE store_id=? LIMIT 1")
      .bind(storeId).first();
    if (!row) return json({ ok: true, storeId, payload: null, updatedAt: null });
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch (_) { return json({ error: "ledger_data_invalid" }, 500); }
    if (!validPayload(payload)) return json({ error: "ledger_data_invalid" }, 500);
    return json({ ok: true, storeId, payload, updatedAt: row.updated_at });
  }

  if (!access.canWrite) return json({ error: "ledger_write_permission_required" }, 403);
  if (String(body.storeId || "") !== storeId || !validPayload(body.payload)) {
    return json({ error: "invalid_ledger_payload" }, 400);
  }
  const payloadJson = JSON.stringify(body.payload);
  const now = new Date().toISOString();
  try {
    await env.DAGA_APP_DB.prepare("INSERT INTO daga_store_ledgers (store_id,payload_json,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(store_id) DO UPDATE SET payload_json=excluded.payload_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
      .bind(storeId, payloadJson, account.id, now).run();
    await env.DAGA_APP_DB.prepare("INSERT INTO daga_audit_log (id,actor_account_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), account.id, "store_ledger_saved", "store", storeId, JSON.stringify({ bytes: new TextEncoder().encode(payloadJson).byteLength }), now).run();
    return json({ ok: true, storeId, updatedAt: now });
  } catch (_) {
    return json({ error: "ledger_storage_failed" }, 500);
  }
}
