import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import styles from "./landing.module.css";

export function DashboardHero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>
          <span /> A workspace for LaTeX
        </p>
        <h1 id="hero-title">
          Your paper.
          <br />
          <span>From idea to PDF.</span>
        </h1>
        <p className={styles.introduction}>
          Write in source. Refine on the page. Bring your text, equations, and
          references together in one focused workspace.
        </p>
        <div className={styles.heroActions}>
          <Link href="/editor?new=true" className={styles.primaryCta}>
            Start writing <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link href="/editor?sample=true" className={styles.textCta}>
            Explore a sample <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <p className={styles.portability}>Export your source and PDF.</p>
      </div>
      <figure className={styles.product}>
        <div className={styles.productImages}>
          <Image
            src="/landing/workspace-light.webp"
            alt="Weftly's editor with LaTeX source beside its typeset PDF, project files, and source and visual writing modes."
            width={1440}
            height={900}
            priority
            sizes="(max-width: 1000px) 92vw, (max-width: 1360px) 55vw, 750px"
            className="dark:hidden"
          />
          <Image
            src="/landing/workspace-dark.webp"
            alt="Weftly's editor in dark appearance with LaTeX source beside its typeset PDF."
            width={1440}
            height={900}
            sizes="(max-width: 1000px) 92vw, (max-width: 1360px) 55vw, 750px"
            className="hidden dark:block"
          />
        </div>
        <figcaption>
          <span>Source and PDF, side by side.</span>
          <Link href="/editor?sample=true">
            Try the workspace <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </figcaption>
      </figure>
    </section>
  );
}
