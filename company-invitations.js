import { authenticatedAccount } from "./owner-auth.js";

const MAX_INVITE_TTL_HOURS = 24 * 14;
const DEFAULT_INVITE_TTL_HOURS = 72;
const MANAGER_PERMISSION = "inviteEmployees";

export async function handleCompanyInvitations(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!["/api/company/invitations", "/api/company/invitations/accept"].includes(path) &&
      !/^\/api\/company\/invitations\/[0-9a-f-]{36}(?:\/revoke)?$/i.test(path)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "application_database_not_configured" }, 503);
  const account = await authenticatedAccount(request, db);
  if (!account) return json(env, { error: "authenticated_account_required" }, 401);
  if (account.status !== "approved" || account.role === "program_owner") return json(env, { error: "active_company_account_required" }, 403);

  try {
    if (path === "/api/company/invitations" && request.method === "POST") return createInvitation(request, env, db, account);
    if (path === "/api/company/invitations" && request.method === "GET") return listInvitations(url, db, account);
    if (path === "/api/company/invitations/accept" && request.method === "POST") return acceptInvitation(request, env, db, account);
    const revoke = path.match(/^\/api\/company\/invitations\/([0-9a-f-]{36})\/revoke$/i);
    if (revoke && request.method === "POST") return revokeInvitation(db, account, revoke[1]);
    if (/^\/api\/company\/invitations\/[0-9a-f-]{36}$/i.test(path) && request.method === "DELETE") {
      return revokeInvitation(db, account, path.split("/").filter(Boolean).at(-1));
    }
    return json(env, { error: "method_not_allowed" }, 405);
  } catch (_) {
    return json(env, { error: "invitation_request_failed" }, 500);
  }
}

async function createInvitation(request, env, db, account) {
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const storeId = String(body.storeId || "").trim();
  const intendedRole = String(body.role || "");
  const hours = body.expiresInHours == null ? DEFAULT_INVITE_TTL_HOURS : Number(body.expiresInHours);
  if (!storeId || !["manager", "employee"].includes(intendedRole) || !Number.isInteger(hours) || hours < 1 || hours > MAX_INVITE_TTL_HOURS) {
    return json(env, { error: "invalid_invitation_fields" }, 400);
  }
  const store = await db.prepare("SELECT id,public_id,owner_account_id,status FROM daga_stores WHERE id=? LIMIT 1").bind(storeId).first();
  if (!store || store.status !== "approved") return json(env, { error: "company_not_found_or_inactive" }, 404);
  const authority = await getAuthority(db, account, store);
  if (!authority) return json(env, { error: "company_invitation_permission_denied" }, 403);
  if (authority.role === "manager" && intendedRole !== "employee") return json(env, { error: "manager_can_only_invite_employees" }, 403);
  if (authority.role === "manager" && !authority.permissions.inviteEmployees) return json(env, { error: "manager_invitation_permission_disabled" }, 403);

  const permissions = normalizePermissions(body.permissions, intendedRole, authority);
  if (!permissions) return json(env, { error: "invalid_or_escalated_permissions" }, 400);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3600000).toISOString();
  await db.prepare("INSERT INTO daga_store_invitations (id,store_id,inviter_account_id,token_hash,intended_role,permissions_json,status,expires_at,max_uses,use_count) VALUES (?,?,?,?,?,?,'pending',?,1,0)")
    .bind(id, store.id, account.id, tokenHash, intendedRole, JSON.stringify(permissions), expiresAt).run();
  await audit(db, account.id, "company_invitation_created", id, { storeId: store.id, role: intendedRole, expiresAt });
  const base = trustedBaseUrl(env.DAGA_APP_BASE_URL);
  if (!base) {
    await db.prepare("UPDATE daga_store_invitations SET status='revoked',revoked_at=? WHERE id=? AND status='pending'")
      .bind(new Date().toISOString(), id).run();
    return json(env, { error: "trusted_app_base_url_not_configured" }, 503);
  }
  const inviteUrl = base + "/invite?token=" + encodeURIComponent(token);
  return json(env, { ok: true, invitation: { id, companyPublicId: store.public_id || null, role: intendedRole, expiresAt, maxUses: 1, inviteUrl, token } }, 201);
}

async function listInvitations(url, db, account) {
  const storeId = String(url.searchParams.get("storeId") || "").trim();
  if (!storeId) return json(null, { error: "storeId_required" }, 400);
  const store = await db.prepare("SELECT id,owner_account_id,status FROM daga_stores WHERE id=?").bind(storeId).first();
  if (!store || store.status !== "approved" || !await getAuthority(db, account, store)) return json(null, { error: "company_not_found_or_access_denied" }, 404);
  const rows = await db.prepare("SELECT id,intended_role,status,expires_at,max_uses,use_count,created_at,accepted_at,revoked_at FROM daga_store_invitations WHERE store_id=? ORDER BY created_at DESC LIMIT 100").bind(storeId).all();
  return json(null, { ok: true, invitations: rows.results || [] });
}

async function acceptInvitation(request, env, db, account) {
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const token = String(body.token || "").trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return json(env, { error: "invalid_expired_or_used_invitation" }, 400);
  if (["store_owner", "program_owner"].includes(account.role)) return json(env, { error: "account_role_cannot_accept_company_invitation" }, 403);
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const invite = await db.prepare("SELECT i.id,i.store_id,i.intended_role,i.permissions_json,i.expires_at,s.status AS store_status FROM daga_store_invitations i JOIN daga_stores s ON s.id=i.store_id WHERE i.token_hash=? AND i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>? LIMIT 1")
    .bind(tokenHash, now).first();
  if (!invite || invite.store_status !== "approved") return json(env, { error: "invalid_expired_or_used_invitation" }, 400);
  const existing = await db.prepare("SELECT id,status FROM daga_store_memberships WHERE store_id=? AND account_id=?").bind(invite.store_id, account.id).first();
  if (existing) return json(env, { error: "already_a_company_member" }, 409);
  let permissions;
  try { permissions = JSON.parse(invite.permissions_json || "{}"); } catch (_) { permissions = {}; }
  permissions = safeStoredPermissions(permissions, invite.intended_role);
  const membershipId = crypto.randomUUID();
  const claim = db.prepare("UPDATE daga_store_invitations SET status='accepted',use_count=1,accepted_by_account_id=?,accepted_at=? WHERE id=? AND token_hash=? AND status='pending' AND use_count=0 AND max_uses=1 AND expires_at>? AND EXISTS (SELECT 1 FROM daga_stores s WHERE s.id=daga_store_invitations.store_id AND s.status='approved') RETURNING id,store_id,intended_role,permissions_json")
    .bind(account.id, now, invite.id, tokenHash, now);
  const insert = db.prepare("INSERT INTO daga_store_memberships (id,store_id,account_id,role,status,permissions_json,invited_by_account_id,created_at,updated_at) SELECT ?,i.store_id,?,i.intended_role,'active',i.permissions_json,i.inviter_account_id,?,?,? FROM daga_store_invitations i WHERE i.id=? AND i.status='accepted' AND i.accepted_by_account_id=? AND i.use_count=1 AND NOT EXISTS (SELECT 1 FROM daga_store_memberships m WHERE m.store_id=i.store_id AND m.account_id=? AND m.status!='removed')")
    .bind(membershipId, account.id, now, now, invite.id, account.id, account.id);
  const results = await db.batch([claim, insert]);
  const claimed = Number(results?.[0]?.meta?.changes || 0);
  const inserted = Number(results?.[1]?.meta?.changes || 0);
  if (claimed !== 1 || inserted !== 1) return json(env, { error: "invalid_expired_used_or_concurrently_claimed_invitation" }, 409);
  await audit(db, account.id, "company_invitation_accepted", invite.id, { storeId: invite.store_id, role: invite.intended_role });
  return json(env, { ok: true, membership: { id: membershipId, storeId: invite.store_id, role: invite.intended_role, permissions } }, 201);
}

async function revokeInvitation(db, account, invitationId) {
  const invite = await db.prepare("SELECT id,store_id,intended_role,status,inviter_account_id FROM daga_store_invitations WHERE id=?").bind(invitationId).first();
  if (!invite) return json(null, { error: "invitation_not_found" }, 404);
  const store = await db.prepare("SELECT id,owner_account_id,status FROM daga_stores WHERE id=?").bind(invite.store_id).first();
  const authority = store && await getAuthority(db, account, store);
  if (!authority || (authority.role === "manager" && (invite.intended_role !== "employee" || invite.inviter_account_id !== account.id))) {
    return json(null, { error: "company_invitation_permission_denied" }, 403);
  }
  if (invite.status !== "pending") return json(null, { error: "invitation_not_pending" }, 409);
  const now = new Date().toISOString();
  const result = await db.prepare("UPDATE daga_store_invitations SET status='revoked',revoked_at=? WHERE id=? AND status='pending' AND use_count=0")
    .bind(now, invitationId).run();
  if (Number(result?.meta?.changes || 0) !== 1) return json(null, { error: "invitation_not_pending" }, 409);
  await audit(db, account.id, "company_invitation_revoked", invitationId, { storeId: invite.store_id });
  return json(null, { ok: true });
}

async function getAuthority(db, account, store) {
  if (account.role === "store_owner" && store.owner_account_id === account.id) {
    return { role: "store_owner", permissions: { inviteEmployees: true, inviteManagers: true, manageInvitations: true } };
  }
  const membership = await db.prepare("SELECT role,status,permissions_json FROM daga_store_memberships WHERE store_id=? AND account_id=? LIMIT 1")
    .bind(store.id, account.id).first();
  if (!membership || membership.status !== "active" || !["manager", "employee"].includes(membership.role)) return null;
  let permissions = {};
  try { permissions = JSON.parse(membership.permissions_json || "{}"); } catch (_) {}
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) permissions = {};
  return { role: membership.role, permissions };
}

function normalizePermissions(value, intendedRole, authority) {
  if (value == null) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = intendedRole === "manager" ? ["inviteEmployees", "manageInventory", "viewReports"] : ["manageInventory", "viewReports"];
  const out = {};
  for (const key of allowed) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return null;
    out[key] = Boolean(value[key]);
  }
  if (authority.role === "manager") {
    for (const key of Object.keys(out)) if (out[key] && !authority.permissions[key]) return null;
  }
  if (intendedRole === "employee" && out.inviteEmployees) return null;
  if (intendedRole === "manager" && authority.role !== "store_owner") return null;
  return out;
}

function safeStoredPermissions(value, role) {
  const allowed = role === "manager" ? ["inviteEmployees", "manageInventory", "viewReports"] : ["manageInventory", "viewReports"];
  const out = {};
  for (const key of allowed) out[key] = value && value[key] === true;
  return out;
}

function trustedBaseUrl(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return "";
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch (_) { return ""; }
}
async function audit(db, accountId, action, targetId, details) {
  try {
    await db.prepare("INSERT INTO daga_audit_log (id,actor_account_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), accountId, action, "daga_store_invitations", targetId, JSON.stringify(details || {}), new Date().toISOString()).run();
  } catch (_) {}
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function safeJson(request) { try { return await request.json(); } catch (_) { return null; } }
function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(env, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) });
}
function cors(env, extra = {}) {
  const allowed = String(env?.DAGA_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const origin = allowed.includes("*") ? "*" : allowed.length === 1 ? allowed[0] : allowed.includes("null") ? "null" : allowed.length === 0 ? "*" : "";
  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600", Vary: "Origin", ...extra };
}
