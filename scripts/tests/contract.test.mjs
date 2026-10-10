import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContract, contractPrompt, NO_CONTRACT } from '../../lib/contract.ts';

test('a list request becomes a checkable contract', async () => {
  const llm = async () => '{"kind":"list","quota":100,"item":"lead","fields":["name","email"],"criteria":["India"],"verify":"leads"}';
  const c = await extractContract(llm, 'Find 100 SaaS leads in India');
  assert.equal(c.kind, 'list');
  assert.equal(c.quota, 100);
  assert.equal(c.verify, 'leads');
  assert.deepEqual(c.criteria, ['India']);
});

test('quota is capped at 300', async () => {
  const c = await extractContract(async () => '{"kind":"list","quota":500,"verify":"leads"}', 'Find 500 leads in Delhi');
  assert.equal(c.quota, 300);
});

test('non-list requests get no contract', async () => {
  const c = await extractContract(async () => '{"kind":"other"}', 'Write me a short poem about rain');
  assert.deepEqual(c, NO_CONTRACT);
});

test('if the model fails, the keyword heuristic still builds the contract', async () => {
  const c = await extractContract(async () => { throw new Error('down'); }, 'Please collect 25 startups in Pune');
  assert.equal(c.kind, 'list');
  assert.equal(c.quota, 25);
});

test('prompt states the quota and the evidence rule', async () => {
  const c = await extractContract(async () => '{"kind":"list","quota":10,"verify":"leads"}', 'Find 10 leads');
  assert.match(contractPrompt(c), /Deliver 10 VERIFIED/);
  assert.match(contractPrompt(NO_CONTRACT), /EVIDENCE RULE/);
});
