/** Read-only diagnostics for the JSON approval projection of AI SDK 7 ModelMessage. */
export const SDK_VERSION = '7.0.127' as const;
export type Checkpoint = 'awaiting-approval' | 'ready-to-resume' | 'after-tools';
export type Finding = {
  code: string;
  severity: 'error' | 'inconclusive';
  path: string;
  relatedPaths: string[];
  message: string;
};
export type Report = {
  formatVersion: 1;
  sdkVersion: typeof SDK_VERSION;
  status: 'clean' | 'issues' | 'inconclusive';
  complete: boolean;
  findings: Finding[];
};
export type InspectOptions = { checkpoint: Checkpoint };
export type CompareOptions = { mode: 'lossless-persistence' };

type Obj = Record<string, unknown>;
type Event = { value: Obj; path: string; index: number };
type Scan = { findings: Finding[]; calls: Event[]; requests: Event[]; responses: Event[]; results: Event[] };
const own = (x: Obj, key: string): boolean => Object.hasOwn(x, key);
const object = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const checkpoints: readonly string[] = ['awaiting-approval', 'ready-to-resume', 'after-tools'];

function finding(scan: Scan, code: string, path: string, message: string, severity: Finding['severity'] = 'error', relatedPaths: string[] = []): void {
  scan.findings.push({ code, severity, path, relatedPaths, message });
}
function report(findings: Finding[]): Report {
  const complete = !findings.some(f => f.severity === 'inconclusive');
  return { formatVersion: 1, sdkVersion: SDK_VERSION, status: findings.some(f => f.severity === 'error') ? 'issues' : complete ? 'clean' : 'inconclusive', complete, findings };
}
function group(events: Event[], key: string): Map<string, Event[]> {
  const map = new Map<string, Event[]>();
  for (const e of events) {
    const id = e.value[key] as string;
    const existing = map.get(id);
    if (existing) existing.push(e); else map.set(id, [e]);
  }
  return map;
}

// Reject non-JSON values and getters before touching fields. This is not a sandbox for hostile Proxies.
function isJSON(input: unknown): boolean {
  const seen = new Set<object>();
  let count = 0;
  function visit(value: unknown, depth: number): boolean {
    if (++count > 100_000 || depth > 64) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(k => typeof k !== 'string')) return false;
    if (Array.isArray(value) && (Object.keys(descriptors).length !== value.length + 1 || Object.keys(descriptors).some(k => k !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= value.length)))) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!own(descriptor as unknown as Obj, 'value') || !descriptor.enumerable || !visit(descriptor.value, depth + 1)) return false;
    }
    seen.delete(value);
    return true;
  }
  return visit(input, 0);
}

/** JSON data only. Opaque tool payloads are deliberately not schema-validated. */
function scan(input: unknown): Scan {
  const s: Scan = { findings: [], calls: [], requests: [], responses: [], results: [] };
  if (!isJSON(input)) {
    finding(s, 'UNSUPPORTED_INPUT', '', 'Expected plain JSON data within the documented size/depth limits.', 'inconclusive');
    return s;
  }
  let messages: unknown = input;
  let prefix = '';
  if (object(input)) {
    if (input.format !== 'approval-history-kit' || input.version !== 1 || !Array.isArray(input.messages) || Object.keys(input).some(k => !['format', 'version', 'messages'].includes(k))) {
      finding(s, 'UNSUPPORTED_INPUT', '', 'Expected a ModelMessage array or the documented version-1 envelope.', 'inconclusive');
      return s;
    }
    messages = input.messages;
    prefix = '/messages';
  }
  if (!Array.isArray(messages)) {
    finding(s, 'UNSUPPORTED_INPUT', '', 'Expected a ModelMessage array or the documented version-1 envelope.', 'inconclusive');
    return s;
  }
  let index = 0;
  for (let mi = 0; mi < messages.length; mi++) {
    const m: unknown = messages[mi];
    const mp = `${prefix}/${mi}`;
    if (!object(m) || typeof m.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(m.role)) {
      finding(s, 'UNSUPPORTED_MESSAGE', mp, 'The message role or shape is unsupported.', 'inconclusive'); continue;
    }
    if (own(m, 'parts')) finding(s, 'UNSUPPORTED_MESSAGE', mp, 'UIMessage parts are unsupported; supply ModelMessage content.', 'inconclusive');
    if (typeof m.content === 'string' && m.role !== 'tool') continue;
    if (!Array.isArray(m.content)) {
      finding(s, 'UNSUPPORTED_CONTENT', `${mp}/content`, 'Expected supported message content.', 'inconclusive'); continue;
    }
    for (let pi = 0; pi < m.content.length; pi++) {
      const p: unknown = m.content[pi];
      const path = `${mp}/content/${pi}`;
      index++;
      if (!object(p) || typeof p.type !== 'string') {
        finding(s, 'UNSUPPORTED_PART', path, 'The content part shape is unsupported.', 'inconclusive'); continue;
      }
      const event = { value: p, path, index };
      const type = p.type;
      const roleOK = (type === 'tool-call' || type === 'tool-approval-request') ? m.role === 'assistant'
        : type === 'tool-approval-response' ? m.role === 'tool'
        : type === 'tool-result' ? m.role === 'tool' || m.role === 'assistant' : true;
      if (!roleOK) {
        finding(s, 'UNSUPPORTED_PART_ROLE', path, 'This approval/tool part is not supported in this message role.', 'inconclusive'); continue;
      }
      if (type === 'tool-call' || type === 'tool-result' || type === 'tool-approval-request' || type === 'tool-approval-response') {
        const idKey = type.startsWith('tool-approval-') ? 'approvalId' : 'toolCallId';
        let valid = str(p[idKey]);
        if (type === 'tool-call' || type === 'tool-result') valid &&= str(p.toolName);
        if (type === 'tool-call') valid &&= own(p, 'input');
        if (type === 'tool-approval-request') valid &&= str(p.toolCallId) && (!own(p, 'reason') || typeof p.reason === 'string') && (!own(p, 'isAutomatic') || typeof p.isAutomatic === 'boolean') && (!own(p, 'signature') || typeof p.signature === 'string');
        if (type === 'tool-approval-response') valid &&= typeof p.approved === 'boolean' && (!own(p, 'reason') || typeof p.reason === 'string');
        if (own(p, 'providerExecuted')) valid &&= typeof p.providerExecuted === 'boolean';
        if (!valid) {
          finding(s, 'UNSUPPORTED_APPROVAL_PART', path, 'A required approval/tool field is missing or malformed.', 'inconclusive'); continue;
        }
        if (p.providerExecuted === true || own(p, 'deferred')) {
          finding(s, 'UNSUPPORTED_EXECUTION', path, 'Provider-executed or deferred tool semantics are outside this adapter.', 'inconclusive');
        }
        if (type === 'tool-result') {
          if (!object(p.output) || typeof p.output.type !== 'string' || !['text', 'json', 'error-text', 'error-json', 'execution-denied', 'content'].includes(p.output.type)) {
            finding(s, 'UNSUPPORTED_RESULT', path, 'The tool output variant is unsupported.', 'inconclusive'); continue;
          }
          const output = p.output;
          const outputOK = (output.type === 'text' || output.type === 'error-text') ? typeof output.value === 'string'
            : (output.type === 'json' || output.type === 'error-json') ? own(output, 'value')
            : output.type === 'content' ? Array.isArray(output.value)
            : !own(output, 'reason') || typeof output.reason === 'string';
          if (!outputOK) {
            finding(s, 'UNSUPPORTED_RESULT', path, 'The tool output variant is malformed.', 'inconclusive'); continue;
          }
          s.results.push(event);
        } else if (type === 'tool-call') s.calls.push(event);
        else if (type === 'tool-approval-request') s.requests.push(event);
        else s.responses.push(event);
      } else if ((type === 'text' && ['user', 'assistant'].includes(m.role)) || (type === 'reasoning' && m.role === 'assistant')) {
        if (typeof p.text !== 'string') finding(s, 'UNSUPPORTED_PART', path, 'Expected textual content.', 'inconclusive');
      } else if ((type === 'file' && ['user', 'assistant'].includes(m.role)) || (type === 'image' && m.role === 'user')) {
        // Binary/URL media validity is outside the approval projection.
      } else {
        finding(s, 'UNSUPPORTED_PART', path, 'The content part type is outside this adapter.', 'inconclusive');
      }
    }
  }
  return s;
}

/** Inspect references and approval completion, without executing or modifying input. */
export function inspectApprovalHistory(input: unknown, options: InspectOptions): Report {
  const s = scan(input);
  if (!options || !checkpoints.includes(options.checkpoint)) {
    finding(s, 'UNSUPPORTED_CHECKPOINT', '', 'Choose an explicit documented checkpoint.', 'inconclusive');
    return report(s.findings);
  }
  const coverageComplete = !s.findings.some(f => f.severity === 'inconclusive');
  const calls = group(s.calls, 'toolCallId');
  const requests = group(s.requests, 'approvalId');
  const responses = group(s.responses, 'approvalId');
  const results = group(s.results, 'toolCallId');
  const callRequests = group(s.requests, 'toolCallId');
  for (const entries of callRequests.values()) if (new Set(entries.map(e => e.value.approvalId)).size > 1) {
    finding(s, 'AMBIGUOUS_CALL_APPROVAL', entries[1]!.path, 'Multiple approval IDs for one call are outside this lifecycle model.', 'inconclusive', [entries[0]!.path]);
  }
  for (const entries of calls.values()) if (entries.length > 1) {
    finding(s, 'AMBIGUOUS_TOOL_CALL_ID', entries[1]!.path, 'Repeated tool-call IDs prevent an unambiguous lifecycle check.', 'inconclusive', [entries[0]!.path]);
  }
  for (const entries of requests.values()) {
    const first = entries[0]!;
    for (const next of entries.slice(1)) {
      if (next.value.toolCallId !== first.value.toolCallId) finding(s, 'REUSED_APPROVAL_ID', next.path, 'One approval ID refers to different tool calls.', 'error', [first.path]);
      else finding(s, 'AMBIGUOUS_APPROVAL_REQUEST', next.path, 'Repeated approval requests prevent an unambiguous lifecycle check.', 'inconclusive', [first.path]);
    }
  }
  for (const r of s.responses) {
    if (coverageComplete && !requests.has(r.value.approvalId as string)) finding(s, 'ORPHAN_APPROVAL_RESPONSE', r.path, 'The approval response has no request in this snapshot.');
  }
  for (const entries of responses.values()) {
    const first = entries[0]!;
    for (const next of entries.slice(1)) if (next.value.approved !== first.value.approved) {
      finding(s, 'CONFLICTING_APPROVAL_DECISION', next.path, 'The same approval ID has both approval and denial decisions.', 'error', [first.path]);
    }
  }
  const visitedCalls = new Set<string>();
  for (const r of s.requests) {
    const callId = r.value.toolCallId as string;
    const call = calls.get(callId);
    if (coverageComplete && !call) finding(s, 'ORPHAN_APPROVAL_REQUEST', r.path, 'The approval request has no tool call in this snapshot.');
    if (!call || call.length !== 1 || call[0]!.value.providerExecuted === true || r.value.providerExecuted === true) continue;
    const decisions = responses.get(r.value.approvalId as string) ?? [];
    const terminal = results.get(callId) ?? [];
    if (callRequests.get(callId)!.length !== 1 || decisions.some(d => d.value.providerExecuted === true || own(d.value, 'deferred')) || terminal.some(t => t.value.providerExecuted === true || own(t.value, 'deferred')) || own(call[0]!.value, 'deferred') || own(r.value, 'deferred')) continue;
    if (coverageComplete && !visitedCalls.has(callId) && terminal.length > 1) {
      for (const t of terminal.slice(1)) finding(s, 'DUPLICATE_TERMINAL_RESULT', t.path, 'More than one terminal result refers to this approval-associated tool call.', 'error', [terminal[0]!.path, r.path]);
    }
    visitedCalls.add(callId);
    if (requests.get(r.value.approvalId as string)!.length !== 1 || decisions.some(d => d.value.providerExecuted === true) || terminal.some(t => t.value.providerExecuted === true)) continue;
    if (coverageComplete && options.checkpoint !== 'awaiting-approval' && decisions.length === 0) {
      finding(s, 'APPROVAL_DECISION_MISSING', r.path, 'This checkpoint requires a recorded approval or denial response.');
    }
    if (coverageComplete && options.checkpoint === 'after-tools' && decisions.length > 0 && terminal.length === 0) {
      finding(s, 'TERMINAL_RESULT_MISSING', decisions[0]!.path, 'This checkpoint requires a terminal result for the approval-associated call.', 'error', [r.path]);
    }
  }
  return report(s.findings);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function projection(e: Event): string {
  // Compare all JSON approval metadata, including signatures, privately.
  return canonical(e.value);
}

/** Assert approval metadata preservation only. Never use for pruning or legitimate state transitions. */
export function compareApprovalState(before: unknown, after: unknown, options: CompareOptions): Report {
  const b = scan(before);
  const a = scan(after);
  const findings: Finding[] = [
    ...b.findings.map(f => ({ ...f, path: `/before${f.path}`, relatedPaths: f.relatedPaths.map(p => `/before${p}`) })),
    ...a.findings.map(f => ({ ...f, path: `/after${f.path}`, relatedPaths: f.relatedPaths.map(p => `/after${p}`) })),
  ];
  if (!options || options.mode !== 'lossless-persistence') {
    findings.push({ code: 'UNSUPPORTED_COMPARISON_MODE', severity: 'inconclusive', path: '', relatedPaths: [], message: 'Declare mode lossless-persistence; transitions and pruning are unsupported.' });
    return report(findings);
  }
  // Do not infer a deletion from an unsupported record that could not be parsed.
  if (findings.some(f => f.severity === 'inconclusive')) return report(findings);
  // Match by part type + ID + occurrence, preserving repeated records without collapsing them.
  function keyed(events: Event[]): Map<string, Event[]> {
    const grouped = new Map<string, Event[]>();
    for (const e of events) {
      const key = JSON.stringify([e.value.type, e.value.approvalId]);
      const entries = grouped.get(key);
      if (entries) entries.push(e); else grouped.set(key, [e]);
    }
    return grouped;
  }
  const left = keyed([...b.requests, ...b.responses]);
  const right = keyed([...a.requests, ...a.responses]);
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const prev = left.get(key) ?? [], next = right.get(key) ?? [];
    for (let i = 0; i < Math.max(prev.length, next.length); i++) {
      const x = prev[i], y = next[i];
      if (x && !y) findings.push({ code: 'APPROVAL_STATE_REMOVED', severity: 'error', path: `/before${x.path}`, relatedPaths: [], message: 'An approval record disappeared during the declared lossless round trip.' });
      else if (!x && y) findings.push({ code: 'APPROVAL_STATE_ADDED', severity: 'error', path: `/after${y.path}`, relatedPaths: [], message: 'An approval record appeared during the declared lossless round trip.' });
      else if (x && y && projection(x) !== projection(y)) findings.push({ code: 'APPROVAL_STATE_CHANGED', severity: 'error', path: `/after${y.path}`, relatedPaths: [`/before${x.path}`], message: 'Approval metadata changed during the declared lossless round trip.' });
    }
  }
  return report(findings);
}
