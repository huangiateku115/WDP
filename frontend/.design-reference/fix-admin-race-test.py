from pathlib import Path
p=Path('.design-reference/check-admin-session-live.cjs');s=p.read_text(encoding='utf-8').replace('let oldDelay=600','let oldDelay=3500').replace('await p.waitForTimeout(750)','await p.waitForTimeout(4000)')
start=s.index("await p.goto('http://127.0.0.1:5173/admin/users')")
end=s.index("await p.getByRole('table'",start)
replacement="""const began=p.waitForRequest(r=>r.url().endsWith('/api/v1/users'));await p.goto('http://127.0.0.1:5173/admin/users',{waitUntil:'domcontentloaded'});await began;const companion=await c.newPage();await companion.goto('http://127.0.0.1:5173/login');await companion.evaluate(async second=>{const s=await import('/src/lib/authSession.js');s.saveAuthSession({accessToken:second,refreshToken:'synthetic-next-refresh',user:{id:'new-session',displayName:'New Session',role:'FACILITY_MANAGER'}})},second);"""
s=s[:start]+replacement+s[end:]
s=s.replace("await p.evaluate(async()=>{const source=", "await companion.evaluate(async()=>{const source=")
p.write_text(s,encoding='utf-8')
