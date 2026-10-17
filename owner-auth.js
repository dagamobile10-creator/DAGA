const OWNER_ROLE = "program_owner";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const OTP_TTL_SECONDS = 10 * 60;
const PBKDF2_ITERATIONS = 310000;

export async function handleOwnerAuth(request, env, url) {
  const routes = new Set([
    "/owner/bootstrap/start", "/owner/bootstrap/verify",
    "/owner/auth/login", "/owner/auth/login/verify", "/owner/auth/me", "/owner/auth/logout", "/owner/recovery/start", "/owner/recovery/complete"
  ]);
  if (!routes.has(url.pathname)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (url.pathname === "/owner/auth/login/verify" && request.method === "POST") return ownerLoginVerify(request, env);
  if (url.pathname.endsWith("/me") && request.method === "GET") return ownerMe(request, env);
  if (url.pathname.endsWith("/logout") && request.method === "POST") return ownerLogout(request, env);
  if (url.pathname === "/owner/recovery/start" && request.method === "POST") return recoveryStart(request, env);
  if (url.pathname === "/owner/recovery/complete" && request.method === "POST") return recoveryComplete(request, env);
  if (url.pathname.endsWith("/start") && request.method === "POST") return bootstrapStart(request, env);
  if (url.pathname.endsWith("/verify") && request.method === "POST") return bootstrapVerify(request, env);
  if (url.pathname.endsWith("/login") && request.method === "POST") return ownerLogin(request, env);
  return json(env, { error: "method_not_allowed" }, 405);
}

async function bootstrapStart(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_database_not_configured" }, 503);
  const required = ["DAGA_OWNER_BOOTSTRAP_TOKEN", "DAGA_OWNER_PHONE", "DAGA_OWNER_EMAIL",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "DAGA_EMAIL_FROM", "DAGA_OTP_PEPPER"];
  if (required.some(key => !env[key])) return json(env, { error: "owner_auth_not_configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!constantTimeEqual(auth, "Bearer " + env.DAGA_OWNER_BOOTSTRAP_TOKEN)) {
    await audit(db, null, "owner_bootstrap_start", "failure");
    return json(env, { error: "unauthorized" }, 401);
  }
  const ownerExists = await db.prepare("SELECT singleton_id FROM daga_program_owner WHERE singleton_id=1").first();
  if (ownerExists) return json(env, { error: "owner_already_provisioned" }, 409);
  const content = await safeJson(request);
  if (!content) return json(env, { error: "invalid_json" }, 400);
  const phone = normalizePhone(env.DAGA_OWNER_PHONE);
  const email = String(env.DAGA_OWNER_EMAIL).trim().toLowerCase();
  if (!phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(env, { error: "owner_contact_configuration_invalid" }, 503);

  const limited = await rateLimit(db, env, "bootstrap:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 3, 3600);
  if (!limited) return json(env, { error: "rate_limited" }, 429);
  const now = Math.floor(Date.now() / 1000);
  const phoneCode = randomDigits();
  const emailCode = randomDigits();
  const phoneId = crypto.randomUUID();
  const emailId = crypto.randomUUID();
  const phoneHash = await sha256(phoneId + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER);
  const emailHash = await sha256(emailId + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER);
  const phoneDestHash = await sha256("phone:" + phone);
  const emailDestHash = await sha256("email:" + email);
  const expires = new Date((now + OTP_TTL_SECONDS) * 1000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,NULL,'owner_bootstrap_phone',?,?,?)").bind(phoneId, phoneDestHash, phoneHash, expires),
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,NULL,'owner_bootstrap_email',?,?,?)").bind(emailId, emailDestHash, emailHash, expires)
  ]);
  try {
    await Promise.all([sendSms(env, phone, "DAGA owner verification code: " + phoneCode + ". Expires in 10 minutes."),
      sendEmail(env, email, "DAGA owner verification", "<p>Your DAGA owner verification code is <strong>" + emailCode + "</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>")]);
  } catch (_) {
    await db.batch([
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), phoneId),
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), emailId)
    ]);
    await audit(db, null, "owner_bootstrap_delivery", "failure");
    return json(env, { error: "verification_delivery_failed", detail: "Check SMS/email provider configuration and try again." }, 502);
  }
  await audit(db, null, "owner_bootstrap_start", "success");
  return json(env, { ok: true, phoneMasked: maskPhone(phone), emailMasked: maskEmail(email), expiresInSeconds: OTP_TTL_SECONDS });
}

async function bootstrapVerify(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_database_not_configured" }, 503);
  if (!env.DAGA_OTP_PEPPER) return json(env, { error: "owner_auth_not_configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!env.DAGA_OWNER_BOOTSTRAP_TOKEN || !constantTimeEqual(auth, "Bearer " + env.DAGA_OWNER_BOOTSTRAP_TOKEN)) return json(env, { error: "unauthorized" }, 401);
  const ownerExists = await db.prepare("SELECT singleton_id FROM daga_program_owner WHERE singleton_id=1").first();
  if (ownerExists) return json(env, { error: "owner_already_provisioned" }, 409);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const phoneCode = String(body.phoneCode || "").trim();
  const emailCode = String(body.emailCode || "").trim();
  const password = String(body.password || "");
  const recoveryCode = String(body.recoveryCode || "");
  if (!/^\d{6}$/.test(phoneCode) || !/^\d{6}$/.test(emailCode)) return json(env, { error: "valid_phone_and_email_codes_required" }, 400);
  if (password.length < 14 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return json(env, { error: "password_must_be_14_to_128_chars_with_uppercase_lowercase_and_number" }, 400);
  if (recoveryCode.length < 20 || recoveryCode.length > 128) return json(env, { error: "new_recovery_code_required_20_to_128_chars" }, 400);
  const phone = normalizePhone(env.DAGA_OWNER_PHONE);
  const email = String(env.DAGA_OWNER_EMAIL || "").trim().toLowerCase();
  if (!phone || !email) return json(env, { error: "owner_contact_configuration_invalid" }, 503);
  const [p, e] = await Promise.all([
    consumeChallenge(db, env, "owner_bootstrap_phone", await sha256("phone:" + phone), phoneCode),
    consumeChallenge(db, env, "owner_bootstrap_email", await sha256("email:" + email), emailCode)
  ]);
  if (!p || !e) {
    await audit(db, null, "owner_bootstrap_verify", "failure");
    return json(env, { error: "invalid_expired_or_used_verification_code" }, 400);
  }
  const accountId = crypto.randomUUID();
  const salt = randomToken(24);
  const passwordHash = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  const recoveryHash = await sha256(recoveryCode + ":" + env.DAGA_OTP_PEPPER);
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("INSERT INTO daga_accounts (id,phone_e164,email,display_name,role,status,phone_verified_at,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,'approved',?,?,?,?)")
        .bind(accountId, phone, email, "DAGA Program Owner", OWNER_ROLE, now, now, now, now),
      db.prepare("INSERT INTO daga_program_owner (singleton_id,account_id) VALUES (1,?)").bind(accountId),
      db.prepare("INSERT INTO daga_owner_credentials (account_id,password_hash,password_salt,password_iterations,recovery_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(accountId, passwordHash, salt, PBKDF2_ITERATIONS, recoveryHash, now, now),
      db.prepare("INSERT INTO daga_owner_bootstrap_state (singleton_id,consumed_at,consumed_account_id) VALUES (1,?,?)").bind(now, accountId)
    ]);
  } catch (_) {
    await audit(db, null, "owner_bootstrap_create", "failure");
    return json(env, { error: "owner_provisioning_failed" }, 409);
  }
  await db.batch([
    db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE purpose IN ('owner_bootstrap_phone','owner_bootstrap_email') AND consumed_at IS NULL").bind(now),
    db.prepare("INSERT INTO daga_security_events (id,account_id,event_type,outcome) VALUES (?,?,?,'success')").bind(crypto.randomUUID(), accountId, "owner_provisioned")
  ]);
  const session = await createSession(db, accountId);
  return json(env, { ok: true, account: { id: accountId, role: OWNER_ROLE, phoneMasked: maskPhone(phone), emailMasked: maskEmail(email) }, sessionToken: session.token, expiresAt: session.expiresAt, recoveryCodeReminder: "Store the recovery code offline. It is never shown again." });
}


async function recoveryStart(request, env) {
  const db = env.DAGA_APP_DB;
  const required = ["DAGA_OWNER_PHONE", "DAGA_OWNER_EMAIL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "DAGA_EMAIL_FROM", "DAGA_OTP_PEPPER"];
  if (!db || required.some(key => !env[key])) return json(env, { error: "owner_recovery_not_configured" }, 503);
  const owner = await db.prepare("SELECT a.id FROM daga_program_owner o JOIN daga_accounts a ON a.id=o.account_id WHERE o.singleton_id=1 AND a.status='approved'").first();
  if (!owner) return json(env, { error: "owner_not_provisioned" }, 409);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await rateLimit(db, env, "recovery:" + ip, 3, 3600)) return json(env, { error: "rate_limited" }, 429);
  const phone = normalizePhone(env.DAGA_OWNER_PHONE), email = String(env.DAGA_OWNER_EMAIL).trim().toLowerCase();
  if (!phone || !email) return json(env, { error: "owner_contact_configuration_invalid" }, 503);
  if (!await rateLimit(db, env, "recovery-destination:" + phone, 3, 3600)) return json(env, { error: "rate_limited" }, 429);
  const now = Math.floor(Date.now() / 1000), expires = new Date((now + OTP_TTL_SECONDS) * 1000).toISOString();
  const phoneCode = randomDigits(), emailCode = randomDigits(), phoneId = crypto.randomUUID(), emailId = crypto.randomUUID();
  const [phoneHash,emailHash,phoneDest,emailDest] = await Promise.all([
    sha256(phoneId + ":" + phoneCode + ":" + env.DAGA_OTP_PEPPER), sha256(emailId + ":" + emailCode + ":" + env.DAGA_OTP_PEPPER),
    sha256("phone:" + phone), sha256("email:" + email)
  ]);
  await db.batch([
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,?, 'password_reset',?,?,?)").bind(phoneId,owner.id,phoneDest,phoneHash,expires),
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,?, 'password_reset',?,?,?)").bind(emailId,owner.id,emailDest,emailHash,expires)
  ]);
  try {
    await Promise.all([sendSms(env,phone,"DAGA account recovery code: "+phoneCode+". Expires in 10 minutes."),
      sendEmail(env,email,"DAGA account recovery","<p>Your DAGA account recovery code is <strong>"+emailCode+"</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>")]);
  } catch (_) {
    await db.batch([
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),phoneId),
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),emailId)
    ]);
    return json(env,{error:"verification_delivery_failed"},502);
  }
  await audit(db,owner.id,"owner_recovery_start","success");
  return json(env,{ok:true,phoneMasked:maskPhone(phone),emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}

async function recoveryComplete(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db || !env.DAGA_OTP_PEPPER) return json(env,{error:"owner_recovery_not_configured"},503);
  const body = await safeJson(request);
  if (!body) return json(env,{error:"invalid_json"},400);
  const phoneCode=String(body.phoneCode||"").trim(), emailCode=String(body.emailCode||"").trim();
  const recoveryCode=String(body.recoveryCode||""), newRecoveryCode=String(body.newRecoveryCode||""), newPassword=String(body.newPassword||"");
  if (!/^\\d{6}$/.test(phoneCode)||!/^\\d{6}$/.test(emailCode)||recoveryCode.length<20||recoveryCode.length>128||newRecoveryCode.length<20||newRecoveryCode.length>128) return json(env,{error:"valid_codes_and_current_and_new_recovery_codes_required"},400);
  if (newPassword.length<14||newPassword.length>128||!/[a-z]/.test(newPassword)||!/[A-Z]/.test(newPassword)||!/\\d/.test(newPassword)) return json(env,{error:"password_must_be_14_to_128_chars_with_uppercase_lowercase_and_number"},400);
  const owner=await db.prepare("SELECT a.id,a.phone_e164,a.email,c.recovery_code_hash FROM daga_program_owner o JOIN daga_accounts a ON a.id=o.account_id JOIN daga_owner_credentials c ON c.account_id=a.id WHERE o.singleton_id=1 AND a.status='approved'").first();
  if (!owner) return json(env,{error:"owner_not_provisioned"},409);
  if (!await rateLimit(db,env,"recovery-complete:"+(request.headers.get("CF-Connecting-IP")||"unknown"),5,3600)) return json(env,{error:"rate_limited"},429);
  const [p,e,recoveryHash]=await Promise.all([
    consumeChallenge(db,env,"password_reset",await sha256("phone:"+owner.phone_e164),phoneCode),
    consumeChallenge(db,env,"password_reset",await sha256("email:"+String(owner.email).toLowerCase()),emailCode),
    sha256(recoveryCode+":"+env.DAGA_OTP_PEPPER)
  ]);
  if (!p||!e||!owner.recovery_code_hash||!constantTimeEqual(recoveryHash,owner.recovery_code_hash)) {
    await audit(db,owner.id,"owner_recovery_complete","failure");
    return json(env,{error:"invalid_expired_or_used_recovery_credentials"},400);
  }
  const salt=randomToken(24), hash=await derivePassword(newPassword,salt,PBKDF2_ITERATIONS), newRecoveryHash=await sha256(newRecoveryCode+":"+env.DAGA_OTP_PEPPER), now=new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE daga_owner_credentials SET password_hash=?,password_salt=?,password_iterations=?,recovery_code_hash=?,updated_at=? WHERE account_id=?").bind(hash,salt,PBKDF2_ITERATIONS,newRecoveryHash,now,owner.id),
    db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").bind(now,owner.id),
    db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE account_id=? AND purpose='password_reset' AND consumed_at IS NULL").bind(now,owner.id)
  ]);
  await audit(db,owner.id,"owner_recovery_complete","success");
  return json(env,{ok:true,message:"Password reset. Log in again with the new password."});
}

async function ownerLogin(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db || !env.DAGA_OTP_PEPPER) return json(env, { error: "owner_auth_not_configured" }, 503);
  const body = await safeJson(request);
  if (!body) return json(env, { error: "invalid_json" }, 400);
  const identifier = String(body.identifier || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!identifier || password.length > 128) return json(env, { error: "invalid_credentials" }, 401);
  if (!await rateLimit(db, env, "login:" + identifier + ":" + (request.headers.get("CF-Connecting-IP") || "unknown"), 8, 900)) return json(env, { error: "rate_limited" }, 429);
  const account = await db.prepare("SELECT a.id,a.role,a.status,a.phone_e164,a.email,c.password_hash,c.password_salt,c.password_iterations FROM daga_accounts a JOIN daga_program_owner o ON o.account_id=a.id JOIN daga_owner_credentials c ON c.account_id=a.id WHERE o.singleton_id=1 AND (lower(a.email)=? OR a.phone_e164=?) LIMIT 1")
    .bind(identifier, normalizePhone(identifier) || identifier).first();
  if (!account || account.role !== OWNER_ROLE || account.status !== "approved") {
    await audit(db, null, "owner_login", "failure");
    return json(env, { error: "invalid_credentials" }, 401);
  }
  const attempt = await derivePassword(password, account.password_salt, account.password_iterations);
  if (!constantTimeEqual(attempt, account.password_hash)) {
    await audit(db, account.id, "owner_login", "failure");
    return json(env, { error: "invalid_credentials" }, 401);
  }
  const phone = normalizePhone(env.DAGA_OWNER_PHONE || account.phone_e164);
  const email = String(env.DAGA_OWNER_EMAIL || account.email).trim().toLowerCase();
  if (!phone || !email || phone !== account.phone_e164 || email !== String(account.email).toLowerCase()) return json(env,{error:"owner_contact_configuration_mismatch"},503);
  const now=Math.floor(Date.now()/1000), expires=new Date((now+OTP_TTL_SECONDS)*1000).toISOString();
  const phoneCode=randomDigits(), emailCode=randomDigits(), phoneId=crypto.randomUUID(), emailId=crypto.randomUUID();
  const [phoneHash,emailHash,phoneDest,emailDest]=await Promise.all([
    sha256(phoneId+":"+phoneCode+":"+env.DAGA_OTP_PEPPER),sha256(emailId+":"+emailCode+":"+env.DAGA_OTP_PEPPER),
    sha256("phone:"+phone),sha256("email:"+email)
  ]);
  await db.batch([
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,?,'login_phone',?,?,?)").bind(phoneId,account.id,phoneDest,phoneHash,expires),
    db.prepare("INSERT INTO daga_auth_challenges (id,account_id,purpose,destination_hash,code_hash,expires_at) VALUES (?,?,'login_email',?,?,?)").bind(emailId,account.id,emailDest,emailHash,expires)
  ]);
  try {
    await Promise.all([sendSms(env,phone,"DAGA login verification code: "+phoneCode+". Expires in 10 minutes."),
      sendEmail(env,email,"DAGA login verification","<p>Your DAGA sign-in code is <strong>"+emailCode+"</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>")]);
  } catch (_) {
    await db.batch([
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),phoneId),
      db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),emailId)
    ]);
    return json(env,{error:"verification_delivery_failed"},502);
  }
  await audit(db,account.id,"owner_login_otp_sent","success");
  return json(env,{ok:true,requiresVerification:true,phoneMasked:maskPhone(phone),emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}

async function ownerLoginVerify(request,env) {
  const db=env.DAGA_APP_DB;
  if(!db||!env.DAGA_OTP_PEPPER)return json(env,{error:"owner_auth_not_configured"},503);
  const body=await safeJson(request);if(!body)return json(env,{error:"invalid_json"},400);
  const phoneCode=String(body.phoneCode||"").trim(),emailCode=String(body.emailCode||"").trim();
  if(!/^\\d{6}$/.test(phoneCode)||!/^\\d{6}$/.test(emailCode))return json(env,{error:"valid_phone_and_email_codes_required"},400);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  if(!await rateLimit(db,env,"login-verify:"+ip,8,900))return json(env,{error:"rate_limited"},429);
  const owner=await db.prepare("SELECT a.id,a.role,a.status,a.phone_e164,a.email FROM daga_program_owner o JOIN daga_accounts a ON a.id=o.account_id WHERE o.singleton_id=1").first();
  if(!owner||owner.role!==OWNER_ROLE||owner.status!=="approved")return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  const [p,e]=await Promise.all([
    consumeChallenge(db,env,"login_phone",await sha256("phone:"+owner.phone_e164),phoneCode),
    consumeChallenge(db,env,"login_email",await sha256("email:"+String(owner.email).toLowerCase()),emailCode)
  ]);
  if(!p||!e){await audit(db,owner.id,"owner_login_otp_verify","failure");return json(env,{error:"invalid_expired_or_used_verification_code"},400);}
  const session=await createSession(db,owner.id);
  await audit(db,owner.id,"owner_login","success");
  return json(env,{ok:true,account:{id:owner.id,role:owner.role,phoneMasked:maskPhone(owner.phone_e164),emailMasked:maskEmail(owner.email)},sessionToken:session.token,expiresAt:session.expiresAt});
}

async function ownerMe(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_not_configured" }, 503);
  const account = await authenticatedOwner(request, db);
  if (!account) return json(env, { error: "unauthorized" }, 401);
  return json(env, { ok: true, account: { id: account.id, role: account.role, phoneMasked: maskPhone(account.phone_e164), emailMasked: maskEmail(account.email) } });
}

async function ownerLogout(request, env) {
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "owner_auth_not_configured" }, 503);
  const token = bearer(request);
  if (!token) return json(env, { error: "unauthorized" }, 401);
  await db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), await sha256(token)).run();
  return json(env, { ok: true });
}

export async function authenticatedOwner(request, db) {
  const token = bearer(request);
  if (!token) return null;
  const row = await db.prepare("SELECT a.id,a.role,a.status,a.phone_e164,a.email,s.expires_at FROM daga_auth_sessions s JOIN daga_accounts a ON a.id=s.account_id JOIN daga_program_owner o ON o.account_id=a.id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.role='program_owner' AND a.status='approved' AND o.singleton_id=1 LIMIT 1")
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
  const row = await db.prepare("SELECT id,code_hash,expires_at,attempts,consumed_at FROM daga_auth_challenges WHERE purpose=? AND destination_hash=? ORDER BY rowid DESC LIMIT 1").bind(purpose, destinationHash).first();
  if (!row || row.consumed_at || row.attempts >= 5 || new Date(row.expires_at).getTime() <= Date.now()) return false;
  await db.prepare("UPDATE daga_auth_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL").bind(row.id).run();
  const expected = await sha256(row.id + ":" + code + ":" + env.DAGA_OTP_PEPPER);
  if (!constantTimeEqual(expected, row.code_hash)) return false;
  const updated = await db.prepare("UPDATE daga_auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<=5").bind(new Date().toISOString(), row.id).run();
  return (updated?.meta?.changes || 0) === 1;
}

async function rateLimit(db, env, key, limit, windowSeconds) {
  const hashed = await sha256(key + ":" + (env.DAGA_OTP_PEPPER || env.DAGA_OWNER_BOOTSTRAP_TOKEN || "daga-rate-limit"));
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("SELECT window_started_at,attempts FROM daga_auth_rate_limits WHERE bucket_key=?").bind(hashed).first();
  if (!row || now - row.window_started_at >= windowSeconds) {
    await db.prepare("INSERT INTO daga_auth_rate_limits (bucket_key,window_started_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=1").bind(hashed, now).run();
    return true;
  }
  if (row.attempts >= limit) return false;
  await db.prepare("UPDATE daga_auth_rate_limits SET attempts=attempts+1 WHERE bucket_key=?").bind(hashed).run();
  return true;
}

async function sendSms(env, phone, message) {
  const body = new URLSearchParams({ To: phone, From: env.TWILIO_FROM_NUMBER, Body: message });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(env.TWILIO_ACCOUNT_SID) + "/Messages.json", {
    method: "POST", headers: { Authorization: "Basic " + btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN), "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("sms_delivery_failed");
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
function normalizePhone(value) { const digits = String(value || "").replace(/[^\d+]/g, ""); if (/^01\d{9}$/.test(digits)) return "+20" + digits.slice(1); if (/^\+?20\d{10}$/.test(digits)) return digits.startsWith("+") ? digits : "+" + digits; return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : ""; }
function maskPhone(value) { const s = String(value || ""); return s.length > 5 ? s.slice(0, 4) + "••••" + s.slice(-2) : "••••"; }
function maskEmail(value) { const [u, d] = String(value || "").split("@"); return u && d ? u.slice(0, 2) + "•••@" + d : "••••"; }
function constantTimeEqual(a, b) { const x = String(a), y = String(b); let diff = x.length ^ y.length; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i % (x.length || 1)) || 0) ^ (y.charCodeAt(i % (y.length || 1)) || 0); return diff === 0; }
async function safeJson(request) { try { return await request.json(); } catch (_) { return null; } }
function json(env, data, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors(env, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) }); }
function cors(env, extra = {}) {
  const allowed = String(env.DAGA_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const origin = allowed.includes("*") ? "*" : allowed.length === 1 ? allowed[0] : allowed.includes("null") ? "null" : allowed.length === 0 ? "*" : "";
  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600", "Vary": "Origin", ...extra };
}
