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

    if (path === "/owner/admin/plans" && request.method === "GET") {
      const result = await db.prepare("SELECT id,service,name,price_minor,currency,duration_days,word_quota,features_json,is_active,version,updated_at FROM daga_plans ORDER BY service,name").all();
      return json(env, { ok: true, plans: result.results || [] });
    }
    if (path === "/owner/admin/plans" && request.method === "POST") {
      const b = await readJson(request); if (!b) return json(env, { error: "invalid_json" }, 400);
      const service = String(b.service || "");
      const name = String(b.name || "").trim().slice(0, 100);
      const price = Number(b.priceMinor);
      const duration = Number(b.durationDays ?? 30);
      const quota = b.wordQuota == null ? null : Number(b.wordQuota);
      if (!["store","live_daga"].includes(service) || !name || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(duration) || duration < 1 || duration > 3650 || (quota !== null && (!Number.isSafeInteger(quota) || quota < 1))) return json(env, { error: "invalid_plan_fields" }, 400);
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const features = safeObjectJson(b.features);
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
      const price = b.priceMinor === undefined ? existing.price_minor : Number(b.priceMinor);
      const duration = b.durationDays === undefined ? existing.duration_days : Number(b.durationDays);
      const quota = b.wordQuota === undefined ? existing.word_quota : (b.wordQuota === null ? null : Number(b.wordQuota));
      const active = b.isActive === undefined ? existing.is_active : (b.isActive ? 1 : 0);
      if (!name || !Number.isSafeInteger(price) || price<0 || !Number.isInteger(duration) || duration<1 || duration>3650 || (quota!==null&&(!Number.isSafeInteger(quota)||quota<1))) return json(env, {error:"invalid_plan_fields"},400);
      await db.prepare("UPDATE daga_plans SET name=?,price_minor=?,duration_days=?,word_quota=?,is_active=?,version=version+1,updated_by=?,updated_at=? WHERE id=?")
        .bind(name,price,duration,quota,active,owner.id,new Date().toISOString(),planMatch[1]).run();
      await audit(db,owner.id,"plan_updated","daga_plans",planMatch[1],{version:existing.version+1});
      return json(env, {ok:true,version:existing.version+1});
    }

    if(path==="/owner/admin/promotions"&&request.method==="GET"){
      const r=await db.prepare("SELECT id,code,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemption_count,is_active,created_at,updated_at FROM daga_promotions ORDER BY created_at DESC").all();
      return json(env,{ok:true,promotions:r.results||[]});
    }
    if(path==="/owner/admin/promotions"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const code=String(b.code||"").trim().toUpperCase(),name=String(b.name||"").trim().slice(0,100),service=String(b.service||"both"),type=String(b.discountType||"percent"),value=Number(b.discountValue);
      let starts=null,ends=null;
      try{starts=b.startsAt?new Date(b.startsAt).toISOString():null;ends=b.endsAt?new Date(b.endsAt).toISOString():null;}catch(_){return json(env,{error:"invalid_promotion_dates"},400);}
      const max=b.maxRedemptions==null?null:Number(b.maxRedemptions);
      if(!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)||!name||!["store","live_daga","both"].includes(service)||!["percent","fixed"].includes(type)||!Number.isSafeInteger(value)||value<1||(type==="percent"&&value>100)||(max!==null&&(!Number.isSafeInteger(max)||max<1))||(starts&&ends&&starts>=ends))return json(env,{error:"invalid_promotion_fields"},400);
      const id=crypto.randomUUID(),now=new Date().toISOString();
      try{await db.prepare("INSERT INTO daga_promotions (id,code,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,code,name,service,type,value,starts,ends,max,owner.id,now,now).run();}
      catch(_){return json(env,{error:"promotion_code_already_exists"},409);}
      await audit(db,owner.id,"promotion_created","daga_promotions",id,{code,service,type,value});
      return json(env,{ok:true,id},201);
    }
    const promoMatch=path.match(/^\/owner\/admin\/promotions\/([a-f0-9-]{36})$/i);
    if(promoMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const old=await db.prepare("SELECT * FROM daga_promotions WHERE id=?").bind(promoMatch[1]).first();
      if(!old)return json(env,{error:"promotion_not_found"},404);
      const name=b.name===undefined?old.name:String(b.name).trim().slice(0,100);
      const active=b.isActive===undefined?old.is_active:(b.isActive?1:0);
      let starts=old.starts_at,ends=old.ends_at;
      try{if(b.startsAt!==undefined)starts=b.startsAt?new Date(b.startsAt).toISOString():null;if(b.endsAt!==undefined)ends=b.endsAt?new Date(b.endsAt).toISOString():null;}catch(_){return json(env,{error:"invalid_promotion_dates"},400);}
      const max=b.maxRedemptions===undefined?old.max_redemptions:(b.maxRedemptions===null?null:Number(b.maxRedemptions));
      if(!name||(max!==null&&(!Number.isSafeInteger(max)||max<1))||(starts&&ends&&starts>=ends))return json(env,{error:"invalid_promotion_fields"},400);
      await db.prepare("UPDATE daga_promotions SET name=?,is_active=?,starts_at=?,ends_at=?,max_redemptions=?,updated_at=? WHERE id=?").bind(name,active,starts,ends,max,new Date().toISOString(),old.id).run();
      await audit(db,owner.id,"promotion_updated","daga_promotions",old.id,{isActive:active});
      return json(env,{ok:true});
    }

    if(path==="/owner/admin/offers"&&request.method==="GET"){
      const r=await db.prepare("SELECT id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemption_count,is_active,created_at,updated_at FROM daga_offers ORDER BY created_at DESC").all();
      return json(env,{ok:true,offers:r.results||[]});
    }
    if(path==="/owner/admin/offers"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const name=String(b.name||"").trim().slice(0,100),service=String(b.service||""),type=String(b.discountType||""),value=Number(b.discountValue);
      const max=b.maxRedemptions==null?null:Number(b.maxRedemptions);
      const starts=b.startsAt?new Date(b.startsAt).toISOString():null,ends=b.endsAt?new Date(b.endsAt).toISOString():null;
      if(!name||!["store","live_daga"].includes(service)||!["fixed_minor","percent"].includes(type)||!Number.isSafeInteger(value)||value<1||(type==="percent"&&value>100)||(max!==null&&(!Number.isInteger(max)||max<1))||(starts&&ends&&Date.parse(ends)<=Date.parse(starts)))return json(env,{error:"invalid_offer_fields"},400);
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await db.prepare("INSERT INTO daga_offers (id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,name,service,type,value,starts,ends,max,owner.id,now,now).run();
      await audit(db,owner.id,"offer_created","daga_offers",id,{name,service,discountType:type,discountValue:value});
      return json(env,{ok:true,id},201);
    }
    const offerMatch=path.match(/^\\/owner\\/admin\\/offers\\/([a-f0-9-]{36})$/i);
    if(offerMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const old=await db.prepare("SELECT * FROM daga_offers WHERE id=?").bind(offerMatch[1]).first();
      if(!old)return json(env,{error:"offer_not_found"},404);
      const name=b.name===undefined?old.name:String(b.name).trim().slice(0,100);
      const value=b.discountValue===undefined?old.discount_value:Number(b.discountValue);
      const active=b.isActive===undefined?old.is_active:(b.isActive?1:0);
      const starts=b.startsAt===undefined?old.starts_at:(b.startsAt?new Date(b.startsAt).toISOString():null);
      const ends=b.endsAt===undefined?old.ends_at:(b.endsAt?new Date(b.endsAt).toISOString():null);
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

    if(path==="/owner/admin/stores"&&request.method==="GET"){
      const r=await db.prepare("SELECT s.id,s.owner_account_id,s.legal_identity,s.display_name,s.status,s.created_at,a.phone_e164,a.email FROM daga_stores s JOIN daga_accounts a ON a.id=s.owner_account_id ORDER BY s.created_at DESC LIMIT 500").all();
      return json(env, {ok:true,stores:r.results||[]});
    }
    const storeEditMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})$/i);
    if(storeEditMatch&&request.method==="PATCH"){
      const b=await readJson(request);if(!b)return json(env,{error:"invalid_json"},400);
      const store=await db.prepare("SELECT id,display_name,legal_identity FROM daga_stores WHERE id=?").bind(storeEditMatch[1]).first();
      if(!store)return json(env,{error:"store_not_found"},404);
      const displayName=b.displayName===undefined?store.display_name:String(b.displayName).trim().slice(0,120);
      if(!displayName)return json(env,{error:"display_name_required"},400);
      await db.prepare("UPDATE daga_stores SET display_name=?,updated_at=? WHERE id=?").bind(displayName,new Date().toISOString(),store.id).run();
      await audit(db,owner.id,"store_display_name_changed","daga_stores",store.id,{legalIdentityUnchanged:true});
      return json(env,{ok:true,displayName,legalIdentityUnchanged:true});
    }

    const storeMatch=path.match(/^\/owner\/admin\/stores\/([a-f0-9-]{36})\/decision$/i);
    if(storeMatch&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      if(!["approved","rejected","suspended"].includes(b.status))return json(env, {error:"invalid_store_status"},400);
      const store=await db.prepare("SELECT id,owner_account_id,status FROM daga_stores WHERE id=?").bind(storeMatch[1]).first();
      if(!store)return json(env, {error:"store_not_found"},404);
      const now=new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE daga_stores SET status=?,updated_at=? WHERE id=?").bind(b.status,now,store.id),
        db.prepare("UPDATE daga_accounts SET status=?,updated_at=? WHERE id=? AND role='store_owner'").bind(b.status,now,store.owner_account_id)
      ]);
      await audit(db,owner.id,"store_status_changed","daga_stores",store.id,{from:store.status,to:b.status});
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
        db.prepare("UPDATE daga_payment_submissions SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending_review'").bind(b.status,owner.id,now,sub.id),
        db.prepare("UPDATE daga_plan_orders SET status=?,updated_at=? WHERE id=? AND status IN ('payment_submitted','under_review')").bind(b.status==="confirmed"?"paid_approved":"rejected",now,sub.order_id)
      ];
      if(b.status==="confirmed"){
        const entitlementId=crypto.randomUUID(), starts=now, expires=new Date(Date.now()+Number(sub.duration_days)*86400000).toISOString();
        statements.push(db.prepare("INSERT INTO daga_entitlements (id,account_id,store_id,service,order_id,starts_at,expires_at,status) VALUES (?,?,?,?,?,?,?,'active')").bind(entitlementId,sub.account_id,sub.store_id,sub.service,sub.order_id,starts,expires));
        if(sub.service==="live_daga"&&Number(sub.word_quota)>0) statements.push(db.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,order_id,event_type,words,request_id,note) VALUES (?,?,?,?,'credit',?,?,?)").bind(crypto.randomUUID(),sub.account_id,sub.store_id,sub.order_id,Number(sub.word_quota),"order:"+sub.order_id,"Owner-confirmed LIVE DAGA purchase"));
      }
      await db.batch(statements);
      await audit(db,owner.id,"payment_reviewed","daga_payment_submissions",sub.id,{status:b.status,orderId:sub.order_id});
      return json(env, {ok:true,status:b.status});
    }

    if(path==="/owner/admin/words/adjust"&&request.method==="POST"){
      const b=await readJson(request);if(!b)return json(env, {error:"invalid_json"},400);
      const accountId=String(b.accountId||""), storeId=b.storeId?String(b.storeId):null, words=Number(b.words), requestId=String(b.requestId||"").trim(), note=String(b.note||"").trim().slice(0,240);
      if(!/^[a-f0-9-]{36}$/i.test(accountId)||!Number.isSafeInteger(words)||words<1||words>100000000||requestId.length<12||requestId.length>128)return json(env, {error:"invalid_word_adjustment"},400);
      const prior=await db.prepare("SELECT id FROM daga_live_word_ledger WHERE request_id=?").bind(requestId).first();
      if(prior)return json(env, {ok:true,duplicate:true,entryId:prior.id});
      const account=await db.prepare("SELECT id,role,status,store_id FROM daga_accounts WHERE id=?").bind(accountId).first();
      if(!account||account.status!=="approved"||account.role==="program_owner")return json(env, {error:"eligible_account_not_found"},404);
      if(storeId&&account.store_id!==storeId)return json(env, {error:"store_account_mismatch"},409);
      const id=crypto.randomUUID();
      await db.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,event_type,words,request_id,note) VALUES (?,?,?,'credit',?,?,?)").bind(id,accountId,storeId,words,requestId,note||"Owner adjustment").run();
      await audit(db,owner.id,"live_words_credited","daga_live_word_ledger",id,{accountId,words,requestId});
      return json(env, {ok:true,entryId:id},201);
    }

    if(path==="/owner/admin/columns"&&request.method==="GET"){
      const r=await db.prepare("SELECT id,scope,store_id,stable_key,display_name,data_type,behavior_json,calculation_key,is_enabled,updated_at FROM daga_column_definitions ORDER BY scope,store_id,stable_key").all();
      return json(env, {ok:true,columns:r.results||[]});
    }
    const columnMatch = path.match(/^\/owner\/admin\/plans\/([a-f0-9-]{36})$/i);
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
function safeObjectJson(value){return JSON.stringify(value&&typeof value==="object"&&!Array.isArray(value)?value:{}) .slice(0,10000)}
async function audit(db,actor,action,targetType,targetId,details){
  try{await db.prepare("INSERT INTO daga_audit_log (actor_account_id,action,target_type,target_id,details_json) VALUES (?,?,?,?,?)").bind(actor,action,targetType,targetId,JSON.stringify(details||{}).slice(0,4000)).run()}catch(_){}
}
function json(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:cors(env,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"})})}
function cors(env,extra={}){const allowed=String(env.DAGA_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);const origin=allowed.includes("*")?"*":allowed.length===1?allowed[0]:allowed.length===0?"*":"";return {...(origin?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"GET,POST,PATCH,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Max-Age":"600","Vary":"Origin",...extra}}
