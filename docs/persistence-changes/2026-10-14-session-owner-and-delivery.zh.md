---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-session-owner-and-delivery

[English](2026-10-14-session-owner-and-delivery.md) | 中文

## 概述

为会话头加入可选的持久归属 owner，并让它贯穿创建元数据、物理 JSONL 头部、v4 头部编解码器与查询侧头部投影。新增 delivery/message surface 事件，承载另一个会话投递进本会话的消息，并新增 delivered-message 这一 assistant 消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
    previous: "2026-10-13-user-rpc-principal"
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
    previous: "2026-10-13-user-rpc-principal"
    after: "0208cfb531359fef324f0b6bd7e62b05a476090a3a474352051ed40b6dcc18ae"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "2a3000d006871fc6fa47f50d9ca981aaef048f53509ed9f78f77100d2ce63024"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "96537dbac5eff41560969c2163c00a81c4caa6c5b1652c8b893cedf7d5ffaff4"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两项改动都是已安装 v4 代的相容扩展，因此 SESSION_FORMAT_VERSION 保持 4，不新增也不改写任何迁移边。owner 为可选：归属出现之前写下的头部仍可无 owner 解码，格式层不默认、不猜测归属，而存在的 owner 必须是非空字符串。它由 v4 编解码器自己准入，在把共享键委托给冻结的 released v2 编解码器之前剥离该 v4 专有键、之后再回填，因此 released v2 头部契约不变，已发布的 v0–v3 事实也未被改写。要求归属、从而拒绝无归属会话，仍是产品与授权边界的决定。delivery/message 是新增的必需事件：它进入已安装事件词表，不认识它的 reader 必须拒绝重建会话，而不是静默丢弃模型可见历史；它永不是 ignorable。它刻意不复用 assistant/message，因为后者必须携带 turn、step 与内嵌 provider stream，而投递消息背后没有本会话的模型尝试；伪造这些字段会报告一个从未存在的模型来源，因此 append 校验会拒绝携带 turn、step、stream 的负载。事件命名确保不会与 session-log-deepseek/delivery-accepted 混淆——后者是形如 { sessionId, sessionFormatVersion?, throughSeq } 的增量上传水位标记，不指向任何消息。AssistantMessage.source 现在在模型来源之外接纳 delivered-message 来源；模型来源的历史仍保留其 provider、model 与 replay 行为，投递消息的 replay 为 undefined，请求转换仍会渲染其正文。投递正文进入会话检索提取。

<a id="verification"></a>
## 验证

corepack pnpm@11.28.5 run verify-persistence-catalog：up to date。run verify-session-format-catalog：generated.ts 为最新。run verify-persistence-formats：v0 至 v4 已验证（5 份完整引用）。run verify-persistence-releases：26 条记录、25 条相邻迁移已验证。run typecheck：见证据日志。清代理后运行 vitest，覆盖 packages/core/session/tests、packages/core/agent/tests、packages/session-query/session-query/tests、packages/llm/llm/tests、packages/llm/llm-deepseek/tests、packages/session/session-format/tests、packages/session/session-format-catalog/tests、packages/session/session-persistence/tests：70 个文件、1662 个用例通过。同一条命令在不清除本机全局代理环境时，有 5 个文件、93 个用例失败，全部是本地 HTTP 测试——Node 的 fetch 把 loopback 请求发往 127.0.0.1:7890；清掉 http_proxy/https_proxy/HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NODE_USE_ENV_PROXY 后全部通过。重新生成持久化目录刷新了生成目录与 known-event-types.ts；历史格式索引只改动了 Current checkout 一行（根/类型数 63/597 变为 64/606），已发布各代的引用均未改变。

<a id="dev-note"></a>
## 开发备注

无。
