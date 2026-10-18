const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const api='http://localhost:5000/api/v1',frontend=process.env.MI02C_READONLY_FRONTEND_URL||'http://127.0.0.1:5173';
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext(),page=await context.newPage(),attemptedMutations=[];
 // No fixtures: GET/OPTIONS go to the real server. Block every state-changing API request.
 await context.route('**/api/**',async route=>{const r=route.request();if(!['GET','OPTIONS'].includes(r.method())){attemptedMutations.push({method:r.method(),pathname:new URL(r.url()).pathname});return route.abort('blockedbyclient');}return route.continue();});
 const results=[];await page.goto(frontend+'/login');
 for(const path of ['/health','/reservations/me','/warehouse-map']){
  const result=await page.evaluate(async target=>{try{const response=await fetch(target,{method:'GET',credentials:'omit',signal:AbortSignal.timeout(5000)});let meta={};if(target.endsWith('/health')){const data=await response.json();meta={success:data.success===true,database:['connected','disconnected'].includes(data.database)?data.database:'unknown'};}return {method:'GET',status:response.status,...meta};}catch(error){return {method:'GET',failure:error.name};}},api+path);
  results.push({url:api+path,...result});
 }
 await page.screenshot({path:'.design-reference/mi02c-real-login-connectivity.png',fullPage:true});
 const evidence={mode:'REAL BACKEND; READ ONLY; NO FIXTURES',frontend,api,results,attemptedMutations,authenticatedAccountsUsed:0,databaseIsolation:'NOT VERIFIED',transactions:'NOT VERIFIED',mutationGate:'BLOCKED — TEST DATABASE SAFETY NOT VERIFIED'};
 fs.writeFileSync('.design-reference/mi02c-real-readonly-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 if(attemptedMutations.length)throw Error('Unexpected state-changing request was blocked before network.');
}finally{await browser.close();}})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
