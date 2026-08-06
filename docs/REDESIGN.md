# V4 异步事件驱动可观测性重构 —— 重构假设说明

本文档对应考试要求「列出原系统（V2/V3）所有字段、接口的重构假设」。

## 1. 总体重构假设

| 项 | 原系统假设 | V4 重构假设 |
|---|---|---|
| 导入模型 | 同步请求-响应，单进程长事务 | 异步事件驱动：上传即返回 `task_id`，后台 QStash 队列消费 |
| 状态存储 | 内存 / 单表 | PostgreSQL 多表（`import_tasks` / `import_task_batches` / `event_outbox` / `batch_performance_log` / `trace_events` / `import_task_errors`） |
| 队列 | 无（同步串行） | QStash（持久化、重试、幂等投递）+ Outbox 模式保证不丢消息 |
| 缓存/去重 | 无 | Upstash Redis 旁路：QStash 回调幂等锁 + 监控进度缓存（不存真相，PG 为唯一真相源） |
| 可观测性 | 无 | 每单元每阶段写 `trace_events` + `batch_performance_log`，P50/P95/P99 可查 |
| 降级 | 校验失败即中断 | SKU 校验超 3s 自动降级为本地格式校验，流程不中断 |

## 2. 字段映射假设（源 Excel → `waybills`）

| 源字段 | 类型 | 假设 |
|---|---|---|
| sku | string | **必填**；在 `sku_master` 存在且 `is_active` 为 true 才合法，否则记 `E001` |
| external_order_no | string | 必填；与 `waybills.external_order_no` 唯一约束，重复记 `E005` |
| quantity | number | > 0，否则 `E004` |
| receiver_name | string | 必填，否则 `E002` |
| receiver_phone | string | 中国大陆手机 `^1[3-9]\d{9}$`，否则 `E003` |
| receiver_address | string | 必填，否则 `E002` |
| remark | string? | 可选 |
| 文件大小 | — | ≤ 20MB，否则 `E008` |
| 单号前缀 | — | 压测数据用 `EXT` 前缀，避免与生产冲突 |

## 3. 接口重构假设

| 原接口 | V4 对应 | 假设 |
|---|---|---|
| `POST /api/waybills/sync`（同步 30 条） | `POST /api/import-tasks` | 改为异步：解析后切片成单元（每单元 1000 行），fire-and-forget 返回 `task_id`，SLA ≤ 1s |
| `POST /api/waybills/verify-sku` | 内部批量 `verifySkuBatch` | 不再单条 HTTP 调用，改为单元内 `IN` 查询一次性校验，超 3s 降级 |
| `GET /api/waybills/exception-status` | `GET /api/import-tasks/{id}/errors` + `/batches` | 行级错误落 `import_task_errors`，按 `error_code` 聚合 |
| — | `POST /api/worker/qstash` | 新增：QStash 回调入口，验签 + Redis 幂等锁 + PG 原子抢占 |
| — | `GET /api/import-monitor/summary` `/phase` | 新增：4 区监控（吞吐/阶段耗时/队列积压/错误分布） |
| — | `GET /api/traces` | 新增：按 `task_id`/`trace_id`/`error_code` 检索全链路 Trace |

## 4. 并发与幂等假设

- **QStash 投递**：至少一次（at-least-once），可能重复投递 → 用三层幂等：
  1. `event_outbox` 状态机（pending→sent），`dispatchOnce` 保证只发一次
  2. `import_task_batches` 原子抢占 `UPDATE ... WHERE status IN ('pending','failed') RETURNING`，并发下仅一个 worker 拿到单元
  3. Redis `unit:lock:{unitId}` NX EX 90s，防回调重试在抢占窗口内的重复消费
- **并发度**：默认单批次 `LIMIT` 处理 3 个单元（受 Vercel Serverless 并发约束），可通过 `CRON_BATCH_LIMIT` 调整

## 5. 性能目标假设（考试 SLA）

| 指标 | 目标 | 实现手段 |
|---|---|---|
| 上传返回 `task_id` | ≤ 1s | 仅解析 + 切片 + 写库 + 投递 outbox，不处理业务 |
| 1 万行完成 | ≤ 60s | 10 单元 × 1000 行并行 QStash 消费 + 批量 UPSERT |
| SKU 校验 | 批量 `IN` 查询 | 替代逐条 HTTP，N+1 消除 |
| 降级模式 | 校验超 3s | 降级为本地格式校验，流程不中断 |

## 6. 外部依赖假设

- PostgreSQL：Neon / Supabase，连接走 `POSTGRES_URL`（serverless pooled）
- QStash：Upstash，`QSTASH_TOKEN` + `QSTASH_CURRENT/NEXT_SIGNING_KEY` 验签
- Redis：Upstash REST，`REDIS_REST_URL` / `REDIS_REST_TOKEN`（可选，缺失时自动降级为无缓存）
- 部署：Vercel（Hobby 计划，无 cron，改用 QStash 触发）
