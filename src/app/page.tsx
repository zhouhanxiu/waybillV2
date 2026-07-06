"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Settings,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Trash2,
  Download,
  Eye,
  Pencil,
  Save,
  X,
  Plus,
  RotateCw,
  ChevronDown,
  Search,
} from "lucide-react";
import { validateAllWaybills, getErrorRowIndices, getErrorFieldsByRow } from "@/lib/validation";
import { exportToExcel, AggregatedWaybill } from "@/lib/export";

// ──── 类型 ──────────────────────────────────────────────────────────

type Step = "upload" | "analyze" | "preview" | "done";

type ParsedRow = Record<string, any>;

type ParseRule = {
  id: string;
  name: string;
  fileType: "excel" | "pdf";
  config: any;
  createdAt?: string;
};

// ──── 工具函数 ──────────────────────────────────────────────────────

function s(v: any): string {
  return v == null ? "" : String(v).trim();
}

function aggregateByCode(rows: ParsedRow[]): AggregatedWaybill[] {
  const map = new Map<string, AggregatedWaybill>();
  for (const row of rows) {
    const hasExternalCode = !!s(row.external_code);
    const key = s(row.external_code) || s(row.store_name) || `row_${Math.random().toString(36).slice(2, 6)}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        external_code: hasExternalCode ? row.external_code : undefined,
        store_name: row.store_name,
        receiver_name: row.receiver_name,
        receiver_phone: row.receiver_phone,
        receiver_address: row.receiver_address,
        remark: row.remark,
        items: [],
        _sheet: row._sheet,
      });
    }
    map.get(key)!.items.push({
      sku_code: row.sku_code,
      sku_name: row.sku_name,
      quantity: row.quantity,
      spec: row.spec,
    });
  }
  return Array.from(map.values());
}

// ──── 进度条组件 ────────────────────────────────────────────────────

function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  return (
    <div className="w-full">
      {label && <p className="text-sm text-ink-soft mb-2">{label}</p>}
      <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-jingtian rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {pct > 0 && pct < 100 && (
        <p className="text-xs text-ink-faint mt-1">{Math.round(pct)}%</p>
      )}
    </div>
  );
}

// ──── Toast 提示组件 ─────────────────────────────────────────────────

function Toast({
  type,
  message,
  onClose,
}: {
  type: "success" | "error" | "warn";
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const bg =
    type === "success"
      ? "bg-success/10 border-success/30 text-success"
      : type === "error"
      ? "bg-danger-bg border-danger/30 text-danger"
      : "bg-warn-bg border-warn/30 text-warn";

  const icon =
    type === "success" ? (
      <CheckCircle className="w-4 h-4" />
    ) : type === "error" ? (
      <AlertCircle className="w-4 h-4" />
    ) : (
      <AlertCircle className="w-4 h-4" />
    );

  return (
    <div
      className={`fixed top-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg ${bg} animate-in slide-in-from-right`}
    >
      {icon}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ──── 主页面组件 ────────────────────────────────────────────────────

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [aggregatedWaybills, setAggregatedWaybills] = useState<AggregatedWaybill[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<{ waybillKey: string; itemIdx: number; field: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiGeneratedRule, setAiGeneratedRule] = useState<(Partial<ParseRule> & { guessed?: string[] }) | null>(null);
  const [showRuleManager, setShowRuleManager] = useState(false);
  const [waybillPage, setWaybillPage] = useState(1);
  const [expandedWaybills, setExpandedWaybills] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error" | "warn"; message: string } | null>(null);
  const [parseProgress, setParseProgress] = useState({ pct: 0, label: "" });
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);

  // 校验结果
  const [validationErrors, setValidationErrors] = useState<ReturnType<typeof validateAllWaybills>>([]);
  const errorRowSet = useMemo(() => getErrorRowIndices(validationErrors), [validationErrors]);
  const errorFieldsByRow = useMemo(() => getErrorFieldsByRow(validationErrors), [validationErrors]);

  const WAYBILLS_PER_PAGE = 50;

  const totalSkuCount = useMemo(
    () => aggregatedWaybills.reduce((sum, wb) => sum + wb.items.length, 0),
    [aggregatedWaybills]
  );

  const pagedWaybills = useMemo(() => {
    const start = (waybillPage - 1) * WAYBILLS_PER_PAGE;
    return aggregatedWaybills.slice(start, start + WAYBILLS_PER_PAGE);
  }, [aggregatedWaybills, waybillPage]);

  const totalPages = Math.ceil(aggregatedWaybills.length / WAYBILLS_PER_PAGE);

  const toggleWaybillExpand = useCallback((key: string) => {
    setExpandedWaybills((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ──── 文件选择 ──────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls" && ext !== "pdf") {
      setError("仅支持 .xlsx / .xls / .pdf 格式文件");
      return;
    }
    setFile(f);
    setFileName(f.name);
    setError("");
  }, []);

  // ──── 加载规则列表 ──────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data);
        if (data.length > 0 && !selectedRuleId) {
          setSelectedRuleId(data[0].id);
        }
      }
    } catch {
      // ignore
    }
  }, [selectedRuleId]);

  // ──── 加载已有外部编码 ──────────────────────────────────────────

  const loadExistingCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/existing-codes");
      if (res.ok) {
        const data = await res.json();
        setExistingCodes(data.codes || []);
      }
    } catch {
      // ignore
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadRules();
    loadExistingCodes();
  }, [loadRules, loadExistingCodes]);

  // ──── 重新校验 ──────────────────────────────────────────────────

  const revalidate = useCallback(
    (waybills: AggregatedWaybill[]) => {
      const errs = validateAllWaybills(waybills, existingCodes);
      setValidationErrors(errs);
    },
    [existingCodes]
  );

  // ──── AI 分析 ────────────────────────────────────────────────────

  const handleAiAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setParseProgress({ pct: 10, label: "正在上传文件..." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      setParseProgress({ pct: 30, label: "AI 正在分析文件结构..." });

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "AI 分析失败");
      }

      setParseProgress({ pct: 80, label: "正在生成解析规则..." });

      const data = await res.json();
      setAiGeneratedRule(data);
      setStep("analyze");
      setParseProgress({ pct: 100, label: "分析完成" });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setParseProgress({ pct: 0, label: "" }), 500);
    }
  }, [file]);

  // ──── 试解析预览 ────────────────────────────────────────────────

  const handleTestParse = useCallback(async () => {
    if (!file || !aiGeneratedRule?.config) return;
    setLoading(true);
    setError("");

    try {
      // 临时保存规则到服务器
      const saveRes = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: aiGeneratedRule.name || `临时规则_${Date.now()}`,
          fileType: aiGeneratedRule.fileType || "excel",
          config: aiGeneratedRule.config,
        }),
      });

      if (!saveRes.ok) throw new Error("保存规则失败");
      const savedRule = await saveRes.json();

      // 执行解析
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ruleId", savedRule.id);

      const parseRes = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.error || "试解析失败");
      }

      const parseData = await parseRes.json();
      setParsedRows(parseData.rows || []);
      setWarnings(parseData.warnings || []);
      const wbs = aggregateByCode(parseData.rows || []);
      setAggregatedWaybills(wbs);
      revalidate(wbs);
      setWaybillPage(1);
      setStep("preview");
      setToast({ type: "success", message: `试解析完成：${wbs.length} 条运单，${parseData.rows?.length || 0} 个 SKU` });

      // 清理临时规则
      try {
        await fetch(`/api/rules?id=${savedRule.id}`, { method: "DELETE" });
      } catch { /* ignore */ }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [file, aiGeneratedRule, revalidate]);

  // ──── 保存 AI 生成的规则 ────────────────────────────────────────

  const handleSaveRule = useCallback(async () => {
    if (!aiGeneratedRule) return;
    setLoading(true);

    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: aiGeneratedRule.name || `规则_${Date.now()}`,
          fileType: aiGeneratedRule.fileType || "excel",
          config: aiGeneratedRule.config || {},
        }),
      });

      if (!res.ok) throw new Error("保存规则失败");

      const data = await res.json();
      setSelectedRuleId(data.id);
      await loadRules();
      setToast({ type: "success", message: "规则已保存，正在解析..." });

      // 自动执行解析
      await handleParse(data.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [aiGeneratedRule, loadRules]);

  // ──── 手动选择规则后解析 ────────────────────────────────────────

  const handleManualParse = useCallback(async () => {
    if (!selectedRuleId) {
      setError("请先选择或创建解析规则");
      return;
    }
    await handleParse(selectedRuleId);
  }, [selectedRuleId]);

  // ──── 执行解析 ──────────────────────────────────────────────────

  const handleParse = useCallback(
    async (ruleId: string) => {
      if (!file) return;
      setLoading(true);
      setError("");
      setParseProgress({ pct: 10, label: "正在读取文件..." });

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("ruleId", ruleId);

        setParseProgress({ pct: 40, label: "正在执行解析规则..." });

        const res = await fetch("/api/parse", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "解析失败");
        }

        setParseProgress({ pct: 80, label: "正在聚合运单数据..." });

        const data = await res.json();
        setParsedRows(data.rows || []);
        setWarnings(data.warnings || []);
        const wbs = aggregateByCode(data.rows || []);
        setAggregatedWaybills(wbs);
        revalidate(wbs);
        setWaybillPage(1);
        setStep("preview");
        setParseProgress({ pct: 100, label: "解析完成" });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        setTimeout(() => setParseProgress({ pct: 0, label: "" }), 500);
      }
    },
    [file, revalidate]
  );

  // ──── 提交运单 ──────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    // 提交前校验
    const errs = validateAllWaybills(aggregatedWaybills, existingCodes);
    setValidationErrors(errs);
    if (errs.length > 0) {
      setError(`存在 ${errs.length} 个校验错误，请修正后再提交`);
      return;
    }

    setSubmitting(true);
    setSubmitProgress(10);
    setError("");

    try {
      const waybills = aggregatedWaybills.map((wb) => ({
        external_code: wb.external_code,
        store_name: wb.store_name,
        receiver_name: wb.receiver_name,
        receiver_phone: wb.receiver_phone,
        receiver_address: wb.receiver_address,
        remark: wb.remark,
        items: wb.items,
      }));

      setSubmitProgress(30);

      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          ruleId: selectedRuleId,
          waybills,
        }),
      });

      setSubmitProgress(80);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "提交失败");
      }

      const data = await res.json();
      setSubmitProgress(100);
      setToast({ type: "success", message: `提交成功：${data.waybillCount} 条运单已导入` });
      setStep("done");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
      setTimeout(() => setSubmitProgress(0), 500);
    }
  }, [aggregatedWaybills, fileName, selectedRuleId, existingCodes]);

  // ──── 单元格编辑 ────────────────────────────────────────────────

  const handleCellEdit = useCallback(
    (waybillKey: string, itemIdx: number, field: string, value: string) => {
      setAggregatedWaybills((prev) => {
        const updated = prev.map((wb) => {
          if (wb.key !== waybillKey) return wb;
          if (field.startsWith("item_")) {
            const itemField = field.replace("item_", "");
            const newItems = [...wb.items];
            newItems[itemIdx] = {
              ...newItems[itemIdx],
              [itemField]: itemField === "quantity" ? parseFloat(value) || 0 : value,
            };
            return { ...wb, items: newItems };
          }
          return { ...wb, [field]: value };
        });
        // 编辑后重新校验
        setTimeout(() => revalidate(updated), 0);
        return updated;
      });
    },
    [revalidate]
  );

  // ──── 删除行 ────────────────────────────────────────────────────

  const handleDeleteRow = useCallback(
    (waybillKey: string) => {
      setAggregatedWaybills((prev) => {
        const updated = prev.filter((wb) => wb.key !== waybillKey);
        revalidate(updated);
        return updated;
      });
      setToast({ type: "success", message: "已删除运单" });
    },
    [revalidate]
  );

  // ──── 新增空行 ──────────────────────────────────────────────────

  const handleAddRow = useCallback(() => {
    const newKey = `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newWb: AggregatedWaybill = {
      key: newKey,
      external_code: "",
      store_name: "",
      receiver_name: "",
      receiver_phone: "",
      receiver_address: "",
      remark: "",
      items: [{ sku_code: "", sku_name: "", quantity: 1, spec: "" }],
    };
    setAggregatedWaybills((prev) => [...prev, newWb]);
    setToast({ type: "success", message: "已添加空行" });
  }, []);

  // ──── 导出 Excel ────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      await exportToExcel(aggregatedWaybills, fileName.replace(/\.[^.]+$/, ""));
      setToast({ type: "success", message: "导出成功" });
    } catch (err: any) {
      setError("导出失败：" + (err.message || "未知错误"));
    }
  }, [aggregatedWaybills, fileName]);

  // ──── 重置 ──────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setFileName("");
    setParsedRows([]);
    setAggregatedWaybills([]);
    setWarnings([]);
    setAiGeneratedRule(null);
    setWaybillPage(1);
    setError("");
    setValidationErrors([]);
    setParseProgress({ pct: 0, label: "" });
    setSubmitProgress(0);
  }, []);

  // ──── 渲染 ──────────────────────────────────────────────────────

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Toast */}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* 步骤指示器 */}
      <div className="mb-10">
        <div className="flex items-center justify-center gap-2">
          {(["upload", "analyze", "preview", "done"] as Step[]).map((s, idx) => {
            const active = step === s;
            const done =
              (s === "upload" && (step === "analyze" || step === "preview" || step === "done")) ||
              (s === "analyze" && (step === "preview" || step === "done")) ||
              (s === "preview" && step === "done") ||
              (s === "done" && step === "done");

            return (
              <div key={s} className="flex items-center gap-2">
                {idx > 0 && (
                  <div
                    className={`w-8 h-0.5 rounded ${done ? "bg-jingtian" : "bg-line"}`}
                  />
                )}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    active
                      ? "bg-jingtian text-white"
                      : done
                      ? "bg-jingtian-soft text-jingtian-dark"
                      : "bg-line-soft text-ink-faint"
                  }`}
                >
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs border border-current">
                    {done ? <CheckCircle className="w-3 h-3" /> : idx + 1}
                  </span>
                  {s === "upload" && "上传文件"}
                  {s === "analyze" && "AI 分析"}
                  {s === "preview" && "预览编辑"}
                  {s === "done" && "提交完成"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 进度条 */}
      {parseProgress.pct > 0 && (
        <div className="mb-6 max-w-lg mx-auto">
          <ProgressBar pct={parseProgress.pct} label={parseProgress.label} />
        </div>
      )}
      {submitProgress > 0 && (
        <div className="mb-6 max-w-lg mx-auto">
          <ProgressBar pct={submitProgress} label="正在提交运单..." />
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-danger-bg border border-danger/20 text-danger flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-sm">操作失败</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
          <button onClick={() => setError("")} className="ml-auto p-1 hover:bg-danger/10 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 步骤1：上传文件 */}
      {step === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 上传区域 */}
          <div className="lg:col-span-2">
            <div
              className="border-2 border-dashed border-line rounded-2xl p-12 text-center cursor-pointer hover:border-jingtian hover:bg-jingtian-soft/30 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) {
                  const ext = f.name.split(".").pop()?.toLowerCase();
                  if (ext === "xlsx" || ext === "xls" || ext === "pdf") {
                    setFile(f);
                    setFileName(f.name);
                    setError("");
                  } else {
                    setError("仅支持 .xlsx / .xls / .pdf 格式文件");
                  }
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.pdf"
                className="hidden"
                onChange={handleFileSelect}
              />

              {file ? (
                <div className="flex flex-col items-center gap-4">
                  {fileName.endsWith(".pdf") ? (
                    <FileText className="w-16 h-16 text-jingtian" />
                  ) : (
                    <FileSpreadsheet className="w-16 h-16 text-jingtian" />
                  )}
                  <div>
                    <p className="text-lg font-semibold text-ink">{fileName}</p>
                    <p className="text-sm text-ink-faint mt-1">
                      {(file.size / 1024).toFixed(1)} KB ·{" "}
                      {fileName.endsWith(".pdf") ? "PDF 文档" : "Excel 工作簿"}
                    </p>
                  </div>
                  <button
                    className="text-sm text-jingtian hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setFileName("");
                    }}
                  >
                    重新选择
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <Upload className="w-12 h-12 text-ink-faint" />
                  <div>
                    <p className="text-lg font-medium text-ink">
                      拖拽文件到此处，或点击上传
                    </p>
                    <p className="text-sm text-ink-faint mt-1">
                      支持 .xlsx / .xls / .pdf 格式
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 文件选中后的操作 */}
            {file && (
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleAiAnalyze}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <RotateCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Sparkles className="w-5 h-5" />
                  )}
                  AI 智能分析
                </button>
                <button
                  onClick={() => {
                    loadRules();
                    setShowRuleManager(true);
                  }}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors"
                >
                  <Settings className="w-5 h-5" />
                  手动选择规则
                </button>
              </div>
            )}
          </div>

          {/* 右侧提示 */}
          <div className="space-y-4">
            <div className="p-5 rounded-xl bg-card border border-line shadow-sm">
              <h3 className="font-semibold text-ink mb-3">AI 智能解析流程</h3>
              <div className="space-y-3 text-sm text-ink-soft">
                <div className="flex gap-2">
                  <span className="text-jingtian font-bold">1.</span>
                  上传任意格式的出库单文件（Excel/PDF）
                </div>
                <div className="flex gap-2">
                  <span className="text-jingtian font-bold">2.</span>
                  AI 自动分析文件结构，生成解析规则
                </div>
                <div className="flex gap-2">
                  <span className="text-jingtian font-bold">3.</span>
                  预览解析结果，在线编辑修正
                </div>
                <div className="flex gap-2">
                  <span className="text-jingtian font-bold">4.</span>
                  确认无误，一键提交批量下单
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-warn-bg border border-warn/20">
              <h3 className="font-semibold text-warn mb-2 text-sm">支持的文件格式</h3>
              <ul className="text-xs text-ink-soft space-y-1">
                <li>• 标准 Excel 出库单（.xlsx/.xls）</li>
                <li>• 合并单元格、多行表头</li>
                <li>• 矩阵转置（门店作为列名）</li>
                <li>• 卡片式记录格式</li>
                <li>• 尾部收货人信息</li>
                <li>• 多 Sheet 工作簿</li>
                <li>• PDF 出库单</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 步骤2：AI 分析结果确认 */}
      {step === "analyze" && aiGeneratedRule && (
        <div className="max-w-2xl mx-auto">
          <div className="p-6 rounded-2xl bg-card border border-line shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <Sparkles className="w-6 h-6 text-jingtian" />
              <h2 className="text-xl font-bold text-ink">AI 分析结果</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">规则名称</label>
                <input
                  type="text"
                  value={aiGeneratedRule.name || ""}
                  onChange={(e) =>
                    setAiGeneratedRule((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-line bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">文件类型</label>
                <div className="px-4 py-2.5 rounded-xl bg-bg text-ink">
                  {aiGeneratedRule.fileType === "pdf" ? "PDF 文档" : "Excel 工作簿"}
                </div>
              </div>

              {aiGeneratedRule.guessed && aiGeneratedRule.guessed.length > 0 && (
                <div className="p-4 rounded-xl bg-warn-bg border border-warn/20">
                  <p className="text-sm font-medium text-warn mb-2">
                    <AlertCircle className="w-4 h-4 inline mr-1" />
                    以下字段为 AI 推测，建议确认：
                  </p>
                  <ul className="text-xs text-ink-soft space-y-0.5">
                    {aiGeneratedRule.guessed.map((g: string, i: number) => (
                      <li key={i}>• {g}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  解析引擎
                </label>
                <div className="flex items-center gap-2 mb-3">
                  <span className={"px-2.5 py-1 rounded-lg text-xs font-medium border " + (aiGeneratedRule.config?.engine === "matrix" ? "bg-purple-50 border-purple-200 text-purple-700" : aiGeneratedRule.config?.engine === "card" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-green-50 border-green-200 text-green-700")}>
                    {aiGeneratedRule.config?.engine === "matrix" ? "矩阵转置引擎" : aiGeneratedRule.config?.engine === "card" ? "卡片拆分引擎" : "行表格引擎"}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {aiGeneratedRule.config?.engine === "matrix" ? "门店作为列名，自动转置为行" : aiGeneratedRule.config?.engine === "card" ? "按调拨记录卡片拆分" : "标准表格行解析"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  规则配置预览
                </label>
                <pre className="p-4 rounded-xl bg-bg border border-line text-xs text-ink-soft overflow-auto max-h-48">
                  {JSON.stringify(aiGeneratedRule.config, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStep("upload")}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </button>
              <button
                onClick={handleTestParse}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-jingtian text-jingtian hover:bg-jingtian-soft transition-colors text-sm"
              >
                <Eye className="w-4 h-4" />
                试解析预览
              </button>
              <button
                onClick={handleSaveRule}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <RotateCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                保存规则并解析
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 步骤3：预览编辑 */}
      {step === "preview" && (
        <div>
          {/* 统计栏 */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="px-4 py-2 rounded-xl bg-card border border-line shadow-sm">
                <span className="text-sm text-ink-faint">解析结果：</span>
                <span className="font-semibold text-jingtian">{aggregatedWaybills.length} 条运单</span>
                <span className="text-sm text-ink-faint ml-2">({totalSkuCount} 个 SKU)</span>
              </div>
              {warnings.length > 0 && (
                <div className="px-4 py-2 rounded-xl bg-warn-bg border border-warn/20">
                  <span className="text-sm text-warn">
                    <AlertCircle className="w-4 h-4 inline mr-1" />
                    {warnings.length} 条警告
                  </span>
                </div>
              )}
              {validationErrors.length > 0 && (
                <div className="px-4 py-2 rounded-xl bg-danger-bg border border-danger/20">
                  <span className="text-sm text-danger">
                    <AlertCircle className="w-4 h-4 inline mr-1" />
                    {validationErrors.length} 个校验错误
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors text-xs"
                title="新增空行"
              >
                <Plus className="w-4 h-4" />
                新增
              </button>
              <button
                onClick={() => setExpandedWaybills(new Set())}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors text-xs"
                title="全部收起"
              >
                全部收起
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors text-xs"
                title="导出 Excel"
              >
                <Download className="w-4 h-4" />
                导出
              </button>
              <button
                onClick={() => setStep("upload")}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || aggregatedWaybills.length === 0}
                className="flex items-center gap-2 px-6 py-2 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-50 text-sm"
              >
                {submitting ? (
                  <RotateCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                提交批量下单
              </button>
            </div>
          </div>

          {/* 校验错误汇总 */}
          {validationErrors.length > 0 && (
            <div className="mb-4 p-4 rounded-xl bg-danger-bg border border-danger/20">
              <p className="text-sm font-medium text-danger mb-2">
                <AlertCircle className="w-4 h-4 inline mr-1" />
                数据校验发现 {validationErrors.length} 个问题：
              </p>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-danger/70">
                      <th className="text-left py-1 pr-2">行号</th>
                      <th className="text-left py-1 pr-2">字段</th>
                      <th className="text-left py-1">错误原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationErrors.map((e, i) => (
                      <tr key={i} className="border-t border-danger/10">
                        <td className="py-1 pr-2 text-danger font-medium">第 {e.rowIndex + 1} 行</td>
                        <td className="py-1 pr-2 text-danger/80">{e.field}</td>
                        <td className="py-1 text-danger/80">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 运单表格 */}
          <div className="bg-card rounded-2xl border border-line shadow-sm overflow-hidden">
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-bg sticky top-0 z-10">
                  <tr className="border-b border-line">
                    <th className="text-left px-4 py-3 font-semibold text-ink-soft w-12">#</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-soft">外部编码</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-soft">门店</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-soft">SKU 概况</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-soft" colSpan={5}>收货信息</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-soft w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedWaybills.map((wb, wbIdx) => {
                    const realWbIdx = (waybillPage - 1) * WAYBILLS_PER_PAGE + wbIdx;
                    const isExpanded = expandedWaybills.has(wb.key);
                    const skuCount = wb.items.length;
                    const hasError = errorRowSet.has(realWbIdx);
                    const errFields = errorFieldsByRow.get(realWbIdx);

                    return (
                      <tr
                        key={wb.key}
                        className={`border-b border-line-soft hover:bg-jingtian-soft/30 transition-colors cursor-pointer ${
                          hasError ? "bg-danger-bg/30" : ""
                        }`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest(".row-action")) return;
                          toggleWaybillExpand(wb.key);
                        }}
                      >
                        <td className="px-4 py-3 text-ink-faint align-top">
                          {realWbIdx + 1}
                          {hasError && <AlertCircle className="w-3 h-3 text-danger inline ml-1" />}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <EditableCell
                            value={wb.external_code || ""}
                            isEditing={
                              editingCell?.waybillKey === wb.key &&
                              editingCell?.itemIdx === -1 &&
                              editingCell?.field === "external_code"
                            }
                            hasError={errFields?.has("external_code")}
                            onEdit={(e) => { e?.stopPropagation?.(); setEditingCell({ waybillKey: wb.key, itemIdx: -1, field: "external_code" }); }}
                            onSave={(v) => {
                              handleCellEdit(wb.key, -1, "external_code", v);
                              setEditingCell(null);
                            }}
                            onCancel={() => setEditingCell(null)}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <EditableCell
                            value={wb.store_name || ""}
                            isEditing={
                              editingCell?.waybillKey === wb.key &&
                              editingCell?.itemIdx === -1 &&
                              editingCell?.field === "store_name"
                            }
                            hasError={errFields?.has("store_name") || errFields?.has("receiver_info")}
                            onEdit={(e) => { e?.stopPropagation?.(); setEditingCell({ waybillKey: wb.key, itemIdx: -1, field: "store_name" }); }}
                            onSave={(v) => {
                              handleCellEdit(wb.key, -1, "store_name", v);
                              setEditingCell(null);
                            }}
                            onCancel={() => setEditingCell(null)}
                          />
                        </td>
                        <td className="px-4 py-3 align-top text-ink-faint">
                          <span className="inline-flex items-center gap-1">
                            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            {skuCount} 个 SKU
                          </span>
                        </td>
                        <td colSpan={5} className="px-4 py-3 align-top text-ink-faint text-sm">
                          {wb.receiver_name && (
                            <span className={errFields?.has("receiver_name") ? "text-danger" : ""}>
                              收件人：{wb.receiver_name}
                            </span>
                          )}
                          {wb.receiver_phone && (
                            <span className={`ml-3 ${errFields?.has("receiver_phone") ? "text-danger" : ""}`}>
                              电话：{wb.receiver_phone}
                            </span>
                          )}
                          {!wb.receiver_name && !wb.receiver_phone && !wb.receiver_address && !wb.store_name && (
                            <span className="text-danger italic">收货信息缺失</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <button
                            className="row-action p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger-bg transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleDeleteRow(wb.key); }}
                            title="删除此行"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* SKU 展开行 */}
                {pagedWaybills.map((wb) => {
                  const realWbIdx = (waybillPage - 1) * WAYBILLS_PER_PAGE + pagedWaybills.indexOf(wb);
                  const isExpanded = expandedWaybills.has(wb.key);
                  if (!isExpanded) return null;
                  const errFields = errorFieldsByRow.get(realWbIdx);
                  return (
                    <tr key={`${wb.key}_skus`} className="bg-bg/60">
                      <td colSpan={10} className="p-0">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-line-soft">
                              <th className="text-left px-4 py-2 font-medium text-ink-soft text-xs">SKU 编码</th>
                              <th className="text-left px-4 py-2 font-medium text-ink-soft text-xs">SKU 名称</th>
                              <th className="text-right px-4 py-2 font-medium text-ink-soft text-xs">数量</th>
                              <th className="text-left px-4 py-2 font-medium text-ink-soft text-xs">规格</th>
                              <th className="text-left px-4 py-2 font-medium text-ink-soft text-xs">地址</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wb.items.map((item, itemIdx) => (
                              <tr key={`${wb.key}_item_${itemIdx}`} className="border-b border-line-soft/50 hover:bg-jingtian-soft/20">
                                <td className="px-4 py-2">
                                  <EditableCell
                                    value={item.sku_code || ""}
                                    isEditing={
                                      editingCell?.waybillKey === wb.key &&
                                      editingCell?.itemIdx === itemIdx &&
                                      editingCell?.field === "item_sku_code"
                                    }
                                    hasError={errFields?.has("sku_code")}
                                    onEdit={() => setEditingCell({ waybillKey: wb.key, itemIdx, field: "item_sku_code" })}
                                    onSave={(v) => { handleCellEdit(wb.key, itemIdx, "item_sku_code", v); setEditingCell(null); }}
                                    onCancel={() => setEditingCell(null)}
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <EditableCell
                                    value={item.sku_name || ""}
                                    isEditing={
                                      editingCell?.waybillKey === wb.key &&
                                      editingCell?.itemIdx === itemIdx &&
                                      editingCell?.field === "item_sku_name"
                                    }
                                    hasError={errFields?.has("sku_name")}
                                    onEdit={() => setEditingCell({ waybillKey: wb.key, itemIdx, field: "item_sku_name" })}
                                    onSave={(v) => { handleCellEdit(wb.key, itemIdx, "item_sku_name", v); setEditingCell(null); }}
                                    onCancel={() => setEditingCell(null)}
                                  />
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <EditableCell
                                    value={String(item.quantity ?? "")}
                                    isEditing={
                                      editingCell?.waybillKey === wb.key &&
                                      editingCell?.itemIdx === itemIdx &&
                                      editingCell?.field === "item_quantity"
                                    }
                                    hasError={errFields?.has("quantity")}
                                    onEdit={() => setEditingCell({ waybillKey: wb.key, itemIdx, field: "item_quantity" })}
                                    onSave={(v) => { handleCellEdit(wb.key, itemIdx, "item_quantity", v); setEditingCell(null); }}
                                    onCancel={() => setEditingCell(null)}
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <EditableCell
                                    value={item.spec || ""}
                                    isEditing={
                                      editingCell?.waybillKey === wb.key &&
                                      editingCell?.itemIdx === itemIdx &&
                                      editingCell?.field === "item_spec"
                                    }
                                    onEdit={() => setEditingCell({ waybillKey: wb.key, itemIdx, field: "item_spec" })}
                                    onSave={(v) => { handleCellEdit(wb.key, itemIdx, "item_spec", v); setEditingCell(null); }}
                                    onCancel={() => setEditingCell(null)}
                                  />
                                </td>
                                <td className="px-4 py-2 text-ink-faint text-xs max-w-[180px] truncate">
                                  {wb.receiver_address || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  );
                })}
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 py-3 border-t border-line bg-bg text-sm">
                <button
                  onClick={() => setWaybillPage((p) => Math.max(1, p - 1))}
                  disabled={waybillPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="text-ink-soft">
                  第 <span className="font-medium text-ink">{waybillPage}</span> / {totalPages} 页
                </span>
                <button
                  onClick={() => setWaybillPage((p) => Math.min(totalPages, p + 1))}
                  disabled={waybillPage >= totalPages}
                  className="px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}

            {aggregatedWaybills.length === 0 && (
              <div className="py-16 text-center text-ink-faint">
                <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>暂无解析数据</p>
              </div>
            )}
          </div>

          {/* 警告列表 */}
          {warnings.length > 0 && (
            <div className="mt-4 p-4 rounded-xl bg-warn-bg border border-warn/20">
              <p className="text-sm font-medium text-warn mb-2">解析警告：</p>
              <ul className="text-xs text-ink-soft space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 步骤4：完成 */}
      {step === "done" && (
        <div className="max-w-md mx-auto text-center py-12">
          <div className="w-20 h-20 rounded-full bg-jingtian-soft flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-jingtian" />
          </div>
          <h2 className="text-2xl font-bold text-ink mb-2">提交成功！</h2>
          <p className="text-ink-soft mb-8">
            运单已成功导入系统，共 {aggregatedWaybills.length} 条运单
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark transition-colors"
            >
              <Upload className="w-4 h-4" />
              继续导入
            </button>
            <button
              onClick={() => (window.location.href = "/history")}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors"
            >
              <Eye className="w-4 h-4" />
              查看历史
            </button>
          </div>
        </div>
      )}

      {/* 规则管理器弹出层 */}
      {showRuleManager && (
        <RuleManager
          rules={rules}
          selectedRuleId={selectedRuleId}
          onSelect={(id) => {
            setSelectedRuleId(id);
            setShowRuleManager(false);
          }}
          onClose={() => setShowRuleManager(false)}
          onRefresh={loadRules}
          onParse={handleManualParse}
          file={file}
        />
      )}
    </div>
  );
}

// ──── 可编辑单元格组件 ──────────────────────────────────────────────

function EditableCell({
  value,
  isEditing,
  hasError,
  onEdit,
  onSave,
  onCancel,
}: {
  value: string;
  isEditing: boolean;
  hasError?: boolean;
  onEdit: (e?: React.MouseEvent) => void;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          defaultValue={value}
          autoFocus
          className="cell-input border-b-2 border-jingtian bg-transparent px-1 py-0.5 w-full min-w-[60px]"
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave((e.target as HTMLInputElement).value);
            if (e.key === "Escape") onCancel();
          }}
          onBlur={(e) => onSave(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-1 cursor-pointer min-w-[60px] min-h-[24px]"
      onClick={onEdit}
    >
      <span
        className={
          hasError
            ? "text-danger font-medium"
            : value
            ? "text-ink"
            : "text-ink-faint italic"
        }
      >
        {value || "空"}
      </span>
      <Pencil className="w-3 h-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  );
}

// ──── 规则管理器组件 ──────────────────────────────────────────────

function RuleManager({
  rules,
  selectedRuleId,
  onSelect,
  onClose,
  onRefresh,
  onParse,
  file,
}: {
  rules: ParseRule[];
  selectedRuleId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  onParse: () => void;
  file: File | null;
}) {
  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此规则？")) return;
    try {
      await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
      onRefresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h3 className="font-semibold text-ink">选择解析规则</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg text-ink-faint transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {rules.length === 0 ? (
            <div className="text-center py-8 text-ink-faint">
              <Settings className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>暂无解析规则</p>
              <p className="text-xs mt-1">请先使用 AI 智能分析创建规则</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedRuleId === rule.id
                      ? "border-jingtian bg-jingtian-soft/50"
                      : "border-line hover:border-jingtian/30 hover:bg-bg"
                  }`}
                  onClick={() => onSelect(rule.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink text-sm">{rule.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-ink-faint">
                          {rule.fileType === "pdf" ? "PDF" : "Excel"} ·{" "}
                          {rule.createdAt ? new Date(rule.createdAt).toLocaleDateString("zh-CN") : "—"}
                        </span>
                        {(rule.config as any)?.engine && (
                          <span className={"text-[10px] px-1.5 py-0.5 rounded border " + ((rule.config as any).engine === "matrix" ? "bg-purple-50 border-purple-200 text-purple-700" : (rule.config as any).engine === "card" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-green-50 border-green-200 text-green-700")}>
                            {(rule.config as any).engine === "matrix" ? "矩阵" : (rule.config as any).engine === "card" ? "卡片" : "行"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(rule.id);
                        }}
                        className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger-bg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-line flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg transition-colors text-sm"
          >
            取消
          </button>
          <button
            onClick={onParse}
            disabled={!selectedRuleId || !file}
            className="flex-1 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-50 text-sm"
          >
            使用此规则解析
          </button>
        </div>
      </div>
    </div>
  );
}
