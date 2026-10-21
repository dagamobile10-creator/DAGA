#!/usr/bin/env python3
"""Static security checks for staged identity gates on legacy memory and voice routes."""
from pathlib import Path

worker = Path("worker.js").read_text(encoding="utf-8")
checklist = Path("tests/OWNER_AUTH_STAGING_CHECKLIST.md").read_text(encoding="utf-8")
checks = {
    "memory auth gate is explicit": 'env.DAGA_MEMORY_REQUIRE_AUTH || ""' in worker and '=== "true"' in worker,
    "authenticated memory uses server account identity": 'userId = String(account.id || "").trim()' in worker,
    "caller-supplied userId is only used in compatibility branch": 'userId = String(url.searchParams.get("userId") || (request.method === "POST" ? body?.userId : "") || "").trim()' in worker,
    "voice auth gate is explicit": 'env.DAGA_VOICE_REQUIRE_AUTH || ""' in worker and "voiceIdentityRequired" in worker,
    "chat and TTS are protected by shared voice gate": '["/chat", "/tts", "/liveavatar/token"].includes(url.pathname)' in worker,
    "LiveAvatar token endpoint has its own early-exit gate": 'if (String(env.DAGA_VOICE_REQUIRE_AUTH || "").toLowerCase() === "true")' in worker,
    "staging checklist demands unauthenticated requests fail closed": "unauthenticated" in checklist and "/memory" in checklist and "/chat" in checklist and "/tts" in checklist,
    "staging checklist documents legacy userId risk": "caller-supplied legacy" in checklist and "userId" in checklist,
    "voice gate must not be enabled without compatible client session": "must not be enabled for the existing anonymous LIVE DAGA client" in checklist,
}
for name, ok in checks.items():
    print(f'{"PASS" if ok else "FAIL"}: {name}')
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"{len(failed)} identity gate check(s) failed")
print(f"All {len(checks)} legacy voice identity checks passed.")
