import test from 'node:test';
import assert from 'node:assert/strict';
import { personalise, readinessSummary } from '../services/documentRequirements.js';

const docs = [
  { name: 'Caste Certificate', applies_to: ['sc', 'st', 'obc'], income: { max: null, min: null }, required: 'always', condition: null },
  { name: 'Project Report', applies_to: ['all'], income: { max: null, min: null }, required: 'always', condition: null },
  { name: 'Income Certificate', applies_to: ['all'], income: { max: 250000, min: null }, required: 'conditional', condition: 'for the income-linked benefit' },
];
const by = (list) => Object.fromEntries(list.map((d) => [d.name, d.status]));

test('General applicant does not need a caste certificate; SC does', () => {
  assert.equal(by(personalise(docs, { category: 'general', income: 100000 }))['Caste Certificate'], 'not_needed');
  assert.equal(by(personalise(docs, { category: 'sc', income: 100000 }))['Caste Certificate'], 'required');
});
test('unknown category/income makes a document "depends", never hides it', () => {
  const r = by(personalise(docs, { category: null, income: null }));
  assert.equal(r['Caste Certificate'], 'depends');
  assert.equal(r['Income Certificate'], 'depends');
  assert.equal(r['Project Report'], 'required');
});
test('income outside the stated range makes the income document not needed', () => {
  assert.equal(by(personalise(docs, { category: 'general', income: 900000 }))['Income Certificate'], 'not_needed');
  assert.equal(by(personalise(docs, { category: 'general', income: 100000 }))['Income Certificate'], 'conditional');
});

test('readiness counts only documents required for this user, and what they already have', () => {
  const personal = personalise(docs, { category: 'sc', income: 100000 }).map((d) => ({ ...d, have: d.name === 'Caste Certificate' ? 'uploaded' : 'missing' }));
  const r = readinessSummary(personal);
  assert.equal(r.needed, 2);            // Caste Certificate + Project Report (income certificate is conditional)
  assert.equal(r.have, 1);
  assert.equal(r.percent, 50);
  assert.deepEqual(r.missing, ['Project Report']);
  assert.equal(r.conditional, 1);
});
