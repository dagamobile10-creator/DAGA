#!/usr/bin/env python3
"""Static regression checks for company-owner, employee, and manager account lifecycle."""
from pathlib import Path

portal = Path("company/portal.html").read_text(encoding="utf-8")
auth = Path("company-invitations.js").read_text(encoding="utf-8")
owner_ui = Path("owner-console.html").read_text(encoding="utf-8")
worker = Path("worker.js").read_text(encoding="utf-8")

checks = {
    "company email login uses password": '"/api/company/auth/login"' in auth and 'id="loginPassword"' in portal,
    "first-time password setup uses email OTP": '"/api/company/auth/setup/start"' in auth and '"/api/company/auth/setup/verify"' in auth and 'id="setupEmailCode"' in portal,
    "company recovery rotates recovery code and sessions": '"/api/company/auth/recovery/start"' in auth and '"/api/company/auth/recovery/complete"' in auth and "newRecoveryCode" in portal and "UPDATE daga_auth_sessions SET revoked_at" in auth,
    "company login and recovery have rate limits": 'company-login-ip:' in auth and 'company-login-email:' in auth and 'company-recovery-ip:' in auth,
    "invitation registration is email-only": '"/api/company/auth/register"' in auth and '"/api/company/auth/register/verify"' in auth and "channel='email'" in auth,
    "invitation token is single-use and expiry-bound": "i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>?" in auth and "SET status='accepted',use_count=1" in auth,
    "membership creation is gated by accepted invitation": "WHERE EXISTS (SELECT 1 FROM daga_store_invitations WHERE id=? AND status='accepted' AND accepted_by_account_id=? AND use_count=1)" in auth,
    "invite create permission is enforced server-side": "company_invitation_permission_denied" in auth and "manager_invitation_permission_disabled" in auth,
    "manager/employee accounts cannot access owner console": "handleOwnerAdmin" in worker and "authenticatedOwner" in Path("owner-admin.js").read_text(encoding="utf-8"),
    "owner can create company and owner account from console": 'id="companyOwnerForm"' in owner_ui and "/owner/admin/stores" in owner_ui,
    "portal has no phone/SMS verification requirement": 'id="loginPhoneCode"' not in portal and "phoneCode" not in portal and "SMS" not in portal,
}
for name, ok in checks.items():
    print(f'{"PASS" if ok else "FAIL"}: {name}')
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"{len(failed)} company lifecycle check(s) failed")
print(f"All {len(checks)} company lifecycle checks passed.")
