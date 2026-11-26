#!/usr/bin/env python3
"""Ensure LIVE DAGA follows the dashboard's saved accounting treatment, not stale service-name rules."""
from pathlib import Path
live = (Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8")
dashboard = (Path(__file__).resolve().parents[1] / "shop-dashboard-v30.html").read_text(encoding="utf-8")
checks = {
    "LIVE DAGA treats saved card treatment as source of truth": "مصدر الحقيقة هو نوع البند المحفوظ" in live,
    "asset increase/decrease semantics are explicit": "نوعه أصل" in live and "أعد نفس القيمة إلى الفلوس الأساسية" in live,
    "other-company settlement is separate from assets": "نوعه شركة أخرى" in live and "لا تخلط تسوية الشركة الأخرى بتسوية الأصول" in live,
    "ordinary entries do not assume automatic settlement": "البند العادي لا تفترض له تسوية تلقائية" in live,
    "stale service-name mapping is absent": "صفوف الخدمات داخل عمود الكروت" not in live and "ممكن تتبع مندوب ممكن" not in live,
    "preview impacts remain the execution source": "increaseImpact" in live and "decreaseImpact" in live,
    "dashboard implements explicit asset and linked-company treatments": "other_company" in dashboard and "moneyImpactForManualEdit" in dashboard,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + ": " + name)
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"{len(failed)} accounting-context check(s) failed")
print(f"All {len(checks)} LIVE DAGA accounting-context checks passed.")
