const fs=require('node:fs'),crypto=require('node:crypto');
const baseline=JSON.parse(fs.readFileSync('docs/phase4a-mobile-baseline.json','utf8'));
const allowed=new Set(['app/_layout.tsx','src/screens/InventoryScreen.tsx','src/screens/PreviewDetailScreen.tsx','src/state/useCustomerStore.ts','README.md','docs/ARCHITECTURE.md','docs/design-map.json']);
const changed=[],missing=[];for(const [p,hash]of Object.entries(baseline)){if(!fs.existsSync(p))missing.push(p);else if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==hash)changed.push(p);}
const unexpected=changed.filter(p=>!allowed.has(p));console.log(JSON.stringify({baselineFiles:Object.keys(baseline).length,changedExisting:changed,unexpectedChanges:unexpected,missing}));if(unexpected.length||missing.length)process.exitCode=1;
