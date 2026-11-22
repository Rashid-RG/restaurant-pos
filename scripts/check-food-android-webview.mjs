// Read-only Chrome DevTools inspection of GastroFlow Food's isolated Android
// emulator WebView. The emulator runner must forward tcp:9222 to WebView DevTools.
// This script reads startup DOM/errors only; it never invokes checkout or auth.
const endpoint='http://127.0.0.1:9222/json';
const fail=message=>{console.error('GastroFlow Food emulator startup FAILED:',message);process.exitCode=1;};
try {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  let tabs;
  try {
    const response=await fetch(endpoint,{signal:controller.signal});
    if(!response.ok)throw new Error('DevTools returned HTTP '+response.status);
    tabs=await response.json();
  } finally {clearTimeout(timer);}
  const tab=tabs.find(item=>item.type==='page'&&item.webSocketDebuggerUrl);
  if(!tab)throw new Error('Customer Android WebView is not inspectable');
  const wsUrl=new URL(tab.webSocketDebuggerUrl);
  wsUrl.hostname='127.0.0.1';
  const ws=new WebSocket(wsUrl.href);
  const data=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ws.close();reject(new Error('WebView inspection timeout'))},10000);
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('WebView DevTools socket failed'))},{once:true});
    ws.addEventListener('open',()=>{
      const expression=JSON.stringify(''); // replaced below
      void expression;
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
        expression:`JSON.stringify({url:location.origin,hasRoot:!!document.querySelector('#root'),home:!!document.querySelector('.restaurants-view.gastrofood-discovery'),errorScreen:!!document.querySelector('.customer-error-screen'),error:window.__gastrofoodNativeRenderFailure||'',title:document.title,bodyText:document.body?.innerText?.slice(0,140)||''})`,
        returnByValue:true
      }}));
    },{once:true});
    ws.addEventListener('message',event=>{
      let answer;try{answer=JSON.parse(event.data)}catch{return}
      if(answer.id!==1)return;
      clearTimeout(timeout);ws.close();
      if(answer.error||answer.result?.exceptionDetails)return reject(new Error('WebView evaluation failed'));
      try{resolve(JSON.parse(answer.result.result.value))}catch(e){reject(e)}
    });
  });
  console.log('GastroFlow Food emulator startup:',JSON.stringify(data));
  if(!data.hasRoot)fail('React root is missing');
  else if(data.errorScreen)fail(data.error||'React error boundary displayed on startup');
  else if(!data.home)fail('Customer marketplace home did not render');
  else console.log('PASS: GastroFlow Food customer marketplace rendered on Android emulator');
} catch(error) {fail(error.message)}
