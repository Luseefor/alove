"use client";

import { DashboardSidebar } from "@/components/landing/DashboardSidebar";
import { DashboardHeader } from "@/components/landing/DashboardHeader";
import { DashboardHero } from "@/components/landing/DashboardHero";
import { DashboardContent } from "@/components/landing/DashboardContent";
import { Info, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const [showTip, setShowTip] = useState(true);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] h-screen bg-background overflow-hidden font-sans antialiased text-foreground">
      <div className="hidden lg:block">
        <DashboardSidebar />
      </div>

      <div className="flex flex-col min-w-0 h-full relative overflow-hidden">
        <DashboardHeader />

        <div className="flex-1 overflow-y-auto scroll-smooth bg-background">
          <main className="max-w-[1400px] mx-auto w-full p-4 sm:p-8 lg:p-12 space-y-12">
            <DashboardHero />
            <DashboardContent />
          </main>

          {showTip && (
            <div className="px-8 lg:px-12 pb-12">
              <div className="max-w-[1400px] mx-auto">
                <div className="bg-primary/95 backdrop-blur-md text-white px-8 py-5 rounded-[32px] shadow-2xl flex flex-wrap items-center justify-between gap-4 border border-white/10 relative overflow-hidden ring-1 ring-black/5">
                  <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent)] pointer-events-none" />
                  <div className="flex min-w-0 basis-full items-center gap-3 relative z-10 sm:basis-auto sm:flex-1">
                    <div className="w-12 h-12 bg-background/20 rounded-2xl flex items-center justify-center shrink-0 shadow-inner border border-white/10">
                      <Info className="w-6 h-6 text-white" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[15px] font-black tracking-tight text-white uppercase tracking-widest">
                        Pro Tip
                      </p>
                      <p className="text-[14px] text-white/90 font-bold leading-relaxed">
                        Use snippets and templates to accelerate your writing.
                        Export your source for a portable backup.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 relative z-10">
                    <Link
                      href="/help"
                      className="text-[13px] font-black px-6 py-3 bg-background/10 hover:bg-background/20 rounded-2xl transition-all flex items-center gap-2 whitespace-nowrap uppercase tracking-widest border border-white/10 active:scale-95"
                    >
                      Learn more <ExternalLink className="w-4 h-4" />
                    </Link>
                    <button
                      aria-label="Dismiss writing tip"
                      onClick={() => setShowTip(false)}
                      className="p-2.5 hover:bg-background/10 rounded-2xl transition-all shrink-0 active:scale-90"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
