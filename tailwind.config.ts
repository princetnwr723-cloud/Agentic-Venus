import type { Config } from "tailwindcss";

// Colors are CSS variables (see app/theme.css) so the whole app can switch between Night and Light mode.
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        panel: v("panel"),
        panel2: v("panel2"),
        line: v("line"),
        ink: v("ink"),
        muted: v("muted"),
        faint: v("faint"),
        gold: v("gold"),
        goldSoft: v("goldSoft"),
        avatar: {
          teal: "#3FC9AE",
          amber: "#EFA83B",
          violet: "#A98BF0",
          sky: "#5FA6F0",
          coral: "#F08A5E",
          sage: "#7FBF93",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl2: "1.1rem",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset",
      },
    },
  },
  plugins: [],
};

export default config;