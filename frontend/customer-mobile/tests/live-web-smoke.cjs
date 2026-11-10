// Expo web smoke. All API and Hosted Checkout traffic is intercepted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require(process.env.WDP_PLAYWRIGHT_MODULE ||
  'C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const [owner,facilityId,unitId,pricingId,reservationId,contractId,paymentId]='1234567'.split('').map(x=>x.repeat(24));
const start='2099-01-01',end='2099-02-01';
const startDate=start+'T00:00:00.000Z',endDate=end+'T00:00:00.000Z';
const hosted='https://pay.payos.vn/web/mobile-fixture';
const user={_id:owner,role:'CUSTOMER',displayName:'Khách kiểm thử',email:'fixture@example.invalid',isActive:true};
const facility={_id:facilityId,name:'Kho kiểm thử',address:{city:'Hồ Chí Minh'},serviceTypes:['SELF_STORAGE']};
const unit={_id:unitId,facilityId,unitCode:'FIX-01',size:'SMALL',status:'AVAILABLE'};
const unavailable=['OCCUPIED','MAINTENANCE','BLOCKED','UNKNOWN_STATE'].map((status,i)=>({...unit,_id:'abcde'[i].repeat(24),unitCode:'FIX-NO-'+i,status}));
let customerProfile={userId:owner,verificationStatus:'UNVERIFIED',address:'ư',taxCode:null};
let profileWrites=0,profileReads=0,rangeChecks=0,conflict=false,rejectedBookings=0;
let holdStatus,signalStatus,finishStatus,historyError=false;
let booked=false,paid=false,payment=null,bookingCount=0,paymentCount=0,opened=0;
const reservation=()=>({_id:reservationId,facilityId,storageUnitId:unitId,customerId:owner,serviceType:'SELF_STORAGE',
  reservationCode:'R-TEST',startDate,endDate,expiresAt:'2099-01-02T00:00:00Z',status:paid?'DEPOSIT_PAID':'CONTRACTED'});
const scope='/reservations/'+reservationId+'/payments/';
const artifact=path.resolve(__dirname,'../artifacts/live-web');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png'};
const server=http.createServer(async (req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    let file=path.resolve(artifact,'.'+name);
    if(!file.startsWith(artifact+path.sep)||!path.extname(name))file=path.join(artifact,'index.html');
    const body=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream'}).end(body);
  }catch{res.writeHead(404).end();}
});

async function main(){
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const unexpected=[],errors=[];
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(url.origin===origin)return route.continue();
      if(url.href===hosted){opened++;return route.fulfill({status:200,contentType:'text/html',body:'<h1>Checkout fixture</h1>'});}
      if(url.origin!=='https://fixture.invalid')return route.abort();
      const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,authorization,idempotency-key',
        'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,OPTIONS'};
      if(method==='OPTIONS')return route.fulfill({status:204,headers});
      const p=url.pathname.replace(/^\/api\/v1/,'');
      let data,status=200,outcome,pagination,heldStatus=false;
      if(p==='/auth/login'&&method==='POST')data={accessToken:'fixture-access',refreshToken:'fixture-refresh',user};
      else if(p==='/users/me')data=user;
      else if(p==='/auth/logout'&&method==='POST')data={};
      else if(p==='/customers/me/profile'&&method==='GET'){profileReads++;data=customerProfile;}
      else if(p==='/customers/me/profile'&&method==='PUT'){
        profileWrites++;assert.deepEqual(req.postDataJSON(),{address:'12 Nguyễn Huệ'});
        if(profileWrites===1)return route.fulfill({status:400,headers,json:{success:false}});
        customerProfile={...customerProfile,address:'12 Nguyễn Huệ',verificationStatus:'PENDING'};data=customerProfile;
      }
      else if(p==='/reservations/me')data=booked?[reservation()]:[];
      else if(p==='/contracts/me'||p==='/notifications/me')data=[];
      else if(p==='/inventory-items/me'){data=[];pagination={page:1,limit:20,total:0,totalPages:0};}
      else if(p==='/public/facilities'){data=[facility];pagination={page:1,limit:20,total:1,totalPages:1};}
      else if(p==='/public/facilities/'+facilityId)data=facility;
      else if(p==='/facilities/'+facilityId+'/storage-units'){data=[unit,...unavailable];pagination={page:1,limit:20,total:5,totalPages:1};}
      else if(p==='/storage-units/'+unitId)data=unit;
      else if(p==='/storage-units/'+unitId+'/availability'){
        const rangeStart=url.searchParams.get('startDate'),rangeEnd=url.searchParams.get('endDate');
        if(rangeStart)rangeChecks++;
        data={storageUnitId:unitId,month:url.searchParams.get('month'),intervals:[],availabilityState:'VERIFIED',
          rangeAvailability:rangeStart?(conflict||rangeEnd==='2099-01-02'?'CONFLICT':'AVAILABLE'):null,
          requestedRange:rangeStart?{startDate:rangeStart+'T00:00:00Z',endDate:rangeEnd+'T00:00:00Z'}:null,evaluatedAt:'2098-12-31T12:00:00Z'};
      }
      else if(p==='/pricing-rules/resolve'){
        data={_id:pricingId,facilityId,serviceType:'SELF_STORAGE',unitSize:'SMALL',
          term:{value:Number(url.searchParams.get('termValue')),unit:url.searchParams.get('termUnit')},currency:'VND',price:2000,isActive:true,effectiveFrom:'2098-01-01T00:00:00Z'};
      }
      else if(p==='/pricing-rules'){
        data=['DAY','MONTH','YEAR'].map(unit=>({_id:pricingId,facilityId,serviceType:'SELF_STORAGE',unitSize:'SMALL',
          term:{value:1,unit},currency:'VND',price:2000,isActive:true,effectiveFrom:'2098-01-01T00:00:00Z'}));
        pagination={page:1,limit:100,total:3,totalPages:1};
      }
      else if(p==='/reservations/estimate'&&method==='POST')data={estimatedRent:2000,depositAmount:1000,taxAmount:0,basePrice:2000,durationDays:31};
      else if(p==='/reservations'&&method==='POST'){
        assert.equal(req.headers()['authorization'],'Bearer fixture-access');
        assert.match(req.headers()['idempotency-key'],/^wdp-mobile-/);
        const body=req.postDataJSON();
        if(body.endDate==='2100-01-01T00:00:00.000Z'){
          rejectedBookings++;
          return route.fulfill({status:409,headers,json:{success:false}});
        }
        assert.deepEqual(body,{facilityId,storageUnitId:unitId,pricingPolicyId:pricingId,startDate,endDate});
        booked=true;bookingCount++;data=reservation();status=201;
      }else if(p==='/contracts/reservation/'+reservationId)data={_id:contractId,customerId:owner,reservationId,status:'DRAFT'};
      else if(p===scope+'payos'&&method==='GET'){
        if(historyError)return route.fulfill({status:503,headers,json:{success:false}});
        data={items:payment?[{...payment,createdAt:startDate}]:[],nextCursor:null};
      }
      else if(p===scope+paymentId){
        data=payment;
        if(holdStatus){
          const gate=holdStatus;
          heldStatus=true;
          holdStatus=null;
          signalStatus();
          await gate;
        }
      }
      else if(p===scope+'payos'&&method==='POST'){
        assert.equal(req.headers()['authorization'],'Bearer fixture-access');
        assert.match(req.headers()['idempotency-key'],/^wdp-mobile-/);
        assert.deepEqual(req.postDataJSON(),{purpose:'DEPOSIT'});
        paymentCount++;
        payment={id:paymentId,reservationId,provider:'PAYOS',purpose:'DEPOSIT',amount:1000,currency:'VND',status:'PENDING',
          providerSettlementStatus:'NOT_VERIFIED',applicationStatus:'NOT_APPLIED',checkoutStatus:'READY',checkoutUrl:hosted,
          qrCode:null,succeededAt:null,reconciliationRequired:false};
        data=payment;outcome='CREATED';status=201;
      }else{unexpected.push(method+' '+p);return route.fulfill({status:404,headers,json:{success:false}});}
      const response={status,headers,json:{success:true,data,...(outcome?{outcome}:{}),...(pagination?{pagination}:{})}};
      if(!heldStatus)return route.fulfill(response);
      try{await route.fulfill(response);}finally{finishStatus();}

    });
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2098-12-31T12:00:00Z'));
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(origin,{waitUntil:'commit'});
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Mật khẩu',{exact:true}).fill('fixture-only');
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.getByText('Xin chào, '+user.displayName).waitFor();
    await page.getByRole('button',{name:'Khám phá kho'}).click();
    await page.getByRole('button',{name:'Xem cơ sở'}).click();
    await page.getByRole('button',{name:'Chọn kho tự quản'}).click();
    const unitButtons=page.getByRole('button',{name:'Chọn kỳ thuê'});
    await unitButtons.first().waitFor();
    assert.equal(await unitButtons.count(),5);
    for(let i=1;i<5;i++){
      assert.equal(await unitButtons.nth(i).isDisabled(),true);
      await unitButtons.nth(i).evaluate(button=>button.click());
    }
    assert.equal(bookingCount,0);
    assert.equal(rangeChecks,0);
    assert.equal(await page.getByText('Đã có người thuê',{exact:true}).count(),1);
    await unitButtons.first().click();
    await page.getByRole('button',{name:'Chọn ngày bắt đầu'}).click();
    await page.getByRole('button',{name:'Tháng sau'}).click();
    await page.getByRole('button',{name:'Chọn ngày 01/01/2099'}).click();
    await page.getByRole('button',{name:'1 tháng',exact:true}).click();
    const confirm=page.getByRole('button',{name:'Xác nhận đặt kho'});
    await page.getByText('Ngày kết thúc: 01/02/2099').waitFor();
    await page.getByText(/Tiền thuê dự kiến/).waitFor();
    await page.getByRole('button',{name:'Ngày',exact:true}).click();
    await page.getByRole('button',{name:'1 ngày',exact:true}).click();
    await page.getByText('Kho không còn trống trong kỳ thuê đã chọn.').waitFor();
    assert.equal(await confirm.isDisabled(),true);
    assert.equal(await page.getByText(/Tiền thuê dự kiến/).count(),0);
    await page.getByRole('button',{name:'Năm',exact:true}).click();
    await page.getByRole('button',{name:'1 năm',exact:true}).click();
    await page.getByText('Ngày kết thúc: 01/01/2100').waitFor();
    await page.getByText(/Tiền thuê dự kiến/).waitFor();
    await confirm.click();
    await page.getByText(/Kho không còn trống hoặc trạng thái đặt kho đã thay đổi/).waitFor();
    assert.equal(rejectedBookings,1);
    assert.equal(paymentCount,0);
    await page.getByRole('button',{name:'Chọn ngày bắt đầu'}).click();
    await page.getByRole('button',{name:'Chọn ngày 01/01/2099'}).click();
    await page.getByRole('button',{name:'Tháng',exact:true}).click();
    await page.getByRole('button',{name:'1 tháng',exact:true}).click();
    await page.getByText(/Tiền thuê dự kiến/).waitFor();
    conflict=true;
    await confirm.click();
    await page.getByText('Chưa thể hoàn tất đặt kho').waitFor();
    assert.equal(bookingCount,0);
    assert.equal(paymentCount,0);
    await page.getByText('Không tải được dữ liệu',{exact:true}).waitFor();
    conflict=false;
    await page.getByRole('button',{name:'Thử lại',exact:true}).click();
    await page.getByText(/Tiền thuê dự kiến/).waitFor();
    assert.ok(rangeChecks>=5);
    await confirm.evaluate(button=>{button.click();button.click();});
    const create=page.getByRole('button',{name:'Tạo liên kết thanh toán'});
    await create.evaluate(button=>{button.click();button.click();});
    await page.getByRole('button',{name:'Mở liên kết PayOS hiện có'}).waitFor();
    assert.equal(bookingCount,1);
    assert.equal(paymentCount,1);
    assert.equal(opened,1);
    assert.equal(await page.getByText('Tiền đặt cọc đã được xác minh và ghi nhận.').count(),0);
    await page.getByText('Tiến độ đơn thuê',{exact:true}).waitFor();
    payment={...payment,checkoutStatus:'UNKNOWN',checkoutUrl:null};
    await page.getByRole('button',{name:'Kiểm tra trạng thái'}).click();
    await page.getByText('Tiền cọc cần đối soát. Hãy kiểm tra giao dịch hiện có.').first().waitFor();
    assert.equal(await create.count(),0);
    assert.equal(paymentCount,1);

    let releaseOld;
    const oldFinished=new Promise(resolve=>{finishStatus=resolve;});
    holdStatus=new Promise(resolve=>{releaseOld=resolve;});
    const oldStarted=new Promise(resolve=>{signalStatus=resolve;});
    await page.getByRole('button',{name:'Kiểm tra trạng thái'}).click();
    const statusWait=setTimeout(()=>signalStatus(),15000);
    await oldStarted;
    clearTimeout(statusWait);
    assert.equal(holdStatus,null,'expected the prior status GET to reach the fixture');
    paid=true;
    payment={...payment,status:'SUCCEEDED',checkoutStatus:'READY',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED',checkoutUrl:null};
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByText('Tiền đặt cọc đã được xác minh và ghi nhận.').waitFor();
    releaseOld();
    await oldFinished;
    await page.getByText(/Liên hệ cơ sở để ký hợp đồng giấy/).first().waitFor();
    assert.equal(await page.getByText('Tiền cọc cần đối soát. Hãy kiểm tra giao dịch hiện có.').count(),0);
    assert.equal(paymentCount,1);
    const signIn=async()=>{
      await page.getByLabel('Email',{exact:true}).fill(user.email);
      await page.getByLabel('Mật khẩu',{exact:true}).fill('fixture-only');
      await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
      await page.getByText('Xin chào, '+user.displayName).waitFor();
    };
    await page.goto(origin,{waitUntil:'commit'});
    await signIn();
    await page.getByText('Kho thuê',{exact:true}).click();
    await page.getByText('Kho của tôi',{exact:true}).waitFor();
    await page.getByText(/Kho tự quản · Đang ở bước hợp đồng giấy/).last().waitFor();
    historyError=true;
    await page.getByRole('button',{name:'Xem đơn thuê'}).last().press('Enter');
    await page.getByText('Chưa thể xác minh tiến độ',{exact:true}).waitFor();
    assert.equal(await page.getByText('Tiến độ đơn thuê',{exact:true}).count(),0);
    historyError=false;
    await page.getByRole('button',{name:'Thử lại',exact:true}).click();
    await page.getByText('Tiến độ đơn thuê',{exact:true}).waitFor();
    await page.getByText('Đang ở bước hợp đồng giấy',{exact:true}).waitFor();
    assert.equal(paymentCount,1);
    await page.goBack();
    await page.getByText('Tài khoản',{exact:true}).last().click();
    await page.getByRole('button',{name:'Chỉnh sửa hồ sơ'}).click();
    assert.equal(await page.getByLabel('Địa chỉ',{exact:true}).inputValue(),'');
    await page.getByLabel('Địa chỉ',{exact:true}).fill('12 Nguyễn Huệ');
    const save=page.getByRole('button',{name:'Lưu thay đổi'});
    await save.click();
    await page.getByText('Thông tin không hợp lệ. Vui lòng kiểm tra lại.').waitFor();
    assert.equal(await page.getByLabel('Địa chỉ',{exact:true}).inputValue(),'12 Nguyễn Huệ');
    assert.equal(await page.getByText('Đã lưu thay đổi.').count(),0);
    await save.evaluate(button=>{button.click();button.click();});
    await page.getByText('Địa chỉ: 12 Nguyễn Huệ').waitFor();
    await page.getByText('Đang xét duyệt').waitFor();
    assert.equal(profileWrites,2);
    assert.ok(profileReads>=2);
    await page.getByRole('button',{name:'Đăng xuất'}).click();
    await signIn();
    await page.getByText('Tài khoản',{exact:true}).last().click();
    await page.getByText('Địa chỉ: 12 Nguyễn Huệ').waitFor();
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpected,[]);
    console.log('PASS: Expo web Unit controls, calendar, stale quote rejection, booking/PayOS regression, progress refresh and Profile persistence');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
