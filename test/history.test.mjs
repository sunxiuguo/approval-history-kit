import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SDK_VERSION,
  inspectApprovalHistory,
  compareApprovalState,
} from '../dist/index.js';

// All histories are original, synthetic, offline fixtures. No application traces,
// credentials, provider calls, or executable tools are used by this test suite.
const clone = value => structuredClone(value);
const assistant = (...content) => ({ role: 'assistant', content });
const tool = (...content) => ({ role: 'tool', content });
const call = (toolCallId = 'call-a', extra = {}) => ({
  type: 'tool-call', toolCallId, toolName: 'synthetic_lookup',
  input: { record: 'example-only' }, ...extra,
});
const request = (approvalId = 'approval-a', toolCallId = 'call-a', extra = {}) => ({
  type: 'tool-approval-request', approvalId, toolCallId, ...extra,
});
const response = (approved = false, approvalId = 'approval-a', extra = {}) => ({
  type: 'tool-approval-response', approvalId, approved, ...extra,
});
const result = (toolCallId = 'call-a', output = { type: 'execution-denied' }, extra = {}) => ({
  type: 'tool-result', toolCallId, toolName: 'synthetic_lookup', output, ...extra,
});
const pending = () => [assistant(call(), request())];
const ready = (approved = false) => [...pending(), tool(response(approved))];
const complete = (approved = false, output = { type: 'execution-denied' }) => [
  ...pending(), tool(response(approved), result('call-a', output)),
];
const envelope = messages => ({ format: 'approval-history-kit', version: 1, messages });
const lossless = { mode: 'lossless-persistence' };
const expected = (code, path, relatedPaths = [], severity = 'error') => ({ code, path, relatedPaths, severity });
const inconclusive = (code, path, relatedPaths = []) => expected(code, path, relatedPaths, 'inconclusive');
const summary = report => report.findings.map(({ code, path, relatedPaths, severity }) => ({ code, path, relatedPaths, severity }));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function assertReport(report, findings = []) {
  assert.equal(report.formatVersion, 1);
  assert.equal(report.sdkVersion, '7.0.127');
  assert.deepEqual(summary(report), findings);
  assert.equal(report.complete, !findings.some(f => f.severity === 'inconclusive'));
  assert.equal(report.status, findings.some(f => f.severity === 'error') ? 'issues'
    : findings.some(f => f.severity === 'inconclusive') ? 'inconclusive' : 'clean');
  for (const finding of report.findings) {
    assert.equal(typeof finding.message, 'string');
    assert.ok(finding.message.length > 0);
  }
}
function atPointer(input, pointer) {
  if (pointer === '') return input;
  assert.ok(pointer.startsWith('/'));
  return pointer.slice(1).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], input);
}

const parallelMixed = [
  assistant(call('call-a'), call('call-b'), { type: 'text', text: 'Two independent synthetic calls.' }),
  { role: 'user', content: 'An unrelated message separates the calls and requests.' },
  assistant(request('approval-b', 'call-b'), { type: 'reasoning', text: 'Synthetic reasoning.' }, request()),
  tool(response(false, 'approval-a')),
  assistant({ type: 'text', text: 'Results may be in another message.' }),
  tool(result('call-a'), response(true, 'approval-b')),
  tool(result('call-b', { type: 'json', value: { synthetic: true } })),
];

// Negative controls: valid supported snapshots must not become false positives.
const cleanFixtures = [
  ['pending request at awaiting-approval', pending(), 'awaiting-approval'],
  ['approval ready without a terminal result', ready(true), 'ready-to-resume'],
  ['denial ready without a terminal result', ready(false), 'ready-to-resume'],
  ['denial with execution-denied terminal', complete(), 'after-tools'],
  ['false decision with error-text is still one terminal result', complete(false, { type: 'error-text', value: 'Synthetic failure.' }), 'after-tools'],
  ['true decision with execution-denied is not inferred to be contradictory', complete(true), 'after-tools'],
  ['approved text result', complete(true, { type: 'text', value: 'Synthetic success.' }), 'after-tools'],
  ['approved JSON result', complete(true, { type: 'json', value: { items: [1, 2] } }), 'after-tools'],
  ['approved execution failure remains terminal', complete(true, { type: 'error-json', value: { code: 'synthetic' } }), 'after-tools'],
  ['assistant-role terminal result is supported', [...ready(), assistant(result())], 'after-tools'],
  ['terminal precedes response within the same message', [...pending(), tool(result(), response())], 'after-tools'],
  ['terminal can precede a later response message', [...pending(), tool(result()), tool(response())], 'after-tools'],
  ['parallel approve-deny with repeated names, unique IDs, and no adjacency', parallelMixed, 'after-tools'],
  ['empty history', [], 'after-tools'],
  ['ordinary conversation with no approvals', [
    { role: 'system', content: 'Synthetic system context.' },
    { role: 'user', content: 'Synthetic user input.' },
    assistant({ type: 'text', text: 'Synthetic reply.' }),
  ], 'after-tools'],
  ['unapproved ordinary tool call is outside approval completion checks', [assistant(call())], 'after-tools'],
  ['supported request metadata is preserved in a valid history', [
    assistant(call(), request('approval-a', 'call-a', {
      reason: 'Synthetic reason.', isAutomatic: false,
      signature: 'synthetic-signature-not-a-secret', inputSchemaInput: { raw: '42' },
    })),
    tool(response(false, 'approval-a', { reason: 'Synthetic denial.', providerExecuted: false }), result()),
  ], 'after-tools'],
  ['explicit client execution flag', [
    assistant(call('call-a', { providerExecuted: false }), request()),
    tool(response(false, 'approval-a', { providerExecuted: false }), result('call-a', { type: 'execution-denied' }, { providerExecuted: false })),
  ], 'after-tools'],
  ['version-1 envelope', envelope(complete()), 'after-tools'],
  ['an already-completed snapshot at ready-to-resume', complete(), 'ready-to-resume'],
  ['an already-completed snapshot at awaiting-approval', complete(), 'awaiting-approval'],
  ['opaque content result does not require interpreting the payload', complete(true, { type: 'content', value: [{ type: 'text', text: 'Synthetic content.' }] }), 'after-tools'],
];

for (const [name, history, checkpoint] of cleanFixtures) {
  test(`negative control: ${name}`, () => {
    const input = freeze(clone(history));
    const before = JSON.stringify(input);
    assertReport(inspectApprovalHistory(input, { checkpoint }));
    assert.equal(JSON.stringify(input), before, 'inspection must not mutate input');
  });
}

test('fixture minimum and explicit checkpoint coverage', () => {
  assert.ok(cleanFixtures.length >= 12);
  assert.deepEqual([...new Set(cleanFixtures.map(f => f[2]))].sort(), ['after-tools', 'awaiting-approval', 'ready-to-resume']);
  assert.equal(SDK_VERSION, '7.0.127');
});

// Positive controls: the fixture names describe the finding, not a conjectured
// provider runtime failure. Checkpoint obligations are always explicit.
const findingFixtures = [
  ['duplicate denial terminal', [
    ...pending(), tool(response(), result(), result()),
  ], 'after-tools', [expected('DUPLICATE_TERMINAL_RESULT', '/1/content/2', ['/1/content/1', '/0/content/1'])]],
  ['duplicate approval terminal', [
    ...pending(), tool(response(true), result('call-a', { type: 'text', value: 'One.' }), result('call-a', { type: 'text', value: 'Two.' })),
  ], 'after-tools', [expected('DUPLICATE_TERMINAL_RESULT', '/1/content/2', ['/1/content/1', '/0/content/1'])]],
  ['every extra terminal gets its own pointer', [
    ...pending(), tool(response(), result(), result(), result()),
  ], 'after-tools', [
    expected('DUPLICATE_TERMINAL_RESULT', '/1/content/2', ['/1/content/1', '/0/content/1']),
    expected('DUPLICATE_TERMINAL_RESULT', '/1/content/3', ['/1/content/1', '/0/content/1']),
  ]],
  ['duplicate terminal in envelope', envelope([
    ...pending(), tool(response(), result(), result()),
  ]), 'after-tools', [expected('DUPLICATE_TERMINAL_RESULT', '/messages/1/content/2', ['/messages/1/content/1', '/messages/0/content/1'])]],
  ['orphan request', [assistant(request())], 'awaiting-approval', [expected('ORPHAN_APPROVAL_REQUEST', '/0/content/0')]],
  ['orphan response', [tool(response())], 'ready-to-resume', [expected('ORPHAN_APPROVAL_RESPONSE', '/0/content/0')]],
  ['orphan request uses envelope prefix', envelope([assistant(request())]), 'awaiting-approval', [expected('ORPHAN_APPROVAL_REQUEST', '/messages/0/content/0')]],
  ['conflicting approve then deny', [...pending(), tool(response(true), response(false), result())], 'after-tools', [expected('CONFLICTING_APPROVAL_DECISION', '/1/content/1', ['/1/content/0'])]],
  ['conflicting deny then approve', [...pending(), tool(response(false), response(true), result())], 'after-tools', [expected('CONFLICTING_APPROVAL_DECISION', '/1/content/1', ['/1/content/0'])]],
  ['approval ID reused for distinct calls', [assistant(call(), call('call-b'), request(), request('approval-a', 'call-b'))], 'awaiting-approval', [expected('REUSED_APPROVAL_ID', '/0/content/3', ['/0/content/2'])]],
  ['ready-to-resume requires a decision', pending(), 'ready-to-resume', [expected('APPROVAL_DECISION_MISSING', '/0/content/1')]],
  ['after-tools requires a decision', pending(), 'after-tools', [expected('APPROVAL_DECISION_MISSING', '/0/content/1')]],
  ['approval after-tools requires a terminal', ready(true), 'after-tools', [expected('TERMINAL_RESULT_MISSING', '/1/content/0', ['/0/content/1'])]],
  ['denial after-tools requires a terminal', ready(false), 'after-tools', [expected('TERMINAL_RESULT_MISSING', '/1/content/0', ['/0/content/1'])]],
  ['unknown content part is inconclusive', [assistant({ type: 'synthetic-future-part', data: 'opaque' })], 'awaiting-approval', [inconclusive('UNSUPPORTED_PART', '/0/content/0')]],
  ['UIMessage is not silently accepted', [{ role: 'assistant', parts: [{ type: 'text', text: 'UI only.' }] }], 'awaiting-approval', [
    inconclusive('UNSUPPORTED_MESSAGE', '/0'), inconclusive('UNSUPPORTED_CONTENT', '/0/content'),
  ]],
  ['provider-executed call is inconclusive', [assistant(call('call-a', { providerExecuted: true }), request())], 'after-tools', [inconclusive('UNSUPPORTED_EXECUTION', '/0/content/0')]],
  ['provider-executed response is inconclusive', [...pending(), tool(response(false, 'approval-a', { providerExecuted: true }))], 'after-tools', [inconclusive('UNSUPPORTED_EXECUTION', '/1/content/0')]],
  ['provider-executed terminal is inconclusive', [...ready(), tool(result('call-a', { type: 'execution-denied' }, { providerExecuted: true }))], 'after-tools', [inconclusive('UNSUPPORTED_EXECUTION', '/2/content/0')]],
  ['repeated tool-call IDs are inconclusive', [assistant(call(), call(), request())], 'after-tools', [inconclusive('AMBIGUOUS_TOOL_CALL_ID', '/0/content/1', ['/0/content/0'])]],
  ['same approval request repeated is inconclusive', [assistant(call(), request(), request())], 'awaiting-approval', [inconclusive('AMBIGUOUS_APPROVAL_REQUEST', '/0/content/2', ['/0/content/1'])]],
  ['approval response cannot appear in assistant role', [assistant(response())], 'awaiting-approval', [inconclusive('UNSUPPORTED_PART_ROLE', '/0/content/0')]],
  ['approval request cannot appear in tool role', [tool(request())], 'awaiting-approval', [inconclusive('UNSUPPORTED_PART_ROLE', '/0/content/0')]],
  ['malformed approval decision is inconclusive', [tool({ ...response(), approved: 'false' })], 'awaiting-approval', [inconclusive('UNSUPPORTED_APPROVAL_PART', '/0/content/0')]],
  ['unknown terminal variant is inconclusive', [tool(result('call-a', { type: 'synthetic-future-output' }))], 'awaiting-approval', [inconclusive('UNSUPPORTED_RESULT', '/0/content/0')]],
  ['unknown envelope version is inconclusive', { format: 'approval-history-kit', version: 2, messages: [] }, 'awaiting-approval', [inconclusive('UNSUPPORTED_INPUT', '')]],
];

for (const [name, history, checkpoint, findings] of findingFixtures) {
  test(`positive finding: ${name}`, () => {
    const input = freeze(clone(history));
    const before = JSON.stringify(input);
    const report = inspectApprovalHistory(input, { checkpoint });
    assertReport(report, findings);
    assert.equal(JSON.stringify(input), before);
    for (const finding of report.findings) {
      for (const path of [finding.path, ...finding.relatedPaths]) {
        // A missing-content diagnostic intentionally points at the missing field.
        if (finding.code === 'UNSUPPORTED_CONTENT') continue;
        assert.notEqual(atPointer(input, path), undefined, `pointer should address the original input: ${path}`);
      }
    }
  });
}

test('at least 12 distinct positive error fixtures, apart from unsupported shapes', () => {
  assert.ok(findingFixtures.filter(f => f[3].some(issue => issue.severity === 'error')).length >= 12);
});

test('mixed supported error and unknown part reports issues with complete=false', () => {
  assertReport(inspectApprovalHistory([assistant(call(), request(), { type: 'synthetic-unknown' }), tool(response(true), response(false))], { checkpoint: 'ready-to-resume' }), [
    inconclusive('UNSUPPORTED_PART', '/0/content/2'), expected('CONFLICTING_APPROVAL_DECISION', '/1/content/1', ['/1/content/0']),
  ]);
});

test('a checkpoint is mandatory and never inferred from the snapshot', () => {
  for (const options of [undefined, {}, { checkpoint: 'done' }]) {
    assertReport(inspectApprovalHistory(complete(), options), [inconclusive('UNSUPPORTED_CHECKPOINT', '')]);
  }
});

const metadataHistory = () => [
  assistant(call(), request('approval-a', 'call-a', {
    reason: 'Synthetic approval justification.', isAutomatic: false,
    signature: 'synthetic-signature-A', inputSchemaInput: { count: '2', nested: { a: 1, b: 2 } },
  })),
  tool(response(false, 'approval-a', { reason: 'Synthetic decision reason.', providerExecuted: false }), result()),
];

for (const [name, makeAfter, findings] of [
  ['JSON round trip preserves all metadata', before => JSON.parse(JSON.stringify(before)), []],
  ['removed request', before => { before[0].content.splice(1, 1); return before; }, [expected('APPROVAL_STATE_REMOVED', '/before/0/content/1')]],
  ['removed decision', before => { before[1].content.splice(0, 1); return before; }, [expected('APPROVAL_STATE_REMOVED', '/before/1/content/0')]],
  ['changed approved boolean', before => { before[1].content[0].approved = true; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/1/content/0', ['/before/1/content/0'])]],
  ['lost decision reason', before => { delete before[1].content[0].reason; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/1/content/0', ['/before/1/content/0'])]],
  ['changed decision reason', before => { before[1].content[0].reason = 'Another synthetic reason.'; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/1/content/0', ['/before/1/content/0'])]],
  ['lost explicit providerExecuted=false', before => { delete before[1].content[0].providerExecuted; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/1/content/0', ['/before/1/content/0'])]],
  ['changed request reason', before => { before[0].content[1].reason = 'Another synthetic justification.'; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['lost request reason', before => { delete before[0].content[1].reason; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['changed isAutomatic', before => { before[0].content[1].isAutomatic = true; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['changed signature', before => { before[0].content[1].signature = 'synthetic-signature-B'; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['lost signature', before => { delete before[0].content[1].signature; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['changed inputSchemaInput', before => { before[0].content[1].inputSchemaInput.count = '3'; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['lost inputSchemaInput', before => { delete before[0].content[1].inputSchemaInput; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['changed request tool-call link', before => { before[0].content[1].toolCallId = 'call-b'; return before; }, [expected('APPROVAL_STATE_CHANGED', '/after/0/content/1', ['/before/0/content/1'])]],
  ['added response record', before => { before[1].content.push(response(true, 'approval-added')); return before; }, [expected('APPROVAL_STATE_ADDED', '/after/1/content/2')]],
  ['added request record', before => { before[0].content.push(request('approval-added', 'call-b')); return before; }, [expected('APPROVAL_STATE_ADDED', '/after/0/content/2')]],
]) {
  test(`lossless persistence: ${name}`, () => {
    const before = freeze(metadataHistory());
    const after = freeze(makeAfter(clone(before)));
    const beforeJSON = JSON.stringify(before);
    const afterJSON = JSON.stringify(after);
    const report = compareApprovalState(before, after, lossless);
    assertReport(report, findings);
    assert.equal(JSON.stringify(before), beforeJSON);
    assert.equal(JSON.stringify(after), afterJSON);
    for (const finding of report.findings) {
      for (const path of [finding.path, ...finding.relatedPaths]) {
        assert.notEqual(atPointer({ before, after }, path), undefined);
      }
    }
  });
}

test('lossless persistence ignores JSON object key order and unrelated message placement', () => {
  const before = metadataHistory();
  const original = before[0].content[1];
  const reorderedRequest = {
    inputSchemaInput: { nested: { b: 2, a: 1 }, count: '2' },
    signature: original.signature, isAutomatic: original.isAutomatic,
    reason: original.reason, toolCallId: original.toolCallId,
    approvalId: original.approvalId, type: original.type,
  };
  const after = [
    { role: 'user', content: 'Synthetic placement change.' },
    assistant(call()), assistant(reorderedRequest),
    tool(clone(before[1].content[0])), assistant(result()),
  ];
  assertReport(compareApprovalState(before, after, lossless));
});

test('lossless persistence compares approval records rather than tool payloads', () => {
  const before = metadataHistory();
  const after = clone(before);
  after[0].content[0].input = { unrelated: 'Different synthetic payload.' };
  after[1].content[1].output = { type: 'text', value: 'Different synthetic output.' };
  assertReport(compareApprovalState(before, after, lossless));
});

test('lossless persistence prefixes both envelope pointers exactly', () => {
  const before = envelope(metadataHistory());
  const after = clone(before);
  after.messages[0].content[1].signature = 'synthetic-signature-B';
  assertReport(compareApprovalState(before, after, lossless), [
    expected('APPROVAL_STATE_CHANGED', '/after/messages/0/content/1', ['/before/messages/0/content/1']),
  ]);
});

test('lossless persistence identifies ID changes as removal and addition', () => {
  const before = metadataHistory();
  const after = clone(before);
  after[1].content[0].approvalId = 'approval-new';
  assertReport(compareApprovalState(before, after, lossless), [
    expected('APPROVAL_STATE_REMOVED', '/before/1/content/0'),
    expected('APPROVAL_STATE_ADDED', '/after/1/content/0'),
  ]);
});

test('lossless persistence preserves repeated records instead of collapsing by ID', () => {
  const before = metadataHistory();
  before[1].content.push(clone(before[1].content[0]));
  assertReport(compareApprovalState(before, clone(before), lossless));
  const after = clone(before);
  after[1].content.pop();
  assertReport(compareApprovalState(before, after, lossless), [expected('APPROVAL_STATE_REMOVED', '/before/1/content/2')]);
});

test('lossless persistence detects changes to a second response occurrence', () => {
  const before = metadataHistory();
  before[1].content.push(clone(before[1].content[0]));
  const after = clone(before);
  after[1].content[2].reason = 'Changed second synthetic decision.';
  assertReport(compareApprovalState(before, after, lossless), [expected('APPROVAL_STATE_CHANGED', '/after/1/content/2', ['/before/1/content/2'])]);
});

test('comparison does not claim lossless success for unsupported parts', () => {
  const before = [assistant({ type: 'synthetic-future-part' })];
  assertReport(compareApprovalState(before, clone(before), lossless), [
    inconclusive('UNSUPPORTED_PART', '/before/0/content/0'),
    inconclusive('UNSUPPORTED_PART', '/after/0/content/0'),
  ]);
});

test('lossless mode is mandatory; pruning and transitions are not inferred', () => {
  for (const options of [undefined, {}, { mode: 'transition' }]) {
    assertReport(compareApprovalState([], [], options), [inconclusive('UNSUPPORTED_COMPARISON_MODE', '')]);
  }
});

test('reports omit tool inputs, outputs, IDs, reasons, signatures, and metadata', () => {
  const secret = 'SYNTHETIC_PRIVATE_MARKER_7gT';
  const before = [
    assistant(call(`${secret}-call`, { toolName: `${secret}-tool`, input: { value: `${secret}-input` } }), request(`${secret}-approval`, `${secret}-call`, {
      reason: `${secret}-request-reason`, signature: `${secret}-signature`, inputSchemaInput: { value: `${secret}-raw` },
    })),
    tool(response(false, `${secret}-approval`, { reason: `${secret}-denial` }), result(`${secret}-call`, { type: 'error-text', value: `${secret}-output` }, { toolName: `${secret}-tool` })),
  ];
  const after = clone(before);
  after[0].content[1].signature += '-changed';
  after[1].content.push(clone(after[1].content[1]));
  const reports = [
    inspectApprovalHistory(after, { checkpoint: 'after-tools' }),
    compareApprovalState(before, after, lossless),
  ];
  assert.ok(reports.every(report => report.findings.length > 0));
  assert.equal(JSON.stringify(reports).includes(secret), false);
});

test('plain JSON is required: getters are never evaluated', () => {
  let evaluations = 0;
  const input = [];
  Object.defineProperty(input, '0', { enumerable: true, get() { evaluations++; throw new Error('Must not execute.'); } });
  assertReport(inspectApprovalHistory(input, { checkpoint: 'awaiting-approval' }), [inconclusive('UNSUPPORTED_INPUT', '')]);
  assert.equal(evaluations, 0);
});

test('unsupported non-JSON values return inconclusive without throwing', () => {
  const cycle = []; cycle.push(cycle);
  const sparse = Array(1);
  for (const input of [undefined, NaN, Infinity, 1n, () => {}, new Date(0), cycle, sparse, [undefined]]) {
    assertReport(inspectApprovalHistory(input, { checkpoint: 'awaiting-approval' }), [inconclusive('UNSUPPORTED_INPUT', '')]);
  }
});

test('example good-denial.json is a clean after-tools envelope', () => {
  const input = JSON.parse(readFileSync(new URL('../examples/good-denial.json', import.meta.url), 'utf8'));
  assertReport(inspectApprovalHistory(input, { checkpoint: 'after-tools' }));
});

test('example duplicate-denial.json reports exact public example pointers', () => {
  const input = JSON.parse(readFileSync(new URL('../examples/duplicate-denial.json', import.meta.url), 'utf8'));
  assertReport(inspectApprovalHistory(input, { checkpoint: 'after-tools' }), [
    expected('DUPLICATE_TERMINAL_RESULT', '/messages/1/content/2', ['/messages/1/content/1', '/messages/0/content/1']),
  ]);
});
