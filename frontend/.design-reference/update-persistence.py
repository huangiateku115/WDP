from pathlib import Path
p=Path('src/contexts/ReservationContext.jsx');t=p.read_text(encoding='utf-8');marker="  const addContract = (booking)"
t=t.replace(marker,"""  useEffect(() => {
    const syncContracts = event => {
      if (event.key !== 'SelfStorage_pendingContracts' || !event.newValue) return;
      try {
        const records = JSON.parse(event.newValue);
        if (Array.isArray(records)) setContracts(records);
      } catch { /* Ignore invalid browser storage values. */ }
    };
    window.addEventListener('storage', syncContracts);
    return () => window.removeEventListener('storage', syncContracts);
  }, []);
"""+marker);p.write_text(t,encoding='utf-8')
p=Path('.design-reference/check-booking.cjs');t=p.read_text(encoding='utf-8');t=t.replace(" await page.screenshot({path:'.design-reference/contracts-green-desktop.png',fullPage:true});", """ await page.screenshot({path:'.design-reference/contracts-green-desktop.png',fullPage:true});
 const otherTab=await page.context().newPage();
 await otherTab.goto('http://127.0.0.1:5173/portal/contracts',{waitUntil:'networkidle'});
 assert.equal(await otherTab.getByRole('link',{name:'Review & confirm contract'}).count(),1);""")
t=t.replace(" await go('/portal/contracts');\n assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),0);", """ await otherTab.getByRole('heading',{name:'No contracts awaiting confirmation'}).waitFor();
 await otherTab.close();
 await go('/portal/contracts');
 assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),0);""")
# Rerun the changed persistence/signing flow; the full visual matrix already passed.
i=t.index(' for(const width of [1440,390])')
t=t[:i]+" assert.deepEqual(errors,[]); console.log('PASS: contracts persist across tabs and confirmation synchronizes'); await browser.close();\n})().catch(error=>{console.error(error);process.exit(1)});\n"
Path('.design-reference/check-persistence.cjs').write_text(t,encoding='utf-8')
