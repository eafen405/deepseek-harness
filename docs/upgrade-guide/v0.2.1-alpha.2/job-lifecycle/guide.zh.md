---
kind: upgrade-guide
description: "旧读取器拒绝包含必需后台任务生命周期和报告事件的 Session。"
---

# 后台任务 Session 事实

[English](guide.md) | 中文

## 变更

`tool-jobs` 现写入必需的 `jobs/lifecycle` 和 `jobs/report` Session 事件。旧读取器在任何变更前拒绝这些未知事件名。任务身份结合注册表代际与序号任务 ID；Host 重启不恢复进程。

## 迁移

1. 升级所有读取新版 `tool-jobs` 所写 Session 的读取器，保持写入与读取 Harness 版本一致。
2. 结合新事实与已有 inbox、turn 事件重建任务及报告历史，将当前注册表中不存在的任务视为不可用。
3. 在更新后的装配中验证 `job_output`、`job_list` 和 `job_kill`。持久化确认记录说明同版本兼容性和验证结果。
