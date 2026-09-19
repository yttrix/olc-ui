import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "ru" | "en";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; tr: (ru: string, en: string) => string };

const LangCtx = createContext<Ctx>({ lang: "ru", setLang: () => {}, tr: (ru) => ru });

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("olc-lang");
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    /* storage may be unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem("olc-lang", l);
    } catch {
      /* ignore */
    }
  };
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  return <LangCtx.Provider value={{ lang, setLang, tr }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex h-8 items-center rounded-[9px] border border-border-strong bg-background-2 p-0.5 text-xs font-semibold">
      {(["ru", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`h-full rounded-[7px] px-2.5 uppercase transition-colors ${lang === l ? "bg-primary/15 text-primary" : "text-dim hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
