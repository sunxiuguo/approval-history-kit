# approval-history-kit

Catch broken approve/deny histories in your persistence tests before resuming an agent.

An offline TypeScript library and CLI for a narrow question: **did my application preserve the AI SDK approval lifecycle?** It finds missing references, conflicting decisions, duplicate terminal results, and approval metadata lost in a declared lossless save/reload round trip.

**Early v0.1 project.** Use a source checkout, or download a built archive from [GitHub Releases](https://github.com/sunxiuguo/approval-history-kit/releases) when available. This package is not published to npm. The adapter is pinned to **ai@7.0.127**, with original fixtures checked against its exported `ModelMessage` type. This is not a general conversation validator, a provider-acceptance guarantee, or an authorization system.

## Try the broken history beside its control

Node.js 22 or 24:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js check examples/good-denial.json --checkpoint after-tools --format json
# exit 0, status "clean"
node dist/cli.js check examples/duplicate-denial.json --checkpoint after-tools --format json
# exit 1, DUPLICATE_TERMINAL_RESULT
```

Both examples are synthetic. They execute no tool and require no API key. Dependencies are needed for development only; built code has no runtime dependencies, telemetry, HTTP calls, or payload upload.

## Library

```ts
import { inspectApprovalHistory, compareApprovalState } from 'approval-history-kit';

const report = inspectApprovalHistory(history, {
  checkpoint: 'ready-to-resume',
});

const restored = JSON.parse(JSON.stringify(history));
const roundTrip = compareApprovalState(history, restored, {
  mode: 'lossless-persistence',
});
```

The import above works after installing a locally built archive (`npm pack`) or a downloaded GitHub release asset. It is not an instruction to install a published npm package.

To try a downloaded archive in a separate directory without fetching runtime dependencies:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./approval-history-kit-0.1.0.tgz
node node_modules/approval-history-kit/dist/cli.js check node_modules/approval-history-kit/examples/good-denial.json --checkpoint after-tools
```

Inputs are read-only plain JSON. Accept a `ModelMessage[]` or this envelope:

```json
{"format":"approval-history-kit","version":1,"messages":[]}
```

UIMessage `parts`, provider wire formats, JavaScript objects containing dates/binary data/getters, and non-JSON tool payloads are outside the adapter. Convert to your actual persisted JSON first. This library is not a sandbox for hostile JavaScript objects or Proxies.

## Choose the checkpoint you actually saved

- `awaiting-approval`: structural checks only; unanswered requests and answered calls awaiting a result are permitted. Completed earlier turns are permitted too
- `ready-to-resume`: every supported approval request needs a response; approved or denied calls may still await their terminal result
- `after-tools`: every supported approval request needs a response and every answered approval-associated call needs a terminal result, including denied calls

These are explicit application assertions, not detection of the SDK's internal execution phase. The kit does not resume anything. It does not insist on adjacency, on a request being the final message, or on chronological order. The SDK's continuation behavior also depends on its last tool message and current approval policy; a clean report cannot establish that a particular next SDK call will execute correctly.

Results in assistant content are allowed. A denial followed by `error-text` is allowed, as is an approval followed by `execution-denied`: the SDK may revalidate a decision against a newer policy. The kit does not infer whether a real-world action occurred from a result value.

## Findings and coverage

Each report has `status`, `complete`, `sdkVersion`, and `findings`. A finding contains a stable `code`, severity, JSON Pointer `path`, `relatedPaths`, and fixed explanation. Reports omit tool IDs, approval IDs, prompts, inputs, outputs, reasons, and signatures. File and parse errors also omit the submitted content and file path.

- `ORPHAN_APPROVAL_RESPONSE`: no request with that approval ID exists in this snapshot
- `ORPHAN_APPROVAL_REQUEST`: no tool call with that tool-call ID exists in this snapshot
- `REUSED_APPROVAL_ID`: one approval ID points to different calls
- `CONFLICTING_APPROVAL_DECISION`: the same approval has both true and false responses
- `DUPLICATE_TERMINAL_RESULT`: multiple results for a uniquely identified approval-associated call
- `APPROVAL_DECISION_MISSING` / `TERMINAL_RESULT_MISSING`: the declared checkpoint is incomplete
- `APPROVAL_STATE_REMOVED` / `APPROVAL_STATE_ADDED` / `APPROVAL_STATE_CHANGED`: approval metadata differs in a declared lossless round trip

These are this kit's history-integrity assertions, not claims that the SDK rejects every flagged input. Exact repeated requests or repeated call IDs are ambiguous and produce inconclusive findings, rather than silently choosing one lifecycle. Exact repeated responses with the same boolean are permitted; contradictory responses are reported.

Unknown variants, malformed approval fields, provider-executed/deferred semantics, and unsupported JSON inputs are **inconclusive**, never clean. `complete: false` means some input could not be covered, even when known issues also exist. Do not treat `status: issues` as evidence of complete coverage; check both fields. Missing-reference, missing-completion, and duplicate-result assertions are suppressed when parsing is incomplete, since an unsupported record could hold the missing state.

`clean` means no covered approval assertion failed. Tool input/output schemas, media payloads, generic tool-result pairing for calls without approvals, signatures, permissions, business policies, and provider acceptance are not validated. Opaque provider metadata is not interpreted. An empty history is clean because it has no approval state.

The CLI reads at most 8 MiB plus one detection byte per input. The library rejects more than 100,000 JSON nodes or depth greater than 64 as inconclusive. It does not include rejected data in reports.

## Lossless comparison means lossless

```sh
node dist/cli.js compare before.json after.json --mode lossless-persistence --format json
```

Use comparison for storage round trips, not legitimate approval updates, history pruning, compaction, or conversion between formats. It compares every JSON field on approval request/response parts, including reason, signature, `isAutomatic`, and `inputSchemaInput`, without printing the values. Object-key order is ignored. Approval records are matched by part type, approval ID, and occurrence; moving a unique record does not itself count as changed. This compares approval metadata only, not the whole conversation or tool payloads. An ID change appears as a removal and an addition.

If either snapshot contains unsupported input, comparison stays inconclusive and skips loss assertions rather than mistaking an unparsed record for a deletion. Comparison does not run checkpoint checks or assert a valid lifecycle. For both claims, inspect the snapshots separately and compare them.

## CLI contract

```text
approval-history-kit check FILE|- --checkpoint awaiting-approval|ready-to-resume|after-tools [--format text|json]
approval-history-kit compare BEFORE AFTER --mode lossless-persistence [--format text|json]
```

- Exit 0: clean covered projection
- Exit 1: known issues (inspect `complete` for unsupported material too)
- Exit 2: invocation, file-read, size-limit, or UTF-8/JSON-parse error, emitted to stderr
- Exit 3: inconclusive only

`-` reads stdin. Compare accepts stdin for only one side. Compare pointers start `/before` or `/after`, denoting a virtual pair of snapshots. Envelope pointers include `/messages`.

No repair command, automatic approval, network request, tool execution, or input-file write exists.

## Why this narrow scope?

Public regression classes inspired this project:

- [AI SDK #22012](https://github.com/vercel/ai/issues/22012): duplicate result after persisted denial; upstream [fix PR #22019](https://github.com/vercel/ai/pull/22019) already exists
- [#16385](https://github.com/vercel/ai/issues/16385): pruning an approval request while retaining its response; historical issue fixed in ai 7.0.5
- [#18451](https://github.com/vercel/ai/issues/18451): unresolved persisted approval state; closed historical report
- [#21091](https://github.com/vercel/ai/issues/21091): transformed input persistence; fixed in ai 7.0.113, schema transformation execution remains outside this kit

This project is application regression tooling, not an upstream SDK fix. All fixtures and implementation here are original and synthetic; they reproduce structural failure classes rather than executing reporters' applications.

For provider-level repair/trimming, consider [turnsafe](https://github.com/Yasir-Khan-7/turnsafe). For tracing, see [AI SDK DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools). The SDK already has its own validation. This kit concentrates on explicit approval checkpoints and save/reload assertions.

## Compatibility and development

```sh
npm ci --ignore-scripts
npm run check
```

The lockfile pins ai 7.0.127, provider-utils 5.0.53, TypeScript 5.9.3, and Node type definitions. `test/sdk-compatibility.ts` compiles original fixtures against the installed SDK's public types. CI is configured for Node 22 and 24, runs tests and an offline packed-install smoke test, then runs the clean demo in a network namespace. A configured CI matrix is not evidence that a run has passed; inspect the repository's Actions results for the exact commit.

Pinned SDK tag: [`ai@7.0.127`](https://github.com/vercel/ai/tree/ai%407.0.127), commit `eb77f09e3c06c28e860d92e0de941b143c2eecec`. Contract sources: [content parts](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider-utils/src/types/content-part.ts), [requests](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider-utils/src/types/tool-approval-request.ts), [responses](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider-utils/src/types/tool-approval-response.ts), [collection](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/generate-text/collect-tool-approvals.ts), and [UI conversion](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/ui/convert-to-model-messages.ts).

No SDK implementation is vendored. Original code is MIT; development dependencies retain their own licenses, including [AI SDK's Apache-2.0 license](https://github.com/vercel/ai/blob/ai%407.0.127/LICENSE).

See [CONTRIBUTING.md](CONTRIBUTING.md) for reproductions and scope. Releases are gated on independent checkpoint/false-positive review and passing CI. No automatic package publishing is configured.
