/**
 * 队列抽象层（V4 异步事件驱动核心）
 * ---------------------------------------------------------------
 * 设计目标：本地零依赖可运行（默认 memory 模式），生产可切换到 Redis（BullMQ）。
 *
 * 两种后端：
 *  - "memory"：进程内队列 + 并发 Worker。适合本地开发 / 压测 / Vercel 演示。
 *             优点：无需 Redis；缺点：多实例不共享，重启丢队（但我们用 DB 持久化
 *             任务/单元状态做幂等恢复，因此可接受）。
 *  - "redis" ：BullMQ（ioredis/Upstash）。适合常驻 Worker 部署。
 *
 * 无论哪种后端，处理单元的最终状态都落在 import_task_batches（DB），
 * 由 processUnit() 幂等执行，因此队列仅负责"触发"，不负责"持久真相"。
 */

export type QueueBackend = "memory" | "redis";

export interface UnitJob {
  taskId: string;
  unitId: string;
  unitIndex: number;
}

type WorkerFn = (job: UnitJob) => Promise<void>;

const backend: QueueBackend =
  (process.env.QUEUE_BACKEND as QueueBackend) || "memory";

// ── memory 后端实现 ──────────────────────────────────────────────
const memoryQueue: UnitJob[] = [];
const memoryActive = new Set<string>();
let memoryWorkerCount = 0;
let memoryRunning = false;
let memoryConcurrent = 3;

function pumpMemoryQueue(worker: WorkerFn) {
  if (memoryRunning) return;
  memoryRunning = true;
  const tick = async () => {
    while (true) {
      if (memoryActive.size >= memoryConcurrent) {
        await sleep(20);
        continue;
      }
      const job = memoryQueue.shift();
      if (!job) break;
      memoryActive.add(job.unitId);
      worker(job)
        .catch((err) => console.error("[queue:memory] worker error", job, err))
        .finally(() => {
          memoryActive.delete(job.unitId);
        });
    }
    memoryRunning = false;
  };
  void tick();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── redis 后端实现（懒加载，避免无依赖时崩溃）──────────────────────
let bullQueue: any = null;
let bullWorker: any = null;

async function ensureBull() {
  if (bullQueue) return;
  const { default: Queue } = await import("bullmq");
  const { default: IORedis } = await import("ioredis");
  const connection = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });
  bullQueue = new Queue("import-units", { connection });
  memoryWorkerCount = parseInt(process.env.WORKER_CONCURRENCY || "3");
  memoryConcurrent = memoryWorkerCount;
}

export const queueBackend = backend;

/** 入队一个处理单元 */
export async function enqueueUnit(job: UnitJob): Promise<void> {
  if (backend === "redis") {
    await ensureBull();
    await bullQueue.add("unit", job, {
      jobId: job.unitId, // 幂等：BullMQ 去重
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 500,
    });
    return;
  }
  // memory
  if (!memoryActive.has(job.unitId)) {
    memoryQueue.push(job);
  }
}

/** 启动 Worker（消费队列）。memory 模式会自驱动；redis 模式起 BullMQ Worker。 */
export async function startWorker(worker: WorkerFn): Promise<void> {
  if (backend === "redis") {
    await ensureBull();
    const { default: Worker } = await import("bullmq");
    const { default: IORedis } = await import("ioredis");
    const connection = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
    bullWorker = new Worker(
      "import-units",
      async (job) => {
        await worker(job.data as UnitJob);
      },
      { connection, concurrency: memoryConcurrent }
    );
    bullWorker.on("failed", (j: any, err: any) =>
      console.error("[queue:redis] failed", j?.id, err?.message)
    );
    console.log("[queue] BullMQ worker started");
    return;
  }
  // memory：启动内联泵
  memoryRunning = false;
  pumpMemoryQueue(worker);
  console.log("[queue] memory worker pump started (concurrency=" + memoryConcurrent + ")");
}

/** 进程退出时优雅关闭 */
export async function closeQueue(): Promise<void> {
  if (backend === "redis") {
    if (bullWorker) await bullWorker.close();
    if (bullQueue) await bullQueue.close();
  }
  memoryQueue.length = 0;
}
