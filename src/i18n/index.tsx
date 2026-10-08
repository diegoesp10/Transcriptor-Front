import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import es from './locales/es.json';
import en from './locales/en.json';

/*
 * Idioma de la interfaz.
 * - Los textos viven en locales/es.json y locales/en.json (misma estructura; TypeScript lo comprueba).
 * - t('ruta.de.la.clave', { param }) interpola {param}; si el valor es { one, other } elige el plural con params.count.
 * Ojo: es el idioma de la INTERFAZ. El idioma de cada audio (el que se envía a la API) es otro dato, ver LANGUAGES.
 */

export type Lang = 'es' | 'en';
export type Messages = typeof es;
type Plural = { one: string; other: string };
type Params = Record<string, string | number>;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type Translate = (key: MessageKey, params?: Params) => string;

// Si a en.json le falta alguna clave de es.json, esta línea no compila
const resources: Record<Lang, Messages> = { es, en };

export const LANGS: Lang[] = ['es', 'en'];
const LOCALES: Record<Lang, string> = { es: 'es-ES', en: 'en-GB' };
const STORAGE_KEY = 'mm-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* noop */
  }
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function lookup(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
}

function interpolate(text: string, params?: Params) {
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] != null ? String(params[name]) : match)) : text;
}

function createTranslator(lang: Lang): Translate {
  const messages = resources[lang];
  const plurals = new Intl.PluralRules(LOCALES[lang]);
  return (key, params) => {
    const value = lookup(messages, key);
    if (typeof value === 'string') return interpolate(value, params);
    if (value && typeof value === 'object' && 'other' in value) {
      const plural = value as Plural;
      return interpolate(plurals.select(Number(params?.count ?? 0)) === 'one' ? plural.one : plural.other, params);
    }
    return key; // clave inexistente: se ve en pantalla para detectarla
  };
}

interface I18n {
  lang: Lang;
  /** Locale para Intl (fechas, números, tiempos relativos) */
  locale: string;
  t: Translate;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const value = useMemo<I18n>(() => ({ lang, locale: LOCALES[lang], t: createTranslator(lang), setLang }), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* noop */
    }
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>');
  return ctx;
}

/** Idiomas de transcripción que se ofrecen al usuario (ISO 639‑1, como exige el backend). Se pueden ampliar sin más. */
export const TRANSCRIPTION_LANGUAGES = ['es', 'en', 'ca', 'gl', 'eu', 'fr', 'pt', 'it', 'de', 'nl'] as const;
