const reqEl=document.getElementById("req");
const interpretBtn=document.getElementById("interpretBtn");
const replayBtn=document.getElementById("replayBtn");
const interpretStatus=document.getElementById("interpretStatus");
const interpretationBox=document.getElementById("interpretationBox");
const planBox=document.getElementById("planBox");
const planPre=document.getElementById("planPre");
const errorBox=document.getElementById("errorBox");
const approveBtn=document.getElementById("approveBtn");
const approvalHint=document.getElementById("approvalHint");
const modelBadge=document.getElementById("modelBadge");
const liveBadge=document.getElementById("liveBadge");
let state={businessRequirement:"",plan:null,approvalToken:null,modelLabel:"",modelId:""};
let lastReport=null;
async function loadConfig(){
  const r=await fetch("/api/config"); const j=await r.json();
  reqEl.value=j.businessRequirement; modelBadge.textContent="model: "+j.model;
  state.businessRequirement=j.businessRequirement;
}
loadConfig();
reqEl.addEventListener("input",()=>{
  if(state.businessRequirement!==reqEl.value){invalidateApproval();}
});
function invalidateApproval(){
  state.approvalToken=null; approveBtn.disabled=true; approvalHint.textContent="Requirement or plan changed — re-interpret to re-approve.";
  document.getElementById("invariantBanner").classList.add("hidden");
}
function formatCurrency(cents){
  const n = Number(cents);
  if (!Number.isFinite(n)) return String(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
}
function describeOperation(op){
  if (!op || typeof op.op !== 'string') return 'Unknown operation';
  if (op.op === 'createOrder') {
    return 'Create an order "' + op.orderId + '" with ' + formatCurrency(op.capturedCents) + ' captured.';
  }
  if (op.op === 'requestRefund') {
    return 'Request a refund of ' + formatCurrency(op.amountCents) + ' for order "' + op.orderId + '" (refund "' + op.refundId + '").';
  }
  if (op.op === 'assertRefundStatus') {
    return 'Verify refund "' + op.refundId + '" was ' + op.expectedStatus + '.';
  }
  if (op.op === 'assertTotalRefunds') {
    return 'Verify accepted refunds for order "' + op.orderId + '" total ' + formatCurrency(op.expectedCents) + '.';
  }
  return op.op + ' — ' + JSON.stringify(op);
}
function renderPlanSequence(plan){
  const seqEl = document.getElementById('planSequence');
  if (!seqEl) return;
  seqEl.textContent = '';
  if (!plan || !Array.isArray(plan.operations)) return;
  plan.operations.forEach(function(op){
    const li = document.createElement('li');
    li.textContent = describeOperation(op);
    seqEl.appendChild(li);
  });
}
function clearPlanSequence(){
  const seqEl = document.getElementById('planSequence');
  if (seqEl) seqEl.textContent = '';
}
function showError(msg){ errorBox.textContent=msg; errorBox.classList.remove("hidden"); }
function clearError(){ errorBox.classList.add("hidden"); errorBox.textContent=""; }
async function doInterpret(useRecorded=false){
  const mySeq = ++interpretSeq;
  const snapshotReq = reqEl.value;
  clearError(); interpretationBox.classList.add("hidden"); planBox.classList.add("hidden");
  clearPlanSequence();
  approveBtn.disabled=true; state.plan=null; state.approvalToken=null;
  interpretStatus.textContent=useRecorded?"Loading recorded...":"Interpreting...";
  try{
    const r=await fetch("/api/interpret",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({businessRequirement:snapshotReq,useRecorded})});
    const j=await r.json();
    if (mySeq !== interpretSeq) return;
    if (reqEl.value !== snapshotReq) return;
    if (!r.ok) {
      showError(j.error || j.code || "Interpretation rejected");
      interpretStatus.textContent="";
      return;
    }
    if(j.status==="MODEL_ERROR"){ showError("Model error: "+j.message); liveBadge.textContent="MODEL_ERROR"; liveBadge.className="badge"; interpretStatus.textContent=""; return; }
    if(j.status==="UNSUPPORTED_REQUIREMENT"){ showError("Unsupported requirement: "+j.message); liveBadge.textContent="UNSUPPORTED"; interpretStatus.textContent=""; return; }
    if(j.status==="INVALID_PLAN"){ showError("Invalid plan: "+j.message); if(j.plan){ planPre.textContent=JSON.stringify(j.plan,null,2); planBox.classList.remove("hidden"); renderPlanSequence(j.plan); } interpretStatus.textContent=""; return; }
    if(j.status && j.status !== "VALID"){
      showError(j.message || j.error || "Requirement not eligible: "+j.status);
      interpretStatus.textContent="";
      return;
    }
    if(j.status==="VALID"){
      interpretationBox.textContent="Interpreted: "+j.interpretedRule; interpretationBox.classList.remove("hidden");
      planPre.textContent=JSON.stringify(j.plan,null,2); planBox.classList.remove("hidden");
      renderPlanSequence(j.plan);
      state.businessRequirement=snapshotReq;
      state.plan=j.plan; state.approvalToken=j.approvalToken; state.modelLabel=j.modelLabel; state.modelId=j.modelId;
      modelBadge.textContent="model: "+j.modelId; liveBadge.textContent=j.live?"LIVE META RESPONSE":"RECORDED META RESPONSE";
      liveBadge.style.background=j.live?"#12331a":"#33270f";
      approvalHint.textContent="Server-issued authorization granted. Click Approve & Run.";
      approveBtn.disabled=false;
    }
    interpretStatus.textContent="";
  }catch(e){
    if (mySeq !== interpretSeq) return;
    if (reqEl.value !== snapshotReq) return;
    showError(e.message); interpretStatus.textContent="";
  }
}
interpretBtn.onclick=()=>doInterpret(false);
replayBtn.onclick=()=>doInterpret(true);
approveBtn.onclick=async()=>{
  clearError();
  if(!state.plan||!state.approvalToken){ showError("No approved plan"); return;}
  approveBtn.disabled=true; approvalHint.textContent="Running...";
  const r=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({businessRequirement:state.businessRequirement,plan:state.plan,approvalToken:state.approvalToken,modelLabel:state.modelLabel,modelId:state.modelId})});
  const j=await r.json();
  if(!r.ok){ showError(j.error||"Run failed"); approveBtn.disabled=false; return; }
  lastReport=j;
  renderExec(j.results);
  approvalHint.textContent="Executed at "+j.executedAt;
  document.getElementById("downloadBtn").disabled=false;
  approveBtn.disabled=false;
};
function renderExec(results){
  const b=results.buggy, c=results.correct;
  document.getElementById("buggyTrace").textContent=b.transitions.map((t,i)=>`${i+1}. ${t.op} -> ${JSON.stringify(t.result||{pass:t.pass,actual:t.actualCents||t.actualStatus})}`).join("\n");
  document.getElementById("correctTrace").textContent=c.transitions.map((t,i)=>`${i+1}. ${t.op} -> ${JSON.stringify(t.result||{pass:t.pass,actual:t.actualCents||t.actualStatus})}`).join("\n");
  drawChart("buggyChart",b);
  drawChart("correctChart",c);
  const banner=document.getElementById("invariantBanner");
  banner.classList.remove("hidden");
  if(b.invariantViolated){
    const failStep=b.transitions.findIndex(t=>t.state?.orders?.[0]?.invariantViolated)+1;
    banner.textContent=`Invariant violated in BUGGY at step ${failStep}: captured vs accepted mismatch. Correct remains clean.`;
    banner.className="banner fail";
  } else {
    banner.textContent="No invariant violation (plan may not exceed cap)."; banner.className="banner pass";
  }
}
function drawChart(id,data){
  const el=document.getElementById(id); el.innerHTML="";
  const orders=data.finalState.orders[0]; if(!orders){el.textContent="no orders"; return;}
  const captured=orders.capturedCents; const accepted=orders.totalAcceptedCents;
  const max=Math.max(captured,accepted,1);
  const mk=(label,val,color,over=false)=>{const d=document.createElement("div");d.className="bar "+(over?"over":"");const i=document.createElement("i");i.style.height=(val/max*50+8)+"px";i.style.background=color;const s=document.createElement("span");s.textContent=label+":"+val;d.prepend(i);d.append(s);return d;};
  el.append(mk("captured",captured,"#2a6bff"));
  el.append(mk("accepted",accepted,"#ff3b30",accepted>captured));
}
document.getElementById("downloadBtn").onclick=()=>{
  if(!lastReport) return;
  const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="proofcase-report.json";a.click();
};
