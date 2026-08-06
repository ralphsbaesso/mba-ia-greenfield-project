import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/auth/brand-logo";
import { LogoutButton } from "@/components/auth/logout-button";
import { getSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();

  // Authoritative session gate. redirect() throws, so it must stay outside any
  // try/catch — a bare catch would swallow NEXT_REDIRECT.
  if (!session.isLoggedIn) {
    redirect("/login");
  }

  return (
    <main
      data-slot="home-placeholder"
      className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-10"
    >
      <BrandLogo size="lg" />

      <h1 className="text-h1 text-foreground text-center">
        You&apos;re signed in
      </h1>

      <p className="text-body-lg text-muted-foreground max-w-md text-center">
        Signed in as {session.email}. The video feed lands in a later phase —
        for now this page only proves the authenticated area is reachable.
      </p>

      <LogoutButton />
    </main>
  );
}
