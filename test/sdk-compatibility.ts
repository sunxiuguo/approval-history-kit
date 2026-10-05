// Original compile-time fixture: importing only the pinned SDK's public types.
import type { ModelMessage } from 'ai';
import { inspectApprovalHistory } from '../src/index.js';

const history = [
  { role: 'system', content: 'Synthetic offline compatibility fixture.' },
  { role: 'assistant', content: [
    { type: 'tool-call', toolCallId: 'demo-call', toolName: 'sample', input: { value: 1 } },
    { type: 'tool-approval-request', approvalId: 'demo-approval', toolCallId: 'demo-call', reason: 'Demo', isAutomatic: false, signature: 'synthetic-not-a-valid-signature', inputSchemaInput: { value: '1' } },
  ] },
  { role: 'tool', content: [
    { type: 'tool-approval-response', approvalId: 'demo-approval', approved: false, reason: 'Demo' },
    { type: 'tool-result', toolCallId: 'demo-call', toolName: 'sample', output: { type: 'execution-denied', reason: 'Demo' } },
  ] },
  { role: 'assistant', content: [
    { type: 'tool-call', toolCallId: 'second-call', toolName: 'sample', input: {} },
    { type: 'tool-approval-request', approvalId: 'second-approval', toolCallId: 'second-call', isAutomatic: true },
    { type: 'tool-result', toolCallId: 'second-call', toolName: 'sample', output: { type: 'error-text', value: 'Synthetic failure' } },
  ] },
  { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'second-approval', approved: true }] },
] satisfies ModelMessage[];
inspectApprovalHistory(history, { checkpoint: 'after-tools' });

const providerExecuted = [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'provider-call', toolName: 'sample', input: {}, providerExecuted: true }] },
  { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'provider-approval', approved: true, providerExecuted: true }] },
] satisfies ModelMessage[];
inspectApprovalHistory(providerExecuted, { checkpoint: 'awaiting-approval' });
