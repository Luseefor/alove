import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";
import { isLocalStandalone } from "@/lib/localStandalone";

export default function SignInPage() {
  if (isLocalStandalone()) {
    redirect("/editor");
  }
  return (
    <AuthShell>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </AuthShell>
  );
}
