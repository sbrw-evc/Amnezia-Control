// Colours are CSS variables (src/index.css), so one set of classes draws both the light and the dark theme of the
// Umbrella design: base-* are the surfaces, slate-* the text shades, and the light tone shades (-200…-400) are the
// Umbrella status colours.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        chrome: v("chrome"),
        fg: v("fg"),
        base: { 950: v("bg"), 900: v("surface"), 850: v("surface-2"), 800: v("surface-3"), 700: v("border"), 600: v("border-strong") },
        slate: { 100: v("fg"), 200: v("fg"), 300: v("fg-2"), 400: v("muted"), 500: v("subtle"), 600: v("faint") },
        accent: { DEFAULT: v("accent"), soft: v("accent-soft") },
        emerald: { 100: v("ok"), 200: v("ok"), 300: v("ok"), 400: v("ok") },
        red: { 100: v("error"), 200: v("error"), 300: v("error"), 400: v("error") },
        amber: { 100: v("warn"), 200: v("warn"), 300: v("warn"), 400: v("warn") },
        blue: { 100: v("info"), 200: v("info"), 300: v("info"), 400: v("info") },
        violet: { 200: v("purple"), 300: v("purple"), 400: v("purple") },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: { card: "14px", control: "9px" },
      boxShadow: {
        card: "var(--shadow)",
        glow: "var(--btn-primary-shadow)",
      },
      keyframes: {
        ping2: { "75%, 100%": { transform: "scale(2.2)", opacity: "0" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { ping2: "ping2 1.6s cubic-bezier(0,0,.2,1) infinite", shimmer: "shimmer 1.6s infinite" },
    },
  },
  plugins: [],
};
