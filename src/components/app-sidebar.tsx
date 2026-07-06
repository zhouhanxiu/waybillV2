"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Truck, ListOrdered, ClipboardList, LayoutDashboard, ScanLine } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { href: "/", label: "智能导入", icon: Home },
  { href: "/waybills", label: "运单列表", icon: Truck },
  { href: "/scan", label: "扫描品控", icon: ScanLine },
  { href: "/tickets", label: "工单列表", icon: ClipboardList },
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
