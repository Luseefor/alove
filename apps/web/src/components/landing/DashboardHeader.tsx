"use client";

import React from "react";
import Link from "next/link";
import { Moon, Sun, ArrowUpRight } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { useTheme } from "@/components/theme/ThemeProvider";
import { isLocalStandalone } from "@/lib/localStandalone";
import styles from "./landing.module.css";

export function DashboardHeader() {
  const { resolved, setAppearance } = useTheme();
  return (
    <header className={styles.header}>
      <Link href="/" aria-label="Weftly home" className={styles.brand}>
        <BrandMark />
        <span>weftly</span>
      </Link>
      <nav aria-label="Main navigation" className={styles.navigation}>
        <Link href="/projects">Projects</Link>
        <Link href="/help" className={styles.guideLink}>
          Guide
        </Link>
      </nav>
      <div className={styles.headerActions}>
        <button
          type="button"
          aria-label="Toggle light and dark appearance"
          title="Toggle light and dark appearance"
          className={styles.themeButton}
          onClick={() => setAppearance(resolved === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" size={18} />
          <Moon className="dark:hidden" size={18} />
        </button>
        {!isLocalStandalone() && <Link href="/sign-in">Sign in</Link>}
        <Link href="/editor" className={styles.headerCta}>
          <span>Open workspace</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
