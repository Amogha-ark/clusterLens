import { useLayoutEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "clusterlens.theme";
export function validTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
export function readTheme(): Theme {
  try {
    return validTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}
export function resolveTheme(theme: Theme, prefersDark: boolean) {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(theme, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#101217" : "#f8f9fb");
    };
    apply();
    media.addEventListener("change", apply);
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null)
        setTheme(validTheme(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", sync);
    };
  }, [theme]);
  const choose = (next: Theme) => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* The theme still works when browser storage is unavailable. */
    }
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Appearance">
      {(
        [
          { value: "light", label: "Light theme", icon: Sun },
          { value: "dark", label: "Dark theme", icon: Moon },
          { value: "system", label: "Use system theme", icon: Monitor },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-label={label}
          title={label}
          aria-pressed={theme === value}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
