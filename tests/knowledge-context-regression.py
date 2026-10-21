#!/usr/bin/env python3
"""Static regression checks for LIVE DAGA curated knowledge context.

These checks complement runtime tests; they do not prove Cloudflare/D1 behavior.
"""
from pathlib import Path

worker = Path("worker.js").read_text(encoding="utf-8")
admin = Path("owner-admin.js").read_text(encoding="utf-8")
console = Path("owner-console.html").read_text(encoding="utf-8")
docs = Path("docs/DAGA-KNOWLEDGE-BASE.md").read_text(encoding="utf-8")

checks = {
    "knowledge is read only from active database entries":
        "WHERE is_active=1 ORDER BY updated_at DESC LIMIT 30" in worker,
    "combined prompt context is bounded":
        'curatedKnowledge.slice(0, 8000)' in worker,
    "knowledge is appended as context without replacing core instructions":
        "const finalInstructions = instructions +" in worker and
        "لا تتجاوز قواعد السلوك والخصوصية وعدم اختلاق البيانات" in worker,
    "owner authentication happens before knowledge admin routes":
        admin.index("const owner = await authenticatedOwner(request, db);") <
        admin.index('if (path === "/owner/admin/knowledge" && request.method === "GET")'),
    "knowledge API enforces 200-entry cap":
        "Number(count?.count || 0) >= 200" in admin,
    "knowledge create and edit enforce 4000-character cap":
        admin.count("content.length > 4000") >= 2,
    "knowledge writes are audit logged":
        "knowledge_entry_created" in admin and "knowledge_entry_updated" in admin,
    "owner console has knowledge management UI and API wiring":
        "معرفة ضجه" in console and "/owner/admin/knowledge" in console,
    "docs warn against secrets and sensitive customer data":
        "Do not put passwords, API keys, customer personal data" in docs,
    "docs distinguish draft from deployed behavior":
        "has not been merged or deployed" in docs,
}

for name, passed in checks.items():
    print(f'{"PASS" if passed else "FAIL"}: {name}')

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"{len(failed)} knowledge regression check(s) failed")
print(f"All {len(checks)} curated-knowledge static checks passed.")
