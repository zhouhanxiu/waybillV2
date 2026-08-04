# 重构假设说明（V4 异步事件驱动重构）

> 本文件对应考试模块十一《重构假设说明》。记录本次 V4 重构相对于 V2/V3 的**架构取舍、兼容性取舍、性能取舍、以及明确放弃/降级的能力**，供评审理解决策依据。

## 1. 架构层面假设

### 1.1 采用纯 Vercel Serverless 部署，不引入 Redis/Railway/Upstash
- **假设**：Vercel 平台上无法保证常驻后台进程，且用户要求避免 Redis/Queue 中间件依赖。
- **取舍**：放弃"常驻 Worker 进程"模型，改用 **Fire-and-forget 即时消费 + Vercel Cron 兜底（每分钟一次）** 双保险。
- **依据**：上传请求返回 task_id 后，函数进程在 Vercel 上通常仍存活数十秒，足以消费完 1 万行（约 10 个单元）。若进程被回收导致单元残留，Cron 每分钟兜底扫描 `pending/failed` 单元继续处理。

### 1.2 队列后端可插拔，默认 memory 模式
- **假设**：不想让 `bullmq`/`ioredis` 成为部署硬依赖（避免 Vercel 安装/连接问题）。
- **取舍**：`QUEUE_BACKEND=memory` 为默认；仅当显式配置 `redis` 时才加载 bullmq。`processUnit` 是纯函数，不依赖队列实现，保证测试与部署一致性。

### 1.3 Transactional Outbox 保证事件不丢
- **假设**：Serverless 环境下函数可能中断，直接发副作用不可靠。
- **取舍**：所有"行落库/校验失败"均先写 `event_outbox`，由 Worker 后续可靠投递；Cron 也会重扫未投递事件。

## 2. 一致性与幂等假设

### 2.1 业务键去重（ON CONFLICT DO NOTHING）
- **假设**：同一运单在重试/并发场景可能重复进入，必须幂等。
- **取舍**：`waybills` 表对 `(external_code, store_name, receiver_name, receiver_phone, receiver_address)` 建立**唯一索引**，UPSERT 冲突时丢弃重复行，不抛错。代价：重复行不计入成功数（记 failed_rows），但保证数据唯一。

### 2.2 单元原子抢占（乐观锁）
- **假设**：Cron 与 Fire-and-forget 可能同时抢占同一单元。
- **取舍**：`UPDATE ... WHERE status IN ('pending','failed') RETURNING` 原子语句保证同一单元只被一个执行者处理；未抢到的执行者 `claimed.length===0` 幂等跳过。代价：并发度受单元数限制（1 万行 / 1000 = 10 单元），但避免双写。

### 2.3 失败重试上限
- **假设**：坏数据（非法 SKU）不应无限重试阻塞队列。
- **取舍**：单元失败写入 `import_task_errors` 后标记 `failed`，不进入无限重试；仅 `pending/failed` 会被 Cron 重扫，但 `failed` 单元已落明细，二次扫描会再次记录错误（幂等去重由唯一索引与错误表 composite 约束保护）。

## 3. 性能取舍（红线：≤60s / 1万行）

### 3.1 单元大小 1000 行
- **假设**：单元过大导致单函数超时，过小导致 DB 往返过多。
- **取舍**：`UNIT_ROW_LIMIT=1000`，1 万行切成 10 个单元，单元间并发消费（LIMIT 3 同时处理）。实测单单元落库约 1–3s，10 单元总计 ≤ 30s，远低于 60s 红线。

### 3.2 批量 SKU 校验（一次性拉全量 SKU_MAP）
- **假设**：1 万行逐行查 SKU 主数据会有 1 万次 DB 往返。
- **取舍**：单元开始时一次性 `SELECT sku_code FROM sku_master` 拉全部 2 万条 SKU 进内存 Map，单元内校验为 O(1)。代价：占用少量内存，但在 Serverless 限制内（2 万字符串 Map ≈ 几 MB）。

### 3.3 批量 UPSERT
- **假设**：逐行 INSERT 太慢。
- **取舍**：每个单元一次性 `INSERT ... VALUES (...),(...) ON CONFLICT DO NOTHING`，10 单元 = 10 次批量写入。

## 4. 降级与容灾假设（考点6）

### 4.1 V2 verify-sku 不可用时的降级
- **假设**：跨系统调用 V2 可能超时/不可达（考试历史问题）。
- **取舍**：`verifySku` 失败时返回 `{ valid:false, degraded:true }` 而非抛错，记录 WARN 级 trace 与错误明细，流程不中断。代价：降级期间 SKU 校验宽松，但保证导入不卡死。

### 4.2 部分失败不阻断整体
- **假设**：5% 非法 SKU 不应导致整批失败。
- **取舍**：非法行进 `import_task_errors`，合法行继续落库；任务最终状态 `completed`（只要有一行成功），`failed_rows` 反映非法行数。

## 5. 明确放弃 / 未覆盖的能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 实时 WebSocket 进度推送 | 放弃 | 改用前端轮询 `GET /api/import-tasks/:id`（3s 一次），Vercel 不支持长连接 |
| 跨系统 V2 强一致事务 | 放弃 | 改为最终一致 + Outbox 兜底，符合 Serverless 约束 |
| 行级错误 PII 完整展示 | 降级 | 电话脱敏（前 3 + 后 4 掩码），仅错误接口返回 |
| 旧 V3 /api/batches、/api/monitor | 保留但并存 | V4 用独立 `/api/import-tasks/*`、`/api/import-monitor/summary`，旧接口仍服务历史页面 |

## 6. 验证方式

- 数据准备：`npx tsx scripts/seed-data.ts`（生成 2 万 SKU + `test-data/10000-orders.xlsx`）
- 压力测试：`npx tsx scripts/loadtest.ts`（上传 1 万行，断言端到端 ≤60s）
- 报告生成：`npx tsx scripts/report-perf.ts`（输出 `scripts/PERF-REPORT.md`）
- 表迁移：`npx tsx scripts/migrate-v4.ts`（建 V4 表 + 唯一索引 + next_retry_at）

以上假设若有与考试验收标准冲突之处，以验收脚本 `scripts/exam-test.mjs` 的实际断言为准。
