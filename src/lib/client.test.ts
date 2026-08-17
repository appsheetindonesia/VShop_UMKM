/**
 * Unit test helper client (src/lib/client.ts):
 * - postJson/putJson/delJson dengan fetch global di-stub;
 * - useSubmit (hook) dieksekusi langsung dengan react & next/navigation
 *   di-mock (useCallback = identitas, useState = [nilai, setter]) sehingga
 *   seluruh cabang (redirect / refresh / error / onSuccess) ter-cover.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delJson, postJson, putJson, useSubmit } from "./client";

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMock.push, refresh: navMock.refresh }),
}));

vi.mock("react", () => ({
  useCallback: (fn: unknown) => fn,
  useState: (init: unknown) => [init, vi.fn()],
}));

let requests: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  requests = [];
  navMock.push.mockClear();
  navMock.refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, message: "berhasil" }),
      } as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("postJson", () => {
  it("POST dengan Content-Type JSON dan body serialized", async () => {
    const res = await postJson("/api/foo", { a: 1 });
    expect(res).toEqual({ ok: true, message: "berhasil" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/foo");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(requests[0].init?.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("putJson", () => {
  it("PUT dengan body serialized", async () => {
    await putJson("/api/bar", { x: 2 });
    expect(requests[0].init?.method).toBe("PUT");
    expect(requests[0].init?.body).toBe(JSON.stringify({ x: 2 }));
  });
});

describe("delJson", () => {
  it("DELETE tanpa body", async () => {
    const res = await delJson("/api/baz");
    expect(res.ok).toBe(true);
    expect(requests[0].init?.method).toBe("DELETE");
    expect(requests[0].init?.body).toBeUndefined();
  });
});

describe("useSubmit", () => {
  it("sukses + redirect → router.push & refresh + onSuccess", async () => {
    const onSuccess = vi.fn();
    const { run } = useSubmit({ onSuccess });
    await run(async () => ({ ok: true, redirect: "/beranda" }));
    expect(navMock.push).toHaveBeenCalledWith("/beranda");
    expect(navMock.refresh).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ ok: true, redirect: "/beranda" });
  });

  it("sukses tanpa redirect → refresh saja", async () => {
    const { run } = useSubmit();
    await run(async () => ({ ok: true }));
    expect(navMock.push).not.toHaveBeenCalled();
    expect(navMock.refresh).toHaveBeenCalled();
  });

  it("respon tidak ok → error di-set, tanpa refresh", async () => {
    const { run } = useSubmit();
    await run(async () => ({ ok: false, message: "Gagal menyimpan" }));
    expect(navMock.refresh).not.toHaveBeenCalled();
  });

  it("exception → error koneksi", async () => {
    const { run } = useSubmit();
    await run(async () => {
      throw new Error("network");
    });
    expect(navMock.refresh).not.toHaveBeenCalled();
  });
});
