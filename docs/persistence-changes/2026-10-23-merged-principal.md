---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-23-merged-principal

English | [中文](2026-10-23-merged-principal.zh.md)

## Summary

Acknowledges the optional `principal` property upstream rc.2 added to four persisted event sources, which the merge now carries alongside the fork's owner and delivery fields.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-23-merged-principal
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-16-job-lifecycle"
    after: "d7041244545a4f6f8bbf2c48011e4286521cadf9b3591428ef8433a4db3c7100"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-16-job-lifecycle"
    after: "6d3838f1ddeddee71f68f1900a368dccf8199981a79ead6e6da4dace50189bbc"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-16-job-lifecycle"
    after: "5395613dff0c71261606a375b6571cdac05450e8a58d6e18e927adcb8262078a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-16-job-lifecycle"
    after: "7948b4790fa2120378fc2fe589ac599042a72f7ae04f31bcc44f56505a0cb63e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Optional property on an existing source variant: logs written before it read unchanged, and readers that do not know it ignore it. No version bump.

<a id="verification"></a>
## Verification

`pnpm run verify-persistence-changes` classifies the transition, and the JSONL persistence suite round-trips a log carrying both the owner field and the principal property.

<a id="dev-note"></a>
## Dev Note

None.
