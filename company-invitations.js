import { authenticatedAccount } from "./owner-auth.js";

const MAX_INVITE_TTL_HOURS = 24 * 14;
const DEFAULT_INVITE_TTL_HOURS = 72;
export async function handleCompanyInvitations(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const publicPaths = ["/api/company/auth/register", "/api/company/auth/register/verify", "/api/company/auth/login", "/api/company/auth/login/verify"];
  const accountPaths = ["/api/company/auth/me", "/api/company/auth/logout"];
  if (!publicPaths.includes(path) && !accountPaths.includes(path) && !["/api/company/invitations", "/api/company/invitations/accept"].includes(path) &&
      !/^\/api\/company\/invitations\/[0-9a-f-]{36}(?:\/revoke)?$/i.test(path)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "application_database_not_configured" }, 503);
  if (path === "/api/company/auth/register" && request.method === "POST") return registerStart(request, env, db);
  if (path === "/api/company/auth/register/verify" && request.method === "POST") return registerVerify(request, env, db);
  if (path === "/api/company/auth/login" && request.method === "POST") return companyLoginStart(request, env, db);
  if (path === "/api/company/auth/login/verify" && request.method === "POST") return companyLoginVerify(request, env, db);
  const account = await authenticatedAccount(request, db);
  if (!account) return json(env, { error: "authenticated_account_required" }, 401);
  if (account.status !== "approved" || account.role === "program_owner") return json(env, { error: "active_company_account_required" }, 403);
  if (path === "/api/company/auth/me" && request.method === "GET") return companyAccountMe(env, db, account);
  if (path === "/api/company/auth/logout" && request.method === "POST") return companyAccountLogout(request, env, db);

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


async function companyAccountMe(env, db, account) {
  const owned = await db.prepare("SELECT id,public_id,display_name,status,'store_owner' AS role FROM daga_stores WHERE owner_account_id=? AND status='approved' ORDER BY created_at DESC").bind(account.id).all();
  const memberships = await db.prepare("SELECT s.id,s.public_id,s.display_name,s.status,m.role,m.permissions_json,m.status AS membership_status FROM daga_store_memberships m JOIN daga_stores s ON s.id=m.store_id WHERE m.account_id=? AND m.status='active' AND s.status='approved' ORDER BY s.display_name").bind(account.id).all();
  const companies = [...(owned.results || []), ...(memberships.results || []).map(row => {
    let permissions = {};
    try { permissions = JSON.parse(row.permissions_json || "{}"); } catch (_) {}
    const safe = {};
    for (const key of ["inviteEmployees","manageInventory","viewReports"]) safe[key] = permissions[key] === true;
    return { id: row.id, publicId: row.public_id || null, displayName: row.display_name, status: row.status, role: row.role, permissions: safe };
  })];
  return json(env, { ok: true, account: { id: account.id, publicId: account.public_id || null, displayName: account.display_name, role: account.role, status: account.status, phoneMasked: maskCompanyPhone(account.phone_e164), emailMasked: maskCompanyEmail(account.email) }, companies });
}
async function companyAccountLogout(request, env, db) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return json(env, { error: "authenticated_account_required" }, 401);
  const hash = await sha256(token);
  const now = new Date().toISOString();
  const result = await db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(now, hash).run();
  if (Number(result?.meta?.changes || 0) !== 1) return json(env, { error: "session_already_revoked" }, 401);
  return json(env, { ok: true });
}

async function companyLoginStart(request, env, db) {
  if (!env.DAGA_OTP_PEPPER || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !env.RESEND_API_KEY || !env.DAGA_EMAIL_FROM) return json(env, { error: "company_login_not_configured" }, 503);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const identifier = String(body.identifier || "").trim();
  const phoneInput = normalizeCompanyPhone(identifier);
  const emailInput = identifier.toLowerCase();
  if (!phoneInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) return json(env, { error: "valid_phone_or_email_required" }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await companyRateLimit(db, env, "company-login-ip:" + ip, 8, 900)) return json(env, { error: "rate_limited" }, 429);
  const account = await db.prepare("SELECT id,phone_e164,email FROM daga_accounts WHERE (phone_e164=? OR lower(email)=?) AND status='approved' AND role IN ('store_owner','manager','employee') LIMIT 1").bind(phoneInput || "__none__", emailInput).first();
  if (!account || !account.phone_e164 || !account.email) return json(env, { error: "invalid_credentials_or_company_account_unavailable" }, 401);
  if (!await companyRateLimit(db, env, "company-login-account:" + account.id, 5, 900)) return json(env, { error: "rate_limited" }, 429);
  const expires = new Date(Date.now() + 600000).toISOString(), phoneCode = companyDigits(), emailCode = companyDigits();
  const phoneId = crypto.randomUUID(), emailId = crypto.randomUUID();
  const [phoneHash, emailHash, phoneDest, emailDest] = await Promise.all([
    sha256(phoneId + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER), sha256(emailId + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER),
    sha256("phone:" + account.phone_e164), sha256("email:" + String(account.email).toLowerCase())
  ]);
  await db.batch([
    db.prepare("INSERT INTO daga_company_login_challenges (id,account_id,channel,destination_hash,code_hash,expires_at) VALUES (?,?,'phone',?,?,?)").bind(phoneId, account.id, phoneDest, phoneHash, expires),
    db.prepare("INSERT INTO daga_company_login_challenges (id,account_id,channel,destination_hash,code_hash,expires_at) VALUES (?,?,'email',?,?,?)").bind(emailId, account.id, emailDest, emailHash, expires)
  ]);
  try {
    await Promise.all([
      companySendSms(env, account.phone_e164, "DAGA sign-in code: " + phoneCode + ". Expires in 10 minutes."),
      companySendEmail(env, account.email, "DAGA sign-in verification", "<p>Your DAGA sign-in code is <strong>" + emailCode + "</strong>.</p><p>It expires in 10 minutes.</p>")
    ]);
  } catch (_) {
    const at = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE daga_company_login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(at, phoneId),
      db.prepare("UPDATE daga_company_login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(at, emailId)
    ]);
    return json(env, { error: "verification_delivery_failed" }, 502);
  }
  return json(env, { ok: true, requiresVerification: true, phoneMasked: maskCompanyPhone(account.phone_e164), emailMasked: maskCompanyEmail(account.email), expiresInSeconds: 600 }, 202);
}

async function companyLoginVerify(request, env, db) {
  if (!env.DAGA_OTP_PEPPER) return json(env, { error: "company_login_not_configured" }, 503);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const identifier = String(body.identifier || "").trim(), phone = normalizeCompanyPhone(identifier), email = identifier.toLowerCase();
  const phoneCode = String(body.phoneCode || "").trim(), emailCode = String(body.emailCode || "").trim();
  if ((!phone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !/^\d{6}$/.test(phoneCode) || !/^\d{6}$/.test(emailCode)) return json(env, { error: "valid_login_fields_required" }, 400);
  const account = await db.prepare("SELECT id,phone_e164,email,display_name,role,status,public_id FROM daga_accounts WHERE (phone_e164=? OR lower(email)=?) AND status='approved' AND role IN ('store_owner','manager','employee') LIMIT 1").bind(phone || "__none__", email).first();
  if (!account || !account.phone_e164 || !account.email) return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  const now = new Date().toISOString();
  const [p, e] = await Promise.all([
    db.prepare("SELECT id,code_hash FROM daga_company_login_challenges WHERE account_id=? AND channel='phone' AND destination_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(account.id, await sha256("phone:" + account.phone_e164), now).first(),
    db.prepare("SELECT id,code_hash FROM daga_company_login_challenges WHERE account_id=? AND channel='email' AND destination_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(account.id, await sha256("email:" + String(account.email).toLowerCase()), now).first()
  ]);
  if (!p || !e) return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  const pa = await db.prepare("UPDATE daga_company_login_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts").bind(p.id, now).first();
  const ea = await db.prepare("UPDATE daga_company_login_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts").bind(e.id, now).first();
  const validPhone = constantTimeEqualCompany(await sha256(p.id + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER), p.code_hash);
  const validEmail = constantTimeEqualCompany(await sha256(e.id + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER), e.code_hash);
  if (!pa || !ea || !validPhone || !validEmail) return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  const sessionToken = companyRandomToken(32), sessionHash = await sha256(sessionToken), sessionId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const claimId = crypto.randomUUID();
  try {
    const results = await db.batch([
      db.prepare("UPDATE daga_company_login_challenges SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?").bind(now, claimId, p.id, now),
      db.prepare("UPDATE daga_company_login_challenges SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?").bind(now, claimId, e.id, now),
      db.prepare("INSERT INTO daga_auth_sessions (id,account_id,token_hash,created_at,expires_at,last_seen_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daga_company_login_challenges WHERE id=? AND claim_id=? AND channel='phone') AND EXISTS (SELECT 1 FROM daga_company_login_challenges WHERE id=? AND claim_id=? AND channel='email') AND EXISTS (SELECT 1 FROM daga_accounts WHERE id=? AND status='approved')").bind(sessionId, account.id, sessionHash, now, expiresAt, now, p.id, claimId, e.id, claimId, account.id)
    ]);
    if (Number(results?.[2]?.meta?.changes || 0) !== 1) return json(env, { error: "login_race_or_conflict_retry" }, 409);
  } catch (_) {
    return json(env, { error: "company_login_failed" }, 409);
  }
  return json(env, { ok: true, account: { id: account.id, publicId: account.public_id || null, displayName: account.display_name, role: account.role, phoneMasked: maskCompanyPhone(account.phone_e164), emailMasked: maskCompanyEmail(account.email) }, sessionToken, expiresAt });
}

async function registerStart(request, env, db) {
  const required = ["DAGA_OTP_PEPPER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "DAGA_EMAIL_FROM"];
  if (required.some(key => !env[key])) return json(env, { error: "company_registration_not_configured" }, 503);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const token = String(body.token || "").trim();
  const displayName = String(body.displayName || "").trim().slice(0, 100);
  const phone = normalizeCompanyPhone(body.phone);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token) || displayName.length < 2 || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(env, { error: "valid_invitation_name_phone_and_email_required" }, 400);
  }
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const invite = await db.prepare("SELECT i.id,s.id AS store_id,i.intended_role FROM daga_store_invitations i JOIN daga_stores s ON s.id=i.store_id WHERE i.token_hash=? AND i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>? AND s.status='approved' LIMIT 1").bind(tokenHash, now).first();
  if (!invite) return json(env, { error: "invalid_expired_or_used_invitation" }, 400);
  const existing = await db.prepare("SELECT id FROM daga_accounts WHERE phone_e164=? OR lower(email)=? LIMIT 1").bind(phone, email).first();
  if (existing) return json(env, { error: "account_exists_use_existing_account" }, 409);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await companyRateLimit(db, env, "company-register-ip:" + ip, 5, 900) ||
      !await companyRateLimit(db, env, "company-register-destination:" + await sha256(phone + ":" + email), 3, 3600)) {
    return json(env, { error: "rate_limited" }, 429);
  }
  const phoneCode = companyDigits(), emailCode = companyDigits();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const phoneId = crypto.randomUUID(), emailId = crypto.randomUUID();
  const phoneHash = await sha256(phoneId + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER);
  const emailHash = await sha256(emailId + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER);
  await db.batch([
    db.prepare("INSERT INTO daga_company_registration_challenges (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at) VALUES (?,?,'phone',?,?,?)").bind(phoneId, tokenHash, await sha256("phone:" + phone), phoneHash, expiresAt),
    db.prepare("INSERT INTO daga_company_registration_challenges (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at) VALUES (?,?,'email',?,?,?)").bind(emailId, tokenHash, await sha256("email:" + email), emailHash, expiresAt)
  ]);
  try {
    await Promise.all([
      companySendSms(env, phone, "DAGA verification code: " + phoneCode + ". Expires in 10 minutes."),
      companySendEmail(env, email, "DAGA account verification", "<p>Your DAGA verification code is <strong>" + emailCode + "</strong>.</p><p>It expires in 10 minutes.</p>")
    ]);
  } catch (_) {
    const failedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE daga_company_registration_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(failedAt, phoneId),
      db.prepare("UPDATE daga_company_registration_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(failedAt, emailId)
    ]);
    return json(env, { error: "verification_delivery_failed" }, 502);
  }
  return json(env, { ok: true, requiresVerification: true, phoneMasked: maskCompanyPhone(phone), emailMasked: maskCompanyEmail(email), expiresInSeconds: 600 }, 202);
}

async function registerVerify(request, env, db) {
  if (!env.DAGA_OTP_PEPPER) return json(env, { error: "company_registration_not_configured" }, 503);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const token = String(body.token || "").trim();
  const displayName = String(body.displayName || "").trim().slice(0, 100);
  const phone = normalizeCompanyPhone(body.phone);
  const email = String(body.email || "").trim().toLowerCase();
  const phoneCode = String(body.phoneCode || "").trim();
  const emailCode = String(body.emailCode || "").trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token) || displayName.length < 2 || !phone ||
      !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !/^\\d{6}$/.test(phoneCode) || !/^\\d{6}$/.test(emailCode)) {
    return json(env, { error: "valid_registration_fields_required" }, 400);
  }
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const invite = await db.prepare("SELECT i.id,i.store_id,i.inviter_account_id,i.intended_role,i.permissions_json FROM daga_store_invitations i JOIN daga_stores s ON s.id=i.store_id WHERE i.token_hash=? AND i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>? AND s.status='approved' LIMIT 1").bind(tokenHash, now).first();
  if (!invite) return json(env, { error: "invalid_expired_or_used_invitation" }, 400);
  const existing = await db.prepare("SELECT id FROM daga_accounts WHERE phone_e164=? OR lower(email)=? LIMIT 1").bind(phone, email).first();
  if (existing) return json(env, { error: "account_exists_use_existing_account" }, 409);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await companyRateLimit(db, env, "company-register-verify-ip:" + ip, 10, 900) ||
      !await companyRateLimit(db, env, "company-register-verify-destination:" + await sha256(phone + ":" + email), 6, 3600)) {
    return json(env, { error: "rate_limited" }, 429);
  }
  const [phoneChallenge, emailChallenge] = await Promise.all([
    db.prepare("SELECT id,code_hash FROM daga_company_registration_challenges WHERE invitation_token_hash=? AND channel='phone' AND destination_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(tokenHash, await sha256("phone:" + phone), now).first(),
    db.prepare("SELECT id,code_hash FROM daga_company_registration_challenges WHERE invitation_token_hash=? AND channel='email' AND destination_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(tokenHash, await sha256("email:" + email), now).first()
  ]);
  if (!phoneChallenge || !emailChallenge) return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  const phoneAttempt = await db.prepare("UPDATE daga_company_registration_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts").bind(phoneChallenge.id, now).first();
  const emailAttempt = await db.prepare("UPDATE daga_company_registration_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts").bind(emailChallenge.id, now).first();
  if (!phoneAttempt || !emailAttempt) return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  const expectedPhone = await sha256(phoneChallenge.id + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER);
  const expectedEmail = await sha256(emailChallenge.id + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER);
  if (!constantTimeEqualCompany(expectedPhone, phoneChallenge.code_hash) || !constantTimeEqualCompany(expectedEmail, emailChallenge.code_hash)) {
    return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  }

  // Registration and invitation acceptance are one D1 batch. Two people cannot
  // register from the same single-use link and leave an orphaned approved account.
  const accountId = crypto.randomUUID();
  const publicId = "DAGA-USER-" + accountId.replace(/-/g, "").toUpperCase();
  const sessionToken = companyRandomToken(32);
  const sessionHash = await sha256(sessionToken);
  const sessionId = crypto.randomUUID();
  const sessionExpires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const claimId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  let results;
  try {
    results = await db.batch([
      db.prepare("UPDATE daga_company_registration_challenges SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?").bind(now, claimId, phoneChallenge.id, now),
      db.prepare("UPDATE daga_company_registration_challenges SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?").bind(now, claimId, emailChallenge.id, now),
      db.prepare("UPDATE daga_store_invitations SET status='accepted',use_count=1,accepted_by_account_id=?,accepted_at=? WHERE id=? AND token_hash=? AND status='pending' AND use_count=0 AND max_uses=1 AND expires_at>? AND EXISTS (SELECT 1 FROM daga_stores WHERE id=daga_store_invitations.store_id AND status='approved') AND EXISTS (SELECT 1 FROM daga_company_registration_challenges WHERE id=? AND claim_id=? AND channel='phone') AND EXISTS (SELECT 1 FROM daga_company_registration_challenges WHERE id=? AND claim_id=? AND channel='email') RETURNING id")
        .bind(accountId, now, invite.id, tokenHash, now, phoneChallenge.id, claimId, emailChallenge.id, claimId),
      db.prepare("INSERT INTO daga_accounts (id,public_id,phone_e164,email,display_name,role,status,store_id,phone_verified_at,email_verified_at,created_at,updated_at) SELECT ?,?,?,?,?,?,'approved',?,?,?, ?,? WHERE EXISTS (SELECT 1 FROM daga_store_invitations WHERE id=? AND status='accepted' AND accepted_by_account_id=? AND use_count=1)")
        .bind(accountId, publicId, phone, email, displayName, invite.intended_role, invite.store_id, now, now, now, now, invite.id, accountId),
      db.prepare("INSERT INTO daga_store_memberships (id,store_id,account_id,role,status,permissions_json,invited_by_account_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daga_accounts WHERE id=?) AND EXISTS (SELECT 1 FROM daga_store_invitations WHERE id=? AND status='accepted' AND accepted_by_account_id=? AND use_count=1)")
        .bind(membershipId, invite.store_id, accountId, invite.intended_role, "active", invite.permissions_json || "{}", invite.inviter_account_id, now, now, accountId, invite.id, accountId),
      db.prepare("INSERT INTO daga_auth_sessions (id,account_id,token_hash,created_at,expires_at,last_seen_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daga_store_memberships WHERE id=? AND account_id=?)")
        .bind(sessionId, accountId, sessionHash, now, sessionExpires, now, membershipId, accountId),
      db.prepare("INSERT INTO daga_security_events (id,account_id,event_type,outcome,details_json) SELECT ?,?,'company_invitation_accepted','success',? WHERE EXISTS (SELECT 1 FROM daga_store_memberships WHERE id=? AND account_id=?)")
        .bind(crypto.randomUUID(), accountId, JSON.stringify({ storeId: invite.store_id, role: invite.intended_role }), membershipId, accountId)
    ]);
  } catch (_) {
    return json(env, { error: "account_registration_conflict_or_failed" }, 409);
  }
  if (Number(results?.[2]?.meta?.changes || 0) !== 1 ||
      Number(results?.[3]?.meta?.changes || 0) !== 1 ||
      Number(results?.[4]?.meta?.changes || 0) !== 1 ||
      Number(results?.[5]?.meta?.changes || 0) !== 1) {
    return json(env, { error: "registration_race_or_conflict_retry" }, 409);
  }
  await audit(db, accountId, "company_invitation_accepted", invite.id, { storeId: invite.store_id, role: invite.intended_role });
  return json(env, { ok: true, account: { id: accountId, publicId, displayName, role: invite.intended_role, phoneMasked: maskCompanyPhone(phone), emailMasked: maskCompanyEmail(email) }, membership: { id: membershipId, companyPublicId: null, role: invite.intended_role, status: "active" }, sessionToken, expiresAt: sessionExpires, nextStep: "complete" }, 201);
}

async function companyRateLimit(db, env, key, limit, windowSeconds) {
  const hashed = await sha256(key + ":" + env.DAGA_OTP_PEPPER);
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("INSERT INTO daga_auth_rate_limits (bucket_key,window_started_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN ? ELSE daga_auth_rate_limits.window_started_at END, attempts=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN 1 ELSE daga_auth_rate_limits.attempts+1 END WHERE ? - daga_auth_rate_limits.window_started_at >= ? OR daga_auth_rate_limits.attempts < ? RETURNING attempts")
    .bind(hashed, now, now, windowSeconds, now, now, windowSeconds, now, windowSeconds, limit).first();
  return Boolean(row);
}
async function companySendSms(env, phone, message) {
  const body = new URLSearchParams({ To: phone, From: env.TWILIO_FROM_NUMBER, Body: message });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(env.TWILIO_ACCOUNT_SID) + "/Messages.json", {
    method: "POST", headers: { Authorization: "Basic " + btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN), "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("sms_delivery_failed");
}
async function companySendEmail(env, email, subject, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.DAGA_EMAIL_FROM, to: [email], subject, html }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("email_delivery_failed");
}
function companyDigits() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
function companyRandomToken(size) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function normalizeCompanyPhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (/^01\d{9}$/.test(digits)) return "+20" + digits.slice(1);
  if (/^\+?20\d{10}$/.test(digits)) return digits.startsWith("+") ? digits : "+" + digits;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
}
function maskCompanyPhone(value) { const s = String(value || ""); return s.length > 5 ? s.slice(0, 4) + "••••" + s.slice(-2) : "••••"; }
function maskCompanyEmail(value) { const [u, d] = String(value || "").split("@"); return u && d ? u.slice(0, 2) + "•••@" + d : "••••"; }
function constantTimeEqualCompany(a, b) { const x = String(a), y = String(b); let diff = x.length ^ y.length; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i % (x.length || 1)) || 0) ^ (y.charCodeAt(i % (y.length || 1)) || 0); return diff === 0; }


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
  const base = trustedBaseUrl(env.DAGA_APP_BASE_URL);
  if (!base) return json(env, { error: "trusted_app_base_url_not_configured" }, 503);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3600000).toISOString();
  await db.prepare("INSERT INTO daga_store_invitations (id,store_id,inviter_account_id,token_hash,intended_role,permissions_json,status,expires_at,max_uses,use_count) VALUES (?,?,?,?,?,?,'pending',?,1,0)")
    .bind(id, store.id, account.id, tokenHash, intendedRole, JSON.stringify(permissions), expiresAt).run();
  await audit(db, account.id, "company_invitation_created", id, { storeId: store.id, role: intendedRole, expiresAt });
  const inviteUrl = base + "/invite/?token=" + encodeURIComponent(token);
  return json(env, { ok: true, invitation: { id, companyPublicId: store.public_id || null, role: intendedRole, expiresAt, maxUses: 1, inviteUrl, token } }, 201);
}

async function listInvitations(url, db, account) {
  const storeId = String(url.searchParams.get("storeId") || "").trim();
  if (!storeId) return json(null, { error: "storeId_required" }, 400);
  const store = await db.prepare("SELECT id,owner_account_id,status FROM daga_stores WHERE id=?").bind(storeId).first();
  const authority = store && store.status === "approved" ? await getAuthority(db, account, store) : null;
  if (!authority) return json(null, { error: "company_not_found_or_access_denied" }, 404);
  if (authority.role === "manager" && !authority.permissions.inviteEmployees) return json(null, { error: "manager_invitation_permission_disabled" }, 403);
  const query = authority.role === "manager"
    ? db.prepare("SELECT id,intended_role,status,expires_at,max_uses,use_count,created_at,accepted_at,revoked_at FROM daga_store_invitations WHERE store_id=? AND inviter_account_id=? ORDER BY created_at DESC LIMIT 100").bind(storeId, account.id)
    : db.prepare("SELECT id,intended_role,status,expires_at,max_uses,use_count,created_at,accepted_at,revoked_at FROM daga_store_invitations WHERE store_id=? ORDER BY created_at DESC LIMIT 100").bind(storeId);
  const rows = await query.all();
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
  const insert = db.prepare("INSERT INTO daga_store_memberships (id,store_id,account_id,role,status,permissions_json,invited_by_account_id,created_at,updated_at) SELECT ?,i.store_id,?,i.intended_role,'active',i.permissions_json,i.inviter_account_id,?,? FROM daga_store_invitations i WHERE i.id=? AND i.status='accepted' AND i.accepted_by_account_id=? AND i.use_count=1 AND NOT EXISTS (SELECT 1 FROM daga_store_memberships m WHERE m.store_id=i.store_id AND m.account_id=?)")
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
  if (!authority || (authority.role === "manager" && (!authority.permissions.inviteEmployees || invite.intended_role !== "employee" || invite.inviter_account_id !== account.id))) {
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
  let stored = {};
  try { stored = JSON.parse(membership.permissions_json || "{}"); } catch (_) {}
  const permissions = {};
  for (const key of ["inviteEmployees", "manageInventory", "viewReports"]) permissions[key] = Boolean(stored && stored[key] === true);
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
