import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../company-entitlements.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { isSmartStoreEntitlement, getActiveStoreEntitlement } = await import(moduleUrl);

assert.equal(isSmartStoreEntitlement(null), false);
assert.equal(isSmartStoreEntitlement({ name: "Standard", features_json: '{"tier":"standard","smartAssistantEnabled":true,"historyEnabled":true}' }), false);
assert.equal(isSmartStoreEntitlement({ name: "Smart", features_json: '{"tier":"smart"}' }), true);
assert.equal(isSmartStoreEntitlement({ name: "DAGA", features_json: '{"smartAssistantEnabled":true}' }), true);
assert.equal(isSmartStoreEntitlement({ name: "باقة ذكي", features_json: '{}' }), true);
assert.equal(isSmartStoreEntitlement({ name: "Basic", features_json: '{}' }), false);

let captured = null;
const db = {
  prepare(sql) {
    return {
      bind(...args) {
        captured = { sql, args };
        return { first: async () => ({ name: "Smart", features_json: '{"tier":"smart"}' }) };
      }
    };
  }
};
const entitlement = await getActiveStoreEntitlement(db, "store-123", "2026-11-25T12:00:00.000Z");
assert.equal(entitlement.name, "Smart");
assert.match(captured.sql, /e\.service='store'/);
assert.match(captured.sql, /e\.status='active'/);
assert.deepEqual(captured.args, ["store-123", "2026-11-25T12:00:00.000Z", "2026-11-25T12:00:00.000Z"]);

console.log("Company Smart/Standard entitlement behavior passed.");
