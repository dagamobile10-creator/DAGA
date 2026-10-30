import { authenticatedOwner } from "./owner-auth.js";

export async function handleOwnerAdmin(request, env, url) {
  if (!url.pathname.startsWith("/owner/admin/")) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "application_database_not_configured" }, 503);
  const owner = await authenticatedOwner(request, db);
  if (!owner) return json(env, { error: "owner_session_required" }, 401);

  try {
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/owner/admin/overview" && request.method === "GET") {
      const [stores, pendingAccounts, plans, pendingPayments, activeEntitlements, wordBalance] = await Promise.all([
        db.prepare("SELECT status,COUNT(*) AS count FROM daga_stores GROUP BY status").all(),
        db.prepare("SELECT role,status,COUNT(*) AS count FROM daga_accounts WHERE role!='program_owner' GROUP BY role,status").all(),
        db.prepare("SELECT service,COUNT(*) AS count FROM daga_plans WHERE is_active=1 GROUP BY service").all(),
        db.prepare("SELECT COUNT(*) AS count FROM daga_payment_submissions WHERE status='pending_review'").first(),
        db.prepare("SELECT service,COUNT(*) AS count FROM daga_entitlements WHERE status='active' AND expires_at>? GROUP BY service").bind(new Date().toISOString()).all(),
        db.prepare("SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund') THEN words ELSE -words END),0) AS remaining FROM daga_live_word_ledger").first()
      ]);
      return json(env, { ok: true, stores: stores.results || [], accounts: pendingAccounts.results || [], activePlans: plans.results || [], pendingPaymentReviews: pendingPayments?.count || 0, activeEntitlements: activeEntitlements.results || [], liveWordsOutstanding: wordBalance?.remaining || 0 });
    }

    if(path==="/owner/admin/audit-log"&&request.method==="GET"){
      const limit=Math.min(200,Math.max(1,Number(url.searchParams.get("limit")||100)));
      const rows=await db.prepare("SELECT id,actor_account_id,action,target_type,target_id,details_json,created_at FROM daga_audit_log ORDER BY created_at DESC,id DESC LIMIT ?").bind(limit).all();
      return json(env,{ok:true,events:rows.results||[]});
    }

    if (path === "/owner/admin/live-daga-rate" && request.method === "GET") {
      const setting = await db.prepare("SELECT setting_value,updated_at FROM daga_app_settings WHERE setting_key='live_daga_price_per_1000_minor'").first();
      return json(env,{ok:true,pricePer1000Minor:setting?Number(setting.setting_value):null,updatedAt:setting?.updated_at||null});
    }
    if (path === "/owner/admin/live-daga-rate" && request.method === "PUT") {
      const b = await readJson(request); if (!b) return json(env,{error:"invalid_json"},400);
      const rate = Number(b.pricePer1000Minor);
      if (!Number.isSafeInteger(rate) || rate < 1 || rate > 100000000) return json(env,{error:"invalid_character_rate"},400);
      const now = new Date().toISOString();
      const plans = await db.prepare("SELECT id,word_quota FROM daga_plans WHERE service='live_daga' AND word_quota IS NOT NULL").all();
      const statements = [
        db.prepare("INSERT INTO daga_app_settings (setting_key,setting_value,updated_by,updated_at) VALUES ('live_daga_price_per_1000_minor',?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(String(rate),owner.id,now),
        ...(plans.results||[]).map(p=>db.prepare("UPDATE daga_plans SET price_minor=?,version=version+1,updated_by=?,updated_at=? WHERE id=?").bind(Math.ceil(Number(p.word_quota)*rate/1000),owner.id,now,p.id))
      ];
      await db.batch(statements);
      await audit(db,owner.id,"live_daga_character_rate_updated","daga_app_settings","live_daga_price_per_1000_minor",{pricePer1000Minor:rate,plansRepriced:(plans.results||[]).length});
      return json(env,{ok:true,pricePer1000Minor:rate,plansRepriced:(plans.results||[]).length});
    }

    if (path === "/owner/admin/plans" && request.method === "GET") {
      const result = await db.prepare("SELECT id,service,name,price_minor,currency,duration_days,word_quota,features_json,is_active,version,updated_at FROM daga_plans ORDER BY service,name").all();
      return json(env, { ok: true, plans: result.results || [] });
    }
    if (path === "/owner/admin/plans" && request.method === "POST") {
      const b = await readJson(request); if (!b) return json(env, { error: "invalid_json" }, 400);
      const service = String(b.service || "");
      const name = String(b.name || "").trim().slice(0, 100);
      let price = Number(b.priceMinor);
      const duration = Number(b.durationDays ?? 30);
      const quota = b.wordQuota == null ? null : Number(b.wordQuota);
      if (service === "live_daga") {
        if (quota === null || !Number.isSafeInteger(quota) || quota < 1) return json(env, { error: "live_daga_character_quota_required" }, 400);
        const rateRow = await db.prepare("SELECT setting_value FROM daga_app_settings WHERE setting_key='live_daga_price_per_1000_minor'").first();
        const rate = Number(rateRow?.setting_value);
        if (!rateRow || !Number.isSafeInteger(rate) || rate < 1) return json(env, { error: "live_daga_pricing_rate_not_configured" }, 409);
        price = Math.ceil(Number(quota)*rate/1000);
        if (!Number.isSafeInteger(price) || price < 1) return json(env, { error: "calculated_plan_price_invalid" }, 400);
      }
      if (!["store","live_daga"].includes(service) || !name || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(duration) || duration < 1 || duration > 3650 || (service === "live_daga" && quota === null) || (quota !== null && (!Number.isSafeInteger(quota) || quota < 1))) return json(env, { error: "invalid_plan_fields" }, 400);
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const features = service === "store" ? normalizeStoreFeatures(b.features) : safeObjectJson(b.features);
      await db.prepare("INSERT INTO daga_plans (id,service,name,price_minor,currency,duration_days,word_quota,features_json,is_active,version,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)")
        .bind(id,service,name,price,String(b.currency || "EGP").slice(0,8),duration,quota,features,owner.id,now).run();
      await audit(db,owner.id,"plan_created","daga_plans",id,{service,name,priceMinor:price});
      return json(env, { ok:true,id },201);
    }
    const planMatch = path.match(/^\/owner\/admin\/plans\/([a-f0-9-]{36})$/i);
    if (planMatch && request.method === "PATCH") {
      const b = await readJson(request); if (!b) return json(env, { error: "invalid_json" }, 400);
      const existing = await db.prepare("SELECT * FROM daga_plans WHERE id=?").bind(planMatch[1]).first();
      if (!existing) return json(env, { error: "plan_not_found" },404);
      const name = b.name === undefined ? existing.name : String(b.name).trim().slice(0,100);
      let price = b.priceMinor === undefined ? existing.price_minor : Number(b.priceMinor);
      const duration = b.durationDays === undefined ? existing.duration_days : Number(b.durationDays);
      const quota = b.wordQuota === undefined ? existing.word_quota : (b.wordQuota === null ? null : Number(b.wordQuota));
      const active = b.isActive === undefined ? existing.is_active : (b.isActive ? 1 : 0);
      const features = existing.service === "store"
        ? normalizeStoreFeatures(b.features === undefined ? (() => { try { return JSON.parse(existing.features_json || "{}"); } catch (_) { return {}; } })() : b.features)
        : existing.features_json;
      if (existing.service === "live_daga") {
        if (quota === null || !Number.isSafeInteger(quota) || quota < 1) return json(env, { error: "live_daga_character_quota_required" }, 400);
        const rateRow = await db.prepare("SELECT setting_value FROM daga_app_settings WHERE setting_key='live_daga_price_per_1000_minor'").first();
        const rate = Number(rateRow?.setting_value);
        if (!rateRow || !Number.isSafeInteger(rate) || rate < 1) return json(env, { error: "live_daga_pricing_rate_not_configured" }, 409);
        price = Math.ceil(Number(quota)*rate/1000);
        if (!Number.isSafeInteger(price) || price < 1) return json(env, { error: "calculated_plan_price_invalid" }, 400);
      }
      if (!name || !Number.isSafeInteger(price) || price<0 || !Number.isInteger(duration) || duration<1 || duration>3650 || (existing.service === "live_daga" && quota === null) || (quota!==null&&(!Number.isSafeInteger(quota)||quota<1))) return json(env, {error:"invalid_plan_fields"},400);
      await db.prepare("UPDATE daga_plans SET name=?,price_minor=?,duration_days=?,word_quota=?,features_json=?,is_active=?,version=version+1,updated_by=?,updated_at=? WHERE id=?")
        .bind(name,price,duration,quota,features,active,owner.id,new Date().toISOString(),planMatch[1]).run();
      await audit(db,owner.id,"plan_updated","daga_plans",planMatch[1],{version:existing.version+1,storeTier:existing.service==="store"?(JSON.parse(features).tier||"standard"):null});
      return json(env, {ok:true,version:existing.version+1});
    }

    if(path==="/owner/admin/offers"&&request.method==="GET"){
      const r=await db.prepare("SELECT id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemption_count,is_active,created_at,updated_at FROM daga_offers ORDER BY created_at DESC").all();
      return json(env,{ok:true,offers:r.results||[]});
    }
    if(path==="/owner/admin/offers"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const name=String(b.name||"").trim().slice(0,100),service=String(b.service||""),type=String(b.discountType||""),value=Number(b.discountValue);
      const max=b.maxRedemptions==null?null:Number(b.maxRedemptions);
      let starts=null,ends=null;
      try{starts=b.startsAt?new Date(b.startsAt).toISOString():null;ends=b.endsAt?new Date(b.endsAt).toISOString():null;}catch(_){return json(env,{error:"invalid_offer_dates"},400);}
      if(!name||!["store","live_daga"].includes(service)||!["fixed_minor","percent"].includes(type)||!Number.isSafeInteger(value)||value<1||(type==="percent"&&value>100)||(max!==null&&(!Number.isInteger(max)||max<1))||(starts&&ends&&Date.parse(ends)<=Date.parse(starts)))return json(env,{error:"invalid_offer_fields"},400);
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await db.prepare("INSERT INTO daga_offers (id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,name,service,type,value,starts,ends,max,owner.id,now,now).run();
      await audit(db,owner.id,"offer_created","daga_offers",id,{name,service,discountType:type,discountValue:value});
      return json(env,{ok:true,id},201);
    }
    const offerMatch=path.match(/^\/owner\/admin\/offers\/([a-f0-9-]{36})$/i);
    if(offerMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const old=await db.prepare("SELECT * FROM daga_offers WHERE id=?").bind(offerMatch[1]).first();
      if(!old)return json(env,{error:"offer_not_found"},404);
      const name=b.name===undefined?old.name:String(b.name).trim().slice(0,100);
      const value=b.discountValue===undefined?old.discount_value:Number(b.discountValue);
      const active=b.isActive===undefined?old.is_active:(b.isActive?1:0);
      let starts=old.starts_at,ends=old.ends_at;
      try{if(b.startsAt!==undefined)starts=b.startsAt?new Date(b.startsAt).toISOString():null;if(b.endsAt!==undefined)ends=b.endsAt?new Date(b.endsAt).toISOString():null;}catch(_){return json(env,{error:"invalid_offer_dates"},400);}
      if(!name||!Number.isSafeInteger(value)||value<1||(old.discount_type==="percent"&&value>100)||(starts&&ends&&Date.parse(ends)<=Date.parse(starts)))return json(env,{error:"invalid_offer_fields"},400);
      await db.prepare("UPDATE daga_offers SET name=?,discount_value=?,starts_at=?,ends_at=?,is_active=?,updated_at=? WHERE id=?").bind(name,value,starts,ends,active,new Date().toISOString(),old.id).run();
      await audit(db,owner.id,"offer_updated","daga_offers",old.id,{isActive:active});
      return json(env,{ok:true});
    }

    if (path === "/owner/admin/payment-methods" && request.method === "GET") {
      const r = await db.prepare("SELECT id,provider,display_label,destination_value,instructions,is_active,updated_at FROM daga_payment_methods ORDER BY provider").all();
      return json(env, {ok:true,methods:r.results||[]});
    }
    if (path === "/owner/admin/payment-methods" && request.method === "POST") {
      const b=await readJson(request); if(!b)return json(env, {error:"invalid_json"},400);
      const provider=String(b.provider||""), label=String(b.displayLabel||"").trim().slice(0,80), destination=String(b.destinationValue||"").trim().slice(0,160), instructions=String(b.instructions||"").trim().slice(0,1000);
      if(!["vodafone_cash","instapay"].includes(provider)||!label||!destination)return json(env, {error:"invalid_payment_method"},400);
      const id=crypto.randomUUID(), now=new Date().toISOString();
      await db.prepare("INSERT INTO daga_payment_methods (id,provider,display_label,destination_value,instructions,is_active,updated_by,updated_at) VALUES (?,?,?,?,?,1,?,?)")
        .bind(id,provider,label,destination,instructions,owner.id,now).run();
      await audit(db,owner.id,"payment_method_created","daga_payment_methods",id,{provider,label});
      return json(env, {ok:true,id},201);
    }
    const paymentMethodMatch=path.match(/^\/owner\/admin\/payment-methods\/([a-f0-9-]{36})$/i);
    if(paymentMethodMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      const old=await db.prepare("SELECT * FROM daga_payment_methods WHERE id=?").bind(paymentMethodMatch[1]).first();
      if(!old)return json(env, {error:"payment_method_not_found"},404);
      const label=b.displayLabel===undefined?old.display_label:String(b.displayLabel).trim().slice(0,80);
      const dest=b.destinationValue===undefined?old.destination_value:String(b.destinationValue).trim().slice(0,160);
      const instructions=b.instructions===undefined?old.instructions:String(b.instructions).trim().slice(0,1000);
      const active=b.isActive===undefined?old.is_active:(b.isActive?1:0);
      if(!label||!dest)return json(env, {error:"invalid_payment_method"},400);
      await db.prepare("UPDATE daga_payment_methods SET display_label=?,destination_value=?,instructions=?,is_active=?,updated_by=?,updated_at=? WHERE id=?").bind(label,dest,instructions,active,owner.id,new Date().toISOString(),old.id).run();
      await audit(db,owner.id,"payment_method_updated","daga_payment_methods",old.id,{provider:old.provider});
      return json(env, {ok:true});
    }

    if(path==="/owner/admin/accounts"&&request.method==="GET"){
      const r=await db.prepare("SELECT a.id,a.public_id,a.display_name,a.role,a.status,a.created_at,a.email FROM daga_accounts a ORDER BY a.created_at DESC LIMIT 1000").all();
      return json(env,{ok:true,accounts:r.results||[]});
    }

    if(path==="/owner/admin/stores"&&request.method==="GET"){
      const r=await db.prepare("SELECT s.id,s.public_id,s.owner_account_id,s.display_name,s.status,s.onboarding_status,s.contact_phone,s.created_at,a.email,a.display_name AS owner_name FROM daga_stores s JOIN daga_accounts a ON a.id=s.owner_account_id ORDER BY s.created_at DESC LIMIT 500").all();
      return json(env, {ok:true,stores:r.results||[]});
    }
    const storeEditMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})$/i);
    if(storeEditMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const store=await db.prepare("SELECT id,display_name FROM daga_stores WHERE id=?").bind(storeEditMatch[1]).first();
      if(!store)return json(env,{error:"store_not_found"},404);
      const displayName=b.displayName===undefined?store.display_name:String(b.displayName).trim().slice(0,120);
      if(!displayName)return json(env,{error:"display_name_required"},400);
      await db.prepare("UPDATE daga_stores SET display_name=?,updated_at=? WHERE id=?").bind(displayName,new Date().toISOString(),store.id).run();
      await audit(db,owner.id,"store_display_name_changed","daga_stores",store.id,{shopNameUpdated:true});
      return json(env,{ok:true,displayName});
    }

    const finalizeMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})\/finalize$/i);
    if(finalizeMatch&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      if(b.paymentConfirmed!==true)return json(env,{error:"payment_confirmation_required"},409);
      const store=await db.prepare("SELECT id,owner_account_id,status,onboarding_status,onboarding_order_id FROM daga_stores WHERE id=?").bind(finalizeMatch[1]).first();
      if(!store)return json(env,{error:"store_not_found"},404);
      if(store.status!=="pending"||store.onboarding_status!=="preliminary_approved"||store.onboarding_order_id)return json(env,{error:"store_not_ready_for_final_activation"},409);
      const plan=await db.prepare("SELECT id,service,name,price_minor,currency,duration_days,version,is_active FROM daga_plans WHERE id=?").bind(String(b.planId||"")).first();
      if(!plan||plan.service!=="store"||!plan.is_active)return json(env,{error:"active_store_plan_required"},400);
      const price=Number(b.agreedPriceMinor);
      if(!Number.isSafeInteger(price)||price<0)return json(env,{error:"valid_agreed_price_required"},400);
      const now=new Date().toISOString(),orderId=crypto.randomUUID(),entitlementId=crypto.randomUUID();
      const expires=new Date(Date.now()+Number(plan.duration_days)*86400000).toISOString();
      const results=await db.batch([
        db.prepare("INSERT INTO daga_plan_orders (id,account_id,store_id,plan_id,plan_version,agreed_price_minor,currency,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'paid_approved',?,? WHERE EXISTS (SELECT 1 FROM daga_stores s JOIN daga_accounts a ON a.id=s.owner_account_id WHERE s.id=? AND s.owner_account_id=? AND s.status='pending' AND s.onboarding_status='preliminary_approved' AND s.onboarding_order_id IS NULL AND a.role='store_owner' AND a.status='pending')").bind(orderId,store.owner_account_id,store.id,plan.id,plan.version,price,plan.currency||"EGP",now,now,store.id,store.owner_account_id),
        db.prepare("UPDATE daga_stores SET status='approved',onboarding_status='approved',onboarding_order_id=?,onboarding_payment_method_id=NULL,onboarding_offer_name=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM daga_plan_orders WHERE id=? AND status='paid_approved')").bind(orderId,String(b.offerName||"").trim().slice(0,120)||null,now,store.id,orderId),
        db.prepare("UPDATE daga_accounts SET status='approved',updated_at=? WHERE id=? AND role='store_owner' AND status='pending' AND EXISTS (SELECT 1 FROM daga_stores WHERE id=? AND status='approved' AND onboarding_order_id=?)").bind(now,store.owner_account_id,store.id,orderId),
        db.prepare("INSERT INTO daga_entitlements (id,account_id,store_id,service,order_id,starts_at,expires_at,status,created_at) SELECT ?,?,?, 'store',?,?,?,'active',? WHERE EXISTS (SELECT 1 FROM daga_stores s JOIN daga_accounts a ON a.id=s.owner_account_id WHERE s.id=? AND s.status='approved' AND s.onboarding_order_id=? AND a.id=? AND a.status='approved' AND a.role='store_owner')").bind(entitlementId,store.owner_account_id,store.id,orderId,now,expires,now,store.id,orderId,store.owner_account_id)
      ]);
      if(results.some(r=>Number(r?.meta?.changes||0)!==1))return json(env,{error:"store_final_activation_conflict_retry"},409);
      await audit(db,owner.id,"store_final_activation_completed","daga_stores",store.id,{orderId,planId:plan.id,agreedPriceMinor:price,paymentManuallyConfirmed:true});
      return json(env,{ok:true,status:"approved",orderId,entitlementId,planName:plan.name,agreedPriceMinor:price,expiresAt:expires});
    }

    const onboardingMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})\/onboarding$/i);
    if(onboardingMatch&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const store=await db.prepare("SELECT id,owner_account_id,onboarding_status FROM daga_stores WHERE id=?").bind(onboardingMatch[1]).first();
      if(!store)return json(env,{error:"store_not_found"},404);
      if(store.onboarding_status!=="preliminary_approved")return json(env,{error:"preliminary_approval_required"},409);
      const plan=await db.prepare("SELECT id,service,name,price_minor,currency,duration_days,version,is_active FROM daga_plans WHERE id=?").bind(String(b.planId||"")).first();
      if(!plan||plan.service!=="store"||!plan.is_active)return json(env,{error:"active_store_plan_required"},400);
      const methodId=String(b.paymentMethodId||"").trim();
      const method=methodId?await db.prepare("SELECT id,is_active FROM daga_payment_methods WHERE id=?").bind(methodId).first():null;
      if(methodId&&(!method||!method.is_active))return json(env,{error:"active_payment_method_required"},400);
      const price=Number(b.agreedPriceMinor);
      if(!Number.isSafeInteger(price)||price<0)return json(env,{error:"valid_agreed_price_required"},400);
      const now=new Date().toISOString(),orderId=crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO daga_plan_orders (id,account_id,store_id,plan_id,plan_version,agreed_price_minor,currency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'awaiting_payment',?,?)").bind(orderId,store.owner_account_id,store.id,plan.id,plan.version,price,plan.currency||"EGP",now,now),
        db.prepare("UPDATE daga_stores SET onboarding_order_id=?,onboarding_payment_method_id=?,onboarding_offer_name=?,updated_at=? WHERE id=?").bind(orderId,method?method.id:null,String(b.offerName||"").trim().slice(0,120)||null,now,store.id)
      ]);
      await audit(db,owner.id,"shop_onboarding_agreement_recorded","daga_stores",store.id,{orderId,planId:plan.id,paymentMethodId:method?method.id:null,agreedPriceMinor:price,manualWhatsAppAgreement:true});
      return json(env,{ok:true,orderId,planName:plan.name,agreedPriceMinor:price,currency:plan.currency||"EGP",paymentMethodId:method?method.id:null});
    }

    const storeMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})\/decision$/i);
    if(storeMatch&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      if(!["preliminary_approved","approved","rejected","suspended"].includes(b.status))return json(env, {error:"invalid_store_status"},400);
      const store=await db.prepare("SELECT id,owner_account_id,status,onboarding_status,onboarding_order_id FROM daga_stores WHERE id=?").bind(storeMatch[1]).first();
      if(!store)return json(env, {error:"store_not_found"},404);
      if(b.status==="approved" && store.onboarding_status!=="preliminary_approved")return json(env,{error:"preliminary_approval_required"},409);
      if(b.status==="preliminary_approved" && store.onboarding_status!=="pending")return json(env,{error:"store_not_pending_preliminary_approval"},409);
      const now=new Date().toISOString();
      if(b.status==="preliminary_approved"){
        await db.prepare("UPDATE daga_stores SET onboarding_status='preliminary_approved',updated_at=? WHERE id=?").bind(now,store.id).run();
        await db.prepare("UPDATE daga_accounts SET status='pending',updated_at=? WHERE id=? AND role='store_owner'").bind(now,store.owner_account_id).run();
      }else if(b.status==="approved"){
        if(!store.onboarding_order_id)return json(env,{error:"onboarding_plan_payment_not_recorded"},409);
        const order=await db.prepare("SELECT o.id,o.status,o.plan_id,o.account_id,o.store_id,o.agreed_price_minor,p.duration_days,p.service FROM daga_plan_orders o JOIN daga_plans p ON p.id=o.plan_id WHERE o.id=? AND o.store_id=? AND o.account_id=?").bind(store.onboarding_order_id,store.id,store.owner_account_id).first();
        if(!order||order.service!=="store"||!["awaiting_payment","under_review","payment_submitted"].includes(order.status))return json(env,{error:"valid_onboarding_payment_order_required"},409);
        const expires=new Date(Date.now()+Number(order.duration_days)*86400000).toISOString();
        const entitlementId=crypto.randomUUID();
        await db.batch([
          db.prepare("UPDATE daga_plan_orders SET status='paid_approved',updated_at=? WHERE id=? AND status IN ('awaiting_payment','under_review','payment_submitted')").bind(now,order.id),
          db.prepare("INSERT INTO daga_entitlements (id,account_id,store_id,service,order_id,starts_at,expires_at,status,created_at) VALUES (?,?,?,'store',?,?,?,'active',?)").bind(entitlementId,store.owner_account_id,store.id,order.id,now,expires,now),
          db.prepare("UPDATE daga_stores SET status='approved',onboarding_status='approved',updated_at=? WHERE id=?").bind(now,store.id),
          db.prepare("UPDATE daga_accounts SET status='approved',updated_at=? WHERE id=? AND role='store_owner'").bind(now,store.owner_account_id)
        ]);
      }else{
        await db.batch([
          db.prepare("UPDATE daga_stores SET status=?,onboarding_status=?,updated_at=? WHERE id=?").bind(b.status,b.status,now,store.id),
          db.prepare("UPDATE daga_accounts SET status=?,updated_at=? WHERE id=? AND role='store_owner'").bind(b.status,now,store.owner_account_id)
        ]);
      }
      await audit(db,owner.id,"store_status_changed","daga_stores",store.id,{from:store.onboarding_status,to:b.status});
      return json(env, {ok:true,status:b.status});
    }

    if(path==="/owner/admin/payments"&&request.method==="GET"){
      const r=await db.prepare("SELECT ps.id,ps.order_id,ps.payment_method_id,ps.claimed_amount_minor,ps.transaction_reference,ps.receipt_url,ps.submitted_at,ps.status,o.account_id,o.store_id,o.plan_id,o.agreed_price_minor,o.currency,o.status AS order_status,pm.provider,pm.display_label FROM daga_payment_submissions ps JOIN daga_plan_orders o ON o.id=ps.order_id JOIN daga_payment_methods pm ON pm.id=ps.payment_method_id ORDER BY ps.submitted_at DESC LIMIT 500").all();
      return json(env, {ok:true,payments:r.results||[]});
    }
    const reviewMatch=path.match(/^\/owner\/admin\/payments\/([a-f0-9-]{36})\/review$/i);
    if(reviewMatch&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      if(!["confirmed","rejected"].includes(b.status))return json(env, {error:"invalid_payment_decision"},400);
      const sub=await db.prepare("SELECT ps.*,o.account_id,o.store_id,o.plan_id,o.agreed_price_minor,o.currency,o.status AS order_status,p.service,p.duration_days,p.word_quota FROM daga_payment_submissions ps JOIN daga_plan_orders o ON o.id=ps.order_id JOIN daga_plans p ON p.id=o.plan_id WHERE ps.id=?").bind(reviewMatch[1]).first();
      if(!sub)return json(env, {error:"payment_submission_not_found"},404);
      if(sub.status!=="pending_review"||!["payment_submitted","under_review"].includes(sub.order_status))return json(env, {error:"payment_already_reviewed_or_order_not_reviewable"},409);
      if(b.status==="confirmed"&&Number(sub.claimed_amount_minor)!==Number(sub.agreed_price_minor))return json(env, {error:"claimed_amount_does_not_match_order_price"},409);
      const now=new Date().toISOString();
      const statements=[
        db.prepare("UPDATE daga_payment_submissions SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending_review' AND EXISTS (SELECT 1 FROM daga_plan_orders o WHERE o.id=daga_payment_submissions.order_id AND o.status IN ('payment_submitted','under_review'))").bind(b.status,owner.id,now,sub.id),
        db.prepare("UPDATE daga_plan_orders SET status=?,updated_at=? WHERE id=? AND status IN ('payment_submitted','under_review') AND EXISTS (SELECT 1 FROM daga_payment_submissions ps WHERE ps.id=? AND ps.status=? AND ps.reviewed_by=? AND ps.reviewed_at=?)").bind(b.status==="confirmed"?"paid_approved":"rejected",now,sub.order_id,sub.id,b.status,owner.id,now)
      ];
      if(b.status==="confirmed"){
        const entitlementId=crypto.randomUUID(), starts=now, expires=new Date(Date.now()+Number(sub.duration_days)*86400000).toISOString();
        statements.push(db.prepare("INSERT INTO daga_entitlements (id,account_id,store_id,service,order_id,starts_at,expires_at,status) SELECT ?,?,?,?,?,?,?,'active' WHERE EXISTS (SELECT 1 FROM daga_payment_submissions ps JOIN daga_plan_orders o ON o.id=ps.order_id WHERE ps.id=? AND ps.status='confirmed' AND ps.reviewed_by=? AND ps.reviewed_at=? AND o.status='paid_approved')").bind(entitlementId,sub.account_id,sub.store_id,sub.service,sub.order_id,starts,expires,sub.id,owner.id,now));
        if(sub.service==="live_daga"&&Number(sub.word_quota)>0) statements.push(db.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,order_id,event_type,words,request_id,note) SELECT ?,?,?,?,'credit',?,?,? WHERE EXISTS (SELECT 1 FROM daga_payment_submissions ps JOIN daga_plan_orders o ON o.id=ps.order_id WHERE ps.id=? AND ps.status='confirmed' AND ps.reviewed_by=? AND ps.reviewed_at=? AND o.status='paid_approved')").bind(crypto.randomUUID(),sub.account_id,sub.store_id,sub.order_id,Number(sub.word_quota),"order:"+sub.order_id,"Owner-confirmed LIVE DAGA purchase",sub.id,owner.id,now));
      }
      const reviewResults = await db.batch(statements);
      if (Number(reviewResults?.[0]?.meta?.changes || 0) !== 1 || Number(reviewResults?.[1]?.meta?.changes || 0) !== 1) {
        return json(env, {error:"payment_review_state_changed_retry"},409);
      }
      await audit(db,owner.id,"payment_reviewed","daga_payment_submissions",sub.id,{status:b.status,orderId:sub.order_id});
      return json(env, {ok:true,status:b.status});
    }

    if(path==="/owner/admin/words/adjust"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      const accountId=String(b.accountId||""), storeId=b.storeId?String(b.storeId):null, words=Number(b.words), requestId=String(b.requestId||"").trim(), note=String(b.note||"").trim().slice(0,240);
      if(!/^[a-f0-9-]{36}$/i.test(accountId)||!Number.isSafeInteger(words)||words<1||words>100000000||requestId.length<12||requestId.length>128)return json(env, {error:"invalid_word_adjustment"},400);
      const adjustmentNote=note||"Owner adjustment";
      const account=await db.prepare("SELECT id,role,status,store_id FROM daga_accounts WHERE id=?").bind(accountId).first();
      if(!account||account.status!=="approved"||account.role!=="store_owner")return json(env, {error:"approved_store_owner_required"},404);
      const ownedStore=await db.prepare("SELECT id FROM daga_stores WHERE owner_account_id=? AND status='approved' ORDER BY created_at DESC LIMIT 1").bind(accountId).first();
      if(!ownedStore)return json(env,{error:"approved_owned_store_required"},409);
      const resolvedStoreId=ownedStore.id;
      if(storeId&&storeId!==resolvedStoreId)return json(env, {error:"store_account_mismatch"},409);
      const prior=await db.prepare("SELECT id,account_id,store_id,event_type,words,note FROM daga_live_word_ledger WHERE request_id=?").bind(requestId).first();
      if(prior){
        const same=prior.account_id===accountId&&prior.store_id===resolvedStoreId&&prior.event_type==="credit"&&Number(prior.words)===words&&prior.note===adjustmentNote;
        return same?json(env,{ok:true,duplicate:true,entryId:prior.id}):json(env,{error:"word_adjustment_request_id_conflict"},409);
      }
      const id=crypto.randomUUID();
      try {
        await db.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,event_type,words,request_id,note) VALUES (?,?,?,'credit',?,?,?)").bind(id,accountId,resolvedStoreId,words,requestId,adjustmentNote).run();
      } catch (_) {
        const duplicate = await db.prepare("SELECT id,account_id,store_id,event_type,words,note FROM daga_live_word_ledger WHERE request_id=?").bind(requestId).first();
        if (duplicate) {
          const same=duplicate.account_id===accountId&&duplicate.store_id===resolvedStoreId&&duplicate.event_type==="credit"&&Number(duplicate.words)===words&&duplicate.note===adjustmentNote;
          return same?json(env,{ok:true,duplicate:true,entryId:duplicate.id}):json(env,{error:"word_adjustment_request_id_conflict"},409);
        }
        return json(env, {error:"word_adjustment_conflict"},409);
      }
      await audit(db,owner.id,"live_words_credited","daga_live_word_ledger",id,{accountId,words,requestId});
      return json(env, {ok:true,entryId:id},201);
    }

    if(path==="/owner/admin/columns"&&request.method==="GET"){
      const r=await db.prepare("SELECT id,scope,store_id,stable_key,display_name,data_type,behavior_json,calculation_key,is_enabled,updated_at FROM daga_column_definitions ORDER BY scope,store_id,stable_key").all();
      return json(env, {ok:true,columns:r.results||[]});
    }
    const columnMatch = path.match(/^\/owner\/admin\/columns\/([a-f0-9-]{36})$/i);
    if(columnMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const old=await db.prepare("SELECT id,scope,store_id,stable_key,display_name,is_enabled FROM daga_column_definitions WHERE id=?").bind(columnMatch[1]).first();
      if(!old)return json(env,{error:"column_not_found"},404);
      const label=b.displayName===undefined?old.display_name:String(b.displayName).trim().slice(0,80);
      const enabled=b.isEnabled===undefined?old.is_enabled:(b.isEnabled?1:0);
      if(!label)return json(env,{error:"invalid_display_name"},400);
      await db.prepare("UPDATE daga_column_definitions SET display_name=?,is_enabled=?,updated_by=?,updated_at=? WHERE id=?").bind(label,enabled,owner.id,new Date().toISOString(),old.id).run();
      await audit(db,owner.id,"column_definition_updated","daga_column_definitions",old.id,{scope:old.scope,storeId:old.store_id,stableKey:old.stable_key});
      return json(env,{ok:true});
    }

    if(path==="/owner/admin/columns"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      const scope=String(b.scope||""), storeId=b.storeId?String(b.storeId):null, key=String(b.stableKey||"").trim(), label=String(b.displayName||"").trim().slice(0,80), dataType=String(b.dataType||"text");
      if(!["system_default","store"].includes(scope)||!key||!/^[a-z][a-z0-9_]{1,63}$/.test(key)||!label||!["text","number","currency","date","boolean"].includes(dataType)||(scope==="store"&&!storeId)||(scope==="system_default"&&storeId))return json(env, {error:"invalid_column_definition"},400);
      const behavior=safeObjectJson(b.behavior), calc=b.calculationKey?String(b.calculationKey).slice(0,80):null;
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await db.prepare("INSERT INTO daga_column_definitions (id,scope,store_id,stable_key,display_name,data_type,behavior_json,calculation_key,is_enabled,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)").bind(id,scope,storeId,key,label,dataType,behavior,calc,owner.id,now).run();
      await audit(db,owner.id,"column_definition_created","daga_column_definitions",id,{scope,storeId,stableKey:key});
      return json(env, {ok:true,id},201);
    }

    return json(env, {error:"owner_admin_route_not_found"},404);
  } catch (error) {
    return json(env, {error:"owner_admin_operation_failed",detail:String(error?.message||error).slice(0,240)},500);
  }
}

async function readJson(request){try{return await request.json()}catch(_){return null}}
function normalizeStoreFeatures(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const smart = source.tier === "smart" || (source.tier !== "standard" && (source.smartAssistantEnabled === true || source.historyEnabled === true));
  return JSON.stringify({ tier: smart ? "smart" : "standard", smartAssistantEnabled: smart, historyEnabled: smart });
}
function safeObjectJson(value){return JSON.stringify(value&&typeof value==="object"&&!Array.isArray(value)?value:{}) .slice(0,10000)}
async function audit(db,actor,action,targetType,targetId,details){
  try{await db.prepare("INSERT INTO daga_audit_log (actor_account_id,action,target_type,target_id,details_json) VALUES (?,?,?,?,?)").bind(actor,action,targetType,targetId,JSON.stringify(details||{}).slice(0,4000)).run()}catch(_){}
}
function json(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:cors(env,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"})})}
function cors(env,extra={}){const allowed=String(env.DAGA_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);const origin=allowed.includes("*")?"*":allowed.length===1?allowed[0]:"";return {...(origin?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Max-Age":"600","Vary":"Origin",...extra}}
