import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectApprovalHistory, compareApprovalState } from '../dist/index.js';
const call = { type:'tool-call',toolCallId:'c',toolName:'demo',input:{} };
const request = { type:'tool-approval-request',approvalId:'a',toolCallId:'c' };
const response = { type:'tool-approval-response',approvalId:'a',approved:false };
const result = { type:'tool-result',toolCallId:'c',toolName:'demo',output:{type:'execution-denied'} };
const history = () => [{role:'assistant',content:[structuredClone(call),structuredClone(request)]},{role:'tool',content:[structuredClone(response),structuredClone(result)]}];
const check = h => inspectApprovalHistory(h,{checkpoint:'after-tools'});
for (const role of [['assistant'], {toString:null}, {valueOf:'assistant'}, 1, null]) {
  test(`malformed role remains inconclusive: ${JSON.stringify(role)}`, () => {
    const r = check([{role,content:'x'}]);
    assert.equal(r.status,'inconclusive');
    assert.equal(r.findings[0].code,'UNSUPPORTED_MESSAGE');
  });
}
for (const type of [['text'], {toString:null}, {}, 1, null]) {
  test(`malformed output discriminant remains inconclusive: ${JSON.stringify(type)}`, () => {
    const h = history();h[1].content[1].output={type};
    const r = check(h);
    assert.equal(r.status,'inconclusive');
    assert.deepEqual(r.findings.map(f=>f.code),['UNSUPPORTED_RESULT']);
  });
}
test('malformed known response is not asserted missing or removed', () => {
  const before=history(), after=history();after[1].content[0].approved='false';
  assert.deepEqual(check(after).findings.map(f=>f.code),['UNSUPPORTED_APPROVAL_PART']);
  assert.deepEqual(compareApprovalState(before,after,{mode:'lossless-persistence'}).findings.map(f=>f.code),['UNSUPPORTED_APPROVAL_PART']);
});
test('deferred call does not assert missing approval', () => {
  const r=check([{role:'assistant',content:[{...call,deferred:true},request]}]);
  assert.deepEqual(r.findings.map(f=>f.code),['UNSUPPORTED_EXECUTION']);
});
test('provider-executed duplicate results stay inconclusive', () => {
  const h=history();h[1].content.push({...result,providerExecuted:true});
  assert.deepEqual(check(h).findings.map(f=>f.code),['UNSUPPORTED_EXECUTION']);
});
test('multiple approval identities on one call stay inconclusive', () => {
  const h=history();h[0].content.push({...request,approvalId:'b'});
  assert.deepEqual(check(h).findings.map(f=>f.code),['AMBIGUOUS_CALL_APPROVAL']);
});
test('malformed same-ID second call quarantines duplicate attribution', () => {
  const h=history();
  h.push({role:'assistant',content:[{type:'tool-call',toolCallId:'c',toolName:'demo'}]});
  h.push({role:'tool',content:[structuredClone(result)]});
  const r=check(h);
  assert.equal(r.status,'inconclusive');
  assert.deepEqual(r.findings.map(f=>f.code),['UNSUPPORTED_APPROVAL_PART']);
});
test('ordinary duplicate still reports the known error', () => {
  const h=history();h[1].content.push(structuredClone(result));
  assert.deepEqual(check(h).findings.map(f=>f.code),['DUPLICATE_TERMINAL_RESULT']);
});
