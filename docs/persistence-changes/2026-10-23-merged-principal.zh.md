---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-23-merged-principal

[English](2026-10-23-merged-principal.md) | 中文

## 概述

确认上游 rc.2 为四个持久化事件来源新增的可选 `principal` 属性；合并后它与 fork 的 owner 与投递字段并存于同一形状。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

既有来源变体上的可选属性：写入早于它的日志仍可读取，不认识它的读取器会忽略它。不需要升版本。

<a id="verification"></a>
## 验证

`pnpm run verify-persistence-changes` 对该迁移分类，JSONL 持久化套件往返一条同时携带 owner 字段与 principal 属性的日志。

<a id="dev-note"></a>
## 开发备注

无。
