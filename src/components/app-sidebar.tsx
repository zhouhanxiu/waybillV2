"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Truck, ListOrdered, Activity, ClipboardList, GitBranch, Gauge } from "lucide-react";

const navItems = [
  { href: "/", label: "智能导入", icon: Home },
  { href: "/tasks", label: "导入任务", icon: ClipboardList },
  { href: "/loadtest", label: "压测验证", icon: Gauge },
  { href: "/monitor-v4", label: "监控看板", icon: Activity },
  { href: "/traces", label: "Trace 检索", icon: GitBranch },
  { href: "/waybills", label: "运单列表", icon: Truck },
  { href: "/rules", label: "规则管理", icon: ListOrdered },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-r border-line flex-shrink-0 hidden md:flex flex-col">
      <div className="p-4">
        <div className="flex items-center gap-2 px-3 py-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-jingtian to-jingtian-dark flex items-center justify-center text-white font-bold text-sm">
            AI
          </div>
          <span className="font-bold text-ink">万能导入</span>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-jingtian-soft text-jingtian-dark"
                    : "text-ink-soft hover:bg-bg hover:text-ink"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
