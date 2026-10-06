import json
from pathlib import Path
collection=json.loads(Path('C:/Users/laptop/Downloads/WDP.postman_collection.json').read_text(encoding='utf-8-sig'))
roles=set()
def walk(items):
 for item in items:
  if 'item' in item:walk(item['item']);continue
  request=item.get('request',{});url=request.get('url',{});raw=url.get('raw','') if isinstance(url,dict) else url
  method=request.get('method','');body=request.get('body',{}).get('raw','')
  try:
   payload=json.loads(body)
   if isinstance(payload,dict) and isinstance(payload.get('role'),str):roles.add(payload['role'])
  except Exception:payload={}
  if '/users' in raw:
   print(json.dumps({'name':item.get('name'),'method':method,'path':raw.split('/api/v1')[-1].split('?')[0],'bodyKeys':list(payload) if isinstance(payload,dict) else [],'role':payload.get('role') if isinstance(payload,dict) else None,'savedResponses':len(item.get('response',[]))}))
walk(collection.get('item',[]));print('Confirmed literal roles:',sorted(roles))
