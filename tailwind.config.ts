import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0B",
        panel: "#151517",
        panel2: "#1B1B1F",
        line: "#28282D",
        ink: "#F1F0EC",
        muted: "#8B8A90",
        faint: "#5B5A60",
        gold: "#E7B24D",
        goldSoft: "#3A2E17",
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