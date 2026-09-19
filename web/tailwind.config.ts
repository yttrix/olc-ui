import type { Config } from "tailwindcss";

// Colors are CSS variables (see src/index.css).
const v = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: v("background"),
        "background-2": v("background-2"),
        card: v("card"),
        muted: v("muted"),
        border: v("border"),
        "border-strong": v("border-strong"),
        foreground: v("foreground"),
        "muted-foreground": v("muted-foreground"),
        dim: v("dim"),
        primary: v("primary"),
        "primary-foreground": v("primary-foreground"),
        success: v("success"),
        warning: v("warning"),
        destructive: v("destructive"),
        sky: v("sky"),
        violet: v("violet"),
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xl: "14px" },
    },
  },
  plugins: [],
} satisfies Config;
