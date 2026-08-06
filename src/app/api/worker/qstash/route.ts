/**
 * QStash 消费路由（事件驱动异步链路）
 * ---------------------------------------------------------------
 * Outbox Dispatcher 把 pending 事件投递到 QStash（enqueueUnit → publishJSON），
 * QStash 通过带签名的 HTTP POST 回调本路由，本路由：
 *   1. 校验 QStash 签名（防止伪造请求）
 *   2. 取出 job（taskId/unitId/unitIndex）
 *   3. 调 processUnit 幂等处理该单元
 *   4. 处理成功返回 2xx（QStash 标记投递成功）；失败抛错（QStash 自动重试）
 *
 * 这是 Vercel 等 Serverless 平台下"即时触发、带平台级重试"的异步消费方式，
 * 不再依赖内存队列存活或 cron 兜底（cron 仍保留作最终兜底）。
 */
import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { processUnit } from "@/lib/worker/processUnit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rt0 = Date.now();
  // 1. 验签
  const signature = req.headers.get("upstash-signature");
  const rawBody = await req.text();
  if (!signature || !process.env.QSTASH_CURRENT_SIGNING_KEY) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }
  let job: { taskId: string; unitId: string; unitIndex: number };
  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || process.env.QSTASH_CURRENT_SIGNING_KEY!,
    });
    const valid = await receiver.verify({ signature, body: rawBody });
    if (!valid) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    job = JSON.parse(rawBody);
  } catch (err: any) {
    return NextResponse.json({ error: "bad signature/payload: " + err.message }, { status: 401 });
  }
  const verifyMs = Date.now() - rt0;
  console.log(JSON.stringify({ stage: "qstash.callback", unitId: job?.unitId, verifyMs }));

  // 2. 调 processUnit（内部已做 attempt 幂等保护）
  try {
    await processUnit(job.taskId, job.unitId);
    console.log(JSON.stringify({ stage: "qstash.done", unitId: job.unitId, totalMs: Date.now() - rt0 }));
    return NextResponse.json({ ok: true, unitId: job.unitId });
  } catch (err: any) {
    console.error("[qstash] processUnit failed", job.unitId, err?.message);
    // 返回 5xx → QStash 按 retries 自动重试
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
