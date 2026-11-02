// ProofCase Semantic Evaluation Suite — Sprint 3
// Defaults to offline/mock dry-run. No paid inference unless --live flag provided.
// Max 10 cases. Respects bounded retry and caps total provider attempts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlan, validateTestPlan } from '../src/testPlanValidator.js';
import { executePlan } from '../src/executor.js';
import { generateTestPlan } from '../src/planner.js';
import { MAX_ATTEMPTS as META_MAX_ATTEMPTS } from '../src/metaClient.js';
import { approvalHash } from '../src/approval.js';
import { checkSemanticEligibility } from '../src/semanticGate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(ROOT, 'fixtures', 'evaluation.json');
const REPORT_JSON = path.join(ROOT, 'docs', 'evaluation-report.json');

const MAX_ATTEMPTS = typeof META_MAX_ATTEMPTS === 'number' ? META_MAX_ATTEMPTS : 2;
const MAX_CASES = 10;

function parseArgs(argv) {
  const args = argv.slice(2);
  const explicitLive = args.includes('--live');
  const dryRun = !explicitLive;
  const verbose = args.includes('--verbose');
  const help = args.includes('--help') || args.includes('-h');
  return { live: explicitLive, dryRun, verbose, help, raw: args };
}

function printHelp() {
  console.log(`
ProofCase Evaluation Suite (Sprint 3)
------------------------------------
Usage:
  node scripts/evaluate.mjs                # dry-run / mock (default, offline, no cost)
  node scripts/evaluate.mjs --live          # live evaluation (paid inference, explicit opt-in)
  node scripts/evaluate.mjs --help

Safety:
  - Default is OFFLINE/MOCK: no network, no API key required, no paid requests.
  - Live mode requires BASETEN_API_KEY in env/.env.local and explicit --live flag.
  - Max cases: 10. Max attempts per case: ` + MAX_ATTEMPTS + ` . Max total paid requests capped at ` + (MAX_CASES * MAX_ATTEMPTS) + `.
  - No API keys or secrets are printed. Model prompt never includes expected labels or defect details.
  - Evaluation labels are pre-established in fixtures/evaluation.json and never modified after model results.

Outputs:
  - Console summary
  - JSON report: docs/evaluation-report.json
  - Human review status per case (pending-human-review is NOT counted as pass)
`);
}

function mockPlanForCase(caseDef) {
  if (caseDef.expectedClassification === 'supported') {
    return {
      version: '1.0',
      ruleId: 'refund-cap',
      businessRequirement: caseDef.requirement,
      interpretedRule: 'The sum of accepted refunds for an order must not exceed its captured payment amount.',
      operations: [
        { op: 'createOrder', orderId: 'order-1', capturedCents: 10000 },
        { op: 'requestRefund', orderId: 'order-1', amountCents: 4000, refundId: 'r1' },
        { op: 'assertRefundStatus', refundId: 'r1', expectedStatus: 'accepted' },
        { op: 'assertTotalRefunds', orderId: 'order-1', expectedCents: 4000 },
        { op: 'requestRefund', orderId: 'order-1', amountCents: 7000, refundId: 'r2' },
        { op: 'assertRefundStatus', refundId: 'r2', expectedStatus: 'rejected' },
        { op: 'assertTotalRefunds', orderId: 'order-1', expectedCents: 4000 }
      ],
      _diag: { modelId: 'mock/meta-muse-spark-open-1026', finishReason: 'stop', mock: true }
    };
  } else {
    return {
      unsupported: true,
      reason: `Requirement cannot be expressed with bounded refund-cap catalog. No operation covers: ${caseDef.requirement.slice(0, 100)}`
    };
  }
}

function checkSemanticCandidate({ plan, caseDef }) {
  const ops = plan.operations;
  const hasCreate = ops.some(o => o.op === 'createOrder');
  const refunds = ops.filter(o => o.op === 'requestRefund');
  const hasAtLeastTwoRefunds = refunds.length >= 2;
  const hasAssertStatus = ops.some(o => o.op === 'assertRefundStatus');
  const hasAssertTotal = ops.some(o => o.op === 'assertTotalRefunds');
  const create = ops.find(o => o.op === 'createOrder');
  const captured = create?.capturedCents;
  const sumRefunds = refunds.reduce((s, r) => s + (r.amountCents || 0), 0);
  const mustExceed = typeof captured === 'number' && sumRefunds > captured;
  const hasAccepted = ops.some(o => o.op === 'assertRefundStatus' && o.expectedStatus === 'accepted');
  const hasRejected = ops.some(o => o.op === 'assertRefundStatus' && o.expectedStatus === 'rejected');
  const rule = (plan.interpretedRule || '').toLowerCase();
  const ruleMentionsCaptured = rule.includes('captur');
  const ruleMentionsTotal = /total|sum|cumul|aggregat|exceed/.test(rule);
  const checks = {
    hasCreate,
    hasAtLeastTwoRefunds,
    hasAssertStatus,
    hasAssertTotal,
    mustExceed,
    hasAccepted,
    hasRejected,
    ruleMentionsCaptured,
    ruleMentionsTotal,
    captured,
    sumRefunds
  };
  const candidate = hasCreate && hasAtLeastTwoRefunds && hasAssertStatus && hasAssertTotal && mustExceed && hasAccepted && hasRejected && ruleMentionsCaptured && ruleMentionsTotal;
  return { candidate, checks };
}
async function evaluate() {
  const { live, verbose, help } = parseArgs(process.argv);
  if (help) { printHelp(); process.exit(0); }
  console.log('=== PROOFCASE SPRINT 3 SEMANTIC EVALUATION ===');
  console.log(`Mode: ${live ? 'LIVE (paid opt-in)' : 'DRY-RUN / MOCK (offline, no cost, default)'}`);
  if (!fs.existsSync(FIXTURES_PATH)) { console.error(`Missing fixtures: ${FIXTURES_PATH}`); process.exit(1); }
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  const cases = fixtures.cases;
  if (!Array.isArray(cases)) { console.error('Malformed fixtures'); process.exit(1); }
  if (cases.length > MAX_CASES) { console.error(`Too many cases: ${cases.length} > max ${MAX_CASES}`); process.exit(1); }
  console.log(`Cases: ${cases.length} (max ${MAX_CASES})`);
  console.log(`Provider retry cap per case: ${MAX_ATTEMPTS}`);
  const maxTotalPaid = cases.length * MAX_ATTEMPTS;
  console.log(`MAXIMUM POSSIBLE PAID REQUESTS: ${cases.length} * ${MAX_ATTEMPTS} = ${maxTotalPaid}`);
  console.log('  (finite upper limit enforced)');
  console.log(`Supported vocabulary: ${fixtures.meta.supportedVocabulary}`);
  console.log(`Disclaimer: ${fixtures.meta.disclaimer}`);
  console.log('');
  if (live) {
    const hasKey = !!process.env.BASETEN_API_KEY;
    console.log(`Live prerequisites: BASETEN_API_KEY present: ${hasKey ? 'yes (hidden)' : 'NO — will fail closed'}`);
  }
  let totalPaidAttempts = 0;
  const maxTotalAttempts = maxTotalPaid;
  const results = [];
  for (const caseDef of cases) {
    console.log(`\n--- Case ${caseDef.id} [expected: ${caseDef.expectedClassification}] ---`);
    console.log(`Requirement: "${caseDef.requirement}"`);
    let actualClassification = null;
    let returnedModelId = null;
    let validationResult = null;
    let jsonValid = false;
    let semanticCorrect = null;
    let humanReview = null;
    let executesValidly = null;
    let exposesDefect = null;
    let latencyMs = null;
    let tokenUsage = null;
    let failureReason = null;
    let returnedPlan = null;
    let providerFinishReason = null;
    if (live) {
      if (totalPaidAttempts >= maxTotalAttempts) {
        failureReason = 'ATTEMPT_CAP_EXCEEDED';
        console.log(`  Skipped: ${failureReason}`);
      } else if (totalPaidAttempts + MAX_ATTEMPTS > maxTotalAttempts) {
        failureReason = 'ATTEMPT_CAP_EXCEEDED';
        console.log(`  Skipped: ${failureReason} (remaining budget insufficient for retry)`);
      } else {
        const attemptStart = totalPaidAttempts + 1;
        console.log(`  Live call ${attemptStart}/${maxTotalAttempts} — invoking Meta (requirement + catalog ONLY)...`);
        const t0 = Date.now();
        try {
          returnedPlan = await generateTestPlan({ businessRequirement: caseDef.requirement });
          latencyMs = Date.now() - t0;
          returnedModelId = returnedPlan?._diag?.modelId || null;
          providerFinishReason = returnedPlan?._diag?.finishReason || null;
          tokenUsage = returnedPlan?._diag?.completionTokens ?? null;
          // Sprint 3.1: accurate provider-attempt count via _diag.attempts (not hardcoded 1)
          {
            const diagAttemptsRaw = returnedPlan?._diag?.attempts;
            let diagAttempts = 1;
            if (typeof diagAttemptsRaw === 'number' && Number.isFinite(diagAttemptsRaw)) diagAttempts = Math.max(1, Math.floor(diagAttemptsRaw));
            totalPaidAttempts += diagAttempts;
          }
          if (returnedPlan?.__modelError) {
            actualClassification = 'model_error';
            validationResult = { ok: false, reason: 'MODEL_ERROR', message: returnedPlan.message, unsupported: false };
            jsonValid = false;
            failureReason = `MODEL_ERROR: ${returnedPlan.message.slice(0, 200)}`;
          } else if (returnedPlan?.unsupported === true) {
            actualClassification = 'unsupported';
            try { const norm = normalizePlan(returnedPlan); validationResult = validateTestPlan(norm); jsonValid = true; returnedPlan = norm; } catch (e) { validationResult = { ok: false, reason: 'MALFORMED_PLAN', message: e.message, unsupported: false }; jsonValid = false; failureReason = e.message; }
          } else {
            try {
              const norm = normalizePlan(returnedPlan);
              validationResult = validateTestPlan(norm);
              jsonValid = validationResult.ok;
              returnedPlan = norm;
              if (validationResult.ok) { actualClassification = 'supported'; returnedModelId = returnedPlan._diag?.modelId || returnedModelId; }
              else if (validationResult.unsupported) actualClassification = 'unsupported';
              else actualClassification = 'invalid';
            } catch (e) { validationResult = { ok: false, reason: 'MALFORMED_PLAN', message: e.message, unsupported: false }; jsonValid = false; actualClassification = 'invalid'; failureReason = e.message; }
          }
        } catch (e) { latencyMs = Date.now() - t0; failureReason = `LIVE_CALL_EXCEPTION: ${String(e.message).slice(0,200)}`; actualClassification = 'model_error'; validationResult = { ok: false, reason: 'MODEL_ERROR', message: e.message, unsupported: false }; totalPaidAttempts += 1; }
      }
    } else {
      returnedPlan = mockPlanForCase(caseDef);
      returnedModelId = returnedPlan._diag?.modelId || 'mock/unsupported-marker';
      providerFinishReason = returnedPlan._diag?.finishReason || null;
      latencyMs = 0; tokenUsage = null;
      if (returnedPlan.unsupported) {
        actualClassification = 'unsupported';
        try { const norm = normalizePlan(returnedPlan); validationResult = validateTestPlan(norm); jsonValid = true; returnedPlan = norm; } catch (e) { validationResult = { ok: false, reason: 'MALFORMED_PLAN', message: e.message, unsupported: false }; jsonValid = false; }
      } else {
        try { const norm = normalizePlan(returnedPlan); validationResult = validateTestPlan(norm); jsonValid = validationResult.ok; actualClassification = validationResult.ok ? 'supported' : 'invalid'; returnedPlan = norm; } catch (e) { validationResult = { ok: false, reason: 'MALFORMED_PLAN', message: e.message, unsupported: false }; jsonValid = false; actualClassification = 'invalid'; }
      }
      if (verbose) console.log(`  Mock: ${actualClassification}, jsonValid: ${jsonValid}`);
    }
    if (caseDef.expectedClassification === 'supported') {
      if (actualClassification !== 'supported' || !validationResult?.ok) {
        semanticCorrect = false;
        humanReview = { required: false, status: 'failed', note: `Expected supported but got ${actualClassification}` };
        failureReason = failureReason || `SEMANTIC_MISMATCH: expected supported, got ${actualClassification}`;
      } else {
        const { candidate, checks } = checkSemanticCandidate({ plan: returnedPlan, caseDef });
        if (!candidate) {
          semanticCorrect = false;
          humanReview = { required: true, status: 'needs-review', note: 'Auto-check failed: plan missing exceed-cap demonstration or rule mentions' };
          failureReason = `SEMANTIC_INCOMPLETE: missing required elements ${JSON.stringify(checks)}`;
        } else {
          semanticCorrect = 'pending-human-review';
          humanReview = { required: true, status: 'pending-human-review', note: 'Auto checks pass; human must confirm interpretedRule accurately paraphrases cumulative cap. NOT counted as pass until approved.' };
        }
      }
    } else if (caseDef.expectedClassification === 'ambiguous' || caseDef.expectedClassification === 'unsupported') {
      if (actualClassification === 'unsupported' && validationResult?.unsupported) {
        semanticCorrect = true;
        humanReview = { required: false, status: 'n/a', note: 'Correctly returned unsupported for out-of-vocabulary/ambiguous requirement' };
      } else if (actualClassification === 'supported' && validationResult?.ok) {
        semanticCorrect = false;
        humanReview = { required: false, status: 'failed', note: 'Model supplied valid plan for unsupported/ambiguous requirement — semantic failure (hallucination)' };
        failureReason = 'SEMANTIC_FAILURE: unsupported requirement incorrectly produced executable plan';
      } else {
        semanticCorrect = false;
        failureReason = failureReason || `UNEXPECTED_CLASSIFICATION: expected ${caseDef.expectedClassification} (unsupported marker) but got ${actualClassification}`;
        humanReview = { required: false, status: 'failed', note: failureReason };
      }
    }
    if (caseDef.expectedClassification === 'supported' && validationResult?.ok && actualClassification === 'supported') {
      const approvalToken = approvalHash({ businessRequirement: caseDef.requirement, plan: returnedPlan });
      const approved = true;
      try {
        const buggy = executePlan({ plan: returnedPlan, approved, variant: 'buggy' });
        const correct = executePlan({ plan: returnedPlan, approved, variant: 'correct' });
        executesValidly = buggy.executed && correct.executed;
        const buggyViolated = buggy.invariantViolated;
        const correctViolated = correct.invariantViolated;
        exposesDefect = buggyViolated === true && correctViolated === false;
        if (verbose) console.log(`  Execution: buggy violated=${buggyViolated} correct violated=${correctViolated} exposesDefect=${exposesDefect}`);
        if (!exposesDefect && !failureReason) humanReview.note = (humanReview.note || '') + ' | Plan executed but did not expose seeded defect.';
      } catch (e) {
        executesValidly = false; exposesDefect = false;
        failureReason = failureReason ? failureReason + `; EXECUTION_ERROR: ${e.message}` : `EXECUTION_ERROR: ${e.message}`;
      }
    } else {
      executesValidly = 'not-executed-per-integrity';
      exposesDefect = 'not-applicable';
    }
    if (actualClassification === 'model_error') {
      semanticCorrect = false;
      humanReview = { required: false, status: 'model_error', note: 'Model call failed; no semantic success fabricated' };
    }
    const caseResult = {
      caseId: caseDef.id,
      submittedRequirement: caseDef.requirement,
      expectedClassification: caseDef.expectedClassification,
      actualModelClassification: actualClassification,
      returnedModelId,
      structuredPlanValidationResult: validationResult,
      jsonValid,
      semanticCorrectAfterReview: semanticCorrect,
      humanReview,
      executesValidly,
      exposesSeededDefect: exposesDefect,
      providerLatencyMs: latencyMs,
      tokenUsage,
      providerFinishReason,
      failureReason: failureReason || null,
    };
    if (returnedPlan) {
      caseResult.planSummary = {
        ruleId: returnedPlan.ruleId,
        interpretedRule: returnedPlan.interpretedRule,
        operations: returnedPlan.operations
      };
    }
    results.push(caseResult);
    console.log(`  4) Actual model classification: ${actualClassification}`);
    console.log(`  5) Returned model ID: ${returnedModelId || 'null'}`);
    console.log(`  6) Validation: ${JSON.stringify(validationResult)} | jsonValid=${jsonValid}`);
    console.log(`  7) Semantic correctness after review: ${semanticCorrect} | humanReview=${JSON.stringify(humanReview)}`);
    console.log(`  8) Executes validly: ${caseResult.executesValidly}`);
    console.log(`  9) Exposes seeded defect: ${caseResult.exposesSeededDefect}`);
    console.log(`  10) LatencyMs: ${latencyMs} TokenUsage: ${tokenUsage === null ? 'n/a (planner path does not expose tokens; known limitation)' : tokenUsage}`);
    console.log(`  11) Failure reason: ${failureReason || 'none'}`);
  }
  const exactMatchCount = results.filter(r => r.expectedClassification === r.actualModelClassification).length;
  const ambiguousTotal = cases.filter(c => c.expectedClassification === 'ambiguous').length;
  const unsupportedTotal = cases.filter(c => c.expectedClassification === 'unsupported').length;
  const abstentionExpected = ambiguousTotal + unsupportedTotal;
  const safeAbstentionCount = results.filter(r => (r.expectedClassification === 'ambiguous' || r.expectedClassification === 'unsupported') && r.actualModelClassification === 'unsupported').length;
  const providerErrorCount = results.filter(r => r.actualModelClassification === 'model_error').length;
  const summary = {
    totalCases: cases.length,
    mode: live ? 'live' : 'dry-run-mock',
    maxPossiblePaidRequests: maxTotalPaid,
    actualPaidAttempts: totalPaidAttempts,
    counts: {
      expectedSupported: cases.filter(c => c.expectedClassification === 'supported').length,
      expectedAmbiguous: cases.filter(c => c.expectedClassification === 'ambiguous').length,
      expectedUnsupported: cases.filter(c => c.expectedClassification === 'unsupported').length,
      actualSupported: results.filter(r => r.actualModelClassification === 'supported').length,
      actualUnsupported: results.filter(r => r.actualModelClassification === 'unsupported').length,
      actualModelError: providerErrorCount,
      jsonValid: results.filter(r => r.jsonValid).length,
      semanticPass: results.filter(r => r.semanticCorrectAfterReview === true).length,
      semanticPending: results.filter(r => r.semanticCorrectAfterReview === 'pending-human-review').length,
      semanticFail: results.filter(r => r.semanticCorrectAfterReview === false).length,
      executesValidly: results.filter(r => r.executesValidly === true).length,
      exposesDefect: results.filter(r => r.exposesSeededDefect === true).length
    },
    metrics: {
      exactClassificationCount: exactMatchCount,
      exactClassificationRate: exactMatchCount + '/' + cases.length,
      exactClassificationNote: 'Strict expected === actual. Ambiguous classified as unsupported is NOT counted as exact success.',
      safeAbstentionCount: safeAbstentionCount,
      safeAbstentionRate: safeAbstentionCount + '/' + abstentionExpected,
      safeAbstentionNote: 'For ambiguous/unsupported expected, actual unsupported is safe abstention.',
      providerErrorCount: providerErrorCount,
      providerErrorNote: 'Provider errors reported separately from semantic failures.',
      semanticPendingNotPass: true
    },
    disclaimer: 'Ten synthetic cases are not a general benchmark. See docs/EVALUATION.md.',
    humanReviewPolicy: 'pending-human-review is NOT counted as pass. JSON validity != semantic correctness. Exact vs safe abstention distinct.'
  };
  console.log('\n=== EVALUATION SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nNote: No fabricated passing results. Unsuccessful results recorded without suppression.');
  console.log(`Report will be written to ${REPORT_JSON}`);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : 'dry-run-mock',
    fixtures: fixtures.meta,
    providerCaps: { maxCases: MAX_CASES, maxAttemptsPerCase: MAX_ATTEMPTS, maxTotalPaidRequests: maxTotalPaid, actualPaidAttempts: totalPaidAttempts },
    summary,
    results
  };
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  if (fs.existsSync(REPORT_JSON)) {
    try {
      const prev = JSON.parse(fs.readFileSync(REPORT_JSON,'utf8'));
      if (prev.mode === 'live') {
        const archDir = path.join(ROOT,'docs','archive');
        fs.mkdirSync(archDir,{recursive:true});
        const ts = (prev.generatedAt || new Date().toISOString()).replace(/[:.]/g,'-');
        const archPath = path.join(archDir, `evaluation-report.live-${ts}.json`);
        if (!fs.existsSync(archPath)) {
          fs.writeFileSync(archPath, JSON.stringify(prev,null,2),'utf8');
          console.log(`Archived previous live report to ${archPath} (never overwritten)`);
        }
      }
    } catch {}
  }
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report written: ${REPORT_JSON}`);
  const fragmentPath = path.join(ROOT, 'docs', 'evaluation-report.md.fragment');
  const rows = results.map(r => `| ${r.caseId} | ${r.expectedClassification} | ${r.actualModelClassification} | ${r.jsonValid} | ${r.semanticCorrectAfterReview} | ${r.executesValidly} | ${r.exposesSeededDefect} | ${r.providerLatencyMs} | ${(r.failureReason ? r.failureReason.slice(0, 80) : '').replace(/\|/g, ' ')} |`).join('\n');
  const fragment = `## Actual Results (${report.generatedAt} — ${report.mode})\nTotal cases: ${report.summary.totalCases} | Mode: ${report.mode} | Max paid requests: ${report.providerCaps.maxTotalPaidRequests} | Actual attempts: ${report.providerCaps.actualPaidAttempts}\n\n| Case | Expected | Actual | JSON Valid | Semantic | Executes | Exposes Defect | LatencyMs | Failure |\n|------|----------|--------|-------------|----------|----------|----------------|-----------|---------|\n${rows}\n\nDisclaimer: Ten synthetic cases are not a general benchmark. Pending-human-review is not a pass.\n`;
  fs.writeFileSync(fragmentPath, fragment, 'utf8');
  console.log(`Fragment written: ${fragmentPath}`);
  if (live) console.log('\nLive run complete. Review docs/evaluation-report.json and docs/EVALUATION.md for methodology.');
  else console.log('\nDry-run complete. Re-run with --live for optional paid inference (explicit opt-in). No costs incurred.');
}
await evaluate();
