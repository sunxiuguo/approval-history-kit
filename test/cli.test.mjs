import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
const stdin = (input, ...args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { input, encoding: 'utf8' });
test('CLI clean file returns 0 without editing it', () => {
  const path = 'examples/good-denial.json';
  const before = readFileSync(path);
  const result = cli('check', path, '--checkpoint', 'after-tools', '--format', 'json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'clean');
  assert.deepEqual(readFileSync(path), before);
});
test('CLI findings return 1 and exact pointer', () => {
  const result = cli('check', 'examples/duplicate-denial.json', '--checkpoint', 'after-tools', '--format', 'json');
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings[0].code, 'DUPLICATE_TERMINAL_RESULT');
  assert.equal(report.findings[0].path, '/messages/1/content/2');
});
test('stdin supports valid input', () => assert.equal(stdin('[]', 'check', '-', '--checkpoint', 'after-tools').status, 0));
test('unknown input returns 3', () => assert.equal(stdin('{}', 'check', '-', '--checkpoint', 'after-tools').status, 3));
test('unknown content never exits successfully', () => assert.equal(stdin('[{"role":"assistant","content":[{"type":"future"}]}]', 'check', '-', '--checkpoint', 'after-tools').status, 3));
test('invalid JSON returns 2 without leaking its text', () => {
  const result = stdin('secret-payload-DO-NOT-PRINT', 'check', '-', '--checkpoint', 'after-tools', '--format', 'json');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {status: 'input-error', code: 'INVALID_JSON'});
  assert.doesNotMatch(result.stderr, /secret-payload/);
});
test('file read errors do not leak file names', () => {
  const result = cli('check', '/secret-missing-path', '--checkpoint', 'after-tools');
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /secret-missing-path/);
});
test('checkpoint and comparison mode must be declared', () => {
  assert.equal(cli('check', 'examples/good-denial.json').status, 2);
  assert.equal(cli('compare', 'examples/good-denial.json', 'examples/good-denial.json').status, 2);
});
test('unknown flag and invalid format are invocation errors', () => {
  assert.equal(cli('check', 'examples/good-denial.json', '--checkpoint', 'after-tools', '--repair').status, 2);
  assert.equal(cli('check', 'examples/good-denial.json', '--checkpoint', 'after-tools', '--format', 'yaml').status, 2);
});
test('compare CLI lossless equality succeeds', () => assert.equal(cli('compare', 'examples/good-denial.json', 'examples/good-denial.json', '--mode', 'lossless-persistence').status, 0));
test('compare cannot consume stdin twice', () => assert.equal(cli('compare', '-', '-', '--mode', 'lossless-persistence').status, 2));
test('input limit reports only its code', () => {
  const result = stdin(' '.repeat(8 * 1024 * 1024 + 1), 'check', '-', '--checkpoint', 'after-tools', '--format', 'json');
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stderr), {status: 'input-error', code: 'INPUT_TOO_LARGE'});
});
for (const command of ['check','compare-before','compare-after']) {
  test(`malformed UTF-8 is rejected without replacement: ${command}`, () => {
    const bytes=Buffer.concat([Buffer.from('[{"role":"user","content":"'),Buffer.from([0xff]),Buffer.from('"}]')]);
    const args=command==='check' ? ['check','-','--checkpoint','after-tools']
      : command==='compare-before' ? ['compare','-','examples/good-denial.json','--mode','lossless-persistence']
      : ['compare','examples/good-denial.json','-','--mode','lossless-persistence'];
    const result=stdin(bytes,...args,'--format','json');
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{status:'input-error',code:'INVALID_UTF8'});
  });
}

test('different malformed signature bytes cannot collapse into clean equality', () => {
  const temp=mkdtempSync(join(tmpdir(),'approval-utf8-'));
  const prefix=Buffer.from('[{"role":"assistant","content":[{"type":"tool-approval-request","approvalId":"a","toolCallId":"c","signature":"');
  const suffix=Buffer.from('"}]}]');
  try {
    writeFileSync(join(temp,'before.json'),Buffer.concat([prefix,Buffer.from([0xff]),suffix]));
    writeFileSync(join(temp,'after.json'),Buffer.concat([prefix,Buffer.from([0xfe]),suffix]));
    const result=cli('compare',join(temp,'before.json'),join(temp,'after.json'),'--mode','lossless-persistence','--format','json');
    assert.equal(result.status,2);
    assert.deepEqual(JSON.parse(result.stderr),{status:'input-error',code:'INVALID_UTF8'});
  } finally { rmSync(temp,{recursive:true,force:true}); }
});
test('legitimate UTF-8 replacement character is supported', () => {
  const result=stdin(JSON.stringify([{role:'user',content:'Valid Unicode: \ufffd'}]),'check','-','--checkpoint','after-tools','--format','json');
  assert.equal(result.status,0,result.stderr);
});
