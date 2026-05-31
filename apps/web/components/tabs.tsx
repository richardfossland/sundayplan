"use client";

/** Minimal presentational tab bar — caller owns the active state. */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-white/[0.08]">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={
              "relative -mb-px rounded-t-md px-3 py-2 text-sm transition-colors " +
              (on
                ? "text-ink-50"
                : "text-ink-500 hover:text-ink-200")
            }
          >
            {t.label}
            <span
              className={
                "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gold-400 transition-opacity " +
                (on ? "opacity-100" : "opacity-0")
              }
            />
          </button>
        );
      })}
    </div>
  );
}
