---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-job-lifecycle

English | [中文](2026-10-16-job-lifecycle.zh.md)

## Summary

Records process-generation job lifecycle and actual completion enqueue disposition in the owning Session; completion sources gain optional structured job correlation.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-job-lifecycle
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-14-session-owner-and-delivery"
    after: "f9236c7f89160689b191fde27805eaf81e38d9f15c31d08978bc471ac0fef7cb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-14-session-owner-and-delivery"
    after: "dadf6f988d9300787e39343863ff351864a7d1a857665bc5a06004bd3839dd95"
    decision: same-version
  - root: "event:jobs/lifecycle"
    previous: null
    after: "7af3f9d6625e2fd49de4d839a6d2e130098b84f9e6b167a14c9a2448b77d9bb9"
    decision: same-version
  - root: "event:jobs/report"
    previous: null
    after: "84656b59d95a6c26dd0b38bbbd160dca6b5ffa307c2fc6c44c3bd2ddf3631fc8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-14-session-owner-and-delivery"
    after: "e6c28134bf4037afd754f3d990d25fb5410c710bb8b38faf1bc763b5741cf780"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-14-session-owner-and-delivery"
    after: "5ed72b0e4f926b668eb94fb454643a7e2a82b14c9fc9f9526dcfb192cf2690d9"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs remain valid and current readers accept them. New required jobs/lifecycle and jobs/report discriminators are absent from older readers' known-event catalog, so those readers refuse before mutation rather than silently reconstructing missing work. Optional source correlation does not change model content or old source meaning. Session format remains v4; processes and output rings are never restored by these facts.

<a id="verification"></a>
## Verification

Focused native jobs/controller/shell tests: 301 passed. Full clean host and client builds passed. Actual product profile tests use real confined processes, Session JSONL and local HTTP/SSE: 5 passed, including restart-unavailable identities, report cancellation, byte retention, independent stops and ownership. Complete product npm test: 98 passed.

<a id="dev-note"></a>
## Dev Note

None.
