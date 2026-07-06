"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Loader2,
  Package,
  MapPin,
  User,
  Phone,
  Home,
  Calendar,
  Truck,
} from "lucide-react";

type WaybillItem = {
  id: string;
  external_code: string | null;
  store_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  receiver_address: string | null;
  created_at: string;
  sku_count: number;
};

type WaybillDetail = WaybillItem & {
  items: {
    id: string;
    sku_code: string;
    sku_name: string;
    quantity: number;
    spec: string | null;
  }[];
};

const PAGE_SIZE = 10;

export default function WaybillsPage() {
  const [waybills, setWaybills] = useState<WaybillItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [externalCode, setExternalCode] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailMap, setDetailMap] = useState<Record<string, WaybillDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());

  const loadWaybills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (externalCode.trim()) params.set("externalCode", externalCode.trim());
      if (receiverName.trim()) params.set("receiverName", receiverName.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));

      const res = await fetch(`/api/waybills?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setWaybills(data.data || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [externalCode, receiverName, startDate, endDate, page]);

  useEffect(() => {
    loadWaybills();
  }, [loadWaybills]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => {
    setPage(1);
    loadWaybills();
  };

  const handleReset = () => {
    setExternalCode("");
    setReceiverName("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const toggleExpand = async (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) {
      next.delete(id);
      setExpandedIds(next);
      return;
    }
    next.add(id);
    setExpandedIds(next);

    if (!detailMap[id]) {
      setDetailLoading((prev) => new Set(prev).add(id));
      try {
      const res = await fetch(`/api/waybills?id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setDetailMap((prev) => ({ ...prev, [id]: data }));
      }
      } finally {
        setDetailLoading((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleString("zh-CN", { hour12: false });

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-jingtian-soft flex items-center justify-center">
          <Truck className="w-5 h-5 text-jingtian-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">已导入运单列表</h1>
          <p className="text-sm text-ink-faint">查看全部历史运单，支持按外部编码、收件人、提交时间筛选</p>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="bg-card border border-line rounded-2xl shadow-sm p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">外部编码</label>
            <div className="relative">
              <input
                type="text"
                placeholder="模糊匹配"
                value={externalCode}
                onChange={(e) => setExternalCode(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
              {externalCode && (
                <button
                  onClick={() => setExternalCode("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">收件人姓名</label>
            <div className="relative">
              <input
                type="text"
                placeholder="模糊匹配"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
              {receiverName && (
                <button
                  onClick={() => setReceiverName("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">提交开始日期</label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-faint mb-1">提交结束日期</label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
            </div>
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
              <th className="text-left py-3 px-4 font-medium text-ink-faint">外部编码</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">收货门店</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">收件人</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">电话</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">收货地址</th>
              <th className="text-center py-3 px-4 font-medium text-ink-faint">SKU 数</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">提交时间</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-jingtian" />
                </td>
              </tr>
            ) : waybills.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-ink-faint">
                  暂无运单数据
                </td>
              </tr>
            ) : (
              waybills.map((wb) => (
                <>
                  <tr
                    key={wb.id}
                    onClick={() => toggleExpand(wb.id)}
                    className="border-b border-line-soft hover:bg-bg/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      {expandedIds.has(wb.id) ? (
                        <ChevronDown className="w-4 h-4 text-ink-faint" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-ink-faint" />
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-jingtian-dark font-medium">
                        {wb.external_code || "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-ink">{wb.store_name || "—"}</td>
                    <td className="py-3 px-4 text-ink">{wb.receiver_name || "—"}</td>
                    <td className="py-3 px-4 text-ink">{wb.receiver_phone || "—"}</td>
                    <td className="py-3 px-4 text-ink-soft max-w-xs truncate">
                      {wb.receiver_address || "—"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-md bg-jingtian-soft text-jingtian-dark text-xs font-medium">
                        {wb.sku_count}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-ink-soft">{formatDate(wb.created_at)}</td>
                  </tr>
                  {expandedIds.has(wb.id) && (
                    <tr className="bg-bg/30 border-b border-line-soft">
                      <td colSpan={8} className="px-4 py-4">
                        {detailLoading.has(wb.id) ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin text-jingtian" />
                          </div>
                        ) : detailMap[wb.id] ? (
                          <div className="pl-8">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 rounded-xl bg-white border border-line">
                              {detailMap[wb.id].store_name && (
                                <div className="flex items-center gap-2 text-sm">
                                  <MapPin className="w-4 h-4 text-ink-faint" />
                                  <span className="text-ink">{detailMap[wb.id].store_name}</span>
                                </div>
                              )}
                              {detailMap[wb.id].receiver_name && (
                                <div className="flex items-center gap-2 text-sm">
                                  <User className="w-4 h-4 text-ink-faint" />
                                  <span className="text-ink">{detailMap[wb.id].receiver_name}</span>
                                </div>
                              )}
                              {detailMap[wb.id].receiver_phone && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Phone className="w-4 h-4 text-ink-faint" />
                                  <span className="text-ink">{detailMap[wb.id].receiver_phone}</span>
                                </div>
                              )}
                              {detailMap[wb.id].receiver_address && (
                                <div className="flex items-center gap-2 text-sm col-span-2">
                                  <Home className="w-4 h-4 text-ink-faint" />
                                  <span className="text-ink">{detailMap[wb.id].receiver_address}</span>
                                </div>
                              )}
                            </div>
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
                                {detailMap[wb.id].items.map((item) => (
                                  <tr key={item.id} className="border-b border-line-soft last:border-0">
                                    <td className="py-2 px-2">
                                      <code className="text-xs bg-white px-1.5 py-0.5 rounded text-ink-soft">
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
                        ) : (
                          <div className="text-center py-8 text-ink-faint">暂无明细</div>
                        )}
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
