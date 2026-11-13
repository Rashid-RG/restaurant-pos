// Offline shell only. Never cache authenticated API responses or other apps.
const PREFIX = 'gastroflow-customer-';
const CACHE = `${PREFIX}v7`;
const BASE = new URL('./', self.location.href).pathname;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([BASE, `${BASE}offline.html`])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith(PREFIX) || key.startsWith('gastroflow-data-') || key.startsWith('gastroflow-shell-')) && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(BASE)) || (await caches.match(`${BASE}offline.html`)) || Response.error()));
  } else if (/\.(js|css|png|svg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
  }
});


// Push is optional and only delivered after the customer explicitly opts in
// for a tracked order. No customer names, coordinates, or payment details.
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json()||{}}catch{}
  const title=typeof data.title==='string'?data.title:'GastroFlow order update';
  const body=typeof data.body==='string'?data.body:'Your order status changed.';
  const tag=typeof data.orderId==='string'?'gastroflow-'+data.orderId:'gastroflow-order';
  event.waitUntil(self.registration.showNotification(title,{
    body,tag,icon:BASE+'food-logo.svg',badge:BASE+'food-logo.svg',
    data:{orderId:typeof data.orderId==='string'?data.orderId:'',tenantId:typeof data.tenantId==='string'?data.tenantId:''}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const {orderId,tenantId}=event.notification.data||{};
  const url=new URL(BASE,self.location.origin);
  url.searchParams.set('view','track');
  if(orderId)url.searchParams.set('track',orderId);
  if(tenantId)url.searchParams.set('tenant',tenantId);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const current=windows.find(w=>new URL(w.url).origin===self.location.origin&&new URL(w.url).pathname.startsWith(BASE));
    if(current){await current.navigate(url.href);return current.focus();}
    return self.clients.openWindow(url.href);
  }));
});
