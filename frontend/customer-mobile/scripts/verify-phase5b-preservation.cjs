const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), baseline = require('../docs/phase5b-mobile-baseline.json');
const allowed = ['README.md', 'docs/ARCHITECTURE.md', 'docs/design-map.json', 'app/_layout.tsx', 'src/components/booking.tsx', 'src/components/customer.tsx', 'src/forms/auth.ts', 'src/screens/DashboardScreen.tsx', 'src/screens/ProfileScreen.tsx', 'src/screens/RegisterScreen.tsx', 'src/state/useCustomerStore.ts'];
const changed = [], missing = [];
for (const [name, hash] of Object.entries(baseline)) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) missing.push(name);
  else if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) changed.push(name);
}
const unexpected = changed.filter(name => !allowed.includes(name));
const result = {checked: Object.keys(baseline).length, changed, missing, unexpected, unchanged: Object.keys(baseline).length - changed.length - missing.length, result: missing.length || unexpected.length ? 'FAIL' : 'PASS', scope: 'Existing source/docs/config before Phase 5B; excludes .env, node_modules, .expo, artifacts. Website has independent 1074-file baseline.'};
fs.writeFileSync(path.join(root, 'docs/phase5b-preservation-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result)); if (result.result !== 'PASS') process.exitCode = 1;
