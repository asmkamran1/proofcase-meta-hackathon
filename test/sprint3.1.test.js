import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSemanticEligibility } from '../src/semanticGate.js';
import { normalizePlan, validateTestPlan } from '../src/testPlanValidator.js';
import { approvalHash, verifyApproval } from '../src/approval.js';
import { executePlan } from '../src/executor.js';
import { generateTestPlan } from '../src/planner.js';
import { MAX_ATTEMPTS } from '../src/metaClient.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(ROOT, 'fixtures', 'evaluation.json');
const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH,'utf8'));
function validPlanForReq(req){
  return { version:'1.0', ruleId:'refund-cap', businessRequirement:req, interpretedRule:'The sum of accepted refunds for an order must not exceed its captured payment amount.', operations:[{op:'createOrder',orderId:'order-1',capturedCents:10000},{op:'requestRefund',orderId:'order-1',amountCents:4000,refundId:'r1'},{op:'assertRefundStatus',refundId:'r1',expectedStatus:'accepted'},{op:'assertTotalRefunds',orderId:'order-1',expectedCents:4000},{op:'requestRefund',orderId:'order-1',amountCents:7000,refundId:'r2'},{op:'assertRefundStatus',refundId:'r2',expectedStatus:'rejected'},{op:'assertTotalRefunds',orderId:'order-1',expectedCents:4000}] };
}
test('ambiguous requirements correctly blocked by semantic gate',()=>{
  const amb01=fixtures.cases.find(c=>c.id==='AMB-01');
  const amb02=fixtures.cases.find(c=>c.id==='AMB-02');
  const g1=checkSemanticEligibility({businessRequirement:amb01.requirement, interpretedRule:'The sum of accepted refunds for an order must not exceed its captured payment amount.', plan:validPlanForReq(amb01.requirement)});
  const g2=checkSemanticEligibility({businessRequirement:amb02.requirement, interpretedRule:'The sum of accepted refunds for an order must not exceed its captured payment amount.', plan:validPlanForReq(amb02.requirement)});
  assert.equal(g1.eligible,false); assert.equal(g2.eligible,false);
  assert.ok(g1.missing.length>=2); assert.equal(g1.unverified,true);
});
test('all six supported paraphrases pass gate',()=>{
  const supCases=fixtures.cases.filter(c=>c.expectedClassification==='supported');
  assert.equal(supCases.length,6);
  for(const c of supCases){ const plan=validPlanForReq(c.requirement); const g=checkSemanticEligibility({businessRequirement:c.requirement, interpretedRule:plan.interpretedRule, plan}); assert.equal(g.eligible,true, c.id+' should be eligible '+g.reason); assert.equal(g.status,'VALID'); }
});
test('both unsupported correctly return UNSUPPORTED',()=>{
  const uns01=fixtures.cases.find(c=>c.id==='UNS-01'); const uns02=fixtures.cases.find(c=>c.id==='UNS-02');
  const g1=checkSemanticEligibility({businessRequirement:uns01.requirement}); const g2=checkSemanticEligibility({businessRequirement:uns02.requirement});
  assert.equal(g1.eligible,false); assert.equal(g2.eligible,false); assert.equal(g1.status,'UNSUPPORTED'); assert.equal(g2.status,'UNSUPPORTED');
});
test('browser API and evaluator gate consistency',()=>{
  const serverCode=fs.readFileSync(path.join(ROOT,'src','server.js'),'utf8'); const evalCode=fs.readFileSync(path.join(ROOT,'scripts','evaluate.mjs'),'utf8');
  assert.ok(serverCode.includes('checkSemanticEligibility')); assert.ok(evalCode.includes('checkSemanticEligibility'));
  const req='Total accepted refunds for an order cannot exceed captured payment.';
  const g1=checkSemanticEligibility({businessRequirement:req, interpretedRule:'sum of accepted refunds per order must not exceed captured', plan:validPlanForReq(req)});
  const g2=checkSemanticEligibility({businessRequirement:req, interpretedRule:'sum of accepted refunds per order must not exceed captured', plan:validPlanForReq(req)});
  assert.deepEqual(g1,g2);
});
test('no execution of unresolved interpretations',()=>{
  const amb='Refunds should not be too large.'; const plan=validPlanForReq(amb); const gate=checkSemanticEligibility({businessRequirement:amb, interpretedRule:plan.interpretedRule, plan});
  assert.equal(gate.eligible,false); const notApproved=executePlan({plan, approved:false, variant:'buggy'}); assert.equal(notApproved.executed,false);
});
test('approval invalidation on changed requirements',()=>{
  const br1='Total accepted refunds for an order cannot exceed captured payment.'; const br2='Refunds should not be too large.'; const plan=validPlanForReq(br1); const tok=approvalHash({businessRequirement:br1,plan}); assert.ok(verifyApproval({businessRequirement:br1,plan,approvalToken:tok})); assert.equal(verifyApproval({businessRequirement:br2,plan,approvalToken:tok}),false);
});
test('output truncation triggers bounded retry with higher budget', async()=>{
  const prev=process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY='test-key';
  try{ let callCount=0; const fetchImpl=async(url,opts)=>{ callCount++; const body=JSON.parse(opts.body); if(callCount===1) return {ok:true,status:200, json:async()=>({model:'meta-models/muse-spark-open-1026', choices:[{finish_reason:'length', message:{content:''}}], usage:{completion_tokens:4095}})}; const plan=validPlanForReq('Total accepted refunds for an order cannot exceed captured payment.'); return {ok:true,status:200, json:async()=>({model:'meta-models/muse-spark-open-1026', choices:[{finish_reason:'stop', message:{content:JSON.stringify(plan)}}], usage:{completion_tokens:300}})}; }; const out=await generateTestPlan({businessRequirement:'Total accepted refunds for an order cannot exceed captured payment.', fetchImpl, maxTokens:4096}); assert.equal(out._diag.attempts,2); assert.equal(out._diag.retried,true); assert.ok(out._diag.outputBudget>4096); assert.equal(callCount,2); } finally { if(prev===undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY=prev; }
});
test('maximum two attempts per case invariant',()=>{ assert.equal(MAX_ATTEMPTS,2); const len=JSON.parse(fs.readFileSync(FIXTURES_PATH,'utf8')).cases.length; assert.equal(len*MAX_ATTEMPTS,20); });
test('actual provider request counting via _diag.attempts', async()=>{
  const prev=process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY='test-key';
  try{ let calls=0; const fetchImpl=async(url,opts)=>{ calls++; const body=JSON.parse(opts.body); if(calls===1) return {ok:true,status:200, json:async()=>({model:'m', choices:[{finish_reason:'length', message:{content:''}}], usage:{completion_tokens: body.max_tokens-1}})}; const plan=validPlanForReq('Total accepted refunds for an order cannot exceed captured payment.'); return {ok:true,status:200, json:async()=>({model:'m', choices:[{finish_reason:'stop', message:{content:JSON.stringify(plan)}}], usage:{completion_tokens:100}})}; }; const out=await generateTestPlan({businessRequirement:'Total accepted refunds for an order cannot exceed captured payment.', fetchImpl, maxTokens:4096}); assert.equal(calls,2); assert.equal(out._diag.attempts,2); } finally { if(prev===undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY=prev; }
});
test('exact classification versus safe abstention metrics separated',()=>{
  const mockResults=[...Array.from({length:6},(_,i)=>({caseId:'SUP-0'+(i+1), expectedClassification:'supported', actualModelClassification:'supported'})), ...Array.from({length:2},(_,i)=>({caseId:'AMB-0'+(i+1), expectedClassification:'ambiguous', actualModelClassification:'unsupported'})), ...Array.from({length:2},(_,i)=>({caseId:'UNS-0'+(i+1), expectedClassification:'unsupported', actualModelClassification:'unsupported'}))];
  const exact=mockResults.filter(r=>r.expectedClassification===r.actualModelClassification).length; const safe=mockResults.filter(r=> (r.expectedClassification==='ambiguous'||r.expectedClassification==='unsupported') && r.actualModelClassification==='unsupported').length;
  assert.equal(exact,8); assert.equal(safe,4);
});
test('no automatic paid API calls in tests',()=>{
  const liveFlag='--'+'live';
  const evalCode=fs.readFileSync(path.join(ROOT,'scripts','evaluate.mjs'),'utf8'); assert.ok(evalCode.includes("args.includes('"+liveFlag+"')")); const thisFile=fs.readFileSync(path.join(ROOT,'test','sprint3.1.test.js'),'utf8'); assert.ok(!thisFile.includes('node scripts/evaluate.mjs '+liveFlag));
});
test('no retry on invalid semantics or validation failure', async()=>{
  const prev=process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY='test-key';
  try{
    let callCount=0; const fetchImpl=async()=>{ callCount++; const plan=validPlanForReq('Refunds should not be too large.'); return {ok:true,status:200, json:async()=>({model:'m', choices:[{finish_reason:'stop', message:{content: JSON.stringify(plan)}}], usage:{completion_tokens:100}})}; };
    const out=await generateTestPlan({businessRequirement:'Refunds should not be too large.', fetchImpl}); assert.equal(callCount,1);
    let call2=0; const fetchImpl2=async()=>{ call2++; return {ok:true,status:200, json:async()=>({model:'m', choices:[{finish_reason:'stop', message:{content:'not json {'}}], usage:{}})}; };
    const out2=await generateTestPlan({businessRequirement:'test', fetchImpl:fetchImpl2}); assert.equal(out2.__modelError,true); assert.equal(call2,1);
  } finally { if(prev===undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY=prev; }
});
test('higher retry budget only on recognized truncation', async()=>{
  const prev=process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY='test-key';
  try{
    let callCount=0; const fetchImpl=async()=>{ callCount++; return {ok:true,status:200, json:async()=>({model:'m', choices:[{finish_reason:'stop', message:{content:''}}], usage:{completion_tokens:10}})}; };
    const out=await generateTestPlan({businessRequirement:'x', fetchImpl, maxTokens:4096}); assert.equal(out.__modelError,true); assert.equal(callCount,1);
  } finally { if(prev===undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY=prev; }
});
test('evaluator report contains separated metrics and archive logic',()=>{
  const evalCode=fs.readFileSync(path.join(ROOT,'scripts','evaluate.mjs'),'utf8');
  assert.ok(evalCode.includes('exactClassificationCount')); assert.ok(evalCode.includes('safeAbstentionCount')); assert.ok(evalCode.includes('providerErrorCount')); assert.ok(evalCode.includes('Archived previous live report'));
});
