/**
 * V3 工单内存状态机 — 本地 mock
 *
 * 工单生命周期:
 *   pending → (一级审批) → level2 → (二级审批) → approved → closed
 *                         → rejected → pending (可重提)
 *
 * 异常类型→赔付方向:
 *   lost/damaged → 赔付客户
 *   shortage → 补货
 *   wrong_item → 换货
 */

type TicketStatus = "pending" | "level1" | "level2" | "approved" | "rejected" | "closed";
type ExceptionType = "lost" | "damaged" | "shortage" | "wrong_item";

interface Ticket {
  id: string;
  waybill_snapshot_id: string;
  external_code: string;
  exception_type: ExceptionType;
  source: "manual" | "scan";
  severity: "low" | "medium" | "high";
  description: string;
  amount: number;
  reporter: string;
  status: TicketStatus;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

interface ApprovalRecord {
  id: string;
  ticket_id: string;
  level: number;
  approver: string;
  opinion: string;
  action: "approve" | "reject";
  created_at: string;
}

interface ScanRecord {
  id: string;
  external_code: string;
  sku_code: string;
  sku_name: string;
  operator: string;
  expected_qty: number;
  actual_qty: number;
  damage_level: number;
  spec_match: boolean;
  result: "pass" | "fail";
  ticket_id?: string;
  released: boolean;
  released_by?: string;
  release_reason?: string;
  created_at: string;
}

const tickets: Ticket[] = [];
const approvals: ApprovalRecord[] = [];
const scans: ScanRecord[] = [];

const idGen = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

export const ticketStore = {
  // ── 工单 ──
  createTicket(data: Omit<Ticket, "id" | "status" | "retry_count" | "created_at" | "updated_at"> & { id?: string }) {
    const id = data.id || idGen("ticket");
    const now = new Date().toISOString();
    const status: TicketStatus = data.amount > 500 ? "level2" : "pending";

    // 检查重复
    const existing = tickets.find(t =>
      t.external_code === data.external_code &&
      t.exception_type === data.exception_type &&
      (t.status === "pending" || t.status === "level1" || t.status === "level2")
    );
    if (existing) {
      return { ...existing, existing_ticket: true };
    }

    const ticket: Ticket = {
      id,
      waybill_snapshot_id: data.waybill_snapshot_id || "",
      external_code: data.external_code,
      exception_type: data.exception_type,
      source: data.source,
      severity: data.severity,
      description: data.description,
      amount: data.amount,
      reporter: data.reporter,
      status,
      retry_count: 0,
      created_at: now,
      updated_at: now,
    };
    tickets.push(ticket);
    return ticket;
  },

  getTicket(id: string) {
    return tickets.find(t => t.id === id) || null;
  },

  listTickets() {
    return [...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  getTotalCount() { return tickets.length; },
  getOpenCount() { return tickets.filter(t => t.status !== "closed").length; },

  // ── 审批 ──
  approve(params: { id: string; action: "approve" | "reject"; approver: string; level?: number; opinion: string }) {
    const ticket = tickets.find(t => t.id === params.id);
    if (!ticket) return { error: "工单不存在", status: 404 };

    // 上报人不能审批自己
    if (ticket.reporter === params.approver) {
      return { error: "上报人不能审批自己的工单", status: 403 };
    }

    // 已关闭/已审批的不能重复操作
    if (ticket.status === "approved" || ticket.status === "closed") {
      return { error: "工单已完结，不可重复审批", status: 409 };
    }

    // 幂等：检查是否已审批过
    const existingApproval = approvals.find(
      a => a.ticket_id === params.id && a.approver === params.approver && a.action === params.action
    );
    if (existingApproval) {
      return { ticket, already_approved: true };
    }

    const now = new Date().toISOString();
    const level = params.level || (ticket.status === "level2" ? 2 : 1);

    const record: ApprovalRecord = {
      id: idGen("approval"),
      ticket_id: params.id,
      level,
      approver: params.approver,
      opinion: params.opinion,
      action: params.action,
      created_at: now,
    };
    approvals.push(record);

    if (params.action === "reject") {
      ticket.status = "pending";
      ticket.retry_count += 1;
    } else if (params.action === "approve") {
      if (ticket.status === "level2") {
        ticket.status = "approved";
      } else {
        // 一级审批通过 → 高金额进入 level2
        ticket.status = ticket.amount > 500 ? "level2" : "approved";
      }
    }
    ticket.updated_at = now;

    // 赔付联动：approved 后自动生成赔付记录
    if (ticket.status === "approved") {
      this.createCompensation(ticket);
    }

    return { ticket, approval_record: record };
  },

  // ── 赔付联动 ──
  createCompensation(ticket: Ticket) {
    const directionMap: Record<ExceptionType, string> = {
      lost: "赔付客户",
      damaged: "赔付客户",
      shortage: "补货",
      wrong_item: "换货",
    };
    const direction = directionMap[ticket.exception_type] || "赔付客户";
    return {
      id: idGen("comp"),
      ticket_id: ticket.id,
      external_code: ticket.external_code,
      amount: ticket.amount,
      direction,
      created_at: new Date().toISOString(),
    };
  },

  getApprovals(ticketId: string) {
    return approvals.filter(a => a.ticket_id === ticketId);
  },

  // ── 扫描 ──
  createScan(data: {
    external_code: string;
    sku_code: string;
    sku_name: string;
    operator: string;
    expected_qty: number;
    actual_qty: number;
    damage_level: number;
    spec_match: boolean;
  }) {
    // 幂等检查：无论是否已放行，同运单同SKU的异常扫描不重复创建
    const existing = scans.find(s =>
      s.external_code === data.external_code &&
      s.sku_code === data.sku_code &&
      s.result === "fail"
    );
    if (existing) {
      return { ...existing, existing_ticket: true };
    }

    const id = idGen("scan");
    const match = data.actual_qty === data.expected_qty && data.spec_match && data.damage_level === 0;
    const result = match ? "pass" : "fail";

    let ticket_id: string | undefined;
    if (!match) {
      // 扫描不通过 → 自动创建工单
      const ticket = this.createTicket({
        waybill_snapshot_id: "",
        external_code: data.external_code,
        exception_type: data.actual_qty < data.expected_qty ? "shortage" : "damaged",
        source: "scan",
        severity: "medium",
        description: `扫描异常: 预期${data.expected_qty}, 实际${data.actual_qty}`,
        amount: 0,
        reporter: data.operator,
      });
      ticket_id = ticket.id;
    }

    const record: ScanRecord = {
      id,
      ...data,
      result,
      ticket_id,
      released: false,
      created_at: new Date().toISOString(),
    };
    scans.push(record);
    return record;
  },

  releaseScan(params: { scan_id: string; operator: string; reason: string }) {
    const scan = scans.find(s => s.id === params.scan_id);
    if (!scan) return { error: "扫描记录不存在", status: 404 };

    // 权限：只有主管/管理员可以放行
    if (!params.operator.includes("supervisor") && !params.operator.includes("admin")) {
      return { error: "无放行权限，需要主管或管理员", status: 403 };
    }

    scan.released = true;
    scan.released_by = params.operator;
    scan.release_reason = params.reason;

    // 关闭关联工单
    if (scan.ticket_id) {
      const ticket = tickets.find(t => t.id === scan.ticket_id);
      if (ticket && ticket.status !== "closed") {
        ticket.status = "closed";
        ticket.updated_at = new Date().toISOString();
      }
    }

    return { scan, message: "放行成功，工单已关闭" };
  },

  getScanRecords(external_code?: string) {
    if (external_code) return scans.filter(s => s.external_code === external_code);
    return [...scans];
  },

  // ── 重置（测试用） ──
  reset() {
    tickets.length = 0;
    approvals.length = 0;
    scans.length = 0;
  },
};
