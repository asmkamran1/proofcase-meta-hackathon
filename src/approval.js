import { createHash } from "node:crypto";

export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

export function approvalHash({ businessRequirement, plan }) {
  const payload = canonicalJson({ businessRequirement: String(businessRequirement ?? ""), plan });
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyApproval({ businessRequirement, plan, approvalToken }) {
  if (typeof approvalToken !== "string" || !approvalToken) return false;
  const expected = approvalHash({ businessRequirement, plan });
  return expected === approvalToken;
}
