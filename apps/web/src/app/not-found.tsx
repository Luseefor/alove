import { SiteFailure } from "@/components/SiteFailure";

export default function NotFound() {
  return (
    <SiteFailure
      eyebrow="404"
      title="Page not found"
      description="This page does not exist or was moved. Pick a link below to keep working."
      actions={[
        { href: "/", label: "Go home", primary: true },
        { href: "/projects", label: "View projects" },
        { href: "/help", label: "Get help" },
      ]}
    />
  );
}
