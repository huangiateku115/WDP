const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const baseline=require('../docs/website-baseline.json');
const changed=[],missing=[];
for(const [name,expected] of Object.entries(baseline)){
  const file=path.join(root,name);
  if(!fs.existsSync(file)){missing.push(name);continue;}
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)changed.push(name);
}
console.log(JSON.stringify({checked:Object.keys(baseline).length,changed,missing}));
if(changed.length||missing.length)process.exitCode=1;
