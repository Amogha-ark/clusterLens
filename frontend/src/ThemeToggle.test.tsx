// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  readTheme,
  resolveTheme,
  THEME_KEY,
  ThemeToggle,
  validTheme,
} from "./ThemeToggle";
let media: MediaQueryList;
let change: (() => void) | undefined;
beforeEach(() => {
  // Node 26's experimental storage getter conflicts with Vitest 3's jsdom globals.
  // Provide the browser Storage contract explicitly for these DOM tests.
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  change = undefined;
  media = {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_, fn) => {
      change = fn as () => void;
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  } as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media),
  });
  document.head.innerHTML = '<meta name="theme-color" content="#101217">';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});
describe("appearance preferences", () => {
  it("defaults to system and validates persisted values", () => {
    expect(readTheme()).toBe("system");
    expect(validTheme("invalid")).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
  it("switches light/dark and persists the explicit choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#101217");
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
  it("restores a saved choice and exposes the selected state", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      screen
        .getByRole("button", { name: "Dark theme" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("follows OS changes only in system mode", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("light");
    Object.defineProperty(media, "matches", {
      value: true,
      configurable: true,
    });
    act(() => change?.());
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    act(() => change?.());
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Use system theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("works when persistence is blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("synchronizes changes from another tab and removes listeners", () => {
    const view = render(<ThemeToggle />);
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }),
      ),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });
});
