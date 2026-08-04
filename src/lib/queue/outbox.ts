/**
 * Transactional Outbox Dispatcher（考试考点1）
 * ---------------------------------------------------------------
 * 保证：任务创建（含单元事件）与事件投递的最终一致。
 * - 上传接口在事务内写入 event_outbox(status='pending')
 * - Dispatcher 轮询 pending 事件，投递到队列后标记 sent
 * - 投递失败按 next_retry_at 退避重试
 * - 进程重启后，未 sent 的事件会被重新投递（内存队列丢队可恢复）
 */
import { query } from "../db";
import { enqueueUnit } from "./index";

let timer: ReturnType<typeof setInterval> | null = null;

export async function startOutboxDispatcher(intervalMs = 2000) {
  if (timer) return;
  // 立即执行一次（恢复可能堆积的 pending）
  void dispatchOnce();
  timer = setInterval(() => void dispatchOnce(), intervalMs);
  console.log("[outbox] dispatcher started, interval=" + intervalMs + "ms");
}

export async function stopOutboxDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** 手动触发一次投递（供 Vercel Cron / 路由调用，保证 Serverless 下也能推进） */
export async function dispatchOnce() {
    const pending = await query<{
      id: number;
      aggregate_id: string;
      payload: { taskId: string; unitId: string; unitIndex: number };
    }>(
      `SELECT id, aggregate_id, payload FROM event_outbox
       WHERE status='pending' AND next_retry_at <= NOW()
       ORDER BY created_at ASC LIMIT 100`
    );
    try {
      for (const ev of pending) {
        const p = ev.payload;
        if (!p?.taskId || !p?.unitId) {
          await query(`UPDATE event_outbox SET status='failed' WHERE id=$1`, [ev.id]);
          continue;
        }
        try {
          await enqueueUnit({ taskId: p.taskId, unitId: p.unitId, unitIndex: p.unitIndex });
          await query(`UPDATE event_outbox SET status='sent', updated_at=NOW() WHERE id=$1`, [ev.id]);
        } catch (err) {
          const retry = (await query<{ c: number }>(`SELECT retry_count AS c FROM event_outbox WHERE id=$1`, [ev.id]))[0]?.c ?? 0;
          const backoff = Math.min(30000, 1000 * 2 ** retry);
          await query(
            `UPDATE event_outbox SET retry_count=$1, next_retry_at=NOW()+$2 * INTERVAL '1 millisecond', updated_at=NOW() WHERE id=$3`,
            [retry + 1, backoff, ev.id]
          );
        }
      }
    } catch (err) {
      console.error("[outbox] dispatch error", err);
    }
}
