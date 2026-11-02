import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlan, validateTestPlan } from '../src/testPlanValidator.js';
import { executePlan } from '../src/executor.js';
import { buildRefundPrompt } from '../src/planner.js';
import { MAX_ATTEMPTS } from '../src/metaClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(ROOT, 'fixtures', 'evaluation.json');
const REPORT_PATH = path.join(ROOT, 'docs', 'evaluation-report.json');

test('evaluation fixtures: correct case count and classifications', () => {
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  assert.equal(fixtures.cases.length, 10);
  const supported = fixtures.cases.filter(c => c.expectedClassification === 'supported');
  const ambiguous = fixtures.cases.filter(c => c.expectedClassification === 'ambiguous');
  const unsupported = fixtures.cases.filter(c => c.expectedClassification === 'unsupported');
  assert.equal(supported.length, 6);
  assert.equal(ambiguous.length, 2);
  assert.equal(unsupported.length, 2);
  const ids = fixtures.cases.map(c => c.id);
  assert.equal(new Set(ids).size, 10);
  assert.ok(fixtures.meta.disclaimer.toLowerCase().includes('not a general benchmark'));
});

test('golden outcomes kept outside model prompt', () => {
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  const caseDef = fixtures.cases[0];
  const messages = buildRefundPrompt({ businessRequirement: caseDef.requirement });
  const promptStr = JSON.stringify(messages);
  assert.ok(!promptStr.includes('expectedClassification'));
  assert.ok(!promptStr.toLowerCase().includes('buggy'));
  assert.ok(!promptStr.toLowerCase().includes('seeded'));
  assert.ok(promptStr.includes(caseDef.requirement));
  assert.ok(promptStr.includes('createOrder'));
});

test('no live inference without explicit opt-in', () => {
  const mockArgv = ['node', 'scripts/evaluate.mjs'];
  assert.equal(mockArgv.includes('--live'), false);
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(evalScript.includes("args.includes('--live')"));
  assert.ok(evalScript.includes('DRY-RUN / MOCK'));
});

test('provider request and retry caps', () => {
  assert.equal(MAX_ATTEMPTS, 2);
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  const maxTotal = fixtures.cases.length * MAX_ATTEMPTS;
  assert.equal(maxTotal, 20);
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(evalScript.includes('MAXIMUM POSSIBLE PAID REQUESTS'));
  assert.ok(evalScript.includes('ATTEMPT_CAP_EXCEEDED'));
});
test('accurate result classification — report generation and 11-field capture', () => {
  assert.ok(fs.existsSync(REPORT_PATH), 'evaluation-report.json must exist after dry-run');
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  assert.equal(report.results.length, 10);
  assert.equal(report.summary.totalCases, 10);
  assert.equal(report.providerCaps.maxTotalPaidRequests, 20);
  assert.ok(['dry-run-mock', 'live'].includes(report.mode), `mode should be dry-run-mock or live, got ${report.mode}`);
  for (const r of report.results) {
    assert.ok(r.caseId);
    assert.ok(r.submittedRequirement);
    assert.ok(r.expectedClassification);
    assert.ok('actualModelClassification' in r);
    assert.ok('returnedModelId' in r);
    assert.ok('structuredPlanValidationResult' in r);
    assert.ok('jsonValid' in r);
    assert.ok('semanticCorrectAfterReview' in r);
    assert.ok('humanReview' in r);
    assert.ok('executesValidly' in r);
    assert.ok('exposesSeededDefect' in r);
    assert.ok('providerLatencyMs' in r);
    assert.ok('failureReason' in r);
  }
  assert.equal(report.summary.counts.expectedSupported, 6);
  assert.equal(report.summary.counts.expectedAmbiguous, 2);
  assert.equal(report.summary.counts.expectedUnsupported, 2);
  const derivedActualSupported = report.results.filter(r => r.actualModelClassification === 'supported').length;
  const derivedActualUnsupported = report.results.filter(r => r.actualModelClassification === 'unsupported').length;
  const derivedActualModelError = report.results.filter(r => r.actualModelClassification === 'model_error').length;
  assert.equal(report.summary.counts.actualSupported, derivedActualSupported);
  assert.equal(report.summary.counts.actualUnsupported, derivedActualUnsupported);
  assert.equal(report.summary.counts.actualModelError, derivedActualModelError);
  assert.equal(derivedActualSupported + derivedActualUnsupported + derivedActualModelError, 10);
  const derivedSemanticPass = report.results.filter(r => r.semanticCorrectAfterReview === true).length;
  const derivedSemanticPending = report.results.filter(r => r.semanticCorrectAfterReview === 'pending-human-review').length;
  const derivedSemanticFail = report.results.filter(r => r.semanticCorrectAfterReview === false).length;
  assert.equal(report.summary.counts.semanticPass, derivedSemanticPass);
  assert.equal(report.summary.counts.semanticPending, derivedSemanticPending);
  assert.equal(report.summary.counts.semanticFail, derivedSemanticFail);
  assert.equal(report.summary.metrics.semanticPendingNotPass, true);
  assert.equal(derivedSemanticPass + derivedSemanticPending + derivedSemanticFail, 10);
  const derivedExecutes = report.results.filter(r => r.executesValidly === true).length;
  const derivedExposes = report.results.filter(r => r.exposesSeededDefect === true).length;
  assert.equal(report.summary.counts.executesValidly, derivedExecutes);
  assert.equal(report.summary.counts.exposesDefect, derivedExposes);
  assert.ok(derivedExecutes <= report.summary.counts.expectedSupported);
  assert.ok(derivedExposes <= derivedExecutes);
  assert.ok('exactClassificationCount' in report.summary.metrics);
  assert.ok('safeAbstentionCount' in report.summary.metrics);
  assert.ok('providerErrorCount' in report.summary.metrics);
  assert.equal(report.summary.metrics.providerErrorCount, derivedActualModelError);
  assert.ok(report.summary.metrics.safeAbstentionCount >= 0 && report.summary.metrics.safeAbstentionCount <= 4);
});

test('no fabricated semantic success — distinguishes JSON validity from semantic correctness', () => {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const sup = report.results.find(r => r.caseId === 'SUP-01');
  assert.equal(sup.jsonValid, true);
  assert.equal(sup.semanticCorrectAfterReview, 'pending-human-review');
  assert.ok(sup.humanReview.required);
  assert.equal(sup.humanReview.status, 'pending-human-review');
  assert.equal(report.summary.metrics.semanticPendingNotPass, true);
  const pendingIds = report.results.filter(r => r.semanticCorrectAfterReview === 'pending-human-review').map(r => r.caseId);
  assert.ok(pendingIds.includes('SUP-01'));
  assert.ok(!report.results.filter(r => r.semanticCorrectAfterReview === true).some(r => r.caseId.startsWith('SUP-')));
  const amb = report.results.find(r => r.caseId === 'AMB-01');
  assert.equal(amb.jsonValid, true);
  if (amb.actualModelClassification === 'unsupported') {
    assert.equal(amb.semanticCorrectAfterReview, true);
    assert.equal(amb.humanReview.status, 'n/a');
  } else if (amb.actualModelClassification === 'supported') {
    assert.equal(amb.semanticCorrectAfterReview, false);
    assert.equal(amb.humanReview.status, 'failed');
    assert.ok(amb.failureReason && amb.failureReason.includes('SEMANTIC_FAILURE'));
    assert.ok(report.summary.counts.semanticFail >= 1);
  } else {
    assert.fail(`unexpected AMB-01 classification ${amb.actualModelClassification}`);
  }
  assert.equal(report.summary.counts.semanticPass, report.results.filter(r => r.semanticCorrectAfterReview === true).length);
});

test('execution integrity — only approved semantically valid plans executed, no dynamic JS', () => {
  const plan = {
    version: '1.0', ruleId: 'refund-cap', businessRequirement: 'x', interpretedRule: 'x',
    operations: [
      { op: 'createOrder', orderId: 'order-1', capturedCents: 10000 },
      { op: 'requestRefund', orderId: 'order-1', amountCents: 4000, refundId: 'r1' },
      { op: 'assertRefundStatus', refundId: 'r1', expectedStatus: 'accepted' }
    ]
  };
  const notApproved = executePlan({ plan, approved: false, variant: 'buggy' });
  assert.equal(notApproved.executed, false);
  assert.equal(notApproved.reason, 'NOT_APPROVED');
  const approved = executePlan({ plan, approved: true, variant: 'buggy' });
  assert.equal(approved.executed, true);
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(!evalScript.includes('new Function'));
});

test('report generation — no secrets printed, max paid requests disclosed upfront', () => {
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(!evalScript.includes('console.log(process.env'));
  assert.ok(evalScript.includes('MAXIMUM POSSIBLE PAID REQUESTS'));
});

test('safe handling of unsupported and ambiguous', () => {
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(evalScript.includes('not-executed-per-integrity'));
  const unsupported = { unsupported: true, reason: 'cannot express with catalog' };
  const v = validateTestPlan(unsupported);
  assert.equal(v.reason, 'UNSUPPORTED_REQUIREMENT');
  assert.equal(v.unsupported, true);
  assert.ok(evalScript.includes('SEMANTIC_FAILURE: unsupported requirement incorrectly produced executable plan'));
});

test('fixtures max 10 and no live call without explicit flag — safety', () => {
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  assert.ok(fixtures.cases.length <= 10);
  const evalScript = fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate.mjs'), 'utf8');
  assert.ok(evalScript.includes('if (cases.length > MAX_CASES)'));
  assert.ok(evalScript.includes("args.includes('--live')"));
});
