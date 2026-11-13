import test from 'node:test';
import assert from 'node:assert/strict';
import { runUiSaveReload } from '../examples/ui-save-reload.mjs';

test('runnable UI save/reload example distinguishes schema validity from metadata preservation', async () => {
  const reports = await runUiSaveReload();
  assert.equal(reports.direct.complete, false);
  assert.equal(reports.single.status, 'clean');
  assert.equal(reports.control.complete, true);
  assert.equal(reports.regression.status, 'issues');
  const findings = JSON.stringify(reports.regression.findings);
  assert.equal(findings.includes('synthetic-call'), false);
  assert.equal(findings.includes('synthetic-approval'), false);
});
