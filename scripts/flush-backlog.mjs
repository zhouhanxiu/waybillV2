// 一次性脚本：清理卡住的 import_task_batches 单元并重新写正确的 outbox 事件。
// 1) 删除无 payload 的脏 failed 事件（不指向任何单元）
// 2) 把卡住的批次（pending/processing/failed 且 attempt<5）重置为 pending
//    并写入正确 taskId/unitId 的 outbox 事件，由 dispatch-outbox 异步消费
import postgres from "postgres";

const url = "postgres://postgres.rmepctmiazuxoizwskpk:zhxWaybillV2@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const sql = postgres(url, { prepare: false, connect_timeout: 30 });

// 1) 清理无 payload 的脏事件
const dirty = await sql`
  DELETE FROM event_outbox
  WHERE status='failed' AND (payload->>'taskId' IS NULL OR payload->>'unitId' IS NULL)
`;
console.log("deleted dirty failed events:", dirty.count ?? dirty);

// 2) 查卡住批次
const stuck = await sql`
  SELECT id, task_id, unit_index, status, attempt
  FROM import_task_batches
  WHERE status IN ('pending','processing','failed') AND attempt < 5
  ORDER BY task_id, unit_index
`;
console.log("stuck units:", stuck.length);

// 3) 重置批次为 pending 并写 outbox 事件
let inserted = 0;
for (const u of stuck) {
  await sql`UPDATE import_task_batches SET status='pending', next_retry_at=NOW(), attempt=0 WHERE id=${u.id}`;
  const exists = await sql`
    SELECT 1 FROM event_outbox
    WHERE payload->>'taskId' = ${u.task_id}
      AND payload->>'unitId' = ${u.id}
      AND status = 'pending'
    LIMIT 1
  `;
  if (exists.length > 0) continue;
  await sql`
    INSERT INTO event_outbox (aggregate_type, aggregate_id, event_type, payload, status, created_at, next_retry_at)
    VALUES ('import_task', ${u.task_id}, 'unit.import', ${sql.json({ taskId: u.task_id, unitId: u.id, unitIndex: u.unit_index })}, 'pending', NOW(), NOW())
  `;
  inserted++;
}
console.log("reset pending + inserted outbox events:", inserted);
await sql.end();
