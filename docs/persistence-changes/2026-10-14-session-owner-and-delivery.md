---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-session-owner-and-delivery

English | [中文](2026-10-14-session-owner-and-delivery.zh.md)

## Summary

Adds an optional durable Session owner to the Session header and stores it through creation metadata, the physical JSONL header, the v4 header codec, and the query-facing header projection. Adds the delivery/message surface event, which carries a message another Session delivered into this one, together with a new delivered-message assistant message source.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-session-owner-and-delivery
baseline: false
changes:
  - root: "JsonlHeaderLine"
    previous: "2026-09-11-initial"
    after: "5d00d6b461063f2c2bd6633d2d1765f100fe1a4a9651f53d2b4d5e3203c3af76"
    decision: same-version
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "cd9d35eaa760a75ee113b8bafe9ad0ff0bee068162e0050265cb1a227e9c2bf4"
    decision: same-version
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "e5191bfd864f7fce0925a49543d264fda77f3b0c2d1318d9ae6f7e368603c2c9"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "5cab60df38577cab7d4812ad4049ed3351ae23278181f6d45c289e8d33b0e8cc"
    decision: same-version
  - root: "event:delivery/message"
    previous: null
    after: "d0bf3f4a24ee256aed92733c61ab11ca99c00000967cb6dcc5dbb126dc1a4aca"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "0208cfb531359fef324f0b6bd7e62b05a476090a3a474352051ed40b6dcc18ae"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "2a3000d006871fc6fa47f50d9ca981aaef048f53509ed9f78f77100d2ce63024"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "96537dbac5eff41560969c2163c00a81c4caa6c5b1652c8b893cedf7d5ffaff4"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both changes are compatible extensions of the installed v4 generation, so SESSION_FORMAT_VERSION stays 4 and no migration edge is added or rewritten. `owner` is optional: a header written before ownership existed still decodes without one, the format layer never defaults or guesses an owner, and a present owner must be a nonempty string. It is admitted by the v4 codec itself, which strips the v4-owned key before delegating the shared keys to the frozen released v2 codec and restores it afterwards, so the released v2 header contract is unchanged and already-published v0 through v3 references are untouched. Requiring ownership, and therefore refusing an ownerless Session, remains a product and authorization decision. `delivery/message` is a new REQUIRED event: it is added to the installed event vocabulary, so a reader that does not recognize it refuses to reconstruct the Session instead of silently dropping model-visible history; it is never ignorable. It deliberately does not reuse assistant/message, because that event must carry turn, step, and an embedded provider stream, and a delivered message has no model attempt behind it; fabricating those fields would report a model origin that never existed, so the append validator refuses a payload carrying turn, step, or stream. The event is named so that it cannot be confused with session-log-deepseek/delivery-accepted, which is an incremental-upload watermark of the form { sessionId, sessionFormatVersion?, throughSeq } and names no message. AssistantMessage.source now admits the delivered-message source alongside the model source; model-sourced history keeps its provider, model, and replay behaviour, replay remains undefined for a delivered message, and request conversion still renders its content. Delivery text joins session search extraction.

<a id="verification"></a>
## Verification

corepack pnpm@11.28.5 run verify-persistence-catalog: up to date. run verify-session-format-catalog: generated.ts up to date. run verify-persistence-formats: v0 through v4 verified (5 complete references). run verify-persistence-releases: 26 records, 25 adjacent transitions verified. run typecheck: see the evidence log. Proxy-cleared vitest over packages/core/session/tests packages/core/agent/tests packages/session-query/session-query/tests packages/llm/llm/tests packages/llm/llm-deepseek/tests packages/session/session-format/tests packages/session/session-format-catalog/tests packages/session/session-persistence/tests: 70 files, 1662 tests passed. The same command without clearing the machine's global proxy environment fails 93 tests in 5 files, all of them local-HTTP tests whose loopback requests Node's fetch sends to 127.0.0.1:7890; clearing http_proxy/https_proxy/HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NODE_USE_ENV_PROXY makes them pass. Regenerating the persistence catalog refreshed the generated catalogs and known-event-types.ts; the historical-format index changed only its Current checkout row (63/597 to 64/606 roots/types), leaving every released generation's reference unchanged.

<a id="dev-note"></a>
## Dev Note

None.
