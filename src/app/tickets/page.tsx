"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ClipboardList,
  Search,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "待审批" },
  { value: "level1", label: "一级审批中" },
  { value: "level2", label: "二级审批中" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "closed", label: "已关闭" },
];

const TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "lost", label: "丢件" },
  { value: "damaged", label: "破损" },
  { value: "shortage", label: "短少" },
  { value: "wrong_item", label: "错件" },
];

const DAYS_OPTIONS = [
  { value: "3", label: "最近 3 天" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "all", label: "全部" },
];

const PAGE_SIZE = 10;

type Ticket = {
  id: string;
  waybill_snapshot_id: string;
  external_code: string;
  exception_type: "lost" | "damaged" | "shortage" | "wrong_item";
  source: "manual" | "scan";
  severity: "low" | "medium" | "high";
  description: string;
  amount: number;
  reporter: string;
  status: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
};

const statusMap: Record<string, string> = {
  pending: "待审批",
  level1: "一级审批中",
  level2: "二级审批中",
  approved: "已通过",
  rejected: "已驳回",
  closed: "已关闭",
};

const typeMap: Record<string, string> = {
  lost: "丢件",
  damaged: "破损",
  shortage: "短少",
  wrong_item: "错件",
};

const severityMap: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const statusClass: Record<string, string> = {
  pending: "bg-warn-bg text-warn",
  level1: "bg-blue-50 text-blue-700",
  level2: "bg-purple-50 text-purple-700",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger-bg text-danger",
  closed: "bg-bg text-ink-faint",
};

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-jingtian" />
        </div>
      }
    >
      <TicketsPageInner />
    </Suspense>
  );
}

function TicketsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [type, setType] = useState(searchParams.get("type") || "");
  const [days, setDays] = useState(searchParams.get("days") || "3");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") || "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") || "");

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 外部 URL 变化时同步回状态
  useEffect(() => {
    setStatus(searchParams.get("status") || "");
    setType(searchParams.get("type") || "");
    setDays(searchParams.get("days") || "3");
    setStartDate(searchParams.get("startDate") || "");
    setEndDate(searchParams.get("endDate") || "");
  }, [searchParams]);

  const updateQuery = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value) params.set(key, value);
        else params.delete(key);
      });
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      if (days !== "all" && !startDate && !endDate) {
        params.set("days", days);
      }
      if (startDate) params.set("created_after", startDate + "T00:00:00.000Z");
      if (endDate) params.set("created_before", endDate + "T23:59:59.999Z");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));

      const res = await fetch(`/api/tickets?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.items || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [status, type, days, startDate, endDate, page]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => {
    setPage(1);
    loadTickets();
  };

  const handleReset = () => {
    setStatus("");
    setType("");
    setDays("3");
    setStartDate("");
    setEndDate("");
    setPage(1);
    router.replace(pathname);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleString("zh-CN", { hour12: false });

  const filteredTickets = useMemo(() => {
    return tickets;
  }, [tickets]);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-jingtian-soft flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-jingtian-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">工单列表</h1>
          <p className="text-sm text-ink-faint">
            共 {total} 条工单
            {days !== "all" && !startDate && !endDate && ` · 默认最近 ${days} 天`}
          </p>
        </div>
        <button
          onClick={handleSearch}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-bg transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="bg-card border border-line rounded-2xl shadow-sm p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">状态</label>
            <select
              value={status}
              onChange={(e) => {
                const value = e.target.value;
                setStatus(value);
                updateQuery({ status: value });
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">异常类型</label>
            <select
              value={type}
              onChange={(e) => {
                const value = e.target.value;
                setType(value);
                updateQuery({ type: value });
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">时间范围</label>
            <select
              value={days}
              onChange={(e) => {
                const value = e.target.value;
                setDays(value);
                setStartDate("");
                setEndDate("");
                updateQuery({ days: value, startDate: "", endDate: "" });
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            >
              {DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const value = e.target.value;
                setStartDate(value);
                if (value) {
                  setDays("all");
                  updateQuery({ startDate: value, days: "all" });
                } else {
                  updateQuery({ startDate: value });
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const value = e.target.value;
                setEndDate(value);
                if (value) {
                  setDays("all");
                  updateQuery({ endDate: value, days: "all" });
                } else {
                  updateQuery({ endDate: value });
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-soft hover:bg-bg transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleSearch}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-jingtian text-white text-sm font-medium hover:bg-jingtian-dark transition-colors"
          >
            <Search className="w-4 h-4" />
            查询
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-line">
            <tr>
              <th className="w-10 py-3 px-4"></th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">工单 ID</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">运单号</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">异常类型</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">来源</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">严重度</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">金额</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">上报人</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">状态</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">创建时间</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="text-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-jingtian" />
                </td>
              </tr>
            ) : filteredTickets.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-ink-faint">
                  暂无工单数据
                </td>
              </tr>
            ) : (
              filteredTickets.map((t) => (
                <>
                  <tr
                    key={t.id}
                    onClick={() => toggleExpand(t.id)}
                    className="border-b border-line-soft hover:bg-bg/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      {expandedIds.has(t.id) ? (
                        <ChevronDown className="w-4 h-4 text-ink-faint" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-ink-faint" />
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-jingtian-dark font-medium">{t.id}</span>
                    </td>
                    <td className="py-3 px-4 text-ink">{t.external_code}</td>
                    <td className="py-3 px-4 text-ink">{typeMap[t.exception_type] || t.exception_type}</td>
                    <td className="py-3 px-4 text-ink-soft">
                      {t.source === "manual" ? "手动" : "扫描"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                          t.severity === "high"
                            ? "bg-danger-bg text-danger"
                            : t.severity === "medium"
                            ? "bg-warn-bg text-warn"
                            : "bg-success/10 text-success"
                        }`}
                      >
                        {severityMap[t.severity] || t.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-ink">{t.amount.toFixed(2)}</td>
                    <td className="py-3 px-4 text-ink">{t.reporter}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                          statusClass[t.status] || "bg-bg text-ink-faint"
                        }`}
                      >
                        {statusMap[t.status] || t.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-ink-soft">{formatDate(t.created_at)}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(t.id);
                        }}
                        className="text-xs text-jingtian hover:underline"
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                  {expandedIds.has(t.id) && (
                    <tr className="bg-bg/30 border-b border-line-soft">
                      <td colSpan={11} className="px-4 py-4">
                        <div className="pl-8 space-y-2 text-sm">
                          <p className="text-ink-soft">
                            <span className="font-medium text-ink">异常描述：</span>
                            {t.description}
                          </p>
                          <p className="text-ink-soft">
                            <span className="font-medium text-ink">重提次数：</span>
                            {t.retry_count}
                          </p>
                          <p className="text-ink-soft">
                            <span className="font-medium text-ink">更新时间：</span>
                            {formatDate(t.updated_at)}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <span className="text-ink-soft">
            第 <span className="font-medium text-ink">{page}</span> / {totalPages} 页
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
