"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ScanLine,
  Package,
  Hash,
  Boxes,
  AlertCircle,
  CheckCircle,
  Loader2,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";

type VerifyResult = {
  valid: boolean;
  item?: {
    sku_code: string;
    sku_name: string;
    quantity: number;
    spec: string;
  } | null;
  reason?: string;
};

export default function ScanPage() {
  const router = useRouter();
  const [externalCode, setExternalCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [skuName, setSkuName] = useState("");
  const [expectedQty, setExpectedQty] = useState<number | "">("");
  const [spec, setSpec] = useState("");
  const [actualQty, setActualQty] = useState<number | "">("");
  const [damageLevel, setDamageLevel] = useState(0);
  const [specMatch, setSpecMatch] = useState(true);
  const [operator, setOperator] = useState("operator_demo");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const verifySku = useCallback(async () => {
    if (!externalCode.trim() || !skuCode.trim()) return;
    setLoading(true);
    setError("");
    setSkuName("");
    setExpectedQty("");
    setSpec("");
    try {
      const res = await fetch(
        `/api/waybills/verify-sku?external_code=${encodeURIComponent(externalCode.trim())}&sku_code=${encodeURIComponent(skuCode.trim())}`,
        {
          headers: {
            authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY || "v3-internal-key"}`,
          },
        }
      );
      const data: VerifyResult = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || "校验失败");
      }
      if (!data.valid || !data.item) {
        throw new Error(data.reason || "SKU 校验不通过");
      }
      setSkuName(data.item.sku_name || "");
      setExpectedQty(Number(data.item.quantity) || 0);
      setSpec(data.item.spec || "");
    } catch (err: any) {
      setError(err.message || "无法带出 SKU 信息");
    } finally {
      setLoading(false);
    }
  }, [externalCode, skuCode]);

  // SKU 编码变化后自动触发带出
  useEffect(() => {
    const timer = setTimeout(() => {
      if (skuCode.trim() && externalCode.trim()) {
        verifySku();
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [skuCode, externalCode, verifySku]);

  const handleSubmit = async () => {
    if (!externalCode.trim() || !skuCode.trim() || !skuName) {
      setError("请先填写运单号/SKU 编码并确认 SKU 已自动带出");
      return;
    }
    if (actualQty === "") {
      setError("请填写实际数量");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_code: externalCode.trim(),
          sku_code: skuCode.trim(),
          sku_name: skuName,
          operator,
          expected_qty: expectedQty === "" ? 0 : Number(expectedQty),
          actual_qty: Number(actualQty),
          damage_level: Number(damageLevel),
          spec_match: specMatch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "扫描提交失败");
      }
      setResult(data);
      if (data.scan?.result === "fail") {
        setError(`品控检测不通过，已自动创建工单${data.ticket ? "（" + data.ticket.id + "）" : ""}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const passed = result?.scan?.result === "pass";
  const failed = result?.scan?.result === "fail";

  return (
    <div className="max-w-[800px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-jingtian-soft flex items-center justify-center">
          <ScanLine className="w-5 h-5 text-jingtian-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">扫描品控</h1>
          <p className="text-sm text-ink-faint">仓库扫描操作入口，自动触发品控规则引擎检测</p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-bg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回工作台
        </button>
      </div>

      <div className="bg-card border border-line rounded-2xl shadow-sm p-6 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-danger-bg border border-danger/20 text-danger flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">{error}</div>
          </div>
        )}

        {passed && (
          <div className="p-4 rounded-xl bg-success/10 border border-success/30 text-success flex items-center gap-2 text-sm">
            <CheckCircle className="w-5 h-5" />
            扫描通过，商品正常流转
          </div>
        )}

        {failed && (
          <div className="p-4 rounded-xl bg-warn-bg border border-warn/20 text-warn flex items-center gap-2 text-sm">
            <AlertTriangle className="w-5 h-5" />
            品控检测不通过，已自动创建工单并暂扣
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              运单号 <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <input
                type="text"
                value={externalCode}
                onChange={(e) => setExternalCode(e.target.value)}
                placeholder="请输入/扫描运单号"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              SKU 编码 <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <input
                type="text"
                value={skuCode}
                onChange={(e) => setSkuCode(e.target.value)}
                placeholder="请输入/扫描 SKU 编码"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">SKU 名称</label>
            <div className="relative">
              <Boxes className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <input
                type="text"
                value={skuName}
                readOnly
                placeholder="自动带出"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-line bg-bg/70 text-sm text-ink focus:outline-none"
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-jingtian" />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">规格</label>
            <input
              type="text"
              value={spec}
              readOnly
              placeholder="自动带出"
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg/70 text-sm text-ink focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">预期数量</label>
            <input
              type="number"
              value={expectedQty}
              readOnly
              placeholder="自动带出"
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg/70 text-sm text-ink focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              实际数量 <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              min={0}
              value={actualQty}
              onChange={(e) => setActualQty(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="请填写实际数量"
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">破损等级</label>
            <select
              value={damageLevel}
              onChange={(e) => setDamageLevel(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            >
              <option value={0}>无破损</option>
              <option value={1}>轻微破损</option>
              <option value={2}>中度破损</option>
              <option value={3}>严重破损</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">规格是否匹配</label>
            <select
              value={specMatch ? "true" : "false"}
              onChange={(e) => setSpecMatch(e.target.value === "true")}
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            >
              <option value="true">匹配</option>
              <option value="false">不匹配</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">操作人</label>
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-line">
          <button
            onClick={() => {
              setExternalCode("");
              setSkuCode("");
              setSkuName("");
              setExpectedQty("");
              setSpec("");
              setActualQty("");
              setDamageLevel(0);
              setSpecMatch(true);
              setError("");
              setResult(null);
            }}
            className="px-5 py-2.5 rounded-xl border border-line text-sm font-medium text-ink-soft hover:bg-bg transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-jingtian text-white text-sm font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
            提交扫描
          </button>
        </div>
      </div>

      {/* 品控规则说明 */}
      <div className="mt-6 p-5 rounded-2xl bg-warn-bg border border-warn/20 text-sm text-warn">
        <p className="font-medium mb-1">品控规则</p>
        <p className="opacity-80">
          当实际数量 = 预期数量、规格匹配且破损等级为 0 时判定通过；任意一项不满足则品控暂扣并自动创建工单。
        </p>
      </div>
    </div>
  );
}
