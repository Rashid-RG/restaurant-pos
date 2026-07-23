import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { TRANSLATIONS, LANGUAGES } from '../i18n/translations.js';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('gastroflow_lang') || 'en');

  const setLang = useCallback((code) => {
    setLangState(code);
    localStorage.setItem('gastroflow_lang', code);
    document.documentElement.setAttribute('lang', code);
  }, []);

  // Merge over English so any untranslated key gracefully falls back.
  const dict = useMemo(() => ({ ...TRANSLATIONS.en, ...(TRANSLATIONS[lang] || {}) }), [lang]);

  // t('key', { count: 3 }) → looks up the string and interpolates {placeholders}.
  const t = useCallback((key, vars) => {
    let str = dict[key] != null ? dict[key] : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    return str;
  }, [dict]);

  const value = useMemo(() => ({ lang, setLang, t, dict, languages: LANGUAGES }), [lang, setLang, t, dict]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}
