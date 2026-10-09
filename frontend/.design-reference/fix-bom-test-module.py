from pathlib import Path
f=Path('.design-reference/check-bom-guards.cjs')
s=f.read_text(encoding='utf-8').replace("m=await import('/src/mocks/bomData.js')", "m=await import((await (await fetch('/src/lib/bomDemoStore.js')).text()).match(/from [\"']([^\"']*\\/bomData\\.js[^\"']*)/)[1])")
f.write_text(s,encoding='utf-8')
