import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./landing.module.css";

const features = [
  {
    title: "Find your writing flow.",
    description:
      "Switch between LaTeX source and visual editing. Edit supported text on your PDF, then rebuild to see the result.",
    detail: "Source + Visual",
  },
  {
    title: "Revise with a way back.",
    description:
      "Keep checkpoints of your work. After a failed build, test a focused restoration before applying it.",
    detail: "History + build recovery",
  },
  {
    title: "Keep your work portable.",
    description:
      "Bring references and project files together. Download your source and PDF, or connect your GitHub repository.",
    detail: "Your files, within reach",
  },
];

export function DashboardContent() {
  return (
    <>
      <section className={styles.features} aria-label="Inside Weftly">
        {features.map((feature, index) => (
          <article key={feature.title}>
            <span className={styles.featureNumber}>
              0{index + 1} / {feature.detail}
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>
      <section className={styles.closing} aria-labelledby="start-title">
        <div>
          <p className={styles.eyebrow}>Start something worth writing.</p>
          <h2 id="start-title">A blank page. A little possibility.</h2>
        </div>
        <Link href="/editor?new=true" className={styles.primaryCta}>
          Create a project <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
