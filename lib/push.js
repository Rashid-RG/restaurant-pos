import webpush from 'web-push';

// Public VAPID keys (can be overridden via environment variables)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa1-Zpe5-93Aae7lUab6l3e5Jq9l14X_2-Wd5x-J8f90X26m5V0X9Z8m5V0X9Z';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'u7u9x0V26m5V0X9Z8m5V0X9Z8m5V0X9Z8m5V0X9Z8m5';

webpush.setVapidDetails(
  'mailto:support@gastroflow.lk',
  publicVapidKey,
  privateVapidKey
);

export { webpush, publicVapidKey };
