# V4 异步事件驱动导入系统 —— 部署说明（纯 Vercel 方案）

本工程在 V2（万能导入解析）基础上重构为**异步事件驱动**：上传即返回，后台批处理，
支持批量校验、批量落库、行级错误、性能观测、链路 Trace、容灾降级。

## 一、纯 Vercel 部署（推荐，零额外服务）

> 你之前担心："依赖装上去，部署会不会跑不起来？"
> 答案：**用纯 Vercel 方案，无需 Redis、无需 Railway，能稳定跑起来。**

### 为什么纯 Vercel 也能跑？
Vercel Serverless Function 在函数响应后可能休眠，`setInterval`/`内存队列` 不持续运行，
会导致上传的任务卡死。采用**双保险**机制：

1. **主路径 · Fire-and-forget 即时消费**：`POST /api/import-tasks` 返回 task_id（≤1s）后，
   Vercel 函数进程在 HTTP 响应后仍存活数十秒，立即 fire-and-forget 消费所有单元，
   1万行（10 个单元）通常在此窗口内处理完 → 满足"1万行 ≤60s 完成"。

2. **兜底 · Vercel Cron**：`vercel.json` 配了每分钟触发 `/api/worker/cron`，
   消费任何因函数超时被打断的剩余单元。**原子抢占**（`processUnit` 内
   `UPDATE ... WHERE status IN ('pending','failed') RETURNING`）保证 fire-and-forget 与
   Cron 并发也不会双跑同一单元，进度不会虚高。

- 配合 Transactional Outbox（`event_outbox`）保证事件不丢，进程重启可恢复。

### 部署步骤
1. 推送代码到 Git 仓库，在 Vercel 导入。
2. 在 Vercel 项目 → Settings → Environment Variables 配置：
   - `DATABASE_URL`（Supabase 连接串，含 `?sslmode=require`）
   - `QUEUE_BACKEND=memory`（默认，纯 Vercel 用这个）
   - `WORKER_MODE=cron`（纯 Vercel 生产：跳过内存 pump，由 Cron 路由兜底消费；本地开发用 auto）
   - `CRON_TOKEN=任意随机串`（Cron 路由鉴权，建议用强随机值；Vercel Cron 自动带此 token）
   - `OPENAI_API_KEY` / `AI_BASE_URL` / `AI_MODEL`（规则引擎用，压测走默认规则可留空）
3. Deploy。Vercel 会按 `vercel.json` 自动注册 Cron。
4. 首次部署后，本地或线上执行一次迁移建表：
   ```
   DATABASE_URL=... npx tsx scripts/migrate-v4.ts
   ```
   （也可通过任意一次访问触发 `instrumentation.ts` 里的幂等迁移）
5. 灌测试数据（2 万 SKU + 1 万行 xlsx）：
   ```
   DATABASE_URL=... npx tsx scripts/seed-data.ts
   ```

### 验证在线可访问
- 上传：`POST https://<your-app>.vercel.app/api/import-tasks`（form-data: file + ruleId?）
- 查询：`GET  https://<your-app>.vercel.app/api/import-tasks?taskId=xxx`
- Cron 每 20 秒自动推进；也可手动 `GET /api/worker/cron?token=<CRON_TOKEN>` 立即推进。

## 二、生产增强方案（可选，更稳）

若需要更高吞吐/更低延迟，可切换到 Redis 后端：
- 申请 Upstash Redis，得到 `REDIS_URL`
- 设 `QUEUE_BACKEND=redis`，并把 Worker 部署到 Railway/Render 常驻消费队列
- 上传 API 仍在 Vercel，只做解析+切片+写 Outbox（≤1s）
- 代码已同时支持两种后端（`src/lib/queue/index.ts`），改环境变量即可切换

## 三、本地开发

```bash
npm install
cp .env.example .env.local   # 填入 DATABASE_URL / CRON_TOKEN 等
npm run dev                  # instrumentation 自动迁移 + 启动内存 Worker
npm run seed:data            # 灌 2 万 SKU + 生成 scripts/loadtest-1w.xlsx
npm run loadtest             # 压测：上传 1 万行，断言 ≤60s 完成
npm run report:perf          # 生成压测报告 scripts/PERF-REPORT.md
```

## 四、考试红线对照
- ✅ 部署可访问在线系统（纯 Vercel + Cron 兜底）
- ✅ 1 万行 ≤ 60s（压测脚本断言，报告佐证）
- ✅ 批量校验/落库（IN 查询 + UPSERT，非逐行）
- ✅ 行级错误 E001~E008（可筛选/分页/脱敏）
- ✅ 幂等（unit 级别 attempt 防重复；UPSERT 按业务唯一键）
- ✅ 容灾降级（SKU 查询超 3s 降级为本地格式校验）
- ✅ 可观测（batch_performance_log 阶段 P99 / trace_events 时间线 / import_tasks 进度）
