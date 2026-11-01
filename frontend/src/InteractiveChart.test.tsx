// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InteractiveChart } from "./InteractiveChart";
const points = [
  {
    uid: "cluster",
    cpu: 0.1,
    memory: 1048576,
    timestamp: "2026-10-31T10:00:00Z",
  },
  {
    uid: "cluster",
    cpu: 0.8,
    memory: 2097152,
    timestamp: "2026-10-31T10:01:00Z",
  },
];
afterEach(cleanup);
describe("interactive metric history", () => {
  it("shows real measurements on hover and clears them on leave", () => {
    Object.defineProperty(window, "PointerEvent", {
      value: MouseEvent,
      configurable: true,
    });
    render(<InteractiveChart points={points} />);
    const plot = screen.getByRole("slider");
    plot.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 680,
      bottom: 190,
      width: 680,
      height: 190,
      toJSON: () => ({}),
    });
    fireEvent.pointerMove(plot, { clientX: 670, clientY: 40 });
    expect(screen.getByRole("status").textContent).toContain("0.800 cores");
    fireEvent.pointerLeave(plot.parentElement!);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("allows keyboard inspection and Escape dismissal", () => {
    render(<InteractiveChart points={points} />);
    const plot = screen.getByRole("slider");
    fireEvent.focus(plot);
    expect(screen.getByRole("status").textContent).toContain("0.800 cores");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toContain("0.100 cores");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("formats memory measurements and uses unique chart gradients", () => {
    const { container } = render(
      <>
        <InteractiveChart points={points} field="memory" />
        <InteractiveChart points={points} field="memory" />
      </>,
    );
    fireEvent.focus(screen.getAllByRole("slider")[0]);
    expect(screen.getByRole("status").textContent).toContain("2.00 MiB");
    const ids = [...container.querySelectorAll("linearGradient")].map(
      (el) => el.id,
    );
    expect(new Set(ids).size).toBe(2);
  });
  it("does not invent a graph with one sample", () => {
    render(<InteractiveChart points={points.slice(0, 1)} />);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("Building your trend")).toBeTruthy();
  });
});
