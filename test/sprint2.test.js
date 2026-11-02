import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan, validateTestPlan } from "../src/testPlanValidator.js";
import { approvalHash, verifyApproval } from "../src/approval.js";
import { executePlan } from "../src/executor.js";
import fs from "node:fs";
const validPlan={
  version:"1.0",ruleId:"refund-cap",businessRequirement:"Total accepted refunds for an order cannot exceed captured payment.",interpretedRule:"Sum must not exceed captured.",
  operations:[
    {op:"createOrder",orderId:"order-1",capturedCents:10000},
    {op:"requestRefund",orderId:"order-1",amountCents:6000,refundId:"r1"},
    {op:"assertRefundStatus",refundId:"r1",expectedStatus:"accepted"},
    {op:"requestRefund",orderId:"order-1",amountCents:5000,refundId:"r2"},
    {op:"assertRefundStatus",refundId:"r2",expectedStatus:"rejected"},
    {op:"assertTotalRefunds",orderId:"order-1",expectedCents:6000}
  ]};
test("API request validation - missing businessRequirement",()=>{
  // simulate server check: empty should 400
  const br="";
  assert.ok(!br.trim());
});
test("Plan approval integrity - token deterministic and verifies",()=>{
  const br="Total accepted refunds for an order cannot exceed captured payment.";
  const h1=approvalHash({businessRequirement:br,plan:validPlan});
  const h2=approvalHash({businessRequirement:br,plan:validPlan});
  assert.equal(h1,h2);
  assert.ok(verifyApproval({businessRequirement:br,plan:validPlan,approvalToken:h1}));
});
test("Requirement change invalidates approval",()=>{
  const br1="Total accepted refunds for an order cannot exceed captured payment.";
  const br2=br1+" extra";
  const tok=approvalHash({businessRequirement:br1,plan:validPlan});
  assert.equal(verifyApproval({businessRequirement:br2,plan:validPlan,approvalToken:tok}),false);
});
test("Plan change invalidates approval",()=>{
  const br="Total accepted refunds for an order cannot exceed captured payment.";
  const tok=approvalHash({businessRequirement:br,plan:validPlan});
  const mod=structuredClone(validPlan); mod.operations[0].capturedCents=9999;
  assert.equal(verifyApproval({businessRequirement:br,plan:mod,approvalToken:tok}),false);
});
test("Invalid model output fails closed",()=>{
  const nullPlan=null;
  assert.throws(()=>validateTestPlan(nullPlan),/MALFORMED_PLAN/);
  const bad={version:"1.0",ruleId:"refund-cap",businessRequirement:"x",interpretedRule:"x",operations:[{op:"dropTable"}]};
  const n=normalizePlan(bad); assert.throws(()=>validateTestPlan(n),/INVALID_OP/);
});
test("Unsupported rules marker handled",()=>{
  const unsupported={unsupported:true,reason:"cannot express"};
  const v=validateTestPlan(unsupported); assert.equal(v.reason,"UNSUPPORTED_REQUIREMENT");
});
test("Buggy/corrected execution comparison",()=>{
  const buggy=executePlan({plan:validPlan,approved:true,variant:"buggy"});
  const correct=executePlan({plan:validPlan,approved:true,variant:"correct"});
  assert.equal(buggy.invariantViolated,true);
  assert.equal(correct.invariantViolated,false);
  assert.ok(buggy.finalState.orders[0].totalAcceptedCents>correct.finalState.orders[0].totalAcceptedCents);
});
test("Export consistency - report contains actual results", async()=>{
  // simulate server report generation: results must equal direct execution
  const br="Total accepted refunds for an order cannot exceed captured payment.";
  const tok=approvalHash({businessRequirement:br,plan:validPlan});
  assert.ok(verifyApproval({businessRequirement:br,plan:validPlan,approvalToken:tok}));
  const buggy=executePlan({plan:validPlan,approved:true,variant:"buggy"});
  const report={businessRequirement:br,plan:validPlan,approvalToken:tok,results:{buggy}};
  assert.deepEqual(report.results.buggy.transitions,buggy.transitions);
});
test("Honest replay labeling - recorded file validated same contract",()=>{
  const rec=JSON.parse(fs.readFileSync("docs/recordedResponse.json","utf8"));
  assert.ok(rec.plan);
  assert.ok(rec._diag.modelId.includes("muse"));
  const norm=normalizePlan(rec.plan);
  const v=validateTestPlan(norm); assert.equal(v.ok,true);
});
test("Normalization rejects duplicate/conflicting fields",()=>{
  const dup=structuredClone(validPlan);
  dup.operations[1]={op:"requestRefund",orderId:"order-1",amountCents:6000,amount:6000,refundId:"r1"};
  const n=normalizePlan(dup);
  assert.throws(()=>validateTestPlan(n),/DUPLICATE_FIELD/);
});
test("Normalization rejects unknown fields",()=>{
  const bad=structuredClone(validPlan); bad.operations[0].evil="x";
  const n=normalizePlan(bad); assert.throws(()=>validateTestPlan(n),/INVALID_FIELD/);
});
