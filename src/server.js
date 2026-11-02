import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUSINESS_REQUIREMENT } from "./catalog.js";
import { generateTestPlan } from "./planner.js";
import { normalizePlan, validateTestPlan } from "./testPlanValidator.js";
import { executePlan } from "./executor.js";
import { approvalHash, verifyApproval } from "./approval.js";
import { basetenConfig } from "./metaClient.js";
import { checkSemanticEligibility } from "./semanticGate.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const RECORDED_PATH = path.join(ROOT, "docs", "recordedResponse.json");
function loadEnv(){for(const name of [".env.local",".env"]){const p=path.join(ROOT,name);if(!fs.existsSync(p))continue;for(const line of fs.readFileSync(p,"utf8").split("\n")){const t=line.trim();if(!t||t.startsWith("#"))continue;const eq=t.indexOf("=");if(eq<0)continue;const k=t.slice(0,eq).trim();const v=t.slice(eq+1).trim().replace(/^['\"]|['\"]$/g,"");if(!(k in process.env))process.env[k]=v;}}}
loadEnv();
function sendJson(res,code,obj){res.writeHead(code,{"Content-Type":"application/json"});res.end(JSON.stringify(obj));}
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json"};
function serveStatic(req,res){let urlPath=req.url.split("?")[0];if(urlPath==="/")urlPath="/index.html";const filePath=path.join(PUBLIC,urlPath);if(!filePath.startsWith(PUBLIC)){res.writeHead(403);res.end("forbidden");return true;}if(!fs.existsSync(filePath)||fs.statSync(filePath).isDirectory())return false;const ext=path.extname(filePath);res.writeHead(200,{"Content-Type":MIME[ext]||"text/plain"});res.end(fs.readFileSync(filePath));return true;}
async function parseBody(req){const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString("utf8");if(!raw)return {};try{return JSON.parse(raw);}catch{throw new Error("INVALID_JSON");}}
function sanitizeError(e){const msg=e.message||"Unknown error";return msg.replace(/[A-Z]:\\[^\s]+/g,"[path]").replace(/\/[^\s]*\/proofcase[^\s]*/g,"[path]");}
const server=http.createServer(async(req,res)=>{
res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");
if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
try{
if(req.method==="GET"&&req.url.startsWith("/api/config")){const cfg=basetenConfig();sendJson(res,200,{businessRequirement:BUSINESS_REQUIREMENT,model:cfg.model,hasKey:!!cfg.apiKey});return;}
if(req.method==="GET"&&req.url.startsWith("/api/recorded")){if(!fs.existsSync(RECORDED_PATH))return sendJson(res,404,{error:"No recorded response available"});const rec=JSON.parse(fs.readFileSync(RECORDED_PATH,"utf8"));sendJson(res,200,{recorded:rec.plan,_diag:rec._diag,label:"RECORDED META RESPONSE"});return;}
if(req.method==="POST"&&req.url.startsWith("/api/interpret")){
const body=await parseBody(req);
const businessRequirement=typeof body.businessRequirement==="string"?body.businessRequirement.trim():"";
if(!businessRequirement)return sendJson(res,400,{error:"businessRequirement required",code:"INVALID_REQUEST"});
if(businessRequirement.length>2000)return sendJson(res,400,{error:"businessRequirement too long",code:"INVALID_REQUEST"});
if(body.useRecorded===true){
if(!fs.existsSync(RECORDED_PATH))return sendJson(res,404,{error:"No recorded response",code:"NO_RECORDED"});
const rec=JSON.parse(fs.readFileSync(RECORDED_PATH,"utf8"));
const norm=normalizePlan(rec.plan);
try{validateTestPlan(norm);}catch(e){return sendJson(res,400,{error:sanitizeError(e),code:"INVALID_PLAN"});}
const v=validateTestPlan(norm);
if(!v.ok)return sendJson(res,200,{status:v.reason,message:v.message,plan:norm,approvalToken:approvalHash({businessRequirement,plan:norm}),modelLabel:"RECORDED META RESPONSE",modelId:rec._diag?.modelId||"recorded",live:false});
return sendJson(res,200,{status:"VALID",plan:norm,approvalToken:approvalHash({businessRequirement,plan:norm}),interpretedRule:norm.interpretedRule,modelLabel:"RECORDED META RESPONSE",modelId:rec._diag?.modelId||"recorded",live:false});
}
const rawPlan=await generateTestPlan({businessRequirement});
if(rawPlan.__modelError){return sendJson(res,200,{status:"MODEL_ERROR",message:rawPlan.message,_diag:rawPlan._diag||null,code:"MODEL_ERROR"});}
const normalized=normalizePlan(rawPlan);
let validation;try{validation=validateTestPlan(normalized);}catch(e){return sendJson(res,200,{status:"INVALID_PLAN",message:sanitizeError(e),plan:normalized,code:"INVALID_PLAN"});}
if(!validation.ok){if(validation.reason==="UNSUPPORTED_REQUIREMENT")return sendJson(res,200,{status:"UNSUPPORTED_REQUIREMENT",message:validation.message,plan:normalized,code:"UNSUPPORTED_REQUIREMENT"});return sendJson(res,200,{status:"INVALID_PLAN",message:validation.message,plan:normalized,code:validation.reason});}
const gate=checkSemanticEligibility({businessRequirement,interpretedRule:normalized.interpretedRule,plan:normalized});
if(!gate.eligible){
  return sendJson(res,200,{status:gate.status,message:gate.reason,plan:normalized,code:gate.status,missing:gate.missing,evidence:gate.evidence,unverified:true,requiresConfirmation:true,_diag:normalized._diag||null});
}
const approvalToken=approvalHash({businessRequirement,plan:normalized});
const modelId=normalized._diag?.modelId||basetenConfig().model;
return sendJson(res,200,{status:"VALID",plan:normalized,approvalToken,interpretedRule:normalized.interpretedRule,modelLabel:"LIVE META RESPONSE",modelId,live:true,_diag:normalized._diag||null,gate});
}
if(req.method==="POST"&&req.url.startsWith("/api/run")){
const body=await parseBody(req);
const{businessRequirement,plan,approvalToken}=body;
if(!businessRequirement||!plan||!approvalToken)return sendJson(res,400,{error:"businessRequirement, plan, approvalToken required",code:"INVALID_REQUEST"});
const normalized=normalizePlan(plan);
try{validateTestPlan(normalized);}catch(e){return sendJson(res,400,{error:sanitizeError(e),code:"INVALID_PLAN"});}
const v=validateTestPlan(normalized);
if(!v.ok)return sendJson(res,400,{error:v.message,code:v.reason});
const gateRun=checkSemanticEligibility({businessRequirement,interpretedRule:normalized.interpretedRule,plan:normalized});
if(!gateRun.eligible) return sendJson(res,400,{error:gateRun.reason,code:gateRun.status,missing:gateRun.missing,unverified:true});
if(!verifyApproval({businessRequirement,plan:normalized,approvalToken}))return sendJson(res,400,{error:"Approval token invalid or stale. Requirement or plan changed.",code:"APPROVAL_INVALID"});
const buggy=executePlan({plan:normalized,approved:true,variant:"buggy"});
const correct=executePlan({plan:normalized,approved:true,variant:"correct"});
const report={version:"1.0",businessRequirement,interpretedRule:normalized.interpretedRule,plan:normalized,approvalToken,modelLabel:body.modelLabel||"LIVE META RESPONSE",modelId:body.modelId||basetenConfig().model,executedAt:new Date().toISOString(),results:{buggy,correct}};
return sendJson(res,200,report);
}
if(req.method==="GET"){if(serveStatic(req,res))return;}
sendJson(res,404,{error:"Not found"});
}catch(e){if(e.message==="INVALID_JSON")return sendJson(res,400,{error:"Invalid JSON body",code:"INVALID_REQUEST"});sendJson(res,500,{error:sanitizeError(e)});}
});
const PORT=Number(process.env.PORT)||8080;
server.listen(PORT,()=>console.log(`Proofcase Sprint 2 UI running at http://localhost:${PORT}`));
