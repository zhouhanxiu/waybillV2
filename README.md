# 万能导入 V4 —— 异步事件驱动 · 全链路可观测

> **考试版本**：V4.0（异步事件驱动与可观测性版）  
> **考试日期**：2026/08/03  
> **部署地址**：https://20260704155001.vercel.app  
> **GitHub**：https://github.com/zhouhanxiu/waybillV2

## 1. 考试目标

将 V2 同步阻塞式下单流程重构为**异步事件驱动链路**，支撑 10,000 单/分钟的高并发导入，同时建设全链路可观测性。

**核心指标**：
- 上传接口 P95 ≤ 1 秒（立即返回 task_id）
- 10,000 行全链路处理 ≤ 60 秒
- MTTD（故障定位时间）≤ 1 分钟

---

## 2. 技术架构

```
上传 xlsx ──▶ POST /api/import-tasks
                │ 同事务：创建任务 + 写入 Outbox 事件
                │ P95 ≤ 1s 返回 { task_id, trace_id, status, total_rows }
                ▼
         event_outbox (pending)
                │
         Outbox Dispatcher (dispatchOnce)
                │
                ▼
         QStash 消息队列 ──▶ POST /api/worker/qstash (验签 + Redis 幂等锁)
                │
                ▼
         Worker: processUnit (PG 原子抢占 batch)
                ├─ 复用 V2 规则引擎解析
                ├─ 批量 SKU 校验 (超 3s 降级)
                ├─ 批量 UPSERT waybills
                ├─ 写行级错误 → import_task_errors
                └─ 写性能日志 → batch_performance_log
                │
                ▼
         前端轮询 /api/import-tasks/:taskId (1~2s)
         监控看板 /monitor-v4 (4 区面板)
         Trace 搜索 /traces (全链路检索)
```

| 组件 | 技术选型 | 用途 |
|------|----------|------|
| 框架 | Next.js 16 App Router + TypeScript | 全栈 |
| 部署 | Vercel | Serverless |
| 数据库 | PostgreSQL (Neon) | 真相源 |
| 消息队列 | Upstash QStash | 可靠消息投递 |
| 缓存 | Upstash Redis (可选) | 幂等锁 + 进度缓存 |
| AI | 智谱 GLM-4.5 Air | 辅助规则生成（不参与导入主链路） |

---

## 3. 快速开始

### 3.1 本地启动

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

### 3.2 环境变量

```bash
POSTGRES_URL=postgres://...              # Neon/Supabase
QUEUE_BACKEND=qstash                     # qstash | memory
QSTASH_TOKEN=eyJ...                      # Upstash QStash
QSTASH_CURRENT_SIGNING_KEY=sig_...
QSTASH_NEXT_SIGNING_KEY=sig_...
QSTASH_WORKER_URL=https://<domain>/api/worker/qstash
REDIS_REST_URL=https://...               # 可选
REDIS_REST_TOKEN=...
UNIT_ROW_LIMIT=1000                      # 处理单元大小
CRON_TOKEN=...                           # Cron 鉴权
```

### 3.3 数据准备

```bash
# 生成 20,000 SKU 主数据 + 10,000 行压测 Excel
pnpm seed:data

# 部署后初始化数据库表
curl -X POST https://<domain>/api/init-db

# 写入 SKU 主数据
curl -X POST https://<domain>/api/seed-sku
```

### 3.4 压测

```bash
# 远程触发（推荐）
curl https://<domain>/api/loadtest

# 查看压测报告
curl https://<domain>/api/loadtest/report?taskId=<id>
```

### 3.5 自动化测试

```bash
pnpm test                    # 运行所有测试
node scripts/exam-test.mjs   # 考试验收脚本
```

---

## 4. 考试交付物清单

| # | 考试要求 | 交付物 | 位置 |
|---|----------|--------|------|
| 1 | 在线地址 | https://20260704155001.vercel.app | Vercel 部署 |
| 2 | 源码仓库 | https://github.com/zhouhanxiu/waybillV2 | GitHub |
| 3 | 压测数据脚本 | 生成 20,000 SKU + 10,000 行 Excel | `scripts/seed-data.ts` |
| 4 | 10,000 行压测文件 | 含 2% 非法 SKU 用于错误定位验证 | `test-data/10000-orders.xlsx` |
| 5 | 压测报告 | 证明 10,000 行 ≤ 60 秒 | `docs/LOADTEST.md` |
| 6 | 架构设计文档 | 异步任务流程图、Outbox、批量处理策略 | `docs/REDESIGN.md` |
| 7 | 重构假设说明 | 覆盖 12 项假设（模块十一要求） | `docs/REDESIGN.md` |
| 8 | 接口文档 | 上传/进度/错误/Trace/监控 | `系统间接口文档.md` |
| 9 | README | 本地启动、环境变量、部署、压测说明 | `README.md`（本文） |
| 10 | 演示访问 | 导入页 `/`、任务页 `/tasks`、监控页 `/monitor-v4` | 无需账号 |

---

## 5. 功能模块

### 模块一：压测数据准备 ✅

- `scripts/seed-data.ts`：一键生成 20,000 SKU + 10,000 行 Excel
- 可重复执行，UPSERT 避免脏数据增长
- SKU 格式：`SKU_00001` ~ `SKU_20000`
- 压测文件含 2% 非法 SKU 验证错误定位

### 模块二：上传即返回 ✅

- `POST /api/import-tasks`：P95 ≤ 1s 返回 task_id
- 同事务创建任务 + Outbox 事件
- 按钮防重复点击

### 模块三：Outbox 可靠投递 ✅

- 任务创建与 Outbox 写入同数据库事务
- Dispatcher 轮询 pending 事件投递到 QStash
- 投递状态：pending → sent / failed
- 宕机恢复后可继续投递

### 模块四：Worker 异步处理 ✅

- 复用 V2 规则引擎，不硬编码
- 批量 SKU 校验（IN 查询）
- 批量 UPSERT 运单
- 行级错误写入 import_task_errors
- 性能日志写入 batch_performance_log
- 原子更新进度

### 模块五：处理单元幂等 ✅

- Redis 分布式锁（task_id + unit_id）
- PG 原子抢占 batch（`FOR UPDATE SKIP LOCKED`）
- 批量 UPSERT 基于稳定业务键
- 已完成单元快速返回

### 模块六：精细化错误记录 ✅

- 8 种错误码：E001(SKU不存在) ~ E008(格式不支持)
- 包含批次、行号、字段、脱敏原始值、错误原因
- 前端支持按批次/错误码筛选和分页

### 模块七：任务进度页 ✅

- 展示：文件名、task_id、trace_id、状态、进度、吞吐量
- 轮询 1~2 秒刷新
- 降级状态明确标注

### 模块八：监控看板 ✅

| 面板 | 内容 |
|------|------|
| 实时吞吐量 | 过去 5 分钟每分钟入库行数（折线图） |
| 队列积压深度 | 等待处理批次数，超阈值预警 |
| 阶段耗时分布 | 解析/规则/校验/写入 P50/P95/P99 |
| 错误类型分布 | 各错误码占比，可点击跳转 |

### 模块九：全链路 Trace ✅

- 按 task_id / trace_id / 文件名 / 行号 / 错误码搜索
- 时间线展示：上传 → Outbox → 入队 → Worker 处理 → 完成
- 失败节点展示详细信息

### 模块十：容灾降级 ✅

- SKU 校验超时 3s 自动降级
- 降级模式跳过 SKU 主数据校验，仅做格式校验
- 前端明确提示：⚠️ SKU 校验已降级
- 服务恢复后新任务自动恢复正常

---

## 6. 数据模型

### 新增表（V4）

| 表名 | 用途 |
|------|------|
| `sku_master` | SKU 主数据（≥20,000 条） |
| `import_tasks` | 导入任务主表 |
| `import_task_batches` | 处理单元状态表 |
| `import_task_errors` | 行级错误明细 |
| `event_outbox` | 本地可靠事件表 |
| `batch_performance_log` | 处理单元性能日志 |
| `trace_events` | 链路时间线事件 |

### 关键索引

- `sku_master.sku_code` UNIQUE
- `import_tasks(status, created_at)`
- `import_task_batches(task_id, unit_id)` UNIQUE
- `import_task_errors(task_id, unit_id)`
- `import_task_errors(error_code)`
- `event_outbox(status, next_retry_at)`
- `batch_performance_log(task_id, unit_id)`
- `trace_events(trace_id, occurred_at)`

---

## 7. API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/import-tasks` | 上传文件，创建异步任务 |
| GET | `/api/import-tasks/:taskId` | 查询任务进度 |
| GET | `/api/import-tasks/:taskId/errors` | 查询错误明细（支持筛选分页） |
| GET | `/api/import-tasks/:taskId/batches` | 查询批次性能 |
| GET | `/api/traces` | Trace 搜索 |
| GET | `/api/traces/:traceId` | Trace 详情时间线 |
| GET | `/api/import-monitor/summary` | 监控聚合（吞吐/积压/耗时/错误） |
| GET | `/api/import-monitor/phase` | 阶段耗时分布（P50/P95/P99） |
| POST | `/api/worker/qstash` | QStash 回调（Worker 入口） |
| POST | `/api/admin/dispatch-outbox` | 手动推进 Outbox |
| POST | `/api/init-db` | 初始化数据库表 |
| POST | `/api/seed-sku` | 灌入 SKU 主数据 |
| GET | `/api/loadtest` | 触发压测 |
| GET | `/api/loadtest/report` | 查看压测报告 |
| GET | `/api/health` | 健康检查 |

---

## 8. 项目结构

```
src/
├── app/
│   ├── page.tsx                          # 首页（上传 + AI 分析）
│   ├── tasks/[taskId]/page.tsx           # 任务进度页
│   ├── monitor-v4/page.tsx               # 监控看板（4 面板）
│   ├── traces/page.tsx                   # Trace 搜索
│   └── api/
│       ├── import-tasks/                 # 上传 + 进度 + 错误 + 批次
│       ├── worker/qstash/route.ts        # QStash Worker 入口
│       ├── worker/cron/route.ts          # Cron 兜底恢复
│       ├── import-monitor/               # 监控聚合
│       ├── traces/                       # Trace 搜索
│       ├── loadtest/                     # 压测
│       ├── admin/dispatch-outbox/        # Outbox 管理
│       ├── analyze/route.ts              # AI 分析
│       └── parse/route.ts               # 文件解析
├── lib/
│   ├── db/                               # 数据库 + 迁移
│   ├── queue/                            # Outbox + Dispatcher
│   ├── worker/                           # processUnit (核心 Worker)
│   ├── ai.ts                             # 大模型调用
│   └── parser/                           # 规则引擎
scripts/
├── seed-data.ts                          # 压测数据生成
├── loadtest.ts                           # 压测脚本
├── exam-test.mjs                         # 考试验收脚本
├── exam-test-v3.mjs                      # V3 验收脚本（V4 不涉及）
└── report-perf.ts                        # 性能报告生成
docs/
├── REDESIGN.md                           # 重构假设说明
├── LOADTEST.md                           # 压测报告
└── RESTRUCTURE-ASSUMPTIONS.md            # 历史假设文档
```

---

## 9. 环境变量完整列表

| 变量 | 必填 | 说明 |
|------|------|------|
| `POSTGRES_URL` | ✅ | PostgreSQL 连接串 |
| `QUEUE_BACKEND` | ✅ | `qstash` / `memory` |
| `QSTASH_TOKEN` | ✅ (qstash) | QStash REST API Token |
| `QSTASH_CURRENT_SIGNING_KEY` | ✅ (qstash) | 回调验签 |
| `QSTASH_NEXT_SIGNING_KEY` | ✅ (qstash) | 回调验签（轮换） |
| `QSTASH_WORKER_URL` | ✅ (qstash) | Worker 回调地址 |
| `REDIS_REST_URL` | 可选 | Upstash Redis URL |
| `REDIS_REST_TOKEN` | 可选 | Upstash Redis Token |
| `UNIT_ROW_LIMIT` | 可选 | 处理单元行数（默认 1000） |
| `CRON_TOKEN` | 可选 | Cron 接口鉴权 |
| `OPENAI_API_KEY` | 可选 | AI 规则生成 |
| `OPENAI_BASE_URL` | 可选 | AI API 地址 |
| `AI_MODEL` | 可选 | AI 模型名 |
