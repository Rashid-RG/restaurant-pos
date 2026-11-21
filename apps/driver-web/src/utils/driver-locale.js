// GastroDriver core navigation and preference strings. This is an incremental
// translation layer; operations, error messages and legal notices must be
// translated separately before claiming complete localization.
const words={
  en:{home:'Home',orders:'Orders',cash:'Cash',profile:'Profile',settings:'Display settings',
    language:'Language',theme:'Appearance',light:'Light',dark:'Dark',system:'System',
    accessibility:'Accessibility',largeText:'Larger text',highContrast:'High contrast',
    reducedMotion:'Reduce motion',preferences:'Notification preferences',
    sound:'Delivery alert sound',currentDelivery:'Current delivery',nextDelivery:'Your next delivery',
    available:'Available pickups',openDelivery:'Open delivery',noJob:'No active jobs'},
  si:{home:'මුල් පිටුව',orders:'ඇණවුම්',cash:'මුදල්',profile:'පැතිකඩ',settings:'තිර සැකසුම්',
    language:'භාෂාව',theme:'පෙනුම',light:'ආලෝක',dark:'අඳුරු',system:'පද්ධතිය',
    accessibility:'ප්‍රවේශ පහසුකම්',largeText:'විශාල අකුරු',highContrast:'වැඩි විරුද්ධතාව',
    reducedMotion:'චලනය අඩු කරන්න',preferences:'දැනුම්දීම් සැකසුම්',
    sound:'බෙදාහැරීමේ දැනුම්දීම් ශබ්දය',currentDelivery:'දැනට ඇති බෙදාහැරීම',
    nextDelivery:'ඊළඟ බෙදාහැරීම',available:'ලබාගත හැකි ඇණවුම්',openDelivery:'බෙදාහැරීම විවෘත කරන්න',noJob:'ක්‍රියාකාරී ඇණවුම් නොමැත'},
  ta:{home:'முகப்பு',orders:'ஆர்டர்கள்',cash:'பணம்',profile:'சுயவிவரம்',settings:'திரை அமைப்புகள்',
    language:'மொழி',theme:'தோற்றம்',light:'ஒளி',dark:'இருள்',system:'சாதனம்',
    accessibility:'அணுகல்தன்மை',largeText:'பெரிய எழுத்து',highContrast:'அதிக மாறுபாடு',
    reducedMotion:'இயக்கத்தைக் குறை',preferences:'அறிவிப்பு அமைப்புகள்',
    sound:'டெலிவரி அறிவிப்பு ஒலி',currentDelivery:'தற்போதைய டெலிவரி',
    nextDelivery:'அடுத்த டெலிவரி',available:'கிடைக்கும் ஆர்டர்கள்',openDelivery:'டெலிவரியைத் திற',noJob:'செயலில் ஆர்டர்கள் இல்லை'}
};
export const driverLanguages=['en','si','ta'];
export const driverText=(locale,key)=>words[driverLanguages.includes(locale)?locale:'en'][key]||words.en[key]||key;
export const driverThemeChoice=value=>['light','dark','system'].includes(value)?value:'system';
