import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

export const metadata: Metadata = {
  title: "SundayPlan — admin",
  description: "Church service planning + volunteer scheduling",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-white/[0.06] md:block">
            <Sidebar />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 px-6 py-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
