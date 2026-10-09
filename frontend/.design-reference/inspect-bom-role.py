import json
from pathlib import Path
p=Path('C:/Users/laptop/Downloads/WDP.postman_collection.json')
d=json.loads(p.read_text(encoding='utf-8-sig'))
known=set()
def walk(v,key=''):
 if isinstance(v,dict):
  for k,x in v.items():
   if k.lower() in ('role','roles') and isinstance(x,(str,list)):known.add(str(x))
   walk(x,k)
 elif isinstance(v,list):
  for x in v:walk(x,key)
 elif isinstance(v,str):
  for role in ('BUSINESS_OPERATIONS_MANAGER','BUSINESS_OPERATION_MANAGER','BOM'):
   if role in v: known.add(role)
walk(d)
print('Role references only:',sorted(known))
