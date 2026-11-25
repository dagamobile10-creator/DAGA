from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

dashboard = read("shop-dashboard-v30.html")
worker = read("worker.js")
config = read("capacitor.config.ts")
deploy = read(".github/workflows/deploy-worker.yml")
wrangler = read("wrangler.toml")
entry = read("entry/index.html")
invite = read("invite/index.html")
owner = read("owner-console.html")
company = read("company/portal.html")

assert "const DAGA_APP_ORIGIN=window.location.origin;" in dashboard
assert "const origin=DAGA_APP_ORIGIN;" in dashboard
assert "postMessage({type:'DAGA_AUTH'" in dashboard
assert "DAGA_LIVE_SRC='/live/'" in dashboard
assert "بيئة الاختبار" not in entry
assert "DAGA_SHOP_AUTH_BRIDGE" in invite
assert "DAGA_SHOP_AUTH_BRIDGE" in dashboard
assert "window.open(" not in invite
assert "window.open(" not in owner
assert 'target="_blank"' not in dashboard
assert 'target="_blank"' not in company
assert "https://daga-app-staging.dagamobile10.workers.dev');" not in dashboard
for route in ("/go", "/live", "/owner", "/shop", "/company", "/invite"):
    assert route in worker, f"Worker route missing: {route}"
assert 'server.url' in config
assert "daga-app-staging.dagamobile10.workers.dev" in config
assert "cleartext: false" in config
assert 'binding = "DAGA_APP_DB"' in deploy
assert "Reuse the existing production application D1 binding" in deploy
assert "select(.name==\"DAGA_APP_DB\" and .type==\"d1\")" in deploy
assert "d1 migrations apply \"$db_name\"" in deploy
assert "Production deployment blocked: existing DAGA_APP_DB binding was not found" in deploy
assert "name=\"daga-app-live\"" not in deploy
assert "DAGA_OWNER_BOOTSTRAP_TOKEN" in deploy
assert "ELEVENLABS_API_KEY" in deploy
assert deploy.index("Check production secrets before deploying") < deploy.index("Deploy daga-voice to Cloudflare")
assert 'DAGA_MEMORY_REQUIRE_AUTH = "true"' in wrangler
assert 'DAGA_PUBLIC_API_RATE_LIMITS = "true"' in wrangler
print("DAGA release candidate source checks passed.")
