import { redirect } from "next/navigation"

import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { LoginForm } from "@/components/auth/login-form"
import { Card } from "@/components/ui/card"
import { getSession } from "@/lib/auth/session"

export default async function LoginPage() {
  const session = await getSession()

  // Mirror of the gate on `/`: the two predicates are strict negations, so no
  // redirect cycle can form.
  if (session.isLoggedIn) {
    redirect("/")
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Sign in</h1>

        <LoginForm className="w-full" />

        <AuthFooter
          question="Don't have an account?"
          linkLabel="Sign up"
          linkHref="/signup"
        />
      </Card>
    </main>
  )
}
