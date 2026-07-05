"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clock,
  FileSpreadsheet,
  FileText,
  Eye,
  ChevronLeft,
  Package,
  Hash,
  MapPin,
  User,
  Phone,
  Home,
} from "lucide-react";
import Link from "next/link";

type BatchItem = {
  id: string;
  fileName: string;
  ruleId: string;
  status: string;
  createdAt: string;
};

type BatchDetail = BatchItem & {
  waybills: {
    id: string;
    external_code?: string;
    store_name?: string;
    receiver_name?: string;
    receiver_phone?: string;
    receiver_address?: string;
    remark?: string;
    items: {
      id: string;
      sku_code: string;
      sku_name: string;
      quantity: number;
      spec?: string;
    }[];
  }[];
};

export default function HistoryPage() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/batches")
      .then((r) => r.json())
      .then((data) => {
        setBatches(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const viewDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/batches?id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBatch(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* 页面标题 */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/"
          className="p-2 rounded-xl hover:bg-bg text-ink-faint hover:text-ink transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink">导入历史</h1>
          <p className="text-sm text-ink-faint mt-0.5">查看所有已提交的导入批次</p>
        </div>
      </div>

      {selectedBatch ? (
        /* 批次详情 */
        <div>
          <button
            onClick={() => setSelectedBatch(null)}
            className="flex items-center gap-2 text-sm text-ink-soft hover:text-ink mb-6 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            返回列表
          </button>

          <div className="p-5 rounded-2xl bg-card border border-line shadow-sm mb-6">
            <div className="flex items-center gap-3 mb-4">
              {selectedBatch.fileName.endsWith(".pdf") ? (
                <FileText className="w-8 h-8 text-jingtian" />
              ) : (
                <FileSpreadsheet className="w-8 h-8 text-jingtian" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-ink">{selectedBatch.fileName}</h2>
                <p className="text-sm text-ink-faint">
                  {new Date(selectedBatch.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {selectedBatch.waybills.length} 条运单
                </p>
              </div>
            </div>
          </div>

          {/* 运单列表 */}
          <div className="space-y-4">
            {selectedBatch.waybills.map((wb, idx) => (
              <div
                key={wb.id}
                className="p-5 rounded-2xl bg-card border border-line shadow-sm"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-jingtian" />
                    <span className="font-semibold text-ink">运单 #{idx + 1}</span>
                    {wb.external_code && (
                      <span className="px-2 py-0.5 rounded-lg bg-jingtian-soft text-jingtian-dark text-xs font-medium">
                        {wb.external_code}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-ink-faint">
                    {wb.items.length} 个 SKU
                  </span>
                </div>

                {/* 收货信息 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 rounded-xl bg-bg">
                  {wb.store_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-ink-faint" />
                      <span className="text-ink">{wb.store_name}</span>
                    </div>
                  )}
                  {wb.receiver_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-ink-faint" />
                      <span className="text-ink">{wb.receiver_name}</span>
                    </div>
                  )}
                  {wb.receiver_phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="w-4 h-4 text-ink-faint" />
                      <span className="text-ink">{wb.receiver_phone}</span>
                    </div>
                  )}
                  {wb.receiver_address && (
                    <div className="flex items-center gap-2 text-sm col-span-2">
                      <Home className="w-4 h-4 text-ink-faint" />
                      <span className="text-ink truncate">{wb.receiver_address}</span>
                    </div>
                  )}
                </div>

                {/* SKU 表格 */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line-soft">
                      <th className="text-left py-2 px-2 font-medium text-ink-faint">SKU 编码</th>
                      <th className="text-left py-2 px-2 font-medium text-ink-faint">SKU 名称</th>
                      <th className="text-right py-2 px-2 font-medium text-ink-faint">数量</th>
                      <th className="text-left py-2 px-2 font-medium text-ink-faint">规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wb.items.map((item) => (
                      <tr key={item.id} className="border-b border-line-soft last:border-0">
                        <td className="py-2 px-2">
                          <code className="text-xs bg-bg px-1.5 py-0.5 rounded text-ink-soft">
                            {item.sku_code || "—"}
                          </code>
                        </td>
                        <td className="py-2 px-2 text-ink">{item.sku_name}</td>
                        <td className="py-2 px-2 text-right font-medium text-ink">{item.quantity}</td>
                        <td className="py-2 px-2 text-ink-soft text-xs">{item.spec || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* 批次列表 */
        <div>
          {loading ? (
            <div className="text-center py-16 text-ink-faint">
              <div className="w-8 h-8 border-2 border-jingtian border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              加载中...
            </div>
          ) : batches.length === 0 ? (
            <div className="text-center py-16 text-ink-faint">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无导入记录</p>
              <Link
                href="/"
                className="text-sm text-jingtian hover:underline mt-2 inline-block"
              >
                前往导入
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="p-4 rounded-xl bg-card border border-line shadow-sm hover:border-jingtian/30 transition-all cursor-pointer"
                  onClick={() => viewDetail(batch.id)}
                >
                  <div className="flex items-center gap-4">
                    {batch.fileName.endsWith(".pdf") ? (
                      <FileText className="w-10 h-10 text-jingtian" />
                    ) : (
                      <FileSpreadsheet className="w-10 h-10 text-jingtian" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-ink">{batch.fileName}</p>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {new Date(batch.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded-lg bg-success/10 text-success text-xs font-medium">
                        {batch.status === "done" ? "已完成" : batch.status}
                      </span>
                      <Eye className="w-4 h-4 text-ink-faint" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
