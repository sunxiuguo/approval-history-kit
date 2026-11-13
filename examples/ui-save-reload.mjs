// Synthetic persistence regression, pinned to the checkout's ai@7.0.127.
// No provider request, agent continuation, or tool execution.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { safeValidateUIMessages, convertToModelMessages } = await import('ai').catch(() => {
  throw new Error('This optional source-checkout example requires the pinned ai development dependency. Run npm ci --ignore-scripts in the source checkout; the dependency-free runtime archive alone is insufficient.');
});
import { inspectApprovalHistory, compareApprovalState } from '../dist/index.js';

export async function runUiSaveReload() {
  const before = [{ id: 'synthetic-message', role: 'assistant', parts: [{
    type: 'tool-demo', toolCallId: 'synthetic-call', state: 'approval-requested',
    input: { topic: 'Synthetic workshop' }, approval: { id: 'synthetic-approval' },
  }] }];
  const temp = mkdtempSync(join(tmpdir(), 'approval-ui-demo-'));
  try {
    const saveReload = (name, value) => {
      const file = join(temp, name);
      writeFileSync(file, JSON.stringify(value));
      return JSON.parse(readFileSync(file, 'utf8'));
    };
    const valid = saveReload('valid.json', before);
    assert.deepEqual(valid, before); // Full UI JSON preservation, beyond this kit.
    const malformed = structuredClone(before);
    malformed[0].parts[0].approval = null;
    assert.equal((await safeValidateUIMessages({ messages: malformed })).success, false);

    const mapped = structuredClone(before);
    mapped[0].parts[0].state = 'input-available';
    delete mapped[0].parts[0].approval;
    const broken = saveReload('broken.json', mapped);
    assert.notDeepEqual(broken, before);
    for (const messages of [before, valid, broken]) {
      // Both original and downgraded UI snapshots are valid SDK shapes.
      assert.equal((await safeValidateUIMessages({ messages })).success, true);
    }
    const direct = inspectApprovalHistory(broken, { checkpoint: 'awaiting-approval' });
    assert.equal(direct.status, 'inconclusive');
    assert.equal(direct.complete, false); // UIMessage is not this kit's input.

    // Use the SDK's real projection; serialize to the supported plain JSON
    // boundary (converter JS objects can contain undefined optional fields).
    const project = async messages => JSON.parse(JSON.stringify(await convertToModelMessages(messages)));
    const originalModel = await project(before);
    const validModel = await project(valid);
    const brokenModel = await project(broken);
    const inspect = messages => inspectApprovalHistory(messages, { checkpoint: 'awaiting-approval' });
    const compare = messages => compareApprovalState(originalModel, messages, { mode: 'lossless-persistence' });
    const control = compare(validModel);
    const single = inspect(brokenModel);
    for (const report of [inspect(originalModel), inspect(validModel), single, control]) {
      assert.equal(report.status, 'clean');
      assert.equal(report.complete, true);
    }
    const regression = compare(brokenModel);
    assert.equal(regression.complete, true);
    assert.equal(regression.status, 'issues');
    assert.deepEqual(regression.findings.map(f => f.code), ['APPROVAL_STATE_REMOVED']);
    return { direct, single, control, regression };
  } finally {
    rmSync(temp, { recursive: true, force: true }); // Only this run's synthetic files.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runUiSaveReload();
  console.log('PASS: SDK rejects null approval but accepts the valid state downgrade');
  console.log('PASS: raw UIMessage is inconclusive; single projected snapshot is clean');
  console.log('PASS: unchanged file round trip is clean; lossy pair reports APPROVAL_STATE_REMOVED');
}
