// Bounded semantic eligibility gate for refund-cap invariant.
// Requires cumulative, accepted, per-order, captured.
const CUMULATIVE_RE = /\b(total|sum|cumulativ\w*|aggregat\w*|combined|collectively|together|overall|entire|capped)\b/i;
const ACCEPTED_RE = /\b(accepted|approved)\b/i;
const PER_ORDER_RE = /\border\b/i;
const CAPTURED_RE = /\bcaptur(ed|es|ing)?\b/i;
function hasCumulative(t){return CUMULATIVE_RE.test(t);}
function hasAccepted(t){return ACCEPTED_RE.test(t);}
function hasPerOrder(t){return PER_ORDER_RE.test(t);}
function hasCaptured(t){return CAPTURED_RE.test(t);}
function missingPillars(req){
  const r=String(req??"").trim();
  const m=[];
  if(!hasCumulative(r)) m.push("cumulative_scope");
  if(!hasAccepted(r)) m.push("accepted_refunds");
  if(!hasPerOrder(r)) m.push("per_order_scope");
  if(!hasCaptured(r)) m.push("captured_payment_bound");
  return m;
}
function planExceedsCap(plan){
  if(!plan||!Array.isArray(plan.operations)) return false;
  const c=plan.operations.find(o=>o.op==="createOrder");
  const rf=plan.operations.filter(o=>o.op==="requestRefund");
  if(!c||typeof c.capturedCents!=="number") return false;
  if(rf.length<2) return false;
  const sum=rf.reduce((s,r)=>s+(typeof r.amountCents==="number"?r.amountCents:0),0);
  return sum>c.capturedCents;
}
function checkPlanShape(plan){
  if(!plan||!Array.isArray(plan.operations)) return {ok:false,reason:"plan operations missing"};
  const ops=plan.operations;
  const hasCreate=ops.some(o=>o.op==="createOrder");
  const refunds=ops.filter(o=>o.op==="requestRefund");
  const hasAssertStatus=ops.some(o=>o.op==="assertRefundStatus");
  const hasAssertTotal=ops.some(o=>o.op==="assertTotalRefunds");
  const hasAccepted=ops.some(o=>o.op==="assertRefundStatus"&&o.expectedStatus==="accepted");
  const hasRejected=ops.some(o=>o.op==="assertRefundStatus"&&o.expectedStatus==="rejected");
  const exceeds=planExceedsCap(plan);
  const checks={hasCreate,refunds:refunds.length,hasAssertStatus,hasAssertTotal,hasAccepted,hasRejected,exceeds};
  const ok=hasCreate&&refunds.length>=2&&hasAssertStatus&&hasAssertTotal&&hasAccepted&&hasRejected&&exceeds;
  if(!ok) return {ok:false,reason:`plan does not demonstrate exceed-cap defect (checks=${JSON.stringify(checks)})`};
  return {ok:true,checks};
}
function interpretedRuleConsistent(ir){
  const s=String(ir??"").trim();
  if(!s) return {ok:false,reason:"interpretedRule missing"};
  const miss=[];
  if(!hasCaptured(s)) miss.push("interpretedRule missing captured");
  if(!hasCumulative(s)&&!/\bcaptur/i.test(s)) miss.push("interpretedRule missing cumulative/total language");
  if(miss.length>0) return {ok:false,reason:miss.join("; ")};
  return {ok:true};
}
export function checkSemanticEligibility({businessRequirement,interpretedRule,plan}={}){
  const req=String(businessRequirement??"").trim();
  if(!req) return {eligible:false,status:"NEEDS_INPUT",reason:"businessRequirement empty",missing:["businessRequirement"],needsHumanReview:true,unverified:true};
  if(req.length>2000) return {eligible:false,status:"NEEDS_INPUT",reason:"businessRequirement too long",missing:[],needsHumanReview:true,unverified:true};
  const missing=missingPillars(req);
  if(missing.length>0){
    const mentionsRefund=/\brefunds?\b/i.test(req);
    let status=mentionsRefund?"NEEDS_INPUT":"UNSUPPORTED";
    const outHints=["email","notification","within 24","24 hour","sla","time"];
    if(outHints.some(h=>req.toLowerCase().includes(h))) status="UNSUPPORTED";
    const reason=`Requirement missing essential invariant pillars: ${missing.join(", ")}. Vague terms like large/reasonable/correctly do not satisfy gate.`;
    return {eligible:false,status,reason,missing,needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
  }
  if(interpretedRule!==undefined){
    const irCheck=interpretedRuleConsistent(interpretedRule);
    if(!irCheck.ok) return {eligible:false,status:"NEEDS_INPUT",reason:`InterpretedRule does not preserve invariant: ${irCheck.reason}`,missing:["interpretedRule_consistency"],needsHumanReview:true,unverified:true};
  }
  if(plan!==undefined&&plan!==null){
    if(plan.unsupported===true) return {eligible:false,status:"UNSUPPORTED",reason:"Model returned unsupported marker despite requirement containing pillars - treat as safe abstention",missing:[],needsHumanReview:false,unverified:false};
    const pc=checkPlanShape(plan);
    if(!pc.ok) return {eligible:false,status:"NEEDS_INPUT",reason:pc.reason,missing:["plan_exceed_cap"],needsHumanReview:true,unverified:true,planChecks:pc.checks??null};
  }
  return {eligible:true,status:"VALID",reason:null,missing:[],needsHumanReview:true,unverified:false,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
}
export function evaluateRequirementEligibility(p){return checkSemanticEligibility(p);}
export const PILLARS={cumulative:"cumulative_scope",accepted:"accepted_refunds",perOrder:"per_order_scope",captured:"captured_payment_bound"};
