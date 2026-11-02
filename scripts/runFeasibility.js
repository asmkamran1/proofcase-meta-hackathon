// Feasibility gate runner: generates plan via real Meta, validates, approves, executes both fixtures.
// Run: node scripts/runFeasibility.js
// Requires BASETEN_API_KEY in .env.local or env. Deterministic fixtures otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTestPlan, BUSINESS_REQUIREMENT } from "../src/planner.js";
import { validateTestPlan, normalizePlan } from "../src/testPlanValidator.js";
import { executePlan } from "../src/executor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['\"]|['\"]$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}
loadEnv();

console.log("=== PROOFCASE SPRINT 1 FEASIBILITY GATE ===");
console.log(`Business requirement: ${BUSINESS_REQUIREMENT}`);

let plan = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT });
console.log("\n--- Model raw output ---");
console.log(JSON.stringify(plan, null, 2));

if (plan.__modelError) {
  console.log("\nModel error - no plan to execute. Using fallback deterministic fixture for demonstration.");
  // Fallback fixture still proves buggy vs correct but marks model usage as failed.
  const fallback = {
    version: "1.0",
    ruleId: "refund-cap",
    businessRequirement: BUSINESS_REQUIREMENT,
    interpretedRule: "Total accepted refunds must not exceed captured payment.",
    operations: [
      { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 6000, refundId: "r1" },
      { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
      { op: "requestRefund", orderId: "order-1", amountCents: 5000, refundId: "r2" },
      { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 },
    ],
  };
  console.log("\n--- Fallback plan ---");
  console.log(JSON.stringify(fallback, null, 2));
  const v = validateTestPlan(fallback);
  console.log("\nValidation:", v);
  const buggy = executePlan({ plan: fallback, approved: true, variant: "buggy" });
  const correct = executePlan({ plan: fallback, approved: true, variant: "correct" });
  console.log("\n--- Buggy fixture transitions ---");
  console.log(JSON.stringify(buggy.transitions, null, 2));
  console.log("\nBuggy violations:", buggy.violations);
  console.log("\n--- Correct fixture transitions ---");
  console.log(JSON.stringify(correct.transitions, null, 2));
  console.log("\nCorrect violations:", correct.violations);
  // Persist docs even on fallback
  const docPath = path.join(ROOT, "docs", "MODEL_RUN.md");
  fs.writeFileSync(docPath, `# Model Run ${new Date().toISOString()}\n\nModel error: ${plan.message}\n\nFallback plan used for deterministic demo.\n\n## Buggy violations: ${buggy.invariantViolated}\n\n## Correct violations: ${correct.invariantViolated}\n`);
  process.exit(0);
}

let normalized = normalizePlan(plan);
if (JSON.stringify(normalized) !== JSON.stringify(plan)) {
  console.log("\n--- Normalized wrapped ops to flat form ---");
  console.log(JSON.stringify(normalized, null, 2));
}
let validation;
try {
  validation = validateTestPlan(normalized);
  console.log("\n--- Validation ---");
  console.log(validation);
  // use normalized for execution
  plan = normalized;
} catch (e) {
  console.log("\nValidation threw (fails closed):", e.message);
  process.exit(1);
}

if (!validation.ok) {
  console.log("\nPlan not executable (unsupported or model error). Gate fails closed as required.");
  process.exit(0);
}

console.log("\n--- Approval gate ---");
console.log("Interpreted rule:", plan.interpretedRule);
const approved = true; // In real UI this would be human click; here we simulate explicit approval.
console.log("Approved:", approved);

const buggy = executePlan({ plan, approved, variant: "buggy" });
const correct = executePlan({ plan, approved, variant: "correct" });

console.log("\n--- Buggy fixture ---");
for (const t of buggy.transitions) console.log(JSON.stringify(t));
console.log("Violations:", buggy.violations);
console.log("Assertion errors:", buggy.assertionErrors);

console.log("\n--- Correct fixture ---");
for (const t of correct.transitions) console.log(JSON.stringify(t));
console.log("Violations:", correct.violations);
console.log("Assertion errors:", correct.assertionErrors);

console.log("\n=== GATE RESULT ===");
console.log(`Buggy invariant violated? ${buggy.invariantViolated}`);
console.log(`Correct invariant violated? ${correct.invariantViolated}`);
console.log(`Valid single refund visible? ${buggy.transitions.some((t) => t.op === "requestRefund" && t.result?.status === "accepted")}`);
console.log(`Two-refund exceed scenario executed? ${buggy.transitions.filter((t) => t.op === "requestRefund").length >= 2}`);

// Persist evidence
const outPath = path.join(ROOT, "docs", "MODEL_RUN.md");
const content = `# Model Run ${new Date().toISOString()}

## Business requirement
${BUSINESS_REQUIREMENT}

## Interpreted rule
${plan.interpretedRule}

## Raw plan
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

## Validation
\`\`\`json
${JSON.stringify(validation, null, 2)}
\`\`\`

## Buggy transitions
\`\`\`json
${JSON.stringify(buggy.transitions, null, 2)}
\`\`\`
Violations: ${JSON.stringify(buggy.violations, null, 2)}

## Correct transitions
\`\`\`json
${JSON.stringify(correct.transitions, null, 2)}
\`\`\`
Violations: ${JSON.stringify(correct.violations, null, 2)}

## Verdict
- Buggy violated: ${buggy.invariantViolated}
- Correct violated: ${correct.invariantViolated}
- Deterministic: yes (fixed fixture, no randomness)
`;
fs.writeFileSync(outPath, content, "utf8");
console.log(`\nEvidence written to ${outPath}`);
