import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "万能导入 - AI 智能多格式批量下单系统",
  description: "AI 驱动的任意格式出库单解析与批量下单",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <div className="min-h-screen flex flex-col">
          <header className="bg-white border-b border-line sticky top-0 z-40">
            <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-jingtian to-jingtian-dark flex items-center justify-center text-white font-bold text-sm">
                AI
              </div>
              <h1 className="text-lg font-bold text-ink tracking-tight">
                万能导入
                <span className="ml-2 text-sm font-normal text-ink-faint">智能多格式批量下单系统</span>
              </h1>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
