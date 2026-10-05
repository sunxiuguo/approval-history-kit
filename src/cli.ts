#!/usr/bin/env node
import { openSync, readSync, closeSync } from 'node:fs';
import { compareApprovalState, inspectApprovalHistory } from './index.js';
import type { Checkpoint, Report } from './index.js';

const HELP = `approval-history-kit (AI SDK 7.0.127 JSON approval projection)

check FILE|- --checkpoint awaiting-approval|ready-to-resume|after-tools [--format text|json]
compare BEFORE AFTER --mode lossless-persistence [--format text|json]

Exit: 0 clean, 1 findings, 2 invocation/read/JSON error, 3 inconclusive.
Inputs are read-only. Reports omit payloads and IDs. No network or tool execution.
A maximum of 8 MiB is read per input. Checkpoint/mode must be explicit.
`;
const LIMIT = 8 * 1024 * 1024;
class InputError extends Error {}
function read(path: string): unknown {
  let fd: number | undefined;
  let bytes: Buffer;
  try {
    fd = path === '-' ? 0 : openSync(path, 'r');
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= LIMIT) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, LIMIT + 1 - total));
      const readBytes = readSync(fd, chunk, 0, chunk.length, null);
      if (!readBytes) break;
      chunks.push(chunk.subarray(0, readBytes));
      total += readBytes;
    }
    if (total > LIMIT) throw new InputError('INPUT_TOO_LARGE');
    bytes = Buffer.concat(chunks, total);
  } catch (err) {
    throw err instanceof InputError ? err : new InputError('INPUT_READ_ERROR');
  } finally {
    if (fd !== undefined && fd !== 0) closeSync(fd);
  }
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new InputError('INVALID_UTF8'); }
  try { return JSON.parse(decoded); } catch { throw new InputError('INVALID_JSON'); }
}
function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { process.stdout.write(HELP); return; }
  const formatIndexes = args.map((v, i) => v === '--format' ? i : -1).filter(i => i >= 0);
  let format = 'text';
  if (formatIndexes.length === 1) format = args[formatIndexes[0]! + 1] ?? '';
  try {
    if (formatIndexes.length > 1 || !['text', 'json'].includes(format)) throw new InputError('INVALID_ARGUMENTS');
    if (formatIndexes.length) args.splice(formatIndexes[0]!, 2);
    let result: Report;
    if (args[0] === 'check' && args.length === 4 && args[2] === '--checkpoint' && ['awaiting-approval', 'ready-to-resume', 'after-tools'].includes(args[3]!)) {
      result = inspectApprovalHistory(read(args[1]!), { checkpoint: args[3] as Checkpoint });
    } else if (args[0] === 'compare' && args.length === 5 && args[3] === '--mode' && args[4] === 'lossless-persistence' && !(args[1] === '-' && args[2] === '-')) {
      result = compareApprovalState(read(args[1]!), read(args[2]!), { mode: 'lossless-persistence' });
    } else throw new InputError('INVALID_ARGUMENTS');
    process.stdout.write(format === 'json' ? JSON.stringify(result, null, 2) + '\n' : `${result.status} (complete: ${result.complete})\n` + result.findings.map(f => `${f.severity} ${f.code} ${f.path || '/'}: ${f.message}\n`).join(''));
    process.exitCode = result.status === 'clean' ? 0 : result.status === 'issues' ? 1 : 3;
  } catch (err) {
    const code = err instanceof InputError ? err.message : 'INPUT_PROCESSING_ERROR';
    const output = format === 'json' ? JSON.stringify({ status: 'input-error', code }) + '\n' : `input-error: ${code}\nRun --help for usage.\n`;
    process.stderr.write(output);
    process.exitCode = 2;
  }
}
main();
