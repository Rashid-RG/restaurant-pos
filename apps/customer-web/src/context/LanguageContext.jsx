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
  const value = useMemo(() => {
    const tFn = (key, vars) => {
      if (!key) return '';
      let str = dict[key] != null ? dict[key] : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    };

    // Proxy so t can be called as a function t('key') OR accessed like t.key or t['key']
    const tProxy = new Proxy(tFn, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string') {
          return dict[prop] != null ? dict[prop] : prop;
        }
        return target[prop];
      }
    });

    return { lang, setLang, t: tProxy, dict, languages: LANGUAGES };
  }, [lang, setLang, dict]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}
