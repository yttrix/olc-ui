import type { Config } from "tailwindcss";

// Colors are CSS variables (see src/index.css) so light/dark themes swap them.
const v = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: v("border"),
        background: v("background"),
        foreground: v("foreground"),
        muted: v("muted"),
        "muted-foreground": v("muted-foreground"),
        card: v("card"),
        primary: v("primary"),
        "primary-foreground": v("primary-foreground"),
        destructive: v("destructive"),
        warning: v("warning"),
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
