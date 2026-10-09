from pathlib import Path
p=Path('src/lib/bomDemoStore.js');s=p.read_text(encoding='utf-8')
s=s.replace("let state;try{const stored=JSON.parse(localStorage.getItem(bomStorageKey));state=bomDemoEnabled?{...clone(bomSeed),...(stored||{})}:clone(empty);}","function restore(value){const keys=Object.keys(bomSeed);if(!value||keys.some(k=>!Array.isArray(value[k])||value[k].some(r=>!r||typeof r!=='object'||typeof r.id!=='string')))return clone(bomSeed);return Object.fromEntries(keys.map(k=>[k,clone(value[k])]));}\nlet state;try{const stored=JSON.parse(localStorage.getItem(bomStorageKey));state=bomDemoEnabled?restore(stored):clone(empty);}")
s=s.replace("state=e.newValue?{...clone(bomSeed),...JSON.parse(e.newValue)}:clone(bomSeed);notify();","state=restore(e.newValue?JSON.parse(e.newValue):null);notify();")
p.write_text(s,encoding='utf-8')
p=Path('src/pages/bom/BusinessRecordsPage.jsx');s=p.read_text(encoding='utf-8')
s=s.replace('<div className="space-y-4"><h3 className="font-bold">Proposed values</h3><ReadOnlyValues value={value}/></div>','<div className="space-y-4">{record&&<><h3 className="font-bold">Before</h3><ReadOnlyValues value={record}/></>}<h3 className="font-bold">Proposed values</h3><ReadOnlyValues value={value}/></div>')
p.write_text(s,encoding='utf-8')
