---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-job-lifecycle

[English](2026-10-16-job-lifecycle.md) | 中文

## 概述

在原所属 Session 记录进程代际任务生命周期和实际完成入队方式，并为完成来源增加可选结构化任务关联。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有日志仍有效，当前读取器可读取。新增必需 jobs/lifecycle、jobs/report 判别项不在旧读取器的已知事件表中，旧读取器在变更前拒绝，而不会忽略工作事实后错误重建。可选来源关联不改变模型内容或旧来源含义。Session 格式保持 v4；这些事实不恢复进程或输出环。

<a id="verification"></a>
## 验证

原生 jobs/controller/shell 定向测试 301 个通过。干净 worktree 的完整 host、client 构建通过。实际产品 profile 使用真实受限进程、Session JSONL 和本地 HTTP/SSE：5 个测试通过，覆盖重启不可用身份、报告取消、字节保留、双停止独立与归属。完整产品 npm test：98 个通过。

<a id="dev-note"></a>
## 开发备注

无。
