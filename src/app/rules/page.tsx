"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  FileText,
  FileSpreadsheet,
  X,
  Save,
  AlertCircle,
  Loader2,
  Search,
} from "lucide-react";

type RuleItem = {
  id: string;
  name: string;
  description?: string;
  fileType: "excel" | "pdf";
  config: any;
  createdAt: string;
  updatedAt: string;
};

const PAGE_SIZE = 10;

const emptyRule = {
  name: "",
  description: "",
  fileType: "excel",
  config: {
    engine: "row",
    structure: {
      headerRows: 0,
      titleRow: 1,
      dataStartRow: 2,
      dataEndMarker: "合计",
      sheetMode: "first",
    },
    fieldMappings: [
      { target: "sku_code", source: "column", value: 0, required: true, transform: "trim" },
      { target: "sku_name", source: "column", value: 1, required: true, transform: "trim" },
      { target: "quantity", source: "column", value: 2, required: true, transform: "number" },
    ],
    aggregation: { enabled: true, keyField: "external_code" },
  },
};

export default function RulesPage() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleItem | null>(null);
  const [form, setForm] = useState(emptyRule);
  const [configJson, setConfigJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const filteredRules = useMemo(() => {
    if (!searchText.trim()) return rules;
    const q = searchText.trim().toLowerCase();
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        r.fileType.toLowerCase().includes(q)
    );
  }, [rules, searchText]);

  const totalPages = Math.ceil(filteredRules.length / PAGE_SIZE);
  const pagedRules = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRules.slice(start, start + PAGE_SIZE);
  }, [filteredRules, page]);

  const openCreate = () => {
    setEditingRule(null);
    setForm(emptyRule);
    setConfigJson(JSON.stringify(emptyRule.config, null, 2));
    setError("");
    setModalOpen(true);
  };

  const openEdit = (rule: RuleItem) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      description: rule.description || "",
      fileType: rule.fileType,
      config: rule.config,
    });
    setConfigJson(JSON.stringify(rule.config, null, 2));
    setError("");
    setModalOpen(true);
  };

  const handleCopy = (rule: RuleItem) => {
    setEditingRule(null);
    setForm({
      name: `${rule.name} 副本`,
      description: rule.description || "",
      fileType: rule.fileType,
      config: rule.config,
    });
    setConfigJson(JSON.stringify(rule.config, null, 2));
    setError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setError("");
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(configJson);
    } catch (e) {
      setError("规则配置 JSON 格式错误");
      return;
    }

    const payload = {
      id: editingRule?.id,
      name: form.name,
      description: form.description,
      fileType: form.fileType,
      config: parsedConfig,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/rules", {
        method: editingRule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "保存失败");
      } else {
        setModalOpen(false);
        await loadRules();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadRules();
      }
    } finally {
      setDeleteId(null);
    }
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleString("zh-CN", { hour12: false });

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">解析规则管理</h1>
          <p className="text-sm text-ink-faint mt-0.5">维护所有解析规则，供导入时复用</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-jingtian text-white text-sm font-medium hover:bg-jingtian-dark transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建规则
        </button>
      </div>

      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          placeholder="搜索规则名称、描述..."
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setPage(1);
          }}
          className="w-full max-w-md pl-10 pr-4 py-2.5 rounded-xl border border-line bg-card text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian transition-all"
        />
      </div>

      <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-line">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">#</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">规则名称</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">文件类型</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">描述</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">更新时间</th>
              <th className="text-left py-3 px-4 font-medium text-ink-faint">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-jingtian" />
                </td>
              </tr>
            ) : pagedRules.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-ink-faint">
                  {searchText ? "无匹配规则" : "暂无规则，点击右上角新建"}
                </td>
              </tr>
            ) : (
              pagedRules.map((rule, idx) => (
                <tr key={rule.id} className="border-b border-line-soft last:border-0 hover:bg-bg/50">
                  <td className="py-3 px-4 text-ink-soft">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="py-3 px-4 font-medium text-ink">{rule.name}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-bg text-xs text-ink-soft">
                      {rule.fileType === "pdf" ? (
                        <FileText className="w-3 h-3" />
                      ) : (
                        <FileSpreadsheet className="w-3 h-3" />
                      )}
                      {rule.fileType.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-ink-soft max-w-xs truncate">
                    {rule.description || "—"}
                  </td>
                  <td className="py-3 px-4 text-ink-soft">{formatDate(rule.updatedAt)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(rule)}
                        className="p-1.5 rounded-lg text-ink-soft hover:bg-jingtian-soft hover:text-jingtian-dark transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleCopy(rule)}
                        className="p-1.5 rounded-lg text-ink-soft hover:bg-jingtian-soft hover:text-jingtian-dark transition-colors"
                        title="复制"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(rule.id)}
                        className="p-1.5 rounded-lg text-ink-soft hover:bg-danger-bg hover:text-danger transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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

      {/* 创建/编辑弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card rounded-2xl shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <h2 className="text-lg font-semibold text-ink">
                {editingRule ? "编辑规则" : "新建规则"}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-bg text-ink-faint"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-auto space-y-4 flex-1">
              {error && (
                <div className="p-3 rounded-lg bg-danger-bg text-danger text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">规则名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
                    placeholder="如：标准出库单"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">文件类型</label>
                  <select
                    value={form.fileType}
                    onChange={(e) => setForm({ ...form, fileType: e.target.value as "excel" | "pdf" })}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
                  >
                    <option value="excel">Excel</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">描述</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian"
                  placeholder="简要说明该规则适用的文件格式"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">规则配置 (JSON)</label>
                <textarea
                  value={configJson}
                  onChange={(e) => setConfigJson(e.target.value)}
                  className="w-full h-64 px-3 py-2 rounded-lg border border-line bg-bg text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-jingtian/20 focus:border-jingtian resize-none"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-4 border-t border-line">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-line text-ink-soft text-sm font-medium hover:bg-bg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-jingtian text-white text-sm font-medium hover:bg-jingtian-dark transition-colors disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card rounded-2xl shadow-lg w-full max-w-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-danger" />
              </div>
              <div>
                <h3 className="font-semibold text-ink">确认删除</h3>
                <p className="text-sm text-ink-faint">删除后无法恢复，是否继续？</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-soft hover:bg-bg"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-medium hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
