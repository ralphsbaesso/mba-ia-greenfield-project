// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { LogoutButton } from "../logout-button"

const { refreshMock, replaceMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}))

beforeEach(() => {
  refreshMock.mockClear()
  replaceMock.mockClear()
})

describe("<LogoutButton />", () => {
  it("posts to the BFF, then refreshes and redirects to /login", async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.use(
      http.post("/api/auth/logout", ({ request }) => {
        calls.push(request.method)
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<LogoutButton />)
    await user.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"))
    expect(calls).toEqual(["POST"])
    // Same ordering contract as login: drop the cached authenticated layout
    // before navigating away.
    expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(
      replaceMock.mock.invocationCallOrder[0]
    )
  })

  it("still redirects when the BFF call fails — logout is idempotent", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/logout", () =>
        HttpResponse.json({ statusCode: 500 }, { status: 500 })
      )
    )

    render(<LogoutButton />)
    await user.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"))
  })
})
