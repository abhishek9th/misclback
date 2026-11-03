// Deterministic tests for the recommender (no network). Run: node --test backend/tests
// The live, AI-backed scenarios live in backend/scripts/runRecommenderScenarios.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreScheme, checkEligibility } from '../services/recommender/scoring.js';
import { bandOf, WEIGHTS } from '../services/recommender/config.js';
import { effectiveProfile, retrieve } from '../services/aiSchemeSearch.js';

const scheme = (over = {}) => ({
  slug: 's', name: 'Test scheme', short_description: '', states: [], benefit_types: [], audiences: [],
  eligible_categories: [], eligible_genders: [], education_levels: [], income_limit: null, min_age: null, max_age: null,
  eligibility_extracted: true, ...over,
  _hay_name: (over.name || 'Test scheme').toLowerCase(), _hay_desc: (over.short_description || '').toLowerCase(), _hay_body: '', _hay_tags: '',
});
const plan = (over = {}) => ({ audiences: ['farmer'], benefit_types: [], keywords: [], avoid_keywords: [], crop_profile: null, beneficiary: 'self', profile: {}, ...over });

test('weights are normalised and sum to 1', () => {
  assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('relevance bands follow the 80/60/40 thresholds', () => {
  assert.equal(bandOf(95), 'highly_relevant');
  assert.equal(bandOf(80), 'highly_relevant');
  assert.equal(bandOf(79), 'relevant');
  assert.equal(bandOf(60), 'relevant');
  assert.equal(bandOf(59), 'potentially_relevant');
  assert.equal(bandOf(40), 'potentially_relevant');
  assert.equal(bandOf(39), 'not_relevant');
});

test('missing user facts give a gap, never a conflict', () => {
  const c = checkEligibility(scheme({ income_limit: 100000, eligible_categories: ['sc'] }), {});
  assert.equal(c.conflict, null);
  assert.deepEqual(c.gaps.sort(), ['annual_income', 'social_category']);
});

test('a known failing fact is a conflict', () => {
  assert.ok(checkEligibility(scheme({ income_limit: 100000 }), { income: 500000 }).conflict);
  assert.ok(checkEligibility(scheme({ eligible_categories: ['sc'] }), { category: 'general' }).conflict);
  assert.ok(checkEligibility(scheme({ states: ['Kerala'] }), { state: 'Bihar' }).conflict);
});

test('high text relevance never overrides a verified eligibility conflict', () => {
  const r = scheme({ name: 'Soybean farmer grant', income_limit: 100000 });
  const sc = scoreScheme(r, { plan: plan(), profile: { income: 900000 }, judge: { relevance: 10, match: 'exact', fit: 'likely' } });
  assert.equal(sc.status, 'not_eligible');
});

test('unknown eligibility is "not verified", not "eligible"', () => {
  const sc = scoreScheme(scheme({ eligibility_extracted: false }), { plan: plan(), profile: {}, judge: { relevance: 9, match: 'general', fit: 'likely' } });
  assert.equal(sc.status, 'not_verified');
});

test('"eligible" only when every stated condition is known and met', () => {
  const r = scheme({ income_limit: 300000 });
  assert.equal(scoreScheme(r, { plan: plan(), profile: { income: 100000 }, judge: { relevance: 9, match: 'general', fit: 'likely' } }).status, 'eligible');
  assert.equal(scoreScheme(r, { plan: plan(), profile: {}, judge: { relevance: 9, match: 'general', fit: 'likely' } }).status, 'potentially_eligible');
});

test('purpose gates the score: a poorly matching scheme cannot rank as relevant', () => {
  const r = scheme({ audiences: ['farmer'] });
  const low = scoreScheme(r, { plan: plan(), profile: { state: 'Bihar' }, judge: { relevance: 4, match: 'general', fit: 'likely' } });
  assert.ok(low.score < 60, `score ${low.score}`);
  const high = scoreScheme(r, { plan: plan(), profile: { state: 'Bihar' }, judge: { relevance: 9, match: 'exact', fit: 'likely' } });
  assert.ok(high.score >= 60 && high.score > low.score);
});

test('beneficiary is not the user: saved category/income/age are not applied to a father', () => {
  const saved = { state: 'Madhya Pradesh', category: 'sc', income: 50000, gender: 'female', age: 24 };
  const eff = effectiveProfile(saved, plan({ beneficiary: 'father' }), {});
  assert.equal(eff.state, 'Madhya Pradesh');
  assert.equal(eff.category, null);
  assert.equal(eff.income, null);
  assert.equal(eff.gender, null);
  assert.equal(eff.age, null);
  // ...but an explicit answer about the beneficiary is used
  assert.equal(effectiveProfile(saved, plan({ beneficiary: 'father' }), { category: 'obc' }).category, 'obc');
  // for self, the saved profile applies
  assert.equal(effectiveProfile(saved, plan(), {}).category, 'sc');
});

test('soybean farmer: coffee/cardamom/coir schemes are excluded, farm schemes kept', () => {
  const pool = [
    scheme({ slug: 'a', name: 'Development Support for Coffee in Traditional Areas', audiences: ['farmer'] }),
    scheme({ slug: 'b', name: 'Large Cardamom Replanting', audiences: ['farmer'] }),
    scheme({ slug: 'c', name: 'Coir Udyami Yojana', audiences: ['entrepreneur'] }),
    scheme({ slug: 'd', name: 'Pradhan Mantri Fasal Bima Yojna crop insurance for farmers', audiences: ['farmer'] }),
  ];
  const p = plan({
    keywords: ['farmer', 'crop', 'insurance'],
    crop_profile: { name: 'soybean', related_terms: ['soybean', 'oilseed'], other_crop_terms: ['coffee', 'cardamom', 'coir', 'tea'] },
  });
  const { list } = retrieve(pool, p, {}, {}, 10);
  assert.deepEqual(list.map((x) => x.slug), ['d']);
});

test('SC farmer asking for wheat is not shown an SC-only scheme as eligible when category unknown', () => {
  const r = scheme({ eligible_categories: ['sc'], audiences: ['farmer'] });
  const sc = scoreScheme(r, { plan: plan(), profile: {}, judge: { relevance: 8, match: 'general', fit: 'maybe' } });
  assert.notEqual(sc.status, 'eligible');
  assert.ok(sc.check.gaps.includes('social_category'));
});
