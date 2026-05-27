/**
 * Design tokens shared between the web (Tailwind config) and the mobile
 * app (NativeWind config). Single source of truth for brand parity.
 *
 * Match SundayRec + SundayStage: gold-on-blue, dark-first.
 */

export const tokens = {
  colors: {
    neutral: {
      50:  "oklch(0.98 0 0)",
      100: "oklch(0.96 0 0)",
      200: "oklch(0.92 0 0)",
      300: "oklch(0.86 0 0)",
      400: "oklch(0.70 0 0)",
      500: "oklch(0.54 0 0)",
      600: "oklch(0.42 0 0)",
      700: "oklch(0.32 0 0)",
      800: "oklch(0.22 0 0)",
      900: "oklch(0.14 0 0)",
      950: "oklch(0.08 0 0)",
    },
    blue: {
      50:  "oklch(0.96 0.02 252)",
      100: "oklch(0.91 0.04 252)",
      200: "oklch(0.82 0.08 252)",
      300: "oklch(0.70 0.12 252)",
      400: "oklch(0.58 0.16 252)",
      500: "oklch(0.46 0.18 252)",
      600: "oklch(0.36 0.16 252)", // primary brand
      700: "oklch(0.28 0.13 252)",
      800: "oklch(0.20 0.10 252)",
      900: "oklch(0.13 0.07 252)",
      950: "oklch(0.08 0.04 252)",
    },
    gold: {
      50:  "oklch(0.98 0.02 85)",
      100: "oklch(0.95 0.06 85)",
      200: "oklch(0.91 0.10 85)",
      300: "oklch(0.87 0.14 85)",
      400: "oklch(0.84 0.16 85)", // primary accent
      500: "oklch(0.78 0.16 80)",
      600: "oklch(0.68 0.15 75)",
      700: "oklch(0.56 0.13 70)",
      800: "oklch(0.42 0.10 65)",
      900: "oklch(0.28 0.07 60)",
    },
    status: {
      success: "oklch(0.74 0.18 145)",
      warning: "oklch(0.80 0.16 75)",
      danger:  "oklch(0.65 0.22 27)",
      info:    "oklch(0.70 0.14 245)",
    },
  },
  typography: {
    fontFamily: {
      sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    },
    fontSize: {
      xs:   "0.75rem",
      sm:   "0.875rem",
      md:   "1rem",
      lg:   "1.125rem",
      xl:   "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
    },
  },
  radius: {
    xs: "0.25rem",
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem",
    xl: "1rem",
    "2xl": "1.5rem",
  },
  spacing: 4, // base unit (px)
} as const;

export type DesignTokens = typeof tokens;
