"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

function LogoutButton() {
  const router = useRouter()
  const [isPending, setIsPending] = React.useState(false)

  async function onClick() {
    setIsPending(true)
    // The BFF destroys the iron-session cookie and revokes upstream tokens;
    // logout is idempotent, so a non-2xx still leaves the client at /login.
    await fetch("/api/auth/logout", { method: "POST" })

    // refresh() first, while / is still the current route, so the cached root
    // layout drops the authenticated session before we navigate away.
    router.refresh()
    router.replace("/login")
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      data-slot="logout-button"
      disabled={isPending}
      onClick={onClick}
    >
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  )
}

export { LogoutButton }
