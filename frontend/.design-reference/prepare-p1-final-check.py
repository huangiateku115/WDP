from pathlib import Path
p=Path('.design-reference/check-priority1.cjs');t=p.read_text(encoding='utf-8-sig');position=t.index(' const routes=');t=t[:position]+" assert.deepEqual(errors,[]); await browser.close();\n})().catch(error=>{console.error(error);process.exit(1)});\n";Path('.design-reference/check-p1-final-interactions.cjs').write_text(t,encoding='utf-8')
