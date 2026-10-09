from pathlib import Path
p=Path('.design-reference/check-admin-session-live.cjs');s=p.read_text(encoding='utf-8').replace("const s=await import('/src/lib/authSession.js');", "const source=await(await fetch('/src/lib/adminUsers.js')).text();const s=await import(source.match(/from [\"']([^\"']*\\/authSession\\.js[^\"']*)/)[1]);");p.write_text(s,encoding='utf-8')
