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

    let items = ticketStore.listTickets();

    // 按状态筛选
    if (statusFilter) {
      items = items.filter(t => t.status === statusFilter);
    }

    // 按异常类型筛选
    if (typeFilter) {
      items = items.filter(t => t.exception_type === typeFilter);
    }

    // 超时筛选
    if (overdueFilter) {
      const now = Date.now();
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
