// GastroMate cannot certify allergen safety from free-text restaurant descriptions.
// Keep sensitive allergy details out of third-party generative prompts.
const triggers = /\b(allerg(?:y|ies|ic|en|ens)|nuts?|peanuts?|gluten(?:[ -]?free)?|dairy(?:[ -]?free)?|lactose|celiac|coeliac|shellfish|sesame|soy(?:a)?|egg(?:s)?|ingredients?|contain(?:s)?|cross[ -]?contaminat(?:ion|ed)|safe to eat)\b|අසාත්මික|අමුද්‍රව්‍ය|ஒவ்வாமை|பொருட்கள்/u;
const qualifying = /\b(allerg(?:y|ies|ic|en|ens)|nuts?|peanuts?|gluten(?:[ -]?free)?|dairy(?:[ -]?free)?|lactose|celiac|coeliac|shellfish|sesame|soy(?:a)?|egg(?:s)?|cross[ -]?contaminat(?:ion|ed)|ingredients?|contain(?:s)?|safe to eat)\b|අසාත්මික|අමුද්‍රව්‍ය|ஒவ்வாமை|பொருட்கள்/u;
const templates = {
  en: 'I cannot verify ingredients, allergens, or cross-contact risks from this menu. Please ask restaurant staff directly before ordering, especially if you have an allergy. Do not rely on the AI to confirm food is allergen-free.',
  si: 'මෙම මෙනුවෙන් අමුද්‍රව්‍ය, අසාත්මිකතා ඇති කරන ද්‍රව්‍ය හෝ ආහාර අතර මිශ්‍රවීමේ අවදානම තහවුරු කළ නොහැක. ඇණවුම් කිරීමට පෙර අවන්හල් කාර්ය මණ්ඩලයෙන් විමසන්න. AI පිළිතුරක් පමණක් මත ආහාරය ආරක්ෂිත බව තීරණය නොකරන්න.',
  ta: 'இந்த மெனுவிலிருந்து பொருட்கள், ஒவ்வாமை ஏற்படுத்தும் கூறுகள் அல்லது உணவுகளுக்கிடையேயான கலப்பு அபாயங்களை உறுதிப்படுத்த முடியாது. ஆர்டர் செய்வதற்கு முன் உணவக ஊழியர்களிடம் நேரடியாகக் கேளுங்கள். AI பதிலை மட்டும் நம்பி உணவு ஒவ்வாமையற்றது என்று கருதாதீர்கள்.'
};
export function gastroFoodSafetyAnswer(message, language='en') {
  const question = String(message || '').slice(0,2000);
  if (!triggers.test(question) || !qualifying.test(question)) return null;
  const lang = ['en','si','ta'].includes(String(language)) ? language : 'en';
  return {reply:templates[lang], recommendedItems:[],suggestions:['Contact Human Support','Browse Menu'],action:null};
}
