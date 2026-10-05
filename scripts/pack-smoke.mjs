import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const temp = mkdtempSync(join(tmpdir(), 'approval-history-kit-'));
let archive;
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(temp, 'cache')], { encoding: 'utf8' }))[0];
  archive = resolve(packed.filename);
  assert.ok(packed.files.some(f => f.path === 'dist/cli.js'));
  assert.ok(packed.files.some(f => f.path === 'dist/index.d.ts'));
  assert.ok(packed.files.every(f => !f.path.includes('node_modules') && !f.path.startsWith('test/')));
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--cache', join(temp, 'cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], { cwd: temp, stdio: 'pipe' });
  const cli = join(temp, 'node_modules', 'approval-history-kit', 'dist', 'cli.js');
  const good = spawnSync(process.execPath, [cli, 'check', join(root, 'examples/good-denial.json'), '--checkpoint', 'after-tools', '--format', 'json'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, 'clean');
  const bad = spawnSync(process.execPath, [cli, 'check', join(root, 'examples/duplicate-denial.json'), '--checkpoint', 'after-tools', '--format', 'json'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(bad.status, 1, bad.stderr);
  assert.equal(JSON.parse(bad.stdout).findings[0].code, 'DUPLICATE_TERMINAL_RESULT');
  const imported = execFileSync(process.execPath, ['--input-type=module', '-e', "import { inspectApprovalHistory } from 'approval-history-kit'; console.log(inspectApprovalHistory([], {checkpoint:'after-tools'}).status)"], { cwd: temp, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(imported.trim(), 'clean');
  assert.equal(readFileSync(join(temp, 'node_modules', 'approval-history-kit', 'package.json'), 'utf8').includes('"dependencies"'), false);
  console.log('Packed artifact: offline install, CLI positive/negative, ESM import passed; no API keys supplied.');
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (archive) rmSync(archive, { force: true });
}
