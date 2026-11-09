const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const origin=process.env.PROFILE_TEST_URL||'http://127.0.0.1:5189';
const api='http://localhost:5000';
const image='https://res.cloudinary.com/demo/image/upload/fixture.png';
const broken='https://res.cloudinary.com/demo/image/upload/missing.png';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPuoAAAAASUVORK5CYII=','base64');

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    const calls=[],uploads=[],errors=[];
    let user={id:'avatar-test',displayName:'Avatar Test',email:'avatar@example.test',phone:'0900000000',role:'CUSTOMER'};
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(url.origin===origin)return route.continue();
      if(url.hostname==='api.cloudinary.com'||(url.hostname==='res.cloudinary.com'&&method!=='GET'))uploads.push(method);
      if(url.href===image)return route.fulfill({contentType:'image/png',body:pixel});
      if(url.href===broken)return route.fulfill({status:404});
      if(url.origin!==api||!url.pathname.startsWith('/api/v1/'))return route.abort();
      const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'content-type,authorization',
        'access-control-allow-methods':'GET,PUT,OPTIONS'};
      if(method==='OPTIONS')return route.fulfill({status:204,headers});
      const path=url.pathname.replace(/\/$/,'');
      const body=method==='PUT'?req.postDataJSON():undefined;
      calls.push({path,method,body});
      let data;
      if(path==='/api/v1/users/me'&&method==='GET')data=user;
      else if(path==='/api/v1/users/me/profile'&&method==='PUT'){
        assert.deepEqual(Object.keys(body).sort(),['displayName','phone']);
        user={...user,...body};data=user;
      }else if(path==='/api/v1/users/me/password'&&method==='PUT'){
        assert.deepEqual(Object.keys(body).sort(),['newPassword','oldPassword']);data={};
      }else if(path==='/api/v1/customers/me/profile')data={verificationStatus:'PENDING'};
      else throw Error('Unexpected Backend request '+method+' '+path);
      return route.fulfill({headers,json:{success:true,data}});
    });
    await context.addInitScript(()=>{
      sessionStorage.setItem('SelfStorage_token','avatar-fixture');
      sessionStorage.setItem('SelfStorage_refreshToken','avatar-fixture-refresh');
      sessionStorage.setItem('SelfStorage_user',JSON.stringify({id:'avatar-test',role:'CUSTOMER'}));
    });

    async function profile(){
      await page.goto(origin+'/portal/profile');
      await page.getByRole('heading',{name:user.displayName,exact:true}).waitFor();
    }
    const fallback=page.getByRole('img',{name:'Default profile avatar',exact:true});
    await profile();
    await fallback.waitFor();
    user.avatarUrl=image;
    await profile();
    await page.getByAltText('Profile avatar',{exact:true}).waitFor();
    await page.waitForFunction(()=>Array.from(document.images).some(img=>img.alt==='Profile avatar'&&img.complete&&img.naturalWidth>0));
    user.avatarUrl=broken;
    await profile();
    await fallback.waitFor();
    user.avatarUrl='javascript:alert(1)';
    await profile();
    await fallback.waitFor();

    assert.equal(await page.locator('input[type=file]').count(),0);
    assert.equal(await page.getByRole('button',{name:/choose avatar|upload image|save avatar/i}).count(),0);
    await page.getByRole('button',{name:'Edit profile',exact:true}).click();
    await page.getByLabel('Full name',{exact:true}).fill('Updated Avatar Test');
    await page.getByRole('button',{name:'Save profile',exact:true}).click();
    await page.getByText('Profile updated successfully.').waitFor();
    await page.getByRole('button',{name:'Change password',exact:true}).click();
    await page.getByLabel('Current password',{exact:true}).fill('old-test');
    await page.getByLabel('New password',{exact:true}).fill('new-test');
    await page.getByLabel('Confirm new password',{exact:true}).fill('new-test');
    await page.getByRole('button',{name:'Update password',exact:true}).click();
    await page.getByText('Password updated successfully.').waitFor();
    await page.getByLabel('Identity Card / CCCD').fill('synthetic-id');
    await page.getByLabel('Identity address').fill('synthetic-address');
    await page.getByRole('button',{name:'Save identity information'}).click();
    await page.getByText('Identity information saved.',{exact:false}).waitFor();
    for(const width of [1440,768,390,320]){
      await page.setViewportSize({width,height:1000});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    assert.deepEqual(calls.filter(call=>call.method==='PUT').map(call=>call.path),[
      '/api/v1/users/me/profile','/api/v1/users/me/password','/api/v1/customers/me/profile',
    ]);
    assert.deepEqual(uploads,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS: read-only avatar/default/invalid/broken image; no picker/upload; contact/password/identity; four widths. HTTP fixtures only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
