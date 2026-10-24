import { authenticatedAccount } from "./owner-auth.js";

const OTP_TTL_SECONDS = 600;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ITERATIONS = 100000;

export async function handleShopAuth(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const routes = new Set([
    "/api/shop/registration/start", "/api/shop/registration/verify",
    "/api/shop/auth/setup/start", "/api/shop/auth/setup/verify",
    "/api/shop/auth/login", "/api/shop/auth/me", "/api/shop/auth/logout", "/api/shop/auth/recovery/start", "/api/shop/auth/recovery/complete"
  ]);
  if (!routes.has(path)) return null;
  if (request.method === "OPTIONS") return new Response(null, {status:204,headers:cors(env)});
  const db = env.DAGA_APP_DB;
  if (!db) return json(env,{error:"application_database_not_configured"},503);
  try {
    if (path === "/api/shop/registration/start" && request.method === "POST") return await registrationStart(request,env,db);
    if (path === "/api/shop/registration/verify" && request.method === "POST") return await registrationVerify(request,env,db);
    if (path === "/api/shop/auth/setup/start" && request.method === "POST") return await setupStart(request,env,db);
    if (path === "/api/shop/auth/setup/verify" && request.method === "POST") return await setupVerify(request,env,db);
    if (path === "/api/shop/auth/login" && request.method === "POST") return await login(request,env,db);
    if (path === "/api/shop/auth/recovery/start" && request.method === "POST") return await recoveryStart(request,env,db);
    if (path === "/api/shop/auth/recovery/complete" && request.method === "POST") return await recoveryComplete(request,env,db);
    if (path === "/api/shop/auth/me" && request.method === "GET") return await me(request,env,db);
    if (path === "/api/shop/auth/logout" && request.method === "POST") return await logout(request,env,db);
    return json(env,{error:"method_not_allowed"},405);
  } catch (e) {
    console.error("shop_auth_error",path,e instanceof Error?e.name:"unknown");
    return json(env,{error:"shop_auth_operation_failed"},500);
  }
}

async function registrationStart(request,env,db){
  if(!env.DAGA_OTP_PEPPER||!env.RESEND_API_KEY||!env.DAGA_EMAIL_FROM)return json(env,{error:"email_verification_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const name=String(b.shopName||"").trim().slice(0,120),owner=String(b.ownerName||"").trim().slice(0,100),email=normalizeEmail(b.email);
  if(name.length<2||owner.length<2||!validEmail(email))return json(env,{error:"valid_shop_owner_name_and_email_required"},400);
  if(await db.prepare("SELECT id FROM daga_accounts WHERE lower(email)=? LIMIT 1").bind(email).first())return json(env,{error:"account_email_already_exists"},409);
  const code=digits(),id=crypto.randomUUID(),now=new Date(),expires=new Date(now.getTime()+OTP_TTL_SECONDS*1000).toISOString();
  const [codeHash,destinationHash]=await Promise.all([sha(id+":"+code+":"+env.DAGA_OTP_PEPPER),sha("email:"+email)]);
  const internalIdentity="request:"+crypto.randomUUID();
  await db.prepare("INSERT INTO daga_shop_registration_challenges (id,email,owner_name,shop_name,internal_identity,destination_hash,code_hash,expires_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id,email,owner,name,internalIdentity,destinationHash,codeHash,expires).run();
  try { await sendEmail(env,email,"DAGA shop registration verification","<p>Your DAGA shop registration code is <strong>"+code+"</strong>.</p><p>It expires in 10 minutes. The shop remains pending until app-owner approval.</p>"); }
  catch(_){await db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json(env,{error:"verification_delivery_failed"},502);}
  return json(env,{ok:true,emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}

async function registrationVerify(request,env,db){
  if(!env.DAGA_OTP_PEPPER)return json(env,{error:"email_verification_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email),code=String(b.emailCode||"").trim();
  if(!validEmail(email)||!/^[0-9]{6}$/.test(code))return json(env,{error:"valid_email_and_verification_code_required"},400);
  const ch=await db.prepare("SELECT * FROM daga_shop_registration_challenges WHERE lower(email)=? AND internal_identity LIKE 'request:%' AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(email,new Date().toISOString()).first();
  if(!ch)return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  const claimed=await db.prepare("UPDATE daga_shop_registration_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>? RETURNING attempts").bind(ch.id,new Date().toISOString()).first();
  if(!claimed||!same(await sha(ch.id+":"+code+":"+env.DAGA_OTP_PEPPER),ch.code_hash))return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  const now=new Date().toISOString(),accountId=crypto.randomUUID(),storeId=crypto.randomUUID();
  const userPublicId="DAGA-USER-"+accountId.replace(/-/g,"").toUpperCase(),storePublicId="DAGA-SHOP-"+storeId.replace(/-/g,"").toUpperCase();
  const internalIdentity="internal:"+crypto.randomUUID();
  try {
    await db.batch([
      db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL").bind(now,accountId,ch.id),
      db.prepare("INSERT INTO daga_accounts (id,public_id,email,display_name,role,status,store_id,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,'store_owner','pending',?,?,?,?)").bind(accountId,userPublicId,email,ch.owner_name,storeId,now,now,now),
      db.prepare("INSERT INTO daga_stores (id,public_id,owner_account_id,legal_identity,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)").bind(storeId,storePublicId,accountId,internalIdentity,ch.shop_name,now,now)
    ]);
  } catch(_) {return json(env,{error:"shop_registration_conflict"},409);}
  return json(env,{ok:true,status:"pending",message:"تم تأكيد البريد. طلب المحل اتبعت لمالك التطبيق للموافقة المبدئية. هيوصلك تنبيه بعد القرار."},201);
}

async function setupStart(request,env,db){
  if(!env.DAGA_OTP_PEPPER||!env.RESEND_API_KEY||!env.DAGA_EMAIL_FROM)return json(env,{error:"email_verification_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email);if(!validEmail(email))return json(env,{error:"valid_email_required"},400);
  const account=await db.prepare("SELECT id,email,display_name FROM daga_accounts WHERE lower(email)=? AND role='store_owner' AND status='approved' LIMIT 1").bind(email).first();
  if(!account)return json(env,{ok:true,message:"لو الحساب موافق عليه ومحتاج إعداد كلمة مرور، هيوصل كود على البريد."});
  if(await db.prepare("SELECT account_id FROM daga_account_credentials WHERE account_id=?").bind(account.id).first())return json(env,{ok:true,message:"لو الحساب محتاج إعداد، هيوصل كود على البريد."});
  const code=digits(),id=crypto.randomUUID(),expires=new Date(Date.now()+OTP_TTL_SECONDS*1000).toISOString(),[codeHash,destinationHash]=await Promise.all([sha(id+":"+code+":"+env.DAGA_OTP_PEPPER),sha("email:"+email)]);
  await db.prepare("INSERT INTO daga_shop_registration_challenges (id,email,owner_name,shop_name,internal_identity,destination_hash,code_hash,expires_at) VALUES (?,?,?,'__setup__',?,?,?,?)").bind(id,email,account.display_name,"setup:"+account.id,destinationHash,codeHash,expires).run();
  try{await sendEmail(env,email,"DAGA shop account setup","<p>Your DAGA account setup code is <strong>"+code+"</strong>.</p><p>It expires in 10 minutes.</p>");}
  catch(_){await db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json(env,{error:"verification_delivery_failed"},502);}
  return json(env,{ok:true,emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}

async function setupVerify(request,env,db){
  if(!env.DAGA_OTP_PEPPER)return json(env,{error:"account_setup_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email),code=String(b.emailCode||"").trim(),password=String(b.password||""),recovery=String(b.recoveryCode||"");
  if(!validEmail(email)||!/^[0-9]{6}$/.test(code)||!validPassword(password)||recovery.length<20||recovery.length>128)return json(env,{error:"valid_account_setup_fields_required"},400);
  const ch=await db.prepare("SELECT * FROM daga_shop_registration_challenges WHERE lower(email)=? AND internal_identity LIKE 'setup:%' AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(email,new Date().toISOString()).first();
  if(!ch)return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  await db.prepare("UPDATE daga_shop_registration_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5").bind(ch.id).run();
  if(!same(await sha(ch.id+":"+code+":"+env.DAGA_OTP_PEPPER),ch.code_hash))return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  const accountId=ch.internal_identity.slice(6),account=await db.prepare("SELECT id FROM daga_accounts WHERE id=? AND lower(email)=? AND role='store_owner' AND status='approved'").bind(accountId,email).first();
  if(!account)return json(env,{error:"shop_not_approved_yet"},403);
  const salt=token(24),hash=await passwordHash(password,salt),recoveryHash=await sha(recovery+":"+env.DAGA_OTP_PEPPER),now=new Date().toISOString();
  try{await db.batch([
    db.prepare("INSERT INTO daga_account_credentials (account_id,password_hash,password_salt,password_iterations,recovery_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(account.id,hash,salt,ITERATIONS,recoveryHash,now,now),
    db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(now,ch.id)
  ]);}catch(_){return json(env,{error:"account_credentials_already_set"},409);}
  return json(env,{ok:true,message:"تم إنشاء كلمة المرور. سجّل الدخول."});
}

async function login(request,env,db){
  if(!env.DAGA_OTP_PEPPER)return json(env,{error:"shop_login_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email),password=String(b.password||"");
  if(!validEmail(email)||password.length>128)return json(env,{error:"invalid_credentials"},401);
  const account=await db.prepare("SELECT a.id,a.role,a.status,a.email,a.display_name,a.store_id,c.password_hash,c.password_salt,c.password_iterations FROM daga_accounts a JOIN daga_account_credentials c ON c.account_id=a.id WHERE lower(a.email)=? LIMIT 1").bind(email).first();
  if(!account||account.role!=="store_owner"||account.status!=="approved")return json(env,{error:account&&account.status==="pending"?"shop_pending_approval":"invalid_credentials"},401);
  const attempt=await passwordHash(password,account.password_salt,Number(account.password_iterations)||ITERATIONS);
  if(!same(attempt,account.password_hash))return json(env,{error:"invalid_credentials"},401);
  const session=await createSession(db,account.id);
  return json(env,{ok:true,account:{id:account.id,role:account.role,displayName:account.display_name,emailMasked:maskEmail(account.email)},sessionToken:session.token,expiresAt:session.expiresAt});
}

async function recoveryStart(request,env,db){
  if(!env.DAGA_OTP_PEPPER||!env.RESEND_API_KEY||!env.DAGA_EMAIL_FROM)return json(env,{error:"email_verification_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email);if(!validEmail(email))return json(env,{error:"valid_email_required"},400);
  const account=await db.prepare("SELECT id,email,display_name FROM daga_accounts WHERE lower(email)=? AND role='store_owner' AND status='approved' LIMIT 1").bind(email).first();
  if(!account)return json(env,{ok:true,message:"لو الحساب مؤهل للاسترداد، هيوصل كود على البريد."});
  const code=digits(),id=crypto.randomUUID(),expires=new Date(Date.now()+OTP_TTL_SECONDS*1000).toISOString(),[codeHash,destinationHash]=await Promise.all([sha(id+":"+code+":"+env.DAGA_OTP_PEPPER),sha("email:"+email)]);
  await db.prepare("INSERT INTO daga_shop_registration_challenges (id,email,owner_name,shop_name,internal_identity,destination_hash,code_hash,expires_at) VALUES (?,?,?,'__recovery__',?,?,?,?)").bind(id,email,account.display_name,"recovery:"+account.id,destinationHash,codeHash,expires).run();
  try{await sendEmail(env,email,"DAGA shop account recovery","<p>Your DAGA account recovery code is <strong>"+code+"</strong>.</p><p>It expires in 10 minutes.</p>");}
  catch(_){await db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json(env,{error:"verification_delivery_failed"},502);}
  return json(env,{ok:true,emailMasked:maskEmail(email),expiresInSeconds:OTP_TTL_SECONDS});
}
async function recoveryComplete(request,env,db){
  if(!env.DAGA_OTP_PEPPER)return json(env,{error:"account_recovery_not_configured"},503);
  const b=await body(request);if(!b)return json(env,{error:"invalid_json"},400);
  const email=normalizeEmail(b.email),code=String(b.emailCode||"").trim(),oldRecovery=String(b.recoveryCode||""),newRecovery=String(b.newRecoveryCode||""),password=String(b.newPassword||"");
  if(!validEmail(email)||!/^[0-9]{6}$/.test(code)||oldRecovery.length<20||oldRecovery.length>128||newRecovery.length<20||newRecovery.length>128||!validPassword(password))return json(env,{error:"valid_recovery_fields_required"},400);
  const ch=await db.prepare("SELECT * FROM daga_shop_registration_challenges WHERE lower(email)=? AND internal_identity LIKE 'recovery:%' AND consumed_at IS NULL AND attempts<5 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(email,new Date().toISOString()).first();
  if(!ch)return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  await db.prepare("UPDATE daga_shop_registration_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5").bind(ch.id).run();
  if(!same(await sha(ch.id+":"+code+":"+env.DAGA_OTP_PEPPER),ch.code_hash))return json(env,{error:"invalid_expired_or_used_verification_code"},400);
  const accountId=ch.internal_identity.slice(9),account=await db.prepare("SELECT a.id,c.recovery_code_hash FROM daga_accounts a JOIN daga_account_credentials c ON c.account_id=a.id WHERE a.id=? AND lower(a.email)=? AND a.role='store_owner' AND a.status='approved'").bind(accountId,email).first();
  if(!account||!account.recovery_code_hash||!same(await sha(oldRecovery+":"+env.DAGA_OTP_PEPPER),account.recovery_code_hash))return json(env,{error:"invalid_recovery_credentials"},400);
  const salt=token(24),hash=await passwordHash(password,salt),recoveryHash=await sha(newRecovery+":"+env.DAGA_OTP_PEPPER),now=new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE daga_account_credentials SET password_hash=?,password_salt=?,password_iterations=?,recovery_code_hash=?,updated_at=? WHERE account_id=?").bind(hash,salt,ITERATIONS,recoveryHash,now,account.id),
    db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").bind(now,account.id),
    db.prepare("UPDATE daga_shop_registration_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(now,ch.id)
  ]);
  return json(env,{ok:true,message:"تم تغيير كلمة المرور وإلغاء الجلسات السابقة."});
}
async function me(request,env,db){
  const account=await authenticatedAccount(request,db);
  if(!account||account.role!=="store_owner"||account.status!=="approved")return json(env,{error:"authentication_required"},401);
  const store=await db.prepare("SELECT id,public_id,display_name,status FROM daga_stores WHERE id=? AND owner_account_id=? AND status='approved'").bind(account.store_id,account.id).first();
  if(!store)return json(env,{error:"shop_not_approved"},403);
  const entitlement=await db.prepare("SELECT id FROM daga_entitlements WHERE account_id=? AND store_id=? AND service='store' AND status='active' AND expires_at>? LIMIT 1").bind(account.id,store.id,new Date().toISOString()).first();
  return json(env,{ok:true,account:{id:account.id,role:account.role,displayName:account.display_name,emailMasked:maskEmail(account.email)},shops:[{id:store.id,publicId:store.public_id,displayName:store.display_name,role:"store_owner",permissions:{},ledgerEnabled:Boolean(entitlement)}]});
}

async function logout(request,env,db){
  const t=bearer(request);if(!t)return json(env,{error:"authentication_required"},401);
  await db.prepare("UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(),await sha(t)).run();
  return json(env,{ok:true});
}
async function createSession(db,accountId){const raw=token(32),now=new Date(),expires=new Date(now.getTime()+SESSION_TTL_SECONDS*1000).toISOString();await db.prepare("INSERT INTO daga_auth_sessions (id,account_id,token_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),accountId,await sha(raw),now.toISOString(),expires,now.toISOString()).run();return {token:raw,expiresAt:expires};}
async function passwordHash(password,salt,iterations=ITERATIONS){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations,hash:"SHA-256"},key,256);return hex(new Uint8Array(bits));}
function validPassword(p){return p.length>=14&&p.length<=128&&/[a-z]/.test(p)&&/[A-Z]/.test(p)&&/[0-9]/.test(p);}
async function sendEmail(env,email,subject,html){const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.DAGA_EMAIL_FROM,to:[email],subject,html}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error("email_delivery_failed");}
async function body(request){try{return await request.json()}catch(_){return null}}
function normalizeEmail(v){return String(v||"").trim().toLowerCase()}
function validEmail(v){return v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function digits(){return String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0")}
function token(size){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(size)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function sha(v){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))))}
function hex(v){return [...v].map(x=>x.toString(16).padStart(2,"0")).join("")}
function same(a,b){const x=String(a),y=String(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x.charCodeAt(i%x.length)||0)^(y.charCodeAt(i%y.length)||0);return d===0}
function maskEmail(v){const [u,d]=String(v||"").split("@");return u&&d?u.slice(0,2)+"•••@"+d:"••••"}
function bearer(request){const v=request.headers.get("Authorization")||"";return v.startsWith("Bearer ")?v.slice(7).trim():""}
function json(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:cors(env,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"})})}
function cors(env,extra={}){const allowed=String(env.DAGA_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);const origin=allowed.includes("*")?"*":allowed.length===1?allowed[0]:"";return {...(origin?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Max-Age":"600","Vary":"Origin",...extra}}
