#!/usr/bin/env python3
"""Static lifecycle regression checks; staging E2E still requires real mailbox and D1."""
from pathlib import Path

ui = Path("owner-console.html").read_text(encoding="utf-8")
auth = Path("owner-auth.js").read_text(encoding="utf-8")
worker = Path("worker.js").read_text(encoding="utf-8")
checks = {
    "owner bootstrap endpoints are routed": '"/owner/bootstrap/start"' in auth and '"/owner/bootstrap/verify"' in auth,
    "bootstrap requires the out-of-band token": 'constantTimeEqual(auth,"Bearer "+env.DAGA_OWNER_BOOTSTRAP_TOKEN)' in auth,
    "bootstrap requires valid email and rate limits": "valid_email_required" in auth and 'rateLimit(db,env,"bootstrap:"' in auth,
    "verification code is single-use and expires": "consumeChallenge(db,env,\"owner_bootstrap_email\"" in auth and "OTP_TTL_SECONDS = 10 * 60" in auth,
    "password policy enforced server-side": "function validPassword(password)" in auth and "PBKDF2_ITERATIONS = 310000" in auth,
    "bootstrap requires recovery code": "new_recovery_code_required_20_to_128_chars" in auth,
    "login is email and password without per-login OTP": "ownerLogin(request,env)" in auth and 'body:JSON.stringify({email:$(\'identifier\').value.trim(),password:$(\'password\').value})' in ui and 'id="loginVerifyForm"' not in ui,
    "login failure is generic and rate limited": "invalid_credentials" in auth and 'rateLimit(db,env,"login:"' in auth,
    "owner recovery requires email OTP and existing recovery code": '"/owner/recovery/start"' in auth and '"/owner/recovery/complete"' in auth and 'id="recoveryOldCode"' in ui,
    "recovery revokes prior sessions": "password_reset" in auth and "revoke" in auth and "owner_recovery" in auth,
    "recovery form sends new password and rotates recovery code": "newPassword" in ui and "newRecoveryCode" in ui,
    "setup token stays in memory and is cleared on cancel": "bootstrapTokenInMemory='';$('bootstrapToken').value=''" in ui and "localStorage.setItem('bootstrapToken'" not in ui and "sessionStorage.setItem('bootstrapToken'" not in ui,
    "worker routes owner auth before protected admin APIs": "handleOwnerAuth(request, env, url)" in worker and "handleOwnerAdmin" in worker,
}
for name, ok in checks.items():
    print(f'{"PASS" if ok else "FAIL"}: {name}')
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"{len(failed)} owner auth lifecycle check(s) failed")
print(f"All {len(checks)} owner-auth lifecycle checks passed.")
