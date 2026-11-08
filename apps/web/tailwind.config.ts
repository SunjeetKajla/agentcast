import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#05060f",
        foreground: "#ffffff",
        card: {
          DEFAULT: "#121215",
          foreground: "#FAFAFA",
        },
        muted: {
          DEFAULT: "#1E1E22",
          foreground: "#A1A1AA",
        },
        // The redesign's palette: yellow is the highlight on media controls.
        accent: {
          DEFAULT: "#f7dd47",
          foreground: "#05060f",
        },
        border: "rgba(255, 255, 255, 0.08)",
        input: "rgba(255, 255, 255, 0.08)",
        ring: "#f7dd47",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
      fontFamily: {
        sans: ["var(--font-schibsted)", "Schibsted Grotesk", "Helvetica Neue", "Arial", "sans-serif"],
        serif: [
          "Playfair Display",
          "Newsreader",
          "Charter",
          "Iowan Old Style",
          "Georgia",
          "serif",
        ],
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
