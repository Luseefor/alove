import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";
import { isLocalStandalone } from "@/lib/localStandalone";

export default function SignUpPage() {
  if (isLocalStandalone()) {
    redirect("/editor");
  }
  return (
    <AuthShell>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthShell>
  );
}
