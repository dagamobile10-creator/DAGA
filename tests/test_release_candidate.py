from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

dashboard = read("shop-dashboard-v30.html")
worker = read("worker.js")
config = read("capacitor.config.ts")
deploy = read(".github/workflows/deploy-worker.yml")
wrangler = read("wrangler.toml")

assert "const DAGA_APP_ORIGIN=window.location.origin;" in dashboard
assert "const origin=DAGA_APP_ORIGIN;" in dashboard
assert "postMessage({type:'DAGA_AUTH'" in dashboard
assert "DAGA_LIVE_SRC='/live/'" in dashboard
assert "https://daga-app-staging.dagamobile10.workers.dev');" not in dashboard
for route in ("/go", "/live", "/owner", "/shop", "/company", "/invite"):
    assert route in worker, f"Worker route missing: {route}"
assert 'server.url' in config
assert "daga-app-staging.dagamobile10.workers.dev" in config
assert "cleartext: false" in config
assert 'binding = "DAGA_APP_DB"' in deploy
assert "d1 migrations apply daga-app-live" in deploy
assert "DAGA_OWNER_BOOTSTRAP_TOKEN" in deploy
assert "ELEVENLABS_API_KEY" in deploy
assert 'DAGA_MEMORY_REQUIRE_AUTH = "true"' in wrangler
assert 'DAGA_PUBLIC_API_RATE_LIMITS = "true"' in wrangler
print("DAGA release candidate source checks passed.")
