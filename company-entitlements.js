export function isSmartStoreEntitlement(entitlement) {
  if (!entitlement) return false;
  let features = {};
  try {
    features = typeof entitlement.features_json === "string"
      ? JSON.parse(entitlement.features_json || "{}")
      : (entitlement.features && typeof entitlement.features === "object" ? entitlement.features : {});
    if (!features || typeof features !== "object" || Array.isArray(features)) features = {};
  } catch (_) { features = {}; }
  const explicitTier = String(features.tier || "").trim().toLowerCase();
  if (explicitTier === "standard") return false;
  if (explicitTier === "smart") return true;
  return features.smartAssistantEnabled === true
    || features.historyEnabled === true
    || /smart|ذكي/i.test(String(entitlement.name || ""));
}

export async function getActiveStoreEntitlement(db, storeId, now = new Date().toISOString()) {
  if (!db || !storeId) return null;
  return db.prepare(
    "SELECT p.name,p.features_json FROM daga_entitlements e " +
    "LEFT JOIN daga_plan_orders o ON o.id=e.order_id " +
    "LEFT JOIN daga_plans p ON p.id=o.plan_id " +
    "WHERE e.store_id=? AND e.service='store' AND e.status='active' " +
    "AND e.starts_at<=? AND e.expires_at>? " +
    "ORDER BY e.starts_at DESC,e.created_at DESC LIMIT 1"
  ).bind(storeId, now, now).first();
}
