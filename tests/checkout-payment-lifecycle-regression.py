#!/usr/bin/env python3
"""Static regression checks for server-side checkout and owner-confirmed payment."""
from pathlib import Path

orders = Path("company-orders.js").read_text(encoding="utf-8")
admin = Path("owner-admin.js").read_text(encoding="utf-8")
checks = {
    "only approved store owner can checkout": 'account.role !== "store_owner"' in orders and "ownedApprovedStore(db, account.id, storeId)" in orders,
    "plan price is loaded server-side": 'SELECT id,service,price_minor,currency,duration_days,word_quota,version FROM daga_plans WHERE id=? AND is_active=1' in orders,
    "price and discount snapshot is stored with order": "INSERT INTO daga_order_price_adjustments" in orders and "agreed_price_minor" in orders,
    "inactive or outdated plan is guarded at insert": "version=? AND service=?" in orders and "status='approved'" in orders,
    "payment submission uses order agreed price": "Number(order.agreed_price_minor)" in orders,
    "payment submission stays pending review": "'pending_review'" in orders and '"payment_submission_already_pending"' in orders,
    "payment receipt URL must be HTTPS": "isHttpsUrl(receiptUrl)" in orders,
    "owner review rejects duplicate or invalid state": "payment_already_reviewed_or_order_not_reviewable" in admin and "status='pending_review'" in admin,
    "confirmed payment amount must match agreed price": "claimed_amount_does_not_match_order_price" in admin,
    "entitlement requires confirmed payment and paid order": "ps.status='confirmed'" in admin and "o.status='paid_approved'" in admin and "INSERT INTO daga_entitlements" in admin,
    "LIVE DAGA words credit only follows confirmed payment": "INSERT INTO daga_live_word_ledger" in admin and '"order:"+sub.order_id' in admin,
    "payment review is audit logged": 'audit(db,owner.id,"payment_reviewed"' in admin,
    "word adjustment retries cannot double credit": "word_adjustment_request_id_conflict" in admin and "duplicate:true" in admin,
}
for name, ok in checks.items():
    print(f'{"PASS" if ok else "FAIL"}: {name}')
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"{len(failed)} checkout/payment check(s) failed")
print(f"All {len(checks)} checkout/payment lifecycle checks passed.")
