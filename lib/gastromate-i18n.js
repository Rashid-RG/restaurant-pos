// Fixed GastroMate system messages translated without sending customer data
// to a separate translation service or trusting a model to invent order state.
const messages = {
  en: {
    preview: 'Here is your food selection for review. No items have been added yet.',
    partial: 'I found part of your request. Please choose the exact restaurant menu item for each unclear or unavailable selection.',
    within: 'The base prices fit within your budget.',
    exceeded: 'The known base total exceeds your budget.',
    unknown: 'The budget cannot be confirmed until you choose the missing items.',
    closed: 'This restaurant is currently closed for online orders. You may browse the menu, but ordering is unavailable.',
    private: 'To see private order status and live delivery tracking, use secure order tracking or sign in.'
  },
  si: {
    preview: 'ඔබ තෝරාගත් ආහාර සමාලෝචනය කරන්න. තවමත් කිසිවක් කරත්තයට එකතු කර නැත.',
    partial: 'ඔබේ ඉල්ලීමේ කොටසක් හඳුනාගත්තා. පැහැදිලි නොවන හෝ නොමැති අයිතම සඳහා මෙනුවෙන් නිවැරදි ආහාරය තෝරන්න.',
    within: 'ආහාරවල මූලික මිල ඔබේ අයවැයට ගැළපේ.',
    exceeded: 'දැනට තහවුරු කළ මූලික එකතුව ඔබේ අයවැය ඉක්මවයි.',
    unknown: 'ඉතිරි ආහාර තෝරන තුරු අයවැය තහවුරු කළ නොහැක.',
    closed: 'මෙම අවන්හල දැනට මාර්ගගත ඇණවුම් සඳහා වසා ඇත. මෙනුව බැලිය හැකි නමුත් ඇණවුම් කළ නොහැක.',
    private: 'පෞද්ගලික ඇණවුම් තත්ත්වය සහ සජීවී බෙදාහැරීම බැලීමට ආරක්ෂිත ඇණවුම් ලුහුබැඳීම භාවිත කරන්න හෝ පිවිසෙන්න.'
  },
  ta: {
    preview: 'நீங்கள் தேர்ந்தெடுத்த உணவுகளைச் சரிபாருங்கள். இன்னும் எதுவும் கூடையில் சேர்க்கப்படவில்லை.',
    partial: 'உங்கள் கோரிக்கையின் ஒரு பகுதியைக் கண்டறிந்தேன். தெளிவில்லாத அல்லது கிடைக்காத உணவுகளுக்கு மெனுவிலிருந்து சரியான உணவைத் தேர்ந்தெடுக்கவும்.',
    within: 'உணவுகளின் அடிப்படை விலைகள் உங்கள் பட்ஜெட்டிற்குள் உள்ளன.',
    exceeded: 'உறுதிப்படுத்தப்பட்ட அடிப்படை மொத்தம் உங்கள் பட்ஜெட்டை மீறுகிறது.',
    unknown: 'மீதமுள்ள உணவுகளைத் தேர்ந்தெடுக்கும் வரை பட்ஜெட்டை உறுதிப்படுத்த முடியாது.',
    closed: 'இந்த உணவகம் தற்போது இணையவழி ஆர்டர்களுக்கு மூடப்பட்டுள்ளது. மெனுவைப் பார்க்கலாம்; ஆர்டர் செய்ய முடியாது.',
    private: 'தனிப்பட்ட ஆர்டர் நிலை மற்றும் நேரடி விநியோகத்தைப் பார்க்க பாதுகாப்பான ஆர்டர் கண்காணிப்பைப் பயன்படுத்தவும் அல்லது உள்நுழையவும்.'
  }
};
export function gastroLanguage(value, text = '') {
  const explicit=String(value||'').toLowerCase().split('-')[0];
  if (['en','si','ta'].includes(explicit)) return explicit;
  if (/[\u0D80-\u0DFF]/u.test(String(text))) return 'si';
  if (/[\u0B80-\u0BFF]/u.test(String(text))) return 'ta';
  return 'en';
}
export function gastroMessage(language,key) {
  const selected=messages[gastroLanguage(language)] || messages.en;
  return selected[key] || messages.en[key] || '';
}
export function gastroPlanIntro(plan, language) {
  const key=plan.lines.some(line=>line.status!=='available')?'partial':'preview';
  const budgetKey=plan.budget == null?null:plan.withinBudget===false?'exceeded':plan.withinBudget===null?'unknown':'within';
  return [gastroMessage(language,key),budgetKey?gastroMessage(language,budgetKey):''].filter(Boolean).join(' ');
}
