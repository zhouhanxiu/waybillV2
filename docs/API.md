# API 接口契约（考试 V4：异步事件驱动可观测性）

> 基础地址：`https://20260704155001.vercel.app`
> 所有接口返回 `application/json`。错误统一结构：`{ "error": string, "code": string }`。

---

## 模块一：异步导入（Fire-and-Forget）

### `POST /api/import-tasks`
上传 Excel 触发导入，立即返回 `task_id`/`trace_id`，后端异步处理（≤1s 返回）。

**请求**
- `Content-Type: multipart/form-data`
- 字段：`file`（xlsx 文件）、`ruleId`（可选，默认 `default`）

**响应 200**
```json
{
  "taskId": "task-1785996095527-c8f7bu",
  "traceId": "trace-xxxxxxxx",
  "totalRows": 10000,
  "totalUnits": 1,
  "acceptedInMs": 29136,
  "backend": "qstash"
}
```
| 字段 | 说明 |
|---|---|
| taskId | 任务唯一 ID（用于后续查询） |
| traceId | 全链路追踪 ID（Trace 检索用） |
| totalRows | 解析出的总行数 |
| totalUnits | 切片单元数（默认 1000 行/单元） |
| acceptedInMs | 接收并投递耗时（应 < 1000ms 为优，压测含解析+投递） |
| backend | 队列后端：`qstash`（异步）或 `sync`（本地内存，降级） |

---

## 模块二/三：任务与单元查询

### `GET /api/import-tasks`
任务列表（最近 50 条）。

**响应 200**
```json
{ "tasks": [ { "id", "file_name", "status", "total_rows", "success_rows", "error_rows", "created_at", "finished_at" } ] }
```

### `GET /api/import-tasks/[taskId]`
任务详情 + 汇总 + 性能聚合。

**响应 200**
```json
{
  "task": { "id", "file_name", "status", "degraded": false, "trace_id", "total_rows", "success_rows", "error_rows", "finished_at", "duration_ms" },
  "summary": {
    "total_rows": 10000, "success_rows": 10000, "error_rows": 0, "processed_rows": 10000,
    "error_records": 0,
    "by_status": { "done": { "count": 1, "total_rows": 10000, "success_rows": 10000, "error_rows": 0, "processed_rows": 10000 } },
    "perf": { "units": 1, "total_ms": 14321, "avg_ms": 14321, "max_ms": 14321, "p95_ms": 14321 }
  }
}
```

### `GET /api/import-tasks/[taskId]/batches?page=1&pageSize=50`
单元（批次）列表，分页。

**响应 200**
```json
{ "batches": [ { "id", "unit_index", "status", "total_rows", "success_rows", "error_rows", "attempt", "created_at", "error_message" } ], "total": 1, "page": 1, "pageSize": 50 }
```

### `GET /api/import-tasks/[taskId]/errors?page=1&pageSize=50&level=ERROR&code=E003`
错误明细，支持 `level`（`ERROR`/`WARN`）、`code` 筛选，电话脱敏。

**响应 200**
```json
{ "errors": [ { "id", "row_number", "level", "error_code", "error_message", "receiver_name", "receiver_phone_masked", "sku_code" } ], "total": 0 }
```

---

## 模块五：监控 4 区

### `GET /api/import-monitor/summary?taskId=`
全局监控汇总（4 区）：吞吐、阶段耗时（P50/P95/P99）、积压深度、错误分布。支持可选 `taskId` 过滤单任务。

**响应 200**
```json
{
  "throughput": { "total_rows": 10000, "total_tasks": 1, "rps": 503.93 },
  "stagePerf": { "units": 1, "avg_ms": 14321, "max_ms": 14321, "p95_ms": 14321 },
  "backlog": { "pending": 0, "processing": 0, "failed": 0 },
  "errorDist": { "byCode": {}, "total": 0 },
  "recent": [ { "id", "file_name", "status", "total_rows", "success_rows", "error_rows", "created_at", "finished_at" } ],
  "byHour": [ { "hour": "10", "tasks": 1, "rows": 10000 } ]
}
```

### `GET /api/import-monitor/phase?taskId=`
积压深度 / 阶段耗时明细（实时）。

**响应 200**
```json
{ "phases": [ { "phase": "parse|sku_validate|db_upsert", "rows": 10000, "avgMs": 120, "p95Ms": 200 } ], "backlog": { "pending": 0, "processing": 0 } }
```

---

## 模块六：Trace 检索

### `GET /api/traces?traceId=&taskId=&errorCode=&limit=100`
全链路 Trace 事件检索。

**响应 200**
```json
{ "events": [ { "trace_id", "task_id", "unit_id", "span_name", "service", "status", "level", "message", "timestamp" } ] }
```

---

## 模块七/十：降级模式

降级由后端自动触发（`task.degraded=true`）：
- SKU 主数据校验超时（>3s）或不可用 → 跳过逐行 SKU 强校验，放行写入。
- QStash / Redis 不可用 → 回退 `sync`（内存）模式，保证导入不中断。

前端任务详情页在 `task.degraded=true` 时显示**降级横幅**明确告知用户。

---

## 压测接口

### `GET /api/loadtest?d=<deploy-tag>`
内部触发 1 万行压测（异步，不等完成返回 202）。`d` 为部署标识便于日志检索。

### `GET /api/loadtest/report`
返回压测报告数据（吞吐、P95、降级次数、错误率）。

---

## 运维接口

### `GET /api/init-db`
初始化数据库（V3 表 + V4 表，含 ALTER 补齐旧表列）。幂等。

### `GET /api/seed-sku`
生成 SKU 主数据（2 万条）写入 `sku_master`。

### `GET /api/health`
健康检查。
