"""Explicit staging-only test. Creates labelled QA restaurants and suspends them afterward.
No gateway charges, emails or SMS are sent. Credentials stay in process memory.
"""
import os,json,time,uuid,urllib.request,urllib.error,concurrent.futures,statistics
base=os.environ.get('STAGING_URL','').rstrip('/')
if base!='https://gastroflow-staging.onrender.com' or os.environ.get('CONFIRM_STAGING_LOAD_TEST')!='1':raise SystemExit('Set the named staging URL and CONFIRM_STAGING_LOAD_TEST=1. Production is not a permitted target.')
def call(path,body=None,token=None):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 attempts=3 if path=='/api/auth/login' else 1
 for attempt in range(attempts):
  try:
   with urllib.request.urlopen(req,timeout=90) as response:
    status=response.status;raw=response.read()
  except urllib.error.HTTPError as error:status=error.code;raw=error.read()
  try:result=json.loads(raw)
  except (ValueError,UnicodeError):result={'error':'Non-JSON HTTP response','status':status}
  if status not in (502,503,504) or attempt==attempts-1:return status,result
  time.sleep(1)
status,login=call('/api/auth/login',{'username':os.environ['STAGING_USERNAME'],'password':os.environ['STAGING_PASSWORD']})
assert status==200,'Staging administrator login failed.'
admin=login['token'];tenants=[];timings=[];created=[]
try:
 for index in range(2):
  slug='qa-concurrency-'+uuid.uuid4().hex[:10]
  status,result=call('/api/saas/tenants',{'name':'QA concurrency restaurant '+str(index+1),'subdomain':slug,'ownerEmail':slug+'@example.test','plan':'pro'},admin)
  assert status==201,(status,result.get('error'));restaurant=result['tenant'];tenants.append(restaurant)
  status,owner=call('/api/auth/login',{'username':restaurant['staffUsername'],'password':restaurant['temporaryPassword']});assert status==200,(status,owner.get('error'))
  restaurant['token']=owner['token'];restaurant['item']='qa-item-'+uuid.uuid4().hex
  status,_=call('/api/menu_items',{'id':restaurant['item'],'name':'QA concurrency test item','price':100,'cost':20,'stock':30,'isAvailable':1},restaurant['token']);assert status==200
 def work(index):
  restaurant=tenants[index%2];id='qa-order-'+uuid.uuid4().hex;start=time.monotonic()
  status,order=call('/api/orders',{'id':id,'diningType':'takeaway','items':[{'id':restaurant['item'],'quantity':1}]},restaurant['token']);assert status==200,(status,order.get('error'))
  payment={'id':id,'status':'paid','paymentMethod':'cash','paymentSplit':[{'method':'cash','amount':order['total']}]}
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as retry_pool:results=list(retry_pool.map(lambda _:call('/api/orders',payment,restaurant['token']),range(2)))
  assert all(code==200 for code,_ in results),[(code,data.get('error'))for code,data in results]
  assert results[0][1]['invoiceNumber']==results[1][1]['invoiceNumber'],'Duplicate invoice on settlement retry.'
  timings.append(time.monotonic()-start);return {'tenant':restaurant['id'],'id':id,'invoice':results[0][1]['invoiceNumber']}
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:created=list(pool.map(work,range(12)))
 assert len({row['invoice'] for row in created})==12,'Invoice numbers reused.'
 for restaurant in tenants:
  status,orders=call('/api/orders',token=restaurant['token']);assert status==200
  own={row['id']for row in created if row['tenant']==restaurant['id']};foreign={row['id']for row in created if row['tenant']!=restaurant['id']}
  ids={row['id']for row in orders};assert own<=ids and not foreign&ids,'Order list leaked across restaurants.'
  status,items=call('/api/menu_items',token=restaurant['token']);assert status==200
  item=next(row for row in items if row['id']==restaurant['item']);assert item['stock']==24,'Stock was deducted twice or lost.'
  other=next(row for row in tenants if row['id']!=restaurant['id'])
  status,_=call('/api/orders',{'id':next(row['id']for row in created if row['tenant']==other['id']),'status':'paid','paymentMethod':'cash'},restaurant['token']);assert status==404,'Cross-restaurant mutation accepted.'
 print(json.dumps({'passed':True,'restaurants':2,'orders':12,'parallelWorkers':6,'settlementRequests':24,'uniqueInvoices':12,'stockEach':24,'medianWorkflowSeconds':round(statistics.median(timings),2),'maximumWorkflowSeconds':round(max(timings),2),'scope':'limited staging correctness check, not a capacity benchmark'}),flush=True)
finally:
 for restaurant in tenants:
  req=urllib.request.Request(base+'/api/saas/tenants/'+restaurant['id']+'/status',data=b'{"status":"suspended"}',headers={'Content-Type':'application/json','Authorization':'Bearer '+admin},method='PATCH')
  try:
   with urllib.request.urlopen(req,timeout=60) as response:assert response.status==200
  except Exception:print('QA restaurant suspension needs operator review: '+restaurant['id'],flush=True)
