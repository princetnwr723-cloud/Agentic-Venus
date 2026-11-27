// Which computer a server-side job uses: the own phone / PC first, the cloud (E2B) one as a backup. Pure rules only.
import test from "node:test";
import assert from "node:assert/strict";
import { decide, isFresh, normPref, pickDevice, worthWaiting, FRESH_MS, RECENT_MS } from "../../lib/computer-pref-core.ts";

const NOW = 1_800_000_000_000;
const dev = (id, ago) => ({ id, lastSeen: NOW - ago });

test("preference: anything unknown means auto", () => {
  assert.equal(normPref("local"), "local");
  assert.equal(normPref("cloud"), "cloud");
  for (const v of [undefined, null, "", "phone", 5]) assert.equal(normPref(v), "auto");
});

test("an online own computer wins in auto and local; cloud wins only when chosen", () => {
  const d = dev("a", 5_000);
  assert.equal(decide({ pref: "auto", hasCloud: true, dev: d, now: NOW }), "local");
  assert.equal(decide({ pref: "local", hasCloud: true, dev: d, now: NOW }), "local");
  assert.equal(decide({ pref: "cloud", hasCloud: true, dev: d, now: NOW }), "cloud");
  assert.equal(decide({ pref: "cloud", hasCloud: false, dev: d, now: NOW }), "local"); // no cloud key: nothing else exists
});

test("an offline own computer: auto falls back to cloud, local does not, nothing left gives the clear local error", () => {
  const off = dev("a", RECENT_MS + 1);
  assert.equal(decide({ pref: "auto", hasCloud: true, dev: off, now: NOW }), "cloud");
  assert.equal(decide({ pref: "local", hasCloud: true, dev: off, now: NOW }), "local");
  assert.equal(decide({ pref: "auto", hasCloud: false, dev: off, now: NOW }), "local");
});

test("a device that was online a moment ago is worth a short wait, once", () => {
  const waking = dev("a", FRESH_MS + 1_000);
  assert.equal(worthWaiting(waking.lastSeen, NOW), true);
  assert.equal(decide({ pref: "auto", hasCloud: true, dev: waking, now: NOW }), "wait");
  assert.equal(decide({ pref: "auto", hasCloud: true, dev: waking, now: NOW, waited: true }), "cloud");
  assert.equal(decide({ pref: "local", hasCloud: true, dev: waking, now: NOW, waited: true }), "local");
});

test("no own computer at all", () => {
  assert.equal(decide({ pref: "auto", hasCloud: true, dev: null, now: NOW }), "cloud");
  assert.equal(decide({ pref: "auto", hasCloud: false, dev: null, now: NOW }), "none");
  assert.equal(decide({ pref: "local", hasCloud: false, dev: null, now: NOW }), "none");
});

test("never seen = offline, fresh window edges", () => {
  assert.equal(isFresh(0, NOW), false);
  assert.equal(isFresh(NOW - FRESH_MS + 1, NOW), true);
  assert.equal(isFresh(NOW - FRESH_MS, NOW), false);
});

test("the chosen device wins, otherwise the one seen last", () => {
  const list = [dev("old", 60_000), dev("new", 1_000), dev("mid", 30_000)];
  assert.equal(pickDevice(list, "mid").id, "mid");
  assert.equal(pickDevice(list, "gone").id, "new");
  assert.equal(pickDevice(list).id, "new");
  assert.equal(pickDevice([], "x"), null);
});