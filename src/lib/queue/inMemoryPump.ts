/**
 * 内存泵（Coalesced Pump）—— 在 serverful 上下文（本地/Vercel 长运行）持续消费 outbox
 * 考试要求：上传即返回 ≤1s；后台异步批量校验/写入
 * 双保险：当 Vercel Cron 未触发 / QStash 失联时，in-memory pump 兜底，保证 SLA
 *
 * 说明：
 * - 进程内防并发：globalThis 全局复用同一个 pump
 * - 单实例上下文安全：Vercel serverless 一般不会出现并发，所以这里没有额外锁
 * - 内存队列场景下：直接调用 queue.consumeAllUnits() 拉取所有 pending
 * - QStash 场景下：依然由 QStash 定时推送；如果 QStash 挂掉，in-memory pump 兜底
 */
import { getInMemoryQueue } from "@/lib/queue/memory";
import { getOutboxDispatcher } from "@/lib/queue/outbox";

declare global {
  // eslint-disable-next-line no-var
  var __v4_inmemory_pump: { stop: () => void } | null | undefined;
}

export function startInMemoryPump() {
  if (globalThis.__v4_inmemory_pump) return globalThis.__v4_inmemory_pump;
  if (process.env.NODE_ENV === "test") return null;

  const queue = getInMemoryQueue();
  const dispatcher = getOutboxDispatcher();

  // 每 1s 派发 outbox（pending → 入队）
  const outboxTimer = setInterval(() => {
    dispatcher.tickOnce().catch((e) => console.error("[pump] outbox tick failed:", e));
  }, 1000);
  if (typeof outboxTimer.unref === "function") outboxTimer.unref();

  // 每 800ms 消费 in-memory 队列（防止 Vercel cron 失效时任务卡 pending）
  const consumeTimer = setInterval(() => {
    queue.consumeAllUnits().catch((e) => console.error("[pump] consume failed:", e));
  }, 800);
  if (typeof consumeTimer.unref === "function") consumeTimer.unref();

  console.log("[v4-pump] 启动内存泵：outbox 1s，in-memory 800ms");

  const stop = () => {
    clearInterval(outboxTimer);
    clearInterval(consumeTimer);
    globalThis.__v4_inmemory_pump = null;
  };

  globalThis.__v4_inmemory_pump = { stop };
  return globalThis.__v4_inmemory_pump;
}
