/**
 * Upstash Redis 单例（V4 旁路加速器）
 * ---------------------------------------------------------------
 * 仅做缓存 / 幂等去重 / 限流，不存任何"真相"。
 * 真相（任务状态、批次、trace）永远在 PostgreSQL。
 * 即使 Redis 不可用，系统靠 PG 也能跑（所有调用都 try/catch 降级到无缓存）。
 *
 * 环境变量：
 *   REDIS_REST_URL / REDIS_REST_TOKEN            —— Upstash Redis REST 端点（与 QStash 同账号）
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN —— Upstash 控制台默认导出名（自动兼容）
 *   REDIS_TTL_SECONDS                  —— 监控缓存 TTL（默认 8s）
 */
import { Redis } from "@upstash/redis";

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  // 兼容两种变量名前缀：REDIS_REST_* 与 UPSTASH_REDIS_REST_*（控制台默认导出）
  const url = process.env.REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // 未配置：返回 null，调用方降级为"无 Redis"
    return null;
  }
  client = new Redis({ url, token });
  return client;
}

export const REDIS_TTL = parseInt(process.env.REDIS_TTL_SECONDS || "8");

/**
 * 尝试为某单元获取一次性处理锁（幂等兜底，防 QStash 重试重复消费）。
 * 返回 true = 抢到锁（可处理）；false = 已被锁（跳过）。
 * Redis 不可用时乐观放行（PG 的原子抢占仍可保证幂等）。
 */
export async function tryLockUnit(unitId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return true; // 降级：放行，靠 PG 幂等
  try {
    const ok = await r.set(`unit:lock:${unitId}`, "1", { nx: true, ex: 90 });
    return ok === "OK";
  } catch (err) {
    console.error("[redis] tryLockUnit failed, degrade to allow", unitId, (err as any)?.message);
    return true;
  }
}

export async function releaseUnitLock(unitId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(`unit:lock:${unitId}`);
  } catch {
    /* 忽略 */
  }
}

/** 读取监控缓存；无/过期/异常返回 null */
export async function getCached<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const v = await r.get<T>(key);
    return v ?? null;
  } catch {
    return null;
  }
}

/** 写入监控缓存（带 TTL） */
export async function setCached(key: string, value: unknown, ttl = REDIS_TTL): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value as any, { ex: ttl });
  } catch {
    /* 忽略 */
  }
}
