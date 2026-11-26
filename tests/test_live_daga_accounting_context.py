#!/usr/bin/env python3
"""Regression guards for dashboard-driven LIVE DAGA accounting and company-agnostic context."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
live = (root / "index.html").read_text(encoding="utf-8")
dashboard = (root / "shop-dashboard-v30.html").read_text(encoding="utf-8")
worker = (root / "worker.js").read_text(encoding="utf-8")

checks = {
    "company-agnostic assistant does not assume a mobile accessories shop": "ليس لنشاط ثابت" in live and "لمحل إكسسوارات موبايل" not in live,
    "dashboard snapshot carries stable column and entry identities": "schemaVersion:3" in dashboard and "id:String(c.id||'')" in dashboard and "treatment:String(e[2]?.treatment||'')" in dashboard,
    "other-company top-up increases its linked balance only": "if(delta>0)return {delta:0,agentDelta:delta,agentName:linkedAgent" in dashboard,
    "other-company consumption increases base money": "return {delta:-delta,agentDelta:0,agentName:null" in dashboard,
    "balance-agent deletion reduces base money": "if(delta<0)return {delta:delta,agentDelta:0,agentName:null" in dashboard,
    "balance-agent top-up does not change base money": "زيادة رصيد المندوب في عمود الرصيد تُسجل في حسابه فقط" in dashboard,
    "hypothetical accounting questions are answered from the live dashboard": "function answerLiveAccountingScenario(text)" in dashboard and "answerLiveAccountingScenario(text)" in dashboard,
    "hypothetical answers are explicitly read-only": "ده تحليل افتراضي فقط؛ مفيش أي تعديل اتسجل." in dashboard,
    "LIVE DAGA passes linked-company metadata to the model": "linkedCompany:e.linkedCompany||null" in live and "treatment:e.treatment||null" in live,

    "LIVE confirmation accepts Egyptian Arabic without literal backslash-s": r"return /^(ايوه|اه|تمام|ماشي|موافق|اكد|اعتمد|خلاص|اتفضل|اوكي|ok|okay|yes|نفذ|نفذها)( +" in dashboard,

    "read-only scenarios are handled before pending confirmation": dashboard.index("const earlyScenarioAnswer=answerLiveAccountingScenario(text)") < dashboard.index("if(dagaLiveOrderPending&&liveOrderConfirmation(text))"),
    "unmatched pending messages fall through to conversational AI": "sendLiveOrderReply(event.source,id,'',false);return;" in dashboard,
    "other-company wizard asks for company name": "اسم الشركة الأخرى المرتبطة بالبند" in dashboard and "اسم الشركة</label>" in dashboard,
    "LIVE iframe waits for parent confirmation response": "},15000);" in live,
    "LIVE assistant prompt preserves exact Super Bee spelling and spacing": "الاسم المعتمد «سوبر بي» وليس «سوبر باي»" in worker,
    "read-only scenario handling runs before destructive delete intent": dashboard.index("const earlyScenarioAnswer=answerLiveAccountingScenario(text)") < dashboard.index("const deleteIntent="),
    "failed LIVE confirmation clears stale pending approval": "dagaLivePendingOrder=null;dagaLivePendingDelete=null;dagaLivePendingClarification=null;" in dashboard,
    "LIVE scenario questions recognize plural delete and change verbs": "شيلنا|نشيل|حذفنا|الغينا" in dashboard and "زودنا|ضفنا|رفعنا|شحننا" in dashboard,
    "LIVE completed-operation questions consult the actual ledger": "آخر حركة مطابقة في سجل الداشبورد" in dashboard and "Array.isArray(ledger)" in dashboard,
    "outside reconciliation stores exact row indices to avoid duplicate-name false conflicts": "existingRows:matching.map(r=>({ci:r.ci,index:r.ei,name:r.name,amount:r.amount}))" in dashboard and "findEntry(r.ci,r.name,r.index)" in dashboard,
    "LIVE company session is retained when entitlement or company mapping needs attention": "e&&e.message==='authenticated_account_required'" in live and "تم تسجيل الدخول، لكن الحساب ليس مرتبطًا بشركة نشطة معتمدة" in live,
    "owner login fields use explicit LTR input and prevent native form reload": "onsubmit=\"return false\"" in (root / "owner-console.html").read_text(encoding="utf-8") and "unicode-bidi:plaintext" in (root / "owner-console.html").read_text(encoding="utf-8"),
    "manual dashboard edits are direct corrections and do not post accounting deltas": "const impact={delta:0,agentDelta:0,agentName:null" in dashboard and "ترحيل الفرق للفلوس الأساسية <b>لا يوجد — تعديل مباشر فقط</b>" in dashboard,
    "card entry edit offers asset or other-company classification": 'id="manualTreatment"' in dashboard and 'value="other_company"' in dashboard and 'id="manualCompany"' in dashboard,
    "manual card classification is saved with the entry metadata": "updatedMeta.treatment='asset'" in dashboard and "updatedMeta.treatment='other_company'" in dashboard and "updatedMeta.linkedCompany=p.manualCompany" in dashboard,
    "manual edit preview shows selected card treatment and company name": "تصنيف البند <b>${manualTreatment==='asset'?'أصل':'شركة أخرى'}</b>" in dashboard and "الشركة المرتبطة <b>${esc(manualCompany)}</b>" in dashboard,
    "existing linked company metadata is preserved as the selected edit treatment": "||!!meta.linkedCompany?'other_company':'asset'" in dashboard,
    "switching card treatment clears stale company linkage when changed to asset": "updatedMeta.linkedCompany=null;updatedMeta.serviceAgent=null" in dashboard,
    "dashboard label is dynamic and not a fixed company type": "اسم العمود والبند الظاهر للمستخدم قد يتغير" in live,
    "worker identifies the context as current dashboard data": "سياق الشركة والداشبورد الحالي المرسل من الواجهة" in worker,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + ": " + name)
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"{len(failed)} LIVE DAGA accounting-context check(s) failed")
print(f"All {len(checks)} LIVE DAGA accounting-context checks passed.")
