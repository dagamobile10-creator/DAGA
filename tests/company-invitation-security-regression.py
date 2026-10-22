#!/usr/bin/env python3
"""Security regression checks for company invitation authorization and token handling."""
from pathlib import Path

src = Path("company-invitations.js").read_text(encoding="utf-8")
checks = {
    "invitation endpoints authenticate before dispatch": src.index("const account = await authenticatedAccount(request, db);") < src.index("if (path === \"/api/company/invitations\" && request.method === \"POST\")"),
    "inactive accounts and program owners are denied": 'account.status !== "approved" || account.role === "program_owner"' in src,
    "invitation token is hashed before database lookup": 'const tokenHash = await sha256(token);' in src and 'WHERE i.token_hash=?' in src,
    "accept requires pending unused single-use unexpired token": "i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>?" in src,
    "store owner and program owner cannot accept staff invitations": '["store_owner", "program_owner"].includes(account.role)' in src,
    "manager invitation permission is enforced": "manager_invitation_permission_disabled" in src and "manager_can_only_invite_employees" in src,
    "manager invite list is scoped to own invitations": "WHERE store_id=? AND inviter_account_id=?" in src,
    "manager revoke is limited to own employee invitations": 'authority.role === "manager"' in src and 'invite.intended_role !== "employee"' in src and "invite.inviter_account_id !== account.id" in src,
    "invitation create rate limits account and IP": "company-invite-create-account:" in src and "company-invite-create-ip:" in src,
    "invitation TTL is capped": "hours > MAX_INVITE_TTL_HOURS" in src and "MAX_INVITE_TTL_HOURS = 24 * 14" in src,
    "membership is created only after accepted invitation claim": "status='accepted' AND accepted_by_account_id=? AND use_count=1" in src,
}
for name, ok in checks.items():
    print(f'{"PASS" if ok else "FAIL"}: {name}')
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"{len(failed)} invitation security check(s) failed")
print(f"All {len(checks)} invitation security checks passed.")
