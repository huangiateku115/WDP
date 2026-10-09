from pathlib import Path
p=Path('.design-reference/check-p2-live-and-guards.cjs');s=p.read_text(encoding='utf-8-sig').replace("assert(guards.every(Boolean));console.log('PASS: capacity", "console.log('GUARD RESULTS',guards);assert(guards.every(Boolean));console.log('PASS: capacity");p.write_text(s,encoding='utf-8')
