# Contributing

Please include a minimal synthetic ModelMessage JSON history, exact ai version,
checkpoint, expected result, and actual rule code. Replace real prompts, tool
inputs/outputs, IDs, approval reasons, and signatures with synthetic values.
Do not upload private conversations, credentials, or customer data.

Run `npm ci --ignore-scripts` and `npm run check` on Node 22 or 24.
Every rule needs an adjacent valid control, exact JSON Pointers, and a test that
reports do not expose submitted data. Public SDK types are the compatibility
contract; runtime behavior may require a separately attributed regression test.

Scope is AI SDK 7 JSON approval history and declared lossless persistence. We do
not add automatic repair/approval, tool execution, telemetry, provider requests,
or speculative rules derived only from one malformed fixture. Unknown semantics
must remain inconclusive. A clean report is not a permission to execute a tool.

Releases require independent review and passing CI on the release commit. There
is no npm publishing workflow. Generated `dist` and archives stay out of Git.
