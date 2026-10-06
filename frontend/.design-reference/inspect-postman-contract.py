import json
from pathlib import Path
p=Path('C:/Users/laptop/Downloads/WDP.postman_collection.json')
x=json.loads(p.read_text(encoding='utf-8-sig'))
def shape(v):
 if isinstance(v,dict): return {k:shape(val) for k,val in v.items()}
 if isinstance(v,list): return [shape(v[0])] if v else []
 return type(v).__name__
def visit(items):
 for item in items:
  if 'item' in item: visit(item['item']);continue
  r=item.get('request',{});u=r.get('url',{});raw=u if isinstance(u,str) else u.get('raw','')
  print(item.get('name'),r.get('method'),raw.split('?')[0])
  b=r.get('body',{}).get('raw')
  if b:
   try:
    values=json.loads(b);print('body schema:',shape(values))
    if 'role' in values:print('confirmed role example:',values['role'])
   except:print('body not JSON')
  for response in item.get('response',[]):
   try:print('example response',response.get('code'),shape(json.loads(response.get('body',''))))
   except:pass
visit(x.get('item',[]))
for v in x.get('variable',[]):
 if v.get('key','').lower() in ['baseurl','base_url','url','host']:print('base variable:',v.get('key'),v.get('value'))
