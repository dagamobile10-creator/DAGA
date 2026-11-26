#!/usr/bin/env python3
"""Verify optional LiveAvatar credentials can be wired to staging without blocking legacy mode."""
from pathlib import Path
workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/daga-staging-setup.yml").read_text(encoding="utf-8")
worker = (Path(__file__).resolve().parents[1] / "worker.js").read_text(encoding="utf-8")
checks = {
    "LiveAvatar API key and avatar ID are sourced from dedicated GitHub secrets": "secrets.LIVEAVATAR_API_KEY" in workflow and "secrets.LIVEAVATAR_AVATAR_ID" in workflow,
    "LiveAvatar secrets are optional and only applied when present": 'for name in LIVEAVATAR_API_KEY LIVEAVATAR_AVATAR_ID' in workflow and 'if [ -n "${!name:-}" ]; then put_staging_secret "$name"; fi' in workflow,
    "health reports LiveAvatar API and avatar ID readiness": "liveAvatarConfigured,liveAvatarIdConfigured" in workflow and "liveAvatarConfigured: Boolean(env.LIVEAVATAR_API_KEY)" in worker,
    "Worker refuses LiveAvatar session creation without configured API key": 'if (!env.LIVEAVATAR_API_KEY)' in worker,
    "staging workflow remains isolated from production": "wrangler.staging.toml" in workflow and "daga-app-staging" in workflow,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + ": " + name)
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"{len(failed)} LiveAvatar staging config check(s) failed")
print(f"All {len(checks)} LiveAvatar staging config checks passed.")
