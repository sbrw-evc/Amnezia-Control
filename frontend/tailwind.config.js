export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {

        base: { 950: "#0b1120", 900: "#0f172a", 850: "#131c31", 800: "#1a2438", 700: "#243049", 600: "#334160" },
        accent: { DEFAULT: "#3b82f6", soft: "#1e3a8a" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "Consolas", "monospace"] },
      boxShadow: { glow: "0 0 0 1px rgba(59,130,246,.35), 0 8px 30px -8px rgba(59,130,246,.35)" },
      keyframes: {
        ping2: { "75%, 100%": { transform: "scale(2.2)", opacity: "0" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { ping2: "ping2 1.6s cubic-bezier(0,0,.2,1) infinite", shimmer: "shimmer 1.6s infinite" },
    },
  },
  plugins: [],
};
