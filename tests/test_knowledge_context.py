#!/usr/bin/env python3
"""Regression guards for owner-managed LIVE DAGA knowledge context."""
from pathlib import Path
worker = Path("worker.js").read_text(encoding="utf-8")
admin = Path("owner-admin.js").read_text(encoding="utf-8")
console = Path("owner-console.html").read_text(encoding="utf-8")
checks = {
    "chat context loads active entries only": "WHERE is_active=1 ORDER BY updated_at DESC LIMIT 30" in worker,
    "knowledge context is bounded": "curatedKnowledge.slice(0, 8000)" in worker,
    "all chat providers receive the augmented system context": worker.count("content: finalInstructions") >= 2 and "instructions: finalInstructions, input: conversation" in worker,
    "knowledge routes require authenticated owner before dispatch": admin.index("const owner = await authenticatedOwner(request, db);") < admin.index('if (path === "/owner/admin/knowledge" && request.method === "GET")'),
    "entry CRUD supports create and patch": 'path === "/owner/admin/knowledge" && request.method === "POST"' in admin and "if (knowledgeMatch && request.method === \"PATCH\")" in admin,
    "entry limits are enforced": "Number(count?.count || 0) >= 200" in admin and admin.count("content.length > 4000") >= 2,
    "audit trail records create and update": "knowledge_entry_created" in admin and "knowledge_entry_updated" in admin,
    "owner console exposes editor and status controls": "معرفة ضجّة" in console and "data-knowledge-toggle" in console and "knowledgeForm" in console,
    "worker routes owner admin module": 'handleOwnerAdmin(request, env, url)' in worker,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + ": " + name)
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"{len(failed)} knowledge regression check(s) failed")
print(f"All {len(checks)} knowledge regression checks passed.")
