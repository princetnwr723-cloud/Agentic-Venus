import test from "node:test";
import assert from "node:assert/strict";
import { paymentsMode, betaMaxPayment, paymentRequestProblem, cardSaveProblem, cardLimitFor, PAYMENTS_OFF_TEXT } from "../../lib/payments-mode.ts";

test("beta is the default; off and on are explicit", () => {
  assert.equal(paymentsMode({}), "beta");
  assert.equal(paymentsMode({ VENUS_PAYMENTS_MODE: "" }), "beta");
  assert.equal(paymentsMode({ VENUS_PAYMENTS_MODE: "garbage" }), "beta");
  assert.equal(paymentsMode({ VENUS_PAYMENTS_MODE: "OFF" }), "off");
  assert.equal(paymentsMode({ VENUS_PAYMENTS_MODE: " on " }), "on");
});

test("beta cap: default 1000, env can change it", () => {
  assert.equal(betaMaxPayment({}), 1000);
  assert.equal(betaMaxPayment({ VENUS_BETA_MAX_PAYMENT: "250" }), 250);
  assert.equal(betaMaxPayment({ VENUS_BETA_MAX_PAYMENT: "-1" }), 1000);
});

test("off blocks every payment request", () => {
  assert.equal(paymentRequestProblem(5, { VENUS_PAYMENTS_MODE: "off" }), PAYMENTS_OFF_TEXT);
});

test("beta blocks big or empty payments, allows small ones", () => {
  assert.match(paymentRequestProblem(5000, {}), /at most 1000/);
  assert.match(paymentRequestProblem(0, {}), /missing/);
  assert.equal(paymentRequestProblem(999, {}), "");
  assert.equal(paymentRequestProblem(5000, { VENUS_PAYMENTS_MODE: "on" }), "");
});

test("beta cards must name a site and stay under the cap", () => {
  assert.match(cardSaveProblem({ site: "", anySite: true, limit: 0 }, {}), /one site/);
  assert.match(cardSaveProblem({ site: "amazon.in", anySite: false, limit: 5000 }, {}), /at most 1000/);
  assert.equal(cardSaveProblem({ site: "amazon.in", anySite: false, limit: 200 }, {}), "");
  assert.equal(cardSaveProblem({ site: "", anySite: true, limit: 0 }, { VENUS_PAYMENTS_MODE: "on" }), "");
});

test("a missing per-payment limit becomes the beta maximum", () => {
  assert.equal(cardLimitFor(0, {}), 1000);
  assert.equal(cardLimitFor(300, {}), 300);
  assert.equal(cardLimitFor(0, { VENUS_PAYMENTS_MODE: "on" }), 0);
});
