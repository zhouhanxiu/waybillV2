"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ClipboardList,
  AlertTriangle,
  Clock,
  ScanLine,
  ShieldAlert,
  CheckCircle,
  ArrowRight,
  Activity,
} from "lucide-react";

type Ticket = {
  id: string;
  external_code: string;
  exception_type: string;
  source: "manual" | "scan";
  status: string;
  created_at: string;
  updated_at: string;
};

type ScanRecord = {
  id: string;
  external_code: string;
  sku_code: string;
  sku_name: string;
  result: "pass" | "fail";
  released: boolean;
  created_at: string;
};

const OPEN_STATUSES = ["pending", "level1", "level2"];
const COMPLETED_STATUSES = ["approved", "closed"];

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

export default function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch("/api/tickets?days=all"),
        fetch("/api/scan"),
      ]);
      if (tRes.ok) {
        const tData = await tRes.json();
        setTickets(tData.items || []);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setScans(sData.records || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const total = tickets.length;
  const pending = tickets.filter(t => OPEN_STATUSES.includes(t.status)).length;
  const overdue = tickets.filter(t => {
    if (COMPLETED_STATUSES.includes(t.status)) return false;
    const created = new Date(t.created_at).getTime();
    return Date.now() - created > 24 * 60 * 60 * 1000;
  }).length;
  const todayScans = scans.filter(s => isToday(s.created_at)).length;
  const qcHolds = tickets.filter(t => t.source === "scan" && OPEN_STATUSES.includes(t.status)).length;
  const todayCompleted = tickets.filter(
    t => COMPLETED_STATUSES.includes(t.status) && isToday(t.updated_at)
  ).length;

  const cards = [
    {
      label: "总工单",
      value: total,
      icon: ClipboardList,
      color: "bg-blue-50 text-blue-600",
      href: "/tickets?days=all",
      desc: "全部状态",
    },
    {
      label: "待处理",
      value: pending,
      icon: AlertTriangle,
      color: "bg-warn-bg text-warn",
      href: `/tickets?status=${OPEN_STATUSES.join(",")}&days=all`,
      desc: "待审批/一级/二级",
    },
    {
      label: "已超时",
      value: overdue,
      icon: Clock,
      color: "bg-danger-bg text-danger",
      href: "/tickets?overdue=true&days=all",
      desc: "超过 24 小时",
    },
    {
      label: "今日扫描",
      value: todayScans,
      icon: ScanLine,
      color: "bg-jingtian-soft text-jingtian-dark",
      href: "/scan",
      desc: "进入扫描",
    },
    {
      label: "品控暂扣",
      value: qcHolds,
      icon: ShieldAlert,
      color: "bg-purple-50 text-purple-600",
      href: `/tickets?source=scan&status=${OPEN_STATUSES.join(",")}&days=all`,
      desc: "扫描异常未放行",
    },
    {
      label: "今日完成",
      value: todayCompleted,
      icon: CheckCircle,
      color: "bg-success/10 text-success",
      href: `/tickets?status=${COMPLETED_STATUSES.join(",")}&days=all`,
      desc: "已通过/已关闭",
    },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-ink">工作台</h1>
          <p className="text-sm text-ink-faint">运单全流程管理概览</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-xs font-medium">
          <Activity className="w-3.5 h-3.5" />
          V2 服务: 正常
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-card border border-line rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.label}
                href={card.href}
                className="group bg-card border border-line rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-jingtian/30 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-2xl font-bold text-ink">{card.value}</div>
                <div className="text-xs text-ink-faint mt-0.5">{card.label}</div>
                <div className="text-[10px] text-ink-faint/70 mt-2">{card.desc}</div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 扫描品控 */}
        <div className="bg-card border border-line rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-jingtian-soft flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-jingtian-dark" />
            </div>
            <div>
              <h2 className="font-semibold text-ink">扫描品控</h2>
              <p className="text-xs text-ink-faint">仓库扫描操作入口，自动触发品控规则引擎检测</p>
            </div>
          </div>
          <Link
            href="/scan"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-jingtian text-white text-sm font-medium hover:bg-jingtian-dark transition-colors"
          >
            进入扫描
          </Link>
        </div>

        {/* 异常上报 */}
        <div className="bg-card border border-line rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-warn-bg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-warn" />
            </div>
            <div>
              <h2 className="font-semibold text-ink">异常上报</h2>
              <p className="text-xs text-ink-faint">手工上报物流异常：丢件、破损、拒收、超时、地址错误</p>
            </div>
          </div>
          <Link
            href="/tickets?status=pending&days=all"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-warn text-white text-sm font-medium hover:bg-warn/90 transition-colors"
          >
            发起上报
          </Link>
        </div>
      </div>

      {/* 运单全流程 */}
      <div className="mt-8 bg-card border border-line rounded-2xl p-6 shadow-sm">
        <h2 className="font-semibold text-ink mb-4">运单全流程</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          {["V2 智能解析", "仓库扫描", "品控检测", "异常上报", "分级审批", "执行联动", "完成"].map(
            (step, idx, arr) => (
              <span key={step} className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-lg bg-bg border border-line">{step}</span>
                {idx < arr.length - 1 && <span className="text-jingtian">→</span>}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
