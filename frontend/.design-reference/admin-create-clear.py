from pathlib import Path
p=Path('src/lib/adminUsers.js');s=p.read_text(encoding='utf-8').replace('createAdminUser(values){','createAdminUser(values,onCreated){').replace("await userApi.createUser(payload);await refreshAfterAction(token,", "await userApi.createUser(payload);payload.password='';onCreated?.();await refreshAfterAction(token,");p.write_text(s,encoding='utf-8')
