import postgres from "postgres";
const url = "postgres://postgres.rmepctmiazuxoizwskpk:zhxWaybillV2@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const sql = postgres(url, { prepare: false, connect_timeout: 30 });

// 查看 failed 事件明细
const failed = await sql`SELECT id, status, retry_count, next_retry_at, payload->>'taskId' AS task, payload->>'unitId' AS unit FROM event_outbox WHERE status='failed' ORDER BY id LIMIT 5`;
console.log("FAILED sample:", JSON.stringify(failed, null, 2));

const before = await sql`SELECT COUNT(*)::int AS c FROM event_outbox WHERE status='failed'`;
console.log("before failed:", before[0].c);

// 重置 failed -> pending
const up = await sql`
  UPDATE event_outbox
  SET status='pending', next_retry_at = NOW(), retry_count = 0, updated_at = NOW()
  WHERE status = 'failed'
`;
console.log("updated rows:", up.count ?? up);

const after = await sql`SELECT status, COUNT(*)::int AS c FROM event_outbox GROUP BY status`;
console.log("after:", after);
await sql.end();
