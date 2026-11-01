// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIWaiting } from "./AIWaiting";
afterEach(() => {cleanup(); vi.useRealTimers(); vi.restoreAllMocks();});
describe("AI waiting experience", () => {
  it("shows actual elapsed time and honest long-wait messages without simulated progress", () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const clearInterval = vi.spyOn(window, "clearInterval");
    const view = render(<AIWaiting model="local" provider="ollama" resourceName="api" entries={[{id:"E1",title:"Deployment api"}]} onCancel={cancel}/>);
    expect(screen.getByRole("region",{name:"Explanation in progress"})).toBe(document.activeElement);
    expect(screen.getByRole("timer").textContent).toContain("0s");
    expect(screen.getByRole("status").textContent).toContain("load into memory");
    act(() => vi.advanceTimersByTime(21000));
    expect(screen.getByRole("timer").textContent).toContain("21s");
    expect(screen.getByRole("status").textContent).toContain("Still waiting");
    act(() => vi.advanceTimersByTime(24000));
    expect(screen.getByRole("status").textContent).toContain("Taking a little longer");
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByText("While you wait: explore the evidence"));
    expect(screen.getByText("Deployment api")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Cancel request"}));expect(cancel).toHaveBeenCalledTimes(1);
    view.unmount();expect(clearInterval).toHaveBeenCalledTimes(1);
  });
  it("uses provider-appropriate wording for hosted models", () => {
    render(<AIWaiting model="hosted" provider="openai" resourceName="api" entries={[]} onCancel={vi.fn()}/>);
    expect(screen.getByRole("status").textContent).toContain("provider’s response");
    expect(screen.queryByText(/load into memory/)).toBeNull();
  });
});
