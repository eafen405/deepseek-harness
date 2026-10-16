---
kind: upgrade-guide
description: "Older readers reject Sessions containing required background-job lifecycle and report events."
---

# Background-job Session facts

English | [中文](guide.zh.md)

## Change

`tool-jobs` now writes required `jobs/lifecycle` and `jobs/report` Session events. Older readers refuse these unknown event names before mutation. Task identity combines the registry generation and ordinal job id; a Host restart does not resume processes.

## Migration

1. Upgrade every reader of Sessions written by the updated `tool-jobs`; keep writer and reader Harness versions aligned.
2. Derive task and report history from the new facts together with existing inbox and turn events. Treat jobs absent from the current registry as unavailable.
3. Verify `job_output`, `job_list` and `job_kill` in the updated composition. The persistence acknowledgement records same-version compatibility and verification.
