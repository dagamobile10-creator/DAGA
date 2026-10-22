import { authenticatedAccount } from "./owner-auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleCompanyOrders(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const orderPayment = path.match(/^\/api\/company\/orders\/([0-9a-f-]{36})\/payment$/i);
  const known = new Set([
    "/api/company/plans",
    "/api/company/payment-methods",
    "/api/company/offers",
    "/api/company/orders"
  ]);
  if (!known.has(path) && !orderPayment) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (!["GET", "POST"].includes(request.method)) return json(env, { error: "method_not_allowed" }, 405);

  const db = env.DAGA_APP_DB;
  if (!db) return json(env, { error: "application_database_not_configured" }, 503);
  const account = await authenticatedAccount(request, db);
  if (!account) return json(env, { error: "authentication_required" }, 401);
  if (account.role !== "store_owner") return json(env, { error: "store_owner_required" }, 403);

  if (path === "/api/company/plans" && request.method === "GET") {
    const service = String(url.searchParams.get("service") || "").trim();
    if (service && !["store", "live_daga"].includes(service)) return json(env, { error: "invalid_service" }, 400);
    const query = service
      ? db.prepare("SELECT id,service,name,price_minor,currency,duration_days,word_quota,features_json,version FROM daga_plans WHERE is_active=1 AND service=? ORDER BY price_minor,name").bind(service)
      : db.prepare("SELECT id,service,name,price_minor,currency,duration_days,word_quota,features_json,version FROM daga_plans WHERE is_active=1 ORDER BY service,price_minor,name");
    const result = await query.all();
    return json(env, { ok: true, plans: result.results || [] });
  }

  if (path === "/api/company/payment-methods" && request.method === "GET") {
    const result = await db.prepare("SELECT id,provider,display_label,destination_value,instructions FROM daga_payment_methods WHERE is_active=1 ORDER BY provider").all();
    return json(env, { ok: true, paymentMethods: result.results || [] });
  }

  if (path === "/api/company/offers" && request.method === "GET") {
    const service = String(url.searchParams.get("service") || "").trim();
    if (!["store", "live_daga"].includes(service)) return json(env, { error: "valid_service_required" }, 400);
    const now = new Date().toISOString();
    const result = await db.prepare("SELECT id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemption_count FROM daga_offers WHERE is_active=1 AND service=? AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) AND (max_redemptions IS NULL OR redemption_count<max_redemptions) ORDER BY created_at DESC").bind(service, now, now).all();
    return json(env, { ok: true, offers: result.results || [] });
  }

  if (path === "/api/company/orders" && request.method === "GET") {
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    if (!UUID.test(storeId)) return json(env, { error: "valid_store_id_required" }, 400);
    const store = await ownedApprovedStore(db, account.id, storeId);
    if (!store) return json(env, { error: "approved_owned_store_required" }, 403);
    const result = await db.prepare("SELECT o.id,o.store_id,o.plan_id,o.plan_version,o.agreed_price_minor,o.currency,o.status,o.created_at,o.updated_at,p.service,p.name AS plan_name,p.duration_days,p.word_quota,a.list_price_minor,a.discount_minor,a.final_price_minor,a.offer_name_snapshot,ps.status AS payment_status,ps.transaction_reference,ps.submitted_at FROM daga_plan_orders o JOIN daga_plans p ON p.id=o.plan_id LEFT JOIN daga_order_price_adjustments a ON a.order_id=o.id LEFT JOIN daga_payment_submissions ps ON ps.order_id=o.id WHERE o.account_id=? AND o.store_id=? ORDER BY o.created_at DESC LIMIT 100").bind(account.id, storeId).all();
    return json(env, { ok: true, orders: result.results || [] });
  }

  if (path === "/api/company/orders" && request.method === "POST") {
    const parsed = await readJson(request, 12000);
    if (!parsed.ok) return json(env, { error: parsed.error }, parsed.status);
    const body = parsed.value;
    const storeId = String(body.storeId || "").trim();
    const planId = String(body.planId || "").trim();
    const offerId = body.offerId == null || body.offerId === "" ? null : String(body.offerId).trim();
    if (!UUID.test(storeId) || !UUID.test(planId) || (offerId && !UUID.test(offerId))) return json(env, { error: "valid_store_plan_and_optional_offer_ids_required" }, 400);
    const store = await ownedApprovedStore(db, account.id, storeId);
    if (!store) return json(env, { error: "approved_owned_store_required" }, 403);
    const plan = await db.prepare("SELECT id,service,price_minor,currency,duration_days,word_quota,version FROM daga_plans WHERE id=? AND is_active=1").bind(planId).first();
    if (!plan) return json(env, { error: "active_plan_not_found" }, 404);

    let offer = null;
    let discount = 0;
    let offerName = null;
    if (offerId) {
      const now = new Date().toISOString();
      offer = await db.prepare("SELECT id,name,service,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemption_count FROM daga_offers WHERE id=? AND is_active=1 AND service=? AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) AND (max_redemptions IS NULL OR redemption_count<max_redemptions)").bind(offerId, plan.service, now, now).first();
      if (!offer) return json(env, { error: "offer_not_available" }, 409);
      discount = offer.discount_type === "percent"
        ? Math.floor(Number(plan.price_minor) * Number(offer.discount_value) / 100)
        : Math.min(Number(plan.price_minor), Number(offer.discount_value));
      offerName = offer.name;
    }
    const listPrice = Number(plan.price_minor);
    const finalPrice = Math.max(0, listPrice - discount);
    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();

    if (offer) {
      const reserved = await db.prepare("UPDATE daga_offers SET redemption_count=redemption_count+1,updated_at=? WHERE id=? AND is_active=1 AND service=? AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) AND (max_redemptions IS NULL OR redemption_count<max_redemptions) RETURNING id")
        .bind(now, offer.id, plan.service, now, now).first();
      if (!reserved) return json(env, { error: "offer_redemption_limit_reached" }, 409);
    }

    try {
      const results = await db.batch([
        db.prepare("INSERT INTO daga_plan_orders (id,account_id,store_id,plan_id,plan_version,agreed_price_minor,currency,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'awaiting_payment',?,? FROM daga_plans WHERE id=? AND is_active=1 AND version=? AND service=? AND EXISTS (SELECT 1 FROM daga_stores WHERE id=? AND owner_account_id=? AND status='approved')")
          .bind(orderId, account.id, storeId, plan.id, plan.version, finalPrice, plan.currency, now, now, plan.id, plan.version, plan.service, storeId, account.id),
        db.prepare("INSERT INTO daga_order_price_adjustments (id,order_id,offer_id,list_price_minor,discount_minor,final_price_minor,offer_name_snapshot,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daga_plan_orders WHERE id=?)")
          .bind(crypto.randomUUID(), orderId, offer?.id || null, listPrice, discount, finalPrice, offerName, now, orderId)
      ]);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
        if (offer) await db.prepare("UPDATE daga_offers SET redemption_count=CASE WHEN redemption_count>0 THEN redemption_count-1 ELSE 0 END WHERE id=?").bind(offer.id).run();
        return json(env, { error: "plan_or_store_changed_retry" }, 409);
      }
      if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
        // The order must never exist without its immutable price/discount snapshot.
        await db.prepare("DELETE FROM daga_plan_orders WHERE id=? AND account_id=? AND status='awaiting_payment' AND NOT EXISTS (SELECT 1 FROM daga_payment_submissions WHERE order_id=?)")
          .bind(orderId, account.id, orderId).run();
        if (offer) await db.prepare("UPDATE daga_offers SET redemption_count=CASE WHEN redemption_count>0 THEN redemption_count-1 ELSE 0 END WHERE id=?").bind(offer.id).run();
        return json(env, { error: "order_price_snapshot_failed" }, 500);
      }
      return json(env, { ok: true, order: { id: orderId, storeId, planId, service: plan.service, planVersion: plan.version, currency: plan.currency, listPriceMinor: listPrice, discountMinor: discount, agreedPriceMinor: finalPrice, offerName, status: "awaiting_payment" } }, 201);
    } catch (_) {
      if (offer) {
        try { await db.prepare("UPDATE daga_offers SET redemption_count=CASE WHEN redemption_count>0 THEN redemption_count-1 ELSE 0 END WHERE id=?").bind(offer.id).run(); } catch (_) {}
      }
      return json(env, { error: "order_creation_failed" }, 500);
    }
  }

  if (orderPayment && request.method === "POST") {
    const orderId = orderPayment[1];
    const parsed = await readJson(request, 12000);
    if (!parsed.ok) return json(env, { error: parsed.error }, parsed.status);
    const body = parsed.value;
    const methodId = String(body.paymentMethodId || "").trim();
    const reference = String(body.transactionReference || "").trim().slice(0, 160);
    const receiptUrl = String(body.receiptUrl || "").trim();
    if (!UUID.test(methodId) || (!reference && !receiptUrl) || (receiptUrl && !isHttpsUrl(receiptUrl))) return json(env, { error: "valid_payment_method_and_transaction_reference_or_https_receipt_required" }, 400);
    const method = await db.prepare("SELECT id FROM daga_payment_methods WHERE id=? AND is_active=1").bind(methodId).first();
    if (!method) return json(env, { error: "active_payment_method_not_found" }, 404);
    const order = await db.prepare("SELECT id,store_id,agreed_price_minor,status FROM daga_plan_orders WHERE id=? AND account_id=?").bind(orderId, account.id).first();
    if (!order) return json(env, { error: "order_not_found" }, 404);
    const store = await ownedApprovedStore(db, account.id, order.store_id);
    if (!store) return json(env, { error: "approved_owned_store_required" }, 403);
    if (order.status !== "awaiting_payment") return json(env, { error: "order_not_awaiting_payment" }, 409);
    const submissionId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      const results = await db.batch([
        db.prepare("INSERT INTO daga_payment_submissions (id,order_id,payment_method_id,claimed_amount_minor,transaction_reference,receipt_url,submitted_at,status) SELECT ?,?,?,?,?,?,?,'pending_review' WHERE EXISTS (SELECT 1 FROM daga_plan_orders WHERE id=? AND account_id=? AND status='awaiting_payment') AND EXISTS (SELECT 1 FROM daga_payment_methods WHERE id=? AND is_active=1)")
          .bind(submissionId, orderId, methodId, Number(order.agreed_price_minor), reference || null, receiptUrl || null, now, orderId, account.id, methodId),
        db.prepare("UPDATE daga_plan_orders SET status='payment_submitted',updated_at=? WHERE id=? AND account_id=? AND status='awaiting_payment' AND EXISTS (SELECT 1 FROM daga_payment_submissions WHERE id=? AND order_id=?)")
          .bind(now, orderId, account.id, submissionId, orderId)
      ]);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1 || Number(results?.[1]?.meta?.changes || 0) !== 1) return json(env, { error: "order_payment_state_changed_retry" }, 409);
      return json(env, { ok: true, paymentSubmission: { id: submissionId, orderId, status: "pending_review", claimedAmountMinor: Number(order.agreed_price_minor) } }, 201);
    } catch (_) {
      try {
        const pending = await db.prepare("SELECT id FROM daga_payment_submissions WHERE order_id=? AND status='pending_review'").bind(orderId).first();
        if (pending) return json(env, { error: "payment_submission_already_pending" }, 409);
      } catch (_) {}
      return json(env, { error: "payment_submission_failed" }, 500);
    }
  }

  return json(env, { error: "method_not_allowed" }, 405);
}

async function ownedApprovedStore(db, accountId, storeId) {
  return db.prepare("SELECT id,public_id,display_name FROM daga_stores WHERE id=? AND owner_account_id=? AND status='approved'").bind(storeId, accountId).first();
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maxBytes) return { ok: false, status: 413, error: "request_body_too_large" };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return { ok: false, status: 413, error: "request_body_too_large" };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, status: 400, error: "json_object_required" };
    return { ok: true, value };
  } catch (_) {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && url.username === "" && url.password === "";
  } catch (_) { return false; }
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(env, { "Content-Type": "application/json; charset=utf-8" }) });
}

function cors(env, extra = {}) {
  const allowed = String(env.DAGA_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  const origin = allowed.includes("*") ? "*" : allowed.length === 1 ? allowed[0] : allowed.includes("null") ? "null" : "";
  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Vary": "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "600", ...extra };
}
