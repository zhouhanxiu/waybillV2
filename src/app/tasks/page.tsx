"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Loader2, ClipboardList, RefreshCw } from "lucide-react";

type Task = {
  id: string;
  file_name: string;
  status: string;
  total_rows: number;
  success_rows: number;
  error_rows: number;
  created_at: string;
  finished_at: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  uploaded: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/import-tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-jingtian" />
          <h1 className="text-xl font-bold text-ink">导入任务</h1>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-line text-sm text-ink-soft hover:bg-bg"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-jingtian" /></div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20 text-ink-soft">暂无导入任务，去「智能导入」上传文件吧</div>
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">文件</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-right px-4 py-3">总行数</th>
                <th className="text-right px-4 py-3">成功</th>
                <th className="text-right px-4 py-3">失败</th>
                <th className="text-left px-4 py-3">创建时间</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-line hover:bg-bg">
                  <td className="px-4 py-3 font-medium text-ink truncate max-w-[200px]">{t.file_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[t.status] || "bg-gray-100 text-gray-600"}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{t.total_rows}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-600">{t.success_rows}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{t.error_rows}</td>
                  <td className="px-4 py-3 text-ink-soft">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/tasks/${t.id}`} className="text-jingtian hover:underline">详情</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
