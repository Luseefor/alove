import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { DashboardHeader } from "@/components/landing/DashboardHeader";
import { DashboardHero } from "@/components/landing/DashboardHero";
import { DashboardContent } from "@/components/landing/DashboardContent";
import styles from "@/components/landing/landing.module.css";

export default function Home() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <DashboardHeader />
      <main id="main" tabIndex={-1} className={styles.main}>
        <DashboardHero />
        <DashboardContent />
      </main>
      <footer className={styles.footer}>
        <Link href="/" aria-label="Weftly home" className={styles.footerBrand}>
          <BrandMark className="h-5 w-5" />
          <span>Made for the work you want to write.</span>
        </Link>
        <nav aria-label="Footer navigation">
          <Link href="/help">Guide</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/status">Service status</Link>
        </nav>
      </footer>
    </div>
  );
}
