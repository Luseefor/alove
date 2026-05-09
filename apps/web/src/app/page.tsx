"use client";

import { DashboardSidebar } from "@/components/landing/DashboardSidebar";
import { DashboardHeader } from "@/components/landing/DashboardHeader";
import { DashboardHero } from "@/components/landing/DashboardHero";
import { DashboardContent } from "@/components/landing/DashboardContent";
import { Info, X, ExternalLink } from "lucide-react";
import { useState } from "react";

export default function Home() {
  const [showTip, setShowTip] = useState(true);

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden font-sans antialiased">
      <DashboardSidebar />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto relative scroll-smooth">
        <DashboardHeader />
        
        <main className="flex-1 p-8 lg:p-12 max-w-[1440px] mx-auto w-full space-y-12">
          <DashboardHero />
          <DashboardContent />
        </main>

        {showTip && (
          <div className="sticky bottom-0 inset-x-0 p-4 z-50">
            <div className="max-w-[1440px] mx-auto">
              <div className="bg-primary/95 backdrop-blur-md text-white px-6 py-3.5 rounded-[20px] shadow-2xl flex items-center justify-between gap-4 border border-white/10 ring-1 ring-black/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-[13px] font-medium leading-relaxed">
                    <span className="font-bold">Pro Tip:</span> Use snippets and templates to accelerate your writing. Everything stays local and under your control.
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <button className="text-[12px] font-bold hover:underline flex items-center gap-1.5 opacity-90 hover:opacity-100 transition-opacity">
                    Learn more <ExternalLink className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={() => setShowTip(false)}
                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
