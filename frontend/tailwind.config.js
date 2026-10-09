/** @type {import("tailwindcss").Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],

  theme: {
    extend: {
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",

        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          container: "rgb(var(--primary-container) / <alpha-value>)",
          fixed: "rgb(var(--primary-fixed) / <alpha-value>)",
        },

        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          container: "rgb(var(--secondary-container) / <alpha-value>)",
          fixed: "rgb(var(--secondary-fixed) / <alpha-value>)",
        },

        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          low: "rgb(var(--surface-low) / <alpha-value>)",
          container: "rgb(var(--surface-container) / <alpha-value>)",
          high: "rgb(var(--surface-high) / <alpha-value>)",
        },

        muted: {
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
      },

      fontFamily: {
        sans: ["Manrope", "sans-serif"],
        heading: ["Plus Jakarta Sans", "sans-serif"],
      },

      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },

      boxShadow: {
        soft: "0 8px 30px rgba(19,27,46,0.08)",
        card: "0 12px 36px rgba(19,27,46,0.10)",
      },
    },
  },

  plugins: [],
};
