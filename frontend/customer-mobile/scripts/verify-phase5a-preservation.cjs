const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname,'..'), baseline = require('../docs/phase5a-mobile-baseline.json');
const allowed = ['app/_layout.tsx','src/screens/RentalDetailScreen.tsx','README.md','docs/ARCHITECTURE.md','docs/design-map.json'];
const changed = [], missing = [];
for(const [name,hash] of Object.entries(baseline)) {
  const file = path.join(root,name);
  if(!fs.existsSync(file)) missing.push(name);
  else if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) changed.push(name);
}
const unexpected = changed.filter(name => !allowed.includes(name));
const result = {checked:Object.keys(baseline).length,changed,missing,unexpected,unchanged:Object.keys(baseline).length-changed.length-missing.length,scope:'Existing mobile source/docs/config before Phase 5A; excludes generated artifacts/node_modules/.expo/.env. Website verified separately.',result:missing.length || unexpected.length ? 'FAIL':'PASS'};
fs.writeFileSync(path.join(root,'docs/phase5a-preservation-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(result.result !== 'PASS') process.exitCode=1;
