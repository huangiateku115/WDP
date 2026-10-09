from pathlib import Path
p=Path('src/pages/admin/SystemPages.jsx');s=p.read_text(encoding='utf-8').replace("state.users.every(u=>userStatus(u)!==null)","state.users.every(u=>['ACTIVE','INACTIVE','DEACTIVATED','DISABLED'].includes(userStatus(u)?.toUpperCase()))");p.write_text(s,encoding='utf-8')
