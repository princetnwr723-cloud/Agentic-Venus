import test from "node:test";
import assert from "node:assert/strict";
import { PROXY_PRESETS, COUNTRIES, applyProxyChoice, presetById, countryByCode } from "../../lib/proxy-presets.ts";

test("presets are complete and have valid hosts and ports", () => {
  const ids = new Set();
  for (const p of PROXY_PRESETS) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.match(p.host, /^[a-z0-9.-]+\.[a-z]{2,}$/);
    assert.ok(Number(p.port) > 0 && Number(p.port) < 65536, p.id);
    assert.ok(p.name && p.userHint && (p.scheme === "http" || p.scheme === "https"));
  }
  assert.ok(PROXY_PRESETS.length >= 5);
});

test("countries carry a real IANA time zone and a language tag", () => {
  for (const c of COUNTRIES) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: c.tz }), c.code);
    assert.match(c.lang, /^[a-z]{2}-[A-Z]{2}$/);
  }
});

test("choosing a preset fills host and port, choosing a country fills time zone and language, nothing else changes", () => {
  const cur = { scheme: "https", host: "", port: "", tz: "", lang: "" };
  const a = applyProxyChoice(cur, "oxylabs");
  assert.deepEqual([a.scheme, a.host, a.port, a.tz], ["http", "pr.oxylabs.io", "7777", ""]);
  const b = applyProxyChoice(a, undefined, "in");
  assert.deepEqual([b.host, b.tz, b.lang], ["pr.oxylabs.io", "Asia/Kolkata", "en-IN"]);
  assert.deepEqual(applyProxyChoice(cur, "nope", "zz"), cur);
  assert.equal(presetById("brightdata").name, "Bright Data");
  assert.equal(countryByCode("gb").tz, "Europe/London");
});
