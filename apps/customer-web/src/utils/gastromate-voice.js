// Local, privacy-preserving voice language selection for GastroMate.
// Browser support for si-LK/ta-LK varies; never claim speech will work universally.
export function gastroVoiceLocale(language='en', text='') {
  const value=String(text || '');
  if (/[\u0D80-\u0DFF]/u.test(value)) return 'si-LK';
  if (/[\u0B80-\u0BFF]/u.test(value)) return 'ta-LK';
  const normalized=String(language || '').toLowerCase().split('-')[0];
  return normalized === 'si' ? 'si-LK' : normalized === 'ta' ? 'ta-LK' : 'en-LK';
}
export function gastroSpeechText(message) {
  return String(message || '')
    .replace(/[*_#~[\]()]/g,'')
    .replace(/https?:\/\/\S+/gi,'')
    .slice(0,900).trim();
}
export function gastroVoiceForLocale(voices,locale) {
  if (!Array.isArray(voices)) return null;
  const loc=String(locale||'en-LK').toLowerCase();
  const language=loc.split('-')[0];
  return voices.find(voice=>String(voice.lang||'').toLowerCase()===loc)
    || voices.find(voice=>String(voice.lang||'').toLowerCase().split('-')[0]===language)
    || null;
}
