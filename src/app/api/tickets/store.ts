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

    // 检查重复：同运单+同异常类型+未完结 → 去重
    const existing = tickets.find(t =>
      t.external_code === data.external_code &&
      t.exception_type === data.exception_type &&
      t.status !== "closed" && t.status !== "approved"
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
  getOverdueCount() {
    // 超过 24 小时未处理的工单视为超时
    const now = Date.now();
    const overdueMs = 24 * 60 * 60 * 1000;
    return tickets.filter(t => {
      if (t.status === "closed" || t.status === "approved") return false;
      const created = new Date(t.created_at).getTime();
      return (now - created) > overdueMs;
    }).length;
  },

  // ── 审批 ──
  approve(params: { id: string; action: "approve" | "reject"; approver: string; level?: number; opinion: string }) {
    const ticket = tickets.find(t => t.id === params.id);
    if (!ticket) return { error: "工单不存在", status: 404 };

    // 上报人不能审批自己
    if (ticket.reporter === params.approver) {
      return { error: "上报人不能审批自己的工单", status: 403 };
    }

    // 已关闭/已审批的不能重复操作（幂等保护）
    if (ticket.status === "approved" || ticket.status === "closed") {
      return { error: "工单已完结，不可重复审批", status: 409, ticket };
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

  // ── 测试数据种子 ──
  seed() {
    const now = new Date();
    const overdueDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 天前
    const recentDate = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 小时前
    const todayStart = new Date(now.setHours(0, 0, 0, 0));

    const samples: Omit<Ticket, "id" | "status" | "retry_count" | "created_at" | "updated_at">[] = [
      {
        waybill_snapshot_id: "snap_001",
        external_code: "EXP001",
        exception_type: "lost",
        source: "manual",
        severity: "high",
        description: "客户反馈包裹未收到，物流轨迹中断",
        amount: 1200,
        reporter: "operator_lisa",
      },
      {
        waybill_snapshot_id: "snap_002",
        external_code: "EXP002",
        exception_type: "damaged",
        source: "manual",
        severity: "medium",
        description: "外包装破损，内件疑似受潮",
        amount: 80,
        reporter: "operator_mike",
      },
      {
        waybill_snapshot_id: "snap_003",
        external_code: "EXP003",
        exception_type: "shortage",
        source: "scan",
        severity: "low",
        description: "扫描复核发现少件 3 个",
        amount: 45,
        reporter: "operator_jim",
      },
      {
        waybill_snapshot_id: "snap_004",
        external_code: "EXP004",
        exception_type: "wrong_item",
        source: "manual",
        severity: "medium",
        description: "客户收到商品与订单不符",
        amount: 300,
        reporter: "operator_lisa",
      },
      {
        waybill_snapshot_id: "snap_005",
        external_code: "EXP005",
        exception_type: "damaged",
        source: "scan",
        severity: "high",
        description: "玻璃制品破损，无法二次销售",
        amount: 600,
        reporter: "operator_mike",
      },
      {
        waybill_snapshot_id: "snap_006",
        external_code: "EXP006",
        exception_type: "lost",
        source: "manual",
        severity: "medium",
        description: "分拨中心丢件",
        amount: 150,
        reporter: "operator_jim",
      },
      {
        waybill_snapshot_id: "snap_007",
        external_code: "EXP007",
        exception_type: "shortage",
        source: "scan",
        severity: "low",
        description: "整箱短少 1 件",
        amount: 60,
        reporter: "operator_lisa",
      },
    ];

    const createdTickets: Ticket[] = [];
    for (const s of samples) {
      const id = idGen("ticket");
      const status: TicketStatus = s.amount > 500 ? "level2" : "pending";
      const createdAt = s.amount > 500 ? overdueDate.toISOString() : recentDate.toISOString();
      const ticket: Ticket = {
        id,
        ...s,
        status,
        retry_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      };
      tickets.push(ticket);
      createdTickets.push(ticket);
    }

    // 额外创建 2 条已超时工单（金额 > 500 进入 level2 且创建时间 > 24h）
    const overdueTickets: Ticket[] = [
      {
        id: idGen("ticket"),
        waybill_snapshot_id: "snap_overdue_001",
        external_code: "EXP_OVERDUE_001",
        exception_type: "damaged",
        source: "manual",
        severity: "high",
        description: "超时未处理：易碎品破损",
        amount: 800,
        reporter: "operator_mike",
        status: "level2",
        retry_count: 0,
        created_at: overdueDate.toISOString(),
        updated_at: overdueDate.toISOString(),
      },
      {
        id: idGen("ticket"),
        waybill_snapshot_id: "snap_overdue_002",
        external_code: "EXP_OVERDUE_002",
        exception_type: "lost",
        source: "manual",
        severity: "high",
        description: "超时未处理：高价值包裹丢失",
        amount: 1500,
        reporter: "operator_jim",
        status: "level2",
        retry_count: 0,
        created_at: overdueDate.toISOString(),
        updated_at: overdueDate.toISOString(),
      },
    ];
    tickets.push(...overdueTickets);
    createdTickets.push(...overdueTickets);

    // 添加若干今日完成工单
    const completedTickets: Ticket[] = [
      {
        id: idGen("ticket"),
        waybill_snapshot_id: "snap_done_001",
        external_code: "EXP_DONE_001",
        exception_type: "shortage",
        source: "manual",
        severity: "low",
        description: "已补货完成",
        amount: 50,
        reporter: "operator_lisa",
        status: "closed",
        retry_count: 0,
        created_at: todayStart.toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: idGen("ticket"),
        waybill_snapshot_id: "snap_done_002",
        external_code: "EXP_DONE_002",
        exception_type: "wrong_item",
        source: "manual",
        severity: "medium",
        description: "已换货完成",
        amount: 200,
        reporter: "operator_mike",
        status: "approved",
        retry_count: 0,
        created_at: todayStart.toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    tickets.push(...completedTickets);
    createdTickets.push(...completedTickets);

    // 创建几条今日扫描记录，部分为失败（品控暂扣）
    const scanSamples = [
      {
        external_code: "EXP003",
        sku_code: "SKU003",
        sku_name: "测试商品C",
        operator: "operator_jim",
        expected_qty: 10,
        actual_qty: 7,
        damage_level: 0,
        spec_match: true,
        result: "fail" as const,
        created_at: todayStart.toISOString(),
      },
      {
        external_code: "EXP005",
        sku_code: "SKU005",
        sku_name: "测试商品E",
        operator: "operator_mike",
        expected_qty: 20,
        actual_qty: 20,
        damage_level: 2,
        spec_match: true,
        result: "fail" as const,
        created_at: todayStart.toISOString(),
      },
      {
        external_code: "EXP007",
        sku_code: "SKU007",
        sku_name: "测试商品G",
        operator: "operator_lisa",
        expected_qty: 15,
        actual_qty: 15,
        damage_level: 0,
        spec_match: true,
        result: "pass" as const,
        created_at: todayStart.toISOString(),
      },
      {
        external_code: "EXP_DONE_001",
        sku_code: "SKU_DONE_001",
        sku_name: "测试商品D",
        operator: "operator_jim",
        expected_qty: 8,
        actual_qty: 8,
        damage_level: 0,
        spec_match: true,
        result: "pass" as const,
        created_at: todayStart.toISOString(),
      },
    ];
    for (const s of scanSamples) {
      const scan: ScanRecord = { id: idGen("scan"), ...s, released: false, ticket_id: undefined };
      if (s.result === "fail") {
        const ticket = this.createTicket({
          waybill_snapshot_id: "",
          external_code: s.external_code,
          exception_type: s.actual_qty < s.expected_qty ? "shortage" : "damaged",
          source: "scan",
          severity: "medium",
          description: `扫描异常: 预期${s.expected_qty}, 实际${s.actual_qty}`,
          amount: 0,
          reporter: s.operator,
        });
        scan.ticket_id = ticket.id;
      }
      scans.push(scan);
    }

    return createdTickets;
  },
};

// 开发/测试环境下自动播种（保留已有数据时不重复）
if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && tickets.length === 0) {
  ticketStore.seed();
}
