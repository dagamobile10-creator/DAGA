const OWNER_ROLE = "program_owner";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const OTP_TTL_SECONDS = 10 * 60;
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers Web Crypto supports at most 100000 iterations

export async function handleOwnerAuth(request, env, url) {
  const routes = new Set([
    "/owner/bootstrap/start", "/owner/bootstrap/verify",
    "/owner/auth/login", "/owner/auth/me", "/owner/auth/logout", "/owner/recovery/start", "/owner/recovery/complete"
  ]);
  if (!routes.has(url.pathname)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (url.pathname.endsWith("/me") && request.method === "GET") return ownerMe(request, env);
  if (url.pathname.endsWith("/logout") && request.method === "POST") return ownerLogout(request, env);
  if (url.pathname === "/owner/recovery/start" && request.method === "POST") return recoveryStart(request, env);
  if (url.pathname === "/owner/recovery/complete" && request.method === "POST") return recoveryComplete(request, env);
  if (url.pathname.endsWith("/start") && request.method === "POST") return bootstrapStart(request, env);
  if (url.pathname.endsWith("/verify") && request.method === "POST") return bootstrapVerify(request, env);
  if (url.pathname.endsWith("/login") && request.method === "POST") return ownerLogin(request, env);
  return json(env, { error: "method_not_allowed" }, 405);
}

async function bootstrapStart(request,env){
const db=env.DAGA_APP_DB;if(!db)return json(env,{error:"owner_auth_database_not_configured"},503);
if(!env.DAGA_OWNER_BOOTSTRAP_TOKEN||!env.DAGA_OTP_PEPPER||!env.RESEND_API_KEY||!env.DAGA_EMAIL_FROM)return json(env,{error:"owner_auth_not_configured"},503);
const auth=request.headers.get("Authorization")||"";if(!constantTimeEqual(auth,"Bearer "+env.DAGA_OWNER_BOOTSTRAP_TOKEN)){await audit(db,null,"owner_bootstrap_start","failure");return json(env,{error:"unauthorized"},401);}
if(await db.prepare("SELECT singleton_id FROM daga_program_owner WHERE singleton_id=1").first())return json(env,{error:"owner_already_provisioned"},409);
const body=await safeJson(request);if(!body)return json(env,{error:"invalid_json"},400);
const email=String(body.email||"").trim().toLowerCase();if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(env,{error:"valid_email_required"},400);
if(!await rateLimit(db,env,"bootstrap:"+(request.headers.get("CF-Connecting-IP")||"unknown"),3,3600))return json(env,{error:"rate_limited"},429);
if(await db.prepare("SELECT id FROM daga_accounts WHERE lower(email)=? LIMIT 1").bind(email).first())return json(env,{error:"owner_email_already_in_use"},409);
const id=crypto.randomUUID(),code=randomDigits(),now=Math.floor(Date.now()/1000),[codeHash,destHash]=await Promise.all([sha256(id+":"+code+":"+env.DAGA_OTP_PEPPER),sha256("email:"+email)]),expires=new Date((now+OTP_TTL_SECONDS)*1000).toISOString();
await db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,NULL,'owner_bootstrap_email',?,?,?)").bind(id,destHash,codeHash,expires).run();
try{await sendEmail(env,email,"DAGA owner verification","<p>Your DAGA owner verification code is <strong>"+code+"</strong>.</p><p>It expires in 10 minutes.</p>");}catch(_){await db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json(env,{error:"verification_delivery_failed"},502);}
await audit(db,null,"owner_bootstrap_start","success");return json(env,{ok:true,emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}
async function bootstrapVerify(request,env){
const db=env.DAGA_APP_DB;if(!db)return json(env,{error:"owner_auth_database_not_configured"},503);if(!env.DAGA_OTP_PEPPER)return json(env,{error:"owner_auth_not_configured"},503);
const auth=request.headers.get("Authorization")||"";if(!env.DAGA_OWNER_BOOTSTRAP_TOKEN||!constantTimeEqual(auth,"Bearer "+env.DAGA_OWNER_BOOTSTRAP_TOKEN))return json(env,{error:"unauthorized"},401);
if(await db.prepare("SELECT singleton_id FROM daga_program_owner WHERE singleton_id=1").first())return json(env,{error:"owner_already_provisioned"},409);
const body=await safeJson(request);if(!body)return json(env,{error:"invalid_json"},400);
const email=String(body.email||"").trim().toLowerCase(),code=String(body.emailCode||"").trim(),password=String(body.password||""),recovery=String(body.recoveryCode||"");
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(code))return json(env,{error:"valid_email_and_verification_code_required"},400);
if(!validPassword(password))return json(env,{error:"password_must_be_14_to_128_chars_with_uppercase_lowercase_and_number"},400);
if(recovery.length<20||recovery.length>128)return json(env,{error:"new_recovery_code_required_20_to_128_chars"},400);
if(await db.prepare("SELECT id FROM daga_accounts WHERE lower(email)=? LIMIT 1").bind(email).first())return json(env,{error:"owner_email_already_in_use"},409);
if(!await consumeChallenge(db,env,"owner_bootstrap_email",await sha256("email:"+email),code))return json(env,{error:"invalid_expired_or_used_verification_code"},400);
const id=crypto.randomUUID(),salt=randomToken(24),passwordHash=await derivePassword(password,salt,PBKDF2_ITERATIONS),recoveryHash=await sha256(recovery+":"+env.DAGA_OTP_PEPPER),now=new Date().toISOString();
try{await db.batch([
db.prepare("INSERT INTO daga_accounts (id,email,display_name,role,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,'approved',?,?,?)").bind(id,email,"DAGA Program Owner",OWNER_ROLE,now,now,now),
db.prepare("INSERT INTO daga_program_owner (singleton_id,account_id) VALUES (1,?)").bind(id),
db.prepare("INSERT INTO daga_owner_credentials (account_id,password_hash,password_salt,password_iterations,recovery_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id,passwordHash,salt,PBKDF2_ITERATIONS,recoveryHash,now,now),
db.prepare("INSERT INTO daga_owner_bootstrap_state (singleton_id,consumed_at,consumed_account_id) VALUES (1,?,?)").bind(now,id)
]);}catch(error){console.error("owner_provisioning_batch_failed",error instanceof Error?error.message:"unknown_error");return json(env,{error:"owner_provisioning_failed",...(new URL(request.url).hostname==="daga-app-staging.dagamobile10.workers.dev"?{diagnostic:error instanceof Error?error.message.slice(0,200):"unknown_error"}:{})},409);}
await db.batch([db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE purpose='owner_bootstrap_email' AND consumed_at IS NULL").bind(now),db.prepare("INSERT INTO daga_security_events (id,account_id,event_type,outcome) VALUES (?,?,?,'success')").bind(crypto.randomUUID(),id,"owner_provisioned")]);
const session=await createSession(db,id);return json(env,{ok:true,account:{id,role:OWNER_ROLE,emailMasked:maskEmail(email)},sessionToken:session.token,expiresAt:session.expiresAt,recoveryCodeReminder:"Store the recovery code offline. It is never shown again."});
}
async function recoveryStart(request,env){
const db=env.DAGA_APP_DB;if(!db||!env.RESEND_API_KEY||!env.DAGA_EMAIL_FROM||!env.DAGA_OTP_PEPPER)return json(env,{error:"owner_recovery_not_configured"},503);
const owner=await db.prepare("SELECT a.id,a.email FROM daga_program_owner o JOIN daga_accounts a ON a.id=o.account_id WHERE o.singleton_id=1 AND a.status='approved'").first();if(!owner)return json(env,{error:"owner_not_provisioned"},409);
const ip=request.headers.get("CF-Connecting-IP")||"unknown";if(!await rateLimit(db,env,"recovery:"+ip,3,3600)||!await rateLimit(db,env,"recovery-destination:"+await sha256(owner.email),3,3600))return json(env,{error:"rate_limited"},429);
const id=crypto.randomUUID(),code=randomDigits(),now=Math.floor(Date.now()/1000),[hash,destHash]=await Promise.all([sha256(id+":"+code+":"+env.DAGA_OTP_PEPPER),sha256("email:"+String(owner.email).toLowerCase())]),expires=new Date((now+OTP_TTL_SECONDS)*1000).toISOString();
await db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,?,'password_reset',?,?,?)").bind(id,owner.id,destHash,hash,expires).run();
try{await sendEmail(env,owner.email,"DAGA account recovery","<p>Your DAGA recovery code is <strong>"+code+"</strong>.</p><p>It expires in 10 minutes.</p>");}catch(_){await db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json(env,{error:"verification_delivery_failed"},502);}
return json(env,{ok:true,emailMasked:maskEmail(owner.email),expiresInSeconds:OTP_TTL_SECONDS});
}
async function recoveryComplete(request,env){
const db=env.DAGA_APP_DB;if(!db||!env.DAGA_OTP_PEPPER)return json(env,{error:"owner_recovery_not_configured"},503);
const body=await safeJson(request);if(!body)return json(env,{error:"invalid_json"},400);
const code=String(body.emailCode||"").trim(),oldRecovery=String(body.recoveryCode||""),newRecovery=String(body.newRecoveryCode||""),password=String(body.newPassword||"");
if(!/^\d{6}$/.test(code)||oldRecovery.length<20||oldRecovery.length>128||newRecovery.length<20||newRecovery.length>128||!validPassword(password))return json(env,{error:"valid_recovery_fields_required"},400);
const owner=await db.prepare("SELECT a.id,a.email,c.recovery_code_hash FROM daga_program_owner o JOIN daga_accounts a ON a.id=o.account_id JOIN daga_owner_credentials c ON c.account_id=a.id WHERE o.singleton_id=1 AND a.status='approved'").first();if(!owner)return json(env,{error:"owner_not_provisioned"},409);
if(!await rateLimit(db,env,"recovery-complete:"+(request.headers.get("CF-Connecting-IP")||"unknown"),5,3600))return json(env,{error:"rate_limited"},429);
const oldHash=await sha256(oldRecovery+":"+env.DAGA_OTP_PEPPER);
if(!owner.recovery_code_hash||!constantTimeEqual(oldHash,owner.recovery_code_hash))return json(env,{error:"invalid_expired_or_used_recovery_credentials"},400);
const verified=await consumeChallenge(db,env,"password_reset",await sha256("email:"+String(owner.email).toLowerCase()),code);
if(!verified)return json(env,{error:"invalid_expired_or_used_recovery_credentials"},400);
const salt=randomToken(24),hash=await derivePassword(password,salt,PBKDF2_ITERATIONS),newHash=await sha256(newRecovery+":"+env.DAGA_OTP_PEPPER),now=new Date().toISOString();
await db.batch([db.prepare("UPDATE daga_owner_credentials SET password_hash=?,password_salt=?,password_iterations=?,recovery_code_hash=?,updated_at=? WHERE account_id=?").bind(hash,salt,PBKDF2_ITERATIONS,newHash,now,owner.id),db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").bind(now,owner.id),db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE account_id=? AND purpose='password_reset' AND consumed_at IS NULL").bind(now,owner.id)]);
return json(env,{ok:true,message:"Password reset. Log in again with the new password."});
}
async function ownerLogin(request,env){
const db=env.DAGA_APP_DB;if(!db||!env.DAGA_OTP_PEPPER)return json(env,{error:"owner_auth_not_configured"},503);
const body=await safeJson(request);if(!body)return json(env,{error:"invalid_json"},400);
const email=String(body.email||body.identifier||"").trim().toLowerCase(),password=String(body.password||"");
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length>128)return json(env,{error:"invalid_credentials"},401);
if(!await rateLimit(db,env,"login:"+email+":"+(request.headers.get("CF-Connecting-IP")||"unknown"),8,900))return json(env,{error:"rate_limited"},429);
const account=await db.prepare("SELECT a.id,a.role,a.status,a.email,c.password_hash,c.password_salt,c.password_iterations FROM daga_accounts a JOIN daga_program_owner o ON o.account_id=a.id JOIN daga_owner_credentials c ON c.account_id=a.id WHERE o.singleton_id=1 AND lower(a.email)=? LIMIT 1").bind(email).first();
if(!account||account.role!==OWNER_ROLE||account.status!=="approved")return json(env,{error:"invalid_credentials"},401);
const attempt=await derivePassword(password,account.password_salt,account.password_iterations);if(!constantTimeEqual(attempt,account.password_hash))return json(env,{error:"invalid_credentials"},401);
const session=await createSession(db,account.id);await audit(db,account.id,"owner_login","success");
return json(env,{ok:true,account:{id:account.id,role:account.role,emailMasked:maskEmail(account.email)},sessionToken:session.token,expiresAt:session.expiresAt});
}
function validPassword(password){return password.length>=14&&password.length<=128&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/\d/.test(password);}

async function ownerMe(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_not_configured" }, 503);
  const account = await authenticatedOwner(request, db);
  if (!account) return json(env, { error: "unauthorized" }, 401);
  return json(env, { ok: true, account: { id: account.id, role: account.role, emailMasked: maskEmail(account.email) } });
}

async function ownerLogout(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_not_configured" }, 503);
  const token = bearer(request);
  if (!token) return json(env, { error: "unauthorized" }, 401);
  await db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), await sha256(token)).run();
  return json(env, { ok: true });
}

export async function authenticatedAccount(request, db) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare("SELECT a.id,a.public_id,a.display_name,a.role,a.status,a.email,a.store_id,s.expires_at FROM daga_auth_sessions s JOIN daga_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.status='approved' LIMIT 1")
    .bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE daga_auth_sessions SET last_seen_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), tokenHash).run();
  return row;
}

export async function authenticatedOwner(request, db) {
  const token = bearer(request);
  if (!token) return null;
  const row = await db.prepare("SELECT a.id,a.role,a.status,a.email,s.expires_at FROM daga_auth_sessions s JOIN daga_accounts a ON a.id=s.account_id JOIN daga_program_owner o ON o.account_id=a.id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.role='program_owner' AND a.status='approved' AND o.singleton_id=1 LIMIT 1")
    .bind(await sha256(token), new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE daga_auth_sessions SET last_seen_at=? WHERE token_hash=?").bind(new Date().toISOString(), await sha256(token)).run();
  return row;
}

async function createSession(db, accountId) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare("INSERT INTO daga_auth_sessions (id,account_id,token_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), accountId, await sha256(token), now.toISOString(), expires, now.toISOString()).run();
  return { token, expiresAt: expires };
}

async function consumeChallenge(db, env, purpose, destinationHash, code) {
  const row = await db.prepare("SELECT id,code_hash FROM daga_auth_challenges WHERE purpose=? AND destination_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY rowid DESC LIMIT 1")
    .bind(purpose, destinationHash, new Date().toISOString()).first();
  if (!row) return false;
  const claimed = await db.prepare("UPDATE daga_auth_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts")
    .bind(row.id, new Date().toISOString()).first();
  if (!claimed) return false;
  const expected = await sha256(row.id + ":" + code + ":" + env.DAGA_OTP_PEPPER);
  if (!constantTimeEqual(expected, row.code_hash)) return false;
  const updated = await db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<=5 AND expires_at>?")
    .bind(new Date().toISOString(), row.id, new Date().toISOString()).run();
  return (updated?.meta?.changes || 0) === 1;
}

async function rateLimit(db, env, key, limit, windowSeconds) {
  const hashed = await sha256(key + ":" + (env.DAGA_OTP_PEPPER || env.DAGA_OWNER_BOOTSTRAP_TOKEN || "daga-rate-limit"));
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("INSERT INTO daga_auth_rate_limits (bucket_key,window_started_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN ? ELSE daga_auth_rate_limits.window_started_at END, attempts=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN 1 ELSE daga_auth_rate_limits.attempts+1 END WHERE ? - daga_auth_rate_limits.window_started_at >= ? OR daga_auth_rate_limits.attempts < ? RETURNING attempts,window_started_at")
    .bind(hashed,now,now,windowSeconds,now,now,windowSeconds,now,windowSeconds,limit).first();
  return Boolean(row);
}

async function sendEmail(env, email, subject, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.DAGA_EMAIL_FROM, to: [email], subject, html }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("email_delivery_failed");
}

async function audit(db, accountId, type, outcome) {
  try {
    await db.prepare("INSERT INTO daga_security_events (id,account_id,event_type,outcome) VALUES (?,?,?,?)").bind(crypto.randomUUID(), accountId, type, outcome).run();
  } catch (_) {}
}
async function derivePassword(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
function bytesToHex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomDigits() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
function randomToken(size) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function bearer(request) { const value = request.headers.get("Authorization") || ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }
function maskEmail(value) { const [u, d] = String(value || "").split("@"); return u && d ? u.slice(0, 2) + "•••@" + d : "••••"; }
function constantTimeEqual(a, b) { const x = String(a), y = String(b); let diff = x.length ^ y.length; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i % (x.length || 1)) || 0) ^ (y.charCodeAt(i % (y.length || 1)) || 0); return diff === 0; }
async function safeJson(request) { try { return await request.json(); } catch (_) { return null; } }
function json(env, data, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors(env, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) }); }
function cors(env, extra = {}) {
  const allowed = String(env.DAGA_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const origin = allowed.includes("*") ? "*" : allowed.length === 1 ? allowed[0] : allowed.includes("null") ? "null" : "";
  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600", "Vary": "Origin", ...extra };
}
