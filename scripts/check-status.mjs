import postgres from "postgres";
const url = "postgres://postgres.rmepctmiazuxoizwskpk:zhxWaybillV2@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const sql = postgres(url, { prepare: false, connect_timeout: 30 });

const tasks = await sql`SELECT status, COUNT(*)::int AS c FROM import_tasks GROUP BY status`;
const batches = await sql`SELECT status, COUNT(*)::int AS c FROM import_task_batches GROUP BY status`;
const outbox = await sql`SELECT status, COUNT(*)::int AS c FROM event_outbox GROUP BY status`;
const traces = await sql`SELECT COUNT(*)::int AS c FROM trace_events`;
const errors = await sql`SELECT COUNT(*)::int AS c, COUNT(DISTINCT error_code)::int AS codes FROM import_task_errors`;
console.log("TASKS", tasks);
console.log("BATCHES", batches);
console.log("OUTBOX", outbox);
console.log("TRACES", traces[0].c);
console.log("ERRORS", errors[0]);
await sql.end();
