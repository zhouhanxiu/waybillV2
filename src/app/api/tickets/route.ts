/**
 * V3 工单 API — CRUD + 状态机 + 审批
 */
import { NextRequest, NextResponse } from "next/server";
import { ticketStore } from "./store";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const overdueFilter = searchParams.get("overdue") === "true";
    const typeFilter = searchParams.get("type");
    const sourceFilter = searchParams.get("source");
    const daysParam = searchParams.get("days");
    const createdAfterParam = searchParams.get("created_after");
    const createdBeforeParam = searchParams.get("created_before");

    const statusSet = statusFilter ? new Set(statusFilter.split(",").map(s => s.trim()).filter(Boolean)) : null;

    // 默认查询最近 3 天；days=all 表示全部时间
    const now = Date.now();
    let createdAfter: string;
    let createdBefore: string;
    if (createdAfterParam) {
      createdAfter = new Date(createdAfterParam).toISOString();
    } else if (daysParam === "all") {
      createdAfter = new Date(0).toISOString();
    } else {
      const days = daysParam ? Number(daysParam) : 3;
      createdAfter = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    }
    createdBefore = createdBeforeParam ? new Date(createdBeforeParam).toISOString() : new Date(now).toISOString();

    let items = ticketStore.listTickets();

    // 按时间范围筛选
    items = items.filter(t => t.created_at >= createdAfter && t.created_at <= createdBefore);

    // 按状态筛选（支持逗号分隔多状态）
    if (statusSet && statusSet.size > 0) {
      items = items.filter(t => statusSet.has(t.status));
    }

    // 按来源筛选
    if (sourceFilter) {
      items = items.filter(t => t.source === sourceFilter);
    }

    // 按异常类型筛选
    if (typeFilter) {
      items = items.filter(t => t.exception_type === typeFilter);
    }

    // 超时筛选
    if (overdueFilter) {
      const overdueMs = 24 * 60 * 60 * 1000;
      items = items.filter(t => {
        if (t.status === "closed" || t.status === "approved") return false;
        const created = new Date(t.created_at).getTime();
        return (now - created) > overdueMs;
      });
    }

    return NextResponse.json({
      items,
      total: items.length,
      total_all: ticketStore.getTotalCount(),
      open_count: ticketStore.getOpenCount(),
      overdue_count: ticketStore.getOverdueCount(),
      filters: { days: daysParam || "3", created_after: createdAfter, created_before: createdBefore },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 缺参校验：创建或操作都需要 body 里有字段
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "缺少请求参数" }, { status: 400 });
    }

    // 查询/列表
    if (body.action === "list" || (!body.action && !body.waybill_snapshot_id && !body.id)) {
      const items = ticketStore.listTickets();
      return NextResponse.json({
        items,
        total: items.length,
        open_count: ticketStore.getOpenCount(),
      });
    }

    // 重置（测试用）
    if (body.action === "reset") {
      ticketStore.reset();
      return NextResponse.json({ message: "已重置", ok: true });
    }

    // 审批/拒绝/重提
    if (body.action) {
      const { id, action, approver, level, opinion } = body;
      if (!id || !action || !approver) {
        return NextResponse.json({ error: "缺少审批必要参数(id/action/approver)" }, { status: 400 });
      }
      const result = ticketStore.approve({ id, action, approver, level, opinion: opinion || "" });
      if (result.status && typeof result.status === "number") {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    // 创建工单
    const { waybill_snapshot_id, external_code, exception_type, source, severity, description, amount, reporter } = body;
    if (!external_code || !exception_type || !source || !severity || !description || !reporter) {
      return NextResponse.json({ error: "缺少工单必要参数" }, { status: 400 });
    }

    const ticket = ticketStore.createTicket({
      waybill_snapshot_id: waybill_snapshot_id || "",
      external_code,
      exception_type,
      source,
      severity,
      description,
      amount: Number(amount) || 0,
      reporter,
    });

    return NextResponse.json(ticket);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
