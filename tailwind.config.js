/** @type {import('tailwindcss').Config} */

// All literal values live in :root (src/index.css). Here we only wire Tailwind's
// utility names to those CSS variables, so `bg-ink-900`, `text-slate-400`,
// `rounded-lg`, `text-2xs`, etc. resolve to the central tokens. Colors use the
// `rgb(var(--x) / <alpha-value>)` form so opacity modifiers (e.g. `/60`) work.
const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: rgb("--color-ink-900"),
          800: rgb("--color-ink-800"),
          700: rgb("--color-ink-700"),
          600: rgb("--color-ink-600"),
        },
        slate: {
          100: rgb("--color-slate-100"),
          200: rgb("--color-slate-200"),
          300: rgb("--color-slate-300"),
          400: rgb("--color-slate-400"),
          500: rgb("--color-slate-500"),
          600: rgb("--color-slate-600"),
        },
        sky: {
          200: rgb("--color-sky-200"),
          300: rgb("--color-sky-300"),
          400: rgb("--color-sky-400"),
          500: rgb("--color-sky-500"),
          600: rgb("--color-sky-600"),
          950: rgb("--color-sky-950"),
        },
        emerald: {
          500: rgb("--color-emerald-500"),
        },
        amber: {
          400: rgb("--color-amber-400"),
        },
        red: {
          200: rgb("--color-red-200"),
          300: rgb("--color-red-300"),
          400: rgb("--color-red-400"),
          500: rgb("--color-red-500"),
          600: rgb("--color-red-600"),
          950: rgb("--color-red-950"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        // Font-size only (no line-height), matching the old `text-[11px]`.
        "2xs": "var(--text-2xs)",
        xs: ["var(--text-xs)", { lineHeight: "var(--leading-xs)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--leading-sm)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-lg)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-2xl)" }],
      },
      borderRadius: {
        none: "0px",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        control: "var(--shadow-control)",
        popover: "var(--shadow-popover)",
        dialog: "var(--shadow-dialog)",
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        spatial: "var(--ease-spatial)",
      },
    },
  },
  plugins: [],
};
