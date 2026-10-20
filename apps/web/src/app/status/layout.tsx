import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Service status",
  description:
    "Readiness of the local compile backend: configuration, queue, and worker.",
};

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
