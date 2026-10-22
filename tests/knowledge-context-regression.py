#!/usr/bin/env python3
"""Static regression checks for LIVE DAGA curated knowledge context."""
from pathlib import Path
worker = Path("worker.js").read_text(encoding="utf-8")
admin = Path("owner-admin.js").read_text(encoding="utf-8")
console = Path("owner-console.html").read_text(encoding="utf-8")
docs = Path("docs/DAGA-KNOWLEDGE-BASE.md").read_text(encoding="utf-8")
checks = {
    "active DB entries only": "WHERE is_active=1 ORDER BY updated_at DESC LIMIT 30" in worker,
    "combined context bounded": "curatedKnowledge.slice(0, 8000)" in worker,
    "core instructions preserved": "const finalInstructions = instructions +" in worker and "لا تتجاوز قواعد السلوك والخصوصية وعدم اختلاق البيانات" in worker,
    "owner gate precedes knowledge routes": admin.index("const owner = await authenticatedOwner(request, db);") < admin.index('if (path === "/owner/admin/knowledge" && request.method === "GET")'),
    "entry count bounded": "Number(count?.count || 0) >= 200" in admin,
    "create and edit size bounded": admin.count("content.length > 4000") >= 2,
    "audit events present": "knowledge_entry_created" in admin and "knowledge_entry_updated" in admin,
    "console UI wired": "معرفة ضجه" in console and "/owner/admin/knowledge" in console,
    "sensitive data warning": "Do not put passwords, API keys, customer personal data" in docs,
    "draft release status documented": "has not been merged or deployed" in docs,
}
for name, passed in checks.items():
    print(f'{"PASS" if passed else "FAIL"}: {name}')
failed=[name for name,passed in checks.items() if not passed]
if failed: raise SystemExit(f"{len(failed)} check(s) failed")
print(f"All {len(checks)} checks passed.")
