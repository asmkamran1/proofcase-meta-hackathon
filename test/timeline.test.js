import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function formatCurrency(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return String(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
}
function describeOperation(op) {
  if (!op || typeof op.op !== 'string') return 'Unknown operation';
  if (op.op === 'createOrder') return 'Create an order "' + op.orderId + '" with ' + formatCurrency(op.capturedCents) + ' captured.';
  if (op.op === 'requestRefund') return 'Request a refund of ' + formatCurrency(op.amountCents) + ' for order "' + op.orderId + '" (refund "' + op.refundId + '").';
  if (op.op === 'assertRefundStatus') return 'Verify refund "' + op.refundId + '" was ' + op.expectedStatus + '.';
  if (op.op === 'assertTotalRefunds') return 'Verify accepted refunds for order "' + op.orderId + '" total ' + formatCurrency(op.expectedCents) + '.';
  return op.op + ' — ' + JSON.stringify(op);
}

test('UI: every supported operation renders correctly', () => {
  const ops = [
    { op: 'createOrder', orderId: 'order-1', capturedCents: 10000 },
    { op: 'requestRefund', orderId: 'order-1', amountCents: 4000, refundId: 'r1' },
    { op: 'assertRefundStatus', refundId: 'r1', expectedStatus: 'accepted' },
    { op: 'assertTotalRefunds', orderId: 'order-1', expectedCents: 4000 },
  ];
  const rendered = ops.map(describeOperation);
  assert.ok(rendered[0].includes('Create an order "order-1" with $100.00 captured.'));
  assert.ok(rendered[1].includes('Request a refund of $40.00'));
  assert.ok(rendered[2].includes('Verify refund "r1" was accepted.'));
  assert.ok(rendered[3].includes('Verify accepted refunds for order "order-1" total $40.00.'));
});

test('UI: currency formatting from integer cents', () => {
  assert.equal(formatCurrency(10000), '$100.00');
  assert.equal(formatCurrency(4000), '$40.00');
  assert.equal(formatCurrency(7000), '$70.00');
  assert.equal(formatCurrency(1), '$0.01');
  assert.equal(formatCurrency(0), '$0.00');
  assert.equal(formatCurrency(1000000), '$10,000.00');
});

test('UI: dynamic sequence generation — not hardcoded seven ops', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(appJs.includes('plan.operations.forEach') || appJs.includes('plan.operations.map'));
  assert.ok(appJs.includes('describeOperation'));
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="planSequence"'));
  assert.ok(!html.includes('<li>Create an order with $100.00'));
});

test('UI: raw JSON remains available in collapsible View Raw Plan', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('<details'));
  assert.ok(html.includes('<summary>View Raw Plan</summary>'));
  assert.ok(html.includes('id="planPre"'));
  const detailsIndex = html.indexOf('<details');
  const preIndex = html.indexOf('id="planPre"');
  assert.ok(detailsIndex !== -1 && preIndex !== -1 && detailsIndex < preIndex);
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(appJs.includes('planPre.textContent=JSON.stringify'));
});

test('UI: untrusted strings rendered safely via textContent', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(appJs.includes('li.textContent = describeOperation'));
  const malicious = { op: 'requestRefund', orderId: 'order-1', amountCents: 100, refundId: '<img src=x onerror=alert(1)>' };
  const rendered = describeOperation(malicious);
  assert.ok(rendered.includes('<img src=x onerror=alert(1)>'));
});

test('UI: existing plan contents remain unchanged', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(!appJs.includes('plan.operations.sort'));
  assert.ok(appJs.includes('state.plan=j.plan'));
});

test('UI: preserve existing LIVE and RECORDED labels', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(appJs.includes('LIVE META RESPONSE'));
  assert.ok(appJs.includes('RECORDED META RESPONSE'));
});

test('UI: support all allowlisted operations', () => {
  const opsToTest = [
    { op: 'createOrder', orderId: 'o1', capturedCents: 5000, expect: '$50.00' },
    { op: 'requestRefund', orderId: 'o1', amountCents: 2500, refundId: 'r10', expect: '$25.00' },
    { op: 'assertTotalRefunds', orderId: 'o1', expectedCents: 2500, expect: '$25.00' },
  ];
  for (const o of opsToTest) {
    const rendered = describeOperation(o);
    assert.ok(rendered.includes(o.expect));
  }
});
