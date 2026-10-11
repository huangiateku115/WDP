const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const calls=[],uploads=[],errors=[];let mode='success',release;
  let user={id:'avatar-test',displayName:'Avatar Test',email:'avatar@example.test',phone:'0900000000',role:'CUSTOMER'};
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.avatarUrls={created:[],revoked:[]};URL.createObjectURL=x=>{const url=create(x);window.avatarUrls.created.push(url);return url;};URL.revokeObjectURL=url=>{window.avatarUrls.revoked.push(url);revoke(url);};});
  await context.route('http://localhost:5000/api/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;try{body=req.postDataJSON();}catch{}
   if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});return;}
   calls.push({path,method:req.method(),body});let data;
   if(path==='/api/v1/users/me/')data=user;
   else if(path==='/api/v1/users/me/profile'){assert.deepEqual(Object.keys(body).sort(),['displayName','phone']);user={...user,...body};data=user;}
   else if(path==='/api/v1/users/me/password'){assert.deepEqual(Object.keys(body).sort(),['newPassword','oldPassword']);data={};}
   else if(path==='/api/v1/customers/me/profile')data={verificationStatus:'PENDING'};
   else if(path==='/api/v1/auth/logout')data={};
   else throw Error('Unexpected Backend request '+path);
   await route.fulfill({headers:{'access-control-allow-origin':'*'},json:{success:true,data}});
  });
  await context.route('https://api.cloudinary.com/**',async route=>{
   const req=route.request();uploads.push({url:req.url(),headers:req.headers(),body:req.postDataBuffer().toString()});
   if(mode==='delay')await new Promise(r=>release=r);
   if(mode==='network'){await route.abort();return;}
   await route.fulfill({status:mode==='failure'?400:200,headers:{'access-control-allow-origin':'*'},json:mode==='failure'?{error:{message:'Private error'}}:{secure_url:mode==='invalid'?'https://evil.example/image.png':'https://res.cloudinary.com/tzk7vj1a/image/upload/v1/avatar-test.png',public_id:'avatar-test'}});
  });
  await page.goto('http://127.0.0.1:5189/login');
  await page.evaluate(async()=>{const {saveAuthSession}=await import('/src/lib/authSession.js');saveAuthSession({accessToken:'avatar-synthetic',refreshToken:'avatar-refresh',user:{id:'avatar-test',role:'CUSTOMER'}});});
  await page.goto('http://127.0.0.1:5189/portal/profile');await page.getByRole('heading',{name:'Avatar Test',exact:true}).waitFor();
  const picker=page.getByLabel('Avatar image file'),png={name:'avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPuoAAAAASUVORK5CYII=','base64')};
  assert.equal(await page.getByAltText('Profile avatar').count(),0);
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose avatar image'}).click();await chooser;
  await picker.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await page.getByText('Choose a JPG, JPEG, PNG or WebP image.').waitFor();
  await picker.setInputFiles({name:'big.png',mimeType:'image/png',buffer:Buffer.alloc(2*1024*1024+1)});await page.getByText('Choose an image smaller than or equal to 2 MB.').waitFor();assert.equal(uploads.length,0);
  await picker.setInputFiles(png);await page.getByAltText('Selected avatar preview').waitFor();assert(await page.getByRole('button',{name:'Save avatar',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByAltText('Selected avatar preview').waitFor({state:'detached'});assert.equal(await page.getByAltText('Selected avatar preview').count(),0);
  await picker.setInputFiles(png);await page.getByRole('button',{name:'Upload image',exact:true}).click();await page.getByText('Image uploaded to Cloudinary.',{exact:false}).waitFor();
  assert.equal(uploads.length,1);assert.equal(uploads[0].url,'https://api.cloudinary.com/v1_1/tzk7vj1a/image/upload');assert(!uploads[0].headers.authorization);assert(uploads[0].body.includes('name="file"'));assert(uploads[0].body.includes('name="upload_preset"'));assert(uploads[0].body.includes('selfstorage_avatars'));assert(await page.getByRole('button',{name:'Upload image',exact:true}).isDisabled());assert(!calls.some(c=>c.method==='PUT'));
  assert(!JSON.stringify(await page.evaluate(()=>({...localStorage}))).includes('res.cloudinary.com'));
  await page.reload();await page.getByRole('heading',{name:'Avatar Test',exact:true}).waitFor();assert.equal(await page.getByAltText('Selected avatar preview').count(),0);
  for(const fail of ['failure','network','invalid']){mode=fail;await picker.setInputFiles(png);await page.getByRole('button',{name:'Upload image',exact:true}).click();await page.getByRole('alert').filter({hasText:fail==='invalid'?'invalid image response':fail==='network'?'Cannot connect to Cloudinary':'Cloudinary could not upload'}).waitFor();assert(!calls.some(c=>c.method==='PUT'));await page.getByRole('button',{name:'Cancel',exact:true}).click();}
  mode='delay';await picker.setInputFiles(png);await page.getByRole('button',{name:'Upload image',exact:true}).click();await page.getByText('Uploading image to Cloudinary…').waitFor();assert(await page.getByRole('button',{name:'Uploading…',exact:true}).isDisabled());await page.getByRole('button',{name:'Cancel upload',exact:true}).click();release();await page.getByRole('button',{name:'Choose avatar image'}).waitFor();
  mode='delay';await picker.setInputFiles(png);await page.getByRole('button',{name:'Upload image',exact:true}).click();await page.getByText('Uploading image to Cloudinary…').waitFor();await page.evaluate(async()=>{const {saveAuthSession}=await import('/src/lib/authSession.js');saveAuthSession({accessToken:'other-test',refreshToken:'other-refresh',user:{id:'other',role:'CUSTOMER'}});});release();await page.waitForTimeout(150);assert.equal(await page.getByText('Image uploaded to Cloudinary.',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();await page.getByLabel('Full name',{exact:true}).fill('Updated Avatar Test');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.getByText('Profile updated successfully.').waitFor();
  await page.getByRole('button',{name:'Change password',exact:true}).click();await page.getByLabel('Current password',{exact:true}).fill('old-test');await page.getByLabel('New password',{exact:true}).fill('new-test');await page.getByLabel('Confirm new password',{exact:true}).fill('new-test');await page.getByRole('button',{name:'Update password',exact:true}).click();await page.getByText('Password updated successfully.').waitFor();
  await page.getByLabel('Identity Card / CCCD').fill('synthetic-id');await page.getByLabel('Identity address').fill('synthetic-address');await page.getByRole('button',{name:'Save identity information'}).click();await page.getByText('Identity information saved.',{exact:false}).waitFor();
  mode='success';for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await picker.setInputFiles(png);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Cancel',exact:true}).click();}
  const urls=await page.evaluate(()=>window.avatarUrls);assert.deepEqual([...urls.created].sort(),[...urls.revoked].sort());assert.deepEqual(errors,[]);
  console.log('PASS: profile/fallback/picker/type/size/preview/cancel/cleanup; multipart upload/no auth/duplicate guard; HTTP/network/invalid URL/abort/stale session; no fake persistence; contact/password/verification; 4 widths, no overflow or page errors. Mocked API tests only.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
