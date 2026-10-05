# A five-minute AI SDK approval save/reload regression test

An optional field can disappear during persistence while the restored approval
lifecycle still looks valid. This demo catches that difference with a real JSON
file save/reload, a valid control, and a deliberately broken storage mapping.

Uses the released **v0.1.0** archive and its synthetic denial fixture, matching the
supported **ai@7.0.127 JSON `ModelMessage`** shape. You need Node.js 22 or 24 and a
POSIX shell. No AI SDK installation, provider, API key, or tool execution is needed.
After downloading the archive, the demo works offline.

## 1. Install the release archive

Create a fresh working directory. Download `approval-history-kit-0.1.0.tgz` from
[release v0.1.0](https://github.com/sunxiuguo/approval-history-kit/releases/tag/v0.1.0)
into it, then open a terminal in that directory. This package is not on npm.

Verify the archive and install it without contacting the registry:

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
assert.equal(createHash("sha256").update(readFileSync("approval-history-kit-0.1.0.tgz")).digest("hex"), "21bd00f81e531f2e187c8dc0a5d3b3669e886d028b8837fad6f0e78b74788435");
console.log("Archive checksum verified");' &&
npm install --cache ./.npm-cache --offline --ignore-scripts --no-audit --no-fund ./approval-history-kit-0.1.0.tgz
```

The checksum command prints `Archive checksum verified`. npm installs one package;
its timing and notices vary. There are no runtime dependencies.

## 2. Save, reload, and detect the deliberate regression

This creates three synthetic JSON files in the working directory. The broken
mapping drops the approval response's optional `reason` field. It does not change
the decision, execute anything, or reproduce a provider request.

```sh
cat > persistence-demo.mjs <<'EOF'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { inspectApprovalHistory, compareApprovalState } from 'approval-history-kit';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));
const before = read('node_modules/approval-history-kit/examples/good-denial.json');
write('before.json', before);

// Control: save and reload the complete supported JSON snapshot.
write('valid.json', before);
const valid = read('valid.json');

// Simulate a storage mapper dropping an optional approval response field.
const mapped = structuredClone(before);
delete mapped.messages[1].content[0].reason;
write('broken.json', mapped);
const broken = read('broken.json');

const inspect = value => inspectApprovalHistory(value, { checkpoint: 'after-tools' });
const compare = value => compareApprovalState(before, value, { mode: 'lossless-persistence' });
const assertClean = report => {
  assert.equal(report.complete, true);
  assert.equal(report.status, 'clean');
};
assertClean(inspect(before));
assertClean(inspect(valid));
assertClean(compare(valid));
console.log('PASS: valid save/reload preserves the covered approval state');

// "reason" is optional: the lifecycle still passes, but the round trip is lossy.
assertClean(inspect(broken));
const regression = compare(broken);
assert.equal(regression.complete, true);
assert.equal(regression.status, 'issues');
assert.deepEqual(regression.findings.map(f => [f.code, f.path]), [
  ['APPROVAL_STATE_CHANGED', '/after/messages/1/content/0'],
]);
console.log('PASS: lossy save/reload reports APPROVAL_STATE_CHANGED');
EOF
node persistence-demo.mjs
```

Exact output, exit 0:

```text
PASS: valid save/reload preserves the covered approval state
PASS: lossy save/reload reports APPROVAL_STATE_CHANGED
```

Both assertions must pass: the control preserves state, and the deliberately
broken mapping is detected. The test exits 0 because it expects that regression.

## 3. See the CLI result and exit code

Both restored histories have a covered, complete approval lifecycle:

```sh
cli=node_modules/approval-history-kit/dist/cli.js
node "$cli" check valid.json --checkpoint after-tools
node "$cli" check broken.json --checkpoint after-tools
```

Exact output, each command exits 0:

```text
clean (complete: true)
clean (complete: true)
```

Now ask whether persistence preserved the approval metadata:

```sh
node "$cli" compare before.json valid.json --mode lossless-persistence
if node "$cli" compare before.json broken.json --mode lossless-persistence; then
  echo 'exit=0'
else
  echo "exit=$?"
fi
```

Exact output:

```text
clean (complete: true)
issues (complete: true)
error APPROVAL_STATE_CHANGED /after/messages/1/content/0: Approval metadata changed during the declared lossless round trip.
exit=1
```

The valid comparison exits 0. The broken comparison exits 1; the shell `if` above
captures that expected failure even when your shell uses `set -e`.

## Put the assertion around your own storage code

Replace this demo's file write/read with your actual save/load operations. Keep
an unmodified JSON snapshot from before saving. In the regression test, require
`complete === true` and `status === 'clean'` for all three reports:

1. `inspectApprovalHistory(before, { checkpoint: 'after-tools' })`
2. `inspectApprovalHistory(restored, { checkpoint: 'after-tools' })`
3. `compareApprovalState(before, restored, { mode: 'lossless-persistence' })`

Choose the [checkpoint](../README.md#choose-the-checkpoint-you-actually-saved)
your application really saved. `after-tools` fits this completed synthetic denial.
Use `ready-to-resume` when the approval decision is recorded but a terminal result
may still be pending, or `awaiting-approval` while a decision may still be pending.

Use lossless comparison only when storage should preserve approval metadata;
legitimate approval changes, pruning, and compaction need different assertions.
Unsupported input is inconclusive, so checking only for an empty findings list is
insufficient. This kit checks a supported approval projection, not the whole
conversation, signature validity, authorization, or provider acceptance. A clean
report does not establish that an SDK continuation will execute correctly.
