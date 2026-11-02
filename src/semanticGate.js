// Bounded semantic eligibility gate for refund-cap invariant.
// Requires cumulative, accepted, per-order, captured.
// Hardened: reversed, strict, equality, vague fail-closed.
const CUMULATIVE_RE = /\b(total|sum|cumulativ\w*|aggregat\w*|combined|collectively|together|overall|entire|capped)\b/i;
const ACCEPTED_RE = /\b(accepted|approved)\b/i;
const PER_ORDER_RE = /\border\b/i;
const CAPTURED_RE = /\bcaptur(ed|es|ing)?\b/i;
function hasCumulative(t){return CUMULATIVE_RE.test(t);}
function hasAccepted(t){return ACCEPTED_RE.test(t);}
function hasPerOrder(t){return PER_ORDER_RE.test(t);}
function hasCaptured(t){return CAPTURED_RE.test(t);}
function hasNegatedExceed(req){
  // Support exceed, surpass, greater, more than with negation
  const neg = "\\b(cannot|cant|can\\s+not|must\\s+not|must\\s+never|never|not|should\\s+not|shall\\s+not|will\\s+not|cannot)\\b";
  const re1 = new RegExp(neg + "[^.]{0,40}\\b(exceed|surpass|greater|more\\s+than)\\b", "i");
  const re2 = /\b(exceed|surpass|greater|more\s+than)\b[^.]{0,20}\b(not|cannot|never)\b/i;
  return re1.test(req) || re2.test(req);
}
function isReversedExceed(req){
  if(!/\b(exceed|surpass|greater|more\s+than)\b/i.test(req)) return false;
  return !hasNegatedExceed(req);
}
function isStrictLess(req){
  return /\bstrictly\s+(less|smaller|below)\b/i.test(req) || /\bless\s+than\b/i.test(req) || /\bsmaller\s+than\b/i.test(req) || /\bstrictly\s+less\b/i.test(req);
}
function isEquality(req){
  return /\bequal(s|ity)?\b/i.test(req);
}
function hasCapRelation(req){
  if (hasNegatedExceed(req)) return true;
  if (/\bcapped\s+(by|at)\b/i.test(req)) return true;
  if (/\bstay\s+within\b/i.test(req)) return true;
  if (/\bwithin\b/i.test(req) && /\bcaptur/i.test(req)) return true;
  if (/\blimit\b/i.test(req)) return true;
  if (/\bcapped\b/i.test(req)) return true;
  if (/\bsurpass\b/i.test(req) && hasNegatedExceed(req)) return true;
  if (/\bmore\s+than\b/i.test(req) && hasNegatedExceed(req)) return true;
  if (/cannot be more than/i.test(req)) return true;
  if (/\b(cannot|must\s+not|never|not)\b[^.]{0,20}\b(greater|surpass)\b/i.test(req)) return true;
  return false;
}
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
    // Strict/equality checks even when pillars missing: they are clearly invalid semantic intent
    if(isStrictLess(req) || isEquality(req)){
      return {eligible:false,status:"NEEDS_INPUT",reason:"Requirement uses strict or equality comparison, not cumulative cap <= captured.",missing,needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
    }
    const reason=`Requirement missing essential invariant pillars: ${missing.join(", ")}. Vague terms like large/reasonable/correctly do not satisfy gate.`;
    return {eligible:false,status,reason,missing,needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
  }
  // Hardened semantic checks where pillars are present
  if(isReversedExceed(req)){
    return {eligible:false,status:"NEEDS_INPUT",reason:"Requirement states refunds must exceed captured payment (inverted invariant).",missing:[],needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
  }
  if(isStrictLess(req)){
    return {eligible:false,status:"NEEDS_INPUT",reason:"Requirement uses strict less-than, not allowed: refunds must not exceed captured (<=).",missing:[],needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
  }
  if(isEquality(req)){
    return {eligible:false,status:"NEEDS_INPUT",reason:"Requirement requires equality to captured, not cumulative cap.",missing:[],needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
  }
  if(!hasCapRelation(req)){
    return {eligible:false,status:"NEEDS_INPUT",reason:"Requirement contains invariant keywords but no meaningful cap relationship (exceed/capped/within/limit).",missing:[],needsHumanReview:true,unverified:true,evidence:{cumulative:hasCumulative(req),accepted:hasAccepted(req),perOrder:hasPerOrder(req),captured:hasCaptured(req)}};
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
