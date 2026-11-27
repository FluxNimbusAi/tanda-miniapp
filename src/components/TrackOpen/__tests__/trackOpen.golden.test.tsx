// @vitest-environment jsdom
// G2G-6 beacon golden: one open per session, ?src attribution honored,
// unknown src falls to organic, sessionStorage dedup blocks reload inflation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TrackOpen } from "../index";

const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function body(): { kind: string; source: string } {
  const call = fetchMock.mock.calls[0];
  return JSON.parse((call as unknown as [string, RequestInit])[1].body as string);
}

describe("TrackOpen beacon", () => {
  it("reads ?src=n2b and posts open with that source", () => {
    window.history.pushState({}, "", "/?src=n2b");
    render(<TrackOpen />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body()).toEqual({ kind: "open", source: "n2b" });
  });

  it("unknown src degrades to organic; share honored", () => {
    window.history.pushState({}, "", "/?src=%20https://x");
    render(<TrackOpen />);
    expect(body().source).toBe("organic");
    cleanup();
    fetchMock.mockClear();
    sessionStorage.clear(); // fresh browser session, second arrival
    window.history.pushState({}, "", "/bill/0x1111111111111111111111111111111111111111?src=share");
    render(<TrackOpen />);
    expect(body().source).toBe("share");
  });

  it("second mount in same session sends nothing (no reload inflation)", () => {
    window.history.pushState({}, "", "/");
    render(<TrackOpen />);
    cleanup();
    render(<TrackOpen />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
