# UI persistence: schema validity is not lossless storage

This **source-checkout example** uses the pinned `ai@7.0.127` development dependency
and the kit together. It adds a UI-to-model boundary test to the existing
[ModelMessage save/reload guide](save-reload-regression.md), not a new UI adapter.

```sh
npm ci --ignore-scripts
npm run build
node examples/ui-save-reload.mjs
```

Requires Node.js 22 or 24. Run from a source checkout: the dependency-free built
archive alone does not install `ai` for this optional example. After setup it is
offline, needs no key, and executes no provider call, agent, or tool. It creates
and removes only its own temporary synthetic JSON files. `npm test` runs the
same example as a regression test.

Expected output (exit 0 because the deliberate regression is detected):

```text
PASS: SDK rejects null approval but accepts the valid state downgrade
PASS: raw UIMessage is inconclusive; single projected snapshot is clean
PASS: unchanged file round trip is clean; lossy pair reports APPROVAL_STATE_REMOVED
```

## What it proves

1. Native `safeValidateUIMessages` rejects `approval-requested` with `approval:null`.
2. A storage mapper that also downgrades to `input-available` and removes approval
   produces a valid SDK shape. Validation alone cannot infer the original state.
3. The kit directly receiving these `UIMessage.parts` returns **inconclusive**.
4. The real SDK `convertToModelMessages`, followed by JSON serialization/parsing,
   yields the supported plain-JSON model projection. This matters because the
   converter's in-memory objects can contain undefined optional properties.
5. Inspecting the downgraded projection alone is clean: the approval reference is
   gone. Comparing the original and restored projections detects
   `APPROVAL_STATE_REMOVED`; the unchanged control stays clean. Always require
   both `complete === true` and the expected status.

Preserve and compare the **full UI JSON** around your storage boundary when the
contract is lossless. The kit's narrower projection does not prove full UI
preservation: conversion can intentionally omit unsupported/unresolved material,
so do not enable `ignoreIncompleteToolCalls` and assume a clean report proves no
loss. Use your installed SDK's native validation as well. Do not use lossless
comparison for legitimate decisions, pruning, or compaction.

Historical inspiration: [Pydantic AI #4830](https://github.com/pydantic/pydantic-ai/issues/4830)
reported approval metadata lost on reload with pydantic-ai 1.71.0 / AI SDK v6.
That issue was closed April 21, 2026. This is an original **v7 synthetic storage
mapping**, not a reproduction of that application, evidence of a current Pydantic
bug, or a claim of v6 support. The report's cancellation-text and cross-run
invocation issues are not tested here. Provider-executed/deferred semantics,
authorization, actual UI rendering, and SDK continuation remain outside this kit.
