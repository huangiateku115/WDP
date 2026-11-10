import type {AxiosAdapter,InternalAxiosRequestConfig} from 'axios';
import {AxiosError} from 'axios';

const mockVault = new Map<string,string>();
jest.mock('expo-secure-store',()=>({
  getItemAsync:async(key:string)=>mockVault.get(key)??null,
  setItemAsync:async(key:string,value:string)=>{mockVault.set(key,value);},
  deleteItemAsync:async(key:string)=>{mockVault.delete(key);},
}));
jest.mock('expo-crypto',()=>{
  const crypto=require('node:crypto');
  return {CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:async(_:string,value:string)=>crypto.createHash('sha256').update(value).digest('hex'),
    randomUUID:()=>crypto.randomUUID()};
});
process.env.EXPO_PUBLIC_API_BASE_URL='https://fixture.invalid/api/v1';

const {apiClient,wire,resolveApiBase,configureApiSession,apiIssue}=require('../src/api/client') as typeof import('../src/api/client');
const {mobileRepo}=require('../src/api/mobileRepository') as typeof import('../src/api/mobileRepository');
const {useLiveSession}=require('../src/state/useLiveSession') as typeof import('../src/state/useLiveSession');
const {journal,newAttempt}=require('../src/state/attemptJournal') as typeof import('../src/state/attemptJournal');
const {paymentContext,openDeposit}=require('../src/api/selfStoragePayment') as typeof import('../src/api/selfStoragePayment');
const {checkoutLink,depositDecision}=require('../src/domain/livePayment') as typeof import('../src/domain/livePayment');

const [owner,other,facilityId,unitId,pricingId,rentalId,contractId,paymentId]=['1','2','3','4','5','6','7','8'].map(i=>i.repeat(24)) as [string,string,string,string,string,string,string,string];
const user={_id:owner,role:'CUSTOMER',displayName:'Khách kiểm thử',email:'example@example.invalid',isActive:true};
const start='2099-01-01',end='2099-02-01';
const reservation={_id:rentalId,customerId:owner,serviceType:'SELF_STORAGE' as const,status:'CONTRACTED' as const,
  reservationCode:'R-1',facilityId,storageUnitId:unitId,startDate:start+'T00:00:00.000Z',endDate:end+'T00:00:00.000Z',expiresAt:'2099-01-02T00:00:00.000Z'};
const contract={_id:contractId,customerId:owner,reservationId:rentalId,status:'DRAFT' as const};
const payment={id:paymentId,reservationId:rentalId,provider:'PAYOS' as const,purpose:'DEPOSIT' as const,amount:2000,currency:'VND' as const,status:'PENDING' as const,
  providerSettlementStatus:'NOT_VERIFIED' as const,applicationStatus:'NOT_APPLIED' as const,checkoutStatus:'READY' as const,
  checkoutUrl:'https://pay.payos.vn/web/test',qrCode:null,succeededAt:null,reconciliationRequired:false};
const envelope=(data:unknown)=>({success:true,data});
const baseAdapter=apiClient.defaults.adapter;
function fixture(handler:(config:InternalAxiosRequestConfig)=>unknown|Promise<unknown>){
  const spy=jest.fn<ReturnType<AxiosAdapter>,Parameters<AxiosAdapter>>(async config=>{
    const data=await handler(config);
    return {data,status:200,statusText:'OK',headers:{},config};
  });
  apiClient.defaults.adapter=spy;
  return spy;
}
function httpError(config:InternalAxiosRequestConfig,status:number,code?:string){
  throw new AxiosError('fixture','ERR_BAD_RESPONSE',config,undefined,{data:{code},status,statusText:'Error',headers:{},config});
}
afterEach(async()=>{
  await useLiveSession.getState().logout().catch(()=>{});
  configureApiSession();
  apiClient.defaults.adapter=baseAdapter;
  mockVault.clear();
});

test('API base accepts HTTPS and development LAN only, and rejects foreign URLs before transport',async()=>{
  expect(resolveApiBase('https://wdp-m4ns.onrender.com/api/v1/',false)).toBe('https://wdp-m4ns.onrender.com/api/v1');
  expect(resolveApiBase('http://10.0.2.2:5000/api/v1',true)).toBe('http://10.0.2.2:5000/api/v1');
  expect(resolveApiBase('http://192.168.1.3:5000/api/v1',false)).toBeUndefined();
  expect(resolveApiBase('https://test.invalid/api/v1?abc=1',false)).toBeUndefined();
  const adapter=fixture(()=>{throw Error('Unexpected network');});
  await expect(apiClient.get('//elsewhere.invalid/api/v1')).rejects.toMatchObject({code:'API_ORIGIN_REJECTED'});
  await expect(apiClient.get('/users/me',{baseURL:'https://elsewhere.invalid/api/v1'})).rejects.toMatchObject({code:'API_ORIGIN_REJECTED'});
  expect(adapter).not.toHaveBeenCalled();
});

test('login verifies Customer identity, restores from SecureStore, and logout clears storage',async()=>{
  const adapter=fixture(c=>{
    if(c.url==='/auth/login'){
      expect(c.headers.get('Authorization')).toBeUndefined();
      expect(JSON.parse(c.data)).toEqual({email:user.email,password:'fixture-only'});
      return envelope({accessToken:'fixture-access',refreshToken:'fixture-refresh',user});
    }
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    return c.url==='/users/me'?envelope(user):{success:true};
  });
  await useLiveSession.getState().login({email:user.email,password:'fixture-only'});
  expect(useLiveSession.getState().user?._id).toBe(owner);
  expect(mockVault.size).toBe(1);
  configureApiSession();
  useLiveSession.setState({user:null});
  await useLiveSession.getState().restore();
  expect(useLiveSession.getState().user?._id).toBe(owner);
  await useLiveSession.getState().logout();
  expect(useLiveSession.getState().user).toBeNull();
  expect(mockVault.size).toBe(0);
  expect(adapter.mock.calls.map(([request])=>request.url)).toEqual(['/auth/login','/users/me','/users/me','/auth/logout']);
});

test('different owner returned from /users/me and staff login cannot activate a Customer session',async()=>{
  fixture(c=>c.url==='/users/me'?envelope({...user,_id:other}):envelope({accessToken:'a',refreshToken:'b',user}));
  await expect(useLiveSession.getState().login({email:user.email,password:'fixture-only'})).rejects.toThrow();
  expect(useLiveSession.getState().user).toBeNull();
  fixture(()=>envelope({accessToken:'a',refreshToken:'b',user:{...user,role:'FACILITY_STAFF'}}));
  await expect(useLiveSession.getState().login({email:user.email,password:'fixture-only'})).rejects.toThrow();
  expect(mockVault.size).toBe(0);
});

test('private 401 expires matching session, 403 leaves it intact and timeout is never retried',async()=>{
  let expired=0;
  configureApiSession('fixture-access',()=>expired++);
  const adapter=fixture(c=>{
    if(c.url==='/restricted')return httpError(c,403);
    if(c.url==='/expired')return httpError(c,401);
    throw new AxiosError('Fixture timeout','ECONNABORTED',c);
  });
  await expect(wire('GET','/restricted')).rejects.toMatchObject({response:{status:403}});
  expect(expired).toBe(0);
  await expect(wire('GET','/expired')).rejects.toMatchObject({response:{status:401}});
  expect(expired).toBe(1);
  await expect(wire('POST','/reservations')).rejects.toMatchObject({code:'ECONNABORTED'});
  expect(adapter.mock.calls.filter(([c])=>c.url==='/reservations')).toHaveLength(1);
  expect(apiIssue(new AxiosError('fixture','ECONNABORTED'))).toMatch(/quá thời gian/);
});

test('Facilities use verified paginated envelope and failure has no fallback',async()=>{
  const adapter=fixture(c=>{
    expect(c.headers.get('Authorization')).toBeUndefined();
    expect(c.params).toMatchObject({page:2,limit:20});
    return {success:true,data:[],pagination:{page:2,limit:20,total:20,totalPages:1}};
  });
  expect((await mobileRepo.facilities(2)).items).toEqual([]);
  expect(adapter).toHaveBeenCalledTimes(1);
  fixture(c=>httpError(c,503));
  await expect(mobileRepo.facilities()).rejects.toMatchObject({response:{status:503}});
});

test('quote checks exact availability and sends only authoritative booking fields with stable key',async()=>{
  configureApiSession('fixture-access');
  fixture(c=>{
    if(c.url==='/storage-units/'+unitId)return envelope({_id:unitId,facilityId,unitCode:'A-01',size:'SMALL',status:'AVAILABLE'});
    if(c.url?.endsWith('/availability'))return envelope({storageUnitId:unitId,month:'2099-01',intervals:[],availabilityState:'VERIFIED',
      rangeAvailability:'AVAILABLE',requestedRange:{startDate:reservation.startDate,endDate:reservation.endDate},evaluatedAt:'2098-12-01T00:00:00Z'});
    if(c.url==='/pricing-rules/resolve')return envelope({_id:pricingId,facilityId,serviceType:'SELF_STORAGE',unitSize:'SMALL',term:{unit:'MONTH',value:1},currency:'VND',price:2000,isActive:true,effectiveFrom:'2098-01-01T00:00:00Z'});
    if(c.url==='/reservations/estimate'){
      expect(Object.keys(JSON.parse(c.data)).sort()).toEqual(['endDate','pricingPolicyId','startDate']);
      return envelope({estimatedRent:2000,depositAmount:1000,taxAmount:0,basePrice:2000,durationDays:31});
    }
    expect(c.url).toBe('/reservations');
    expect(c.headers.get('Idempotency-Key')).toBe('fixture-attempt');
    expect(JSON.parse(c.data)).toEqual({facilityId,storageUnitId:unitId,pricingPolicyId:pricingId,startDate:reservation.startDate,endDate:reservation.endDate});
    return envelope(reservation);
  });
  const quote=await mobileRepo.quote(facilityId,unitId,{start,end,value:'1',unit:'MONTH'});
  expect(quote.estimate.depositAmount).toBe(1000);
  await expect(mobileRepo.book(quote.body,'fixture-attempt',owner)).resolves.toMatchObject({_id:rentalId});
});

test('persisted attempts are scoped and only one concurrent submit can claim a key',async()=>{
  const first=await journal('deposit',owner,rentalId);
  const second=await journal('deposit',owner,rentalId);
  const attempt=newAttempt();
  expect(await Promise.all([first.claim(attempt),second.claim(newAttempt())])).toEqual([true,false]);
  expect(await second.read()).toEqual(attempt);
  expect(await (await journal('deposit',other,rentalId)).read()).toBeNull();
  await second.write({...attempt,resourceId:paymentId});
  expect((await (await journal('deposit',owner,rentalId)).read())?.resourceId).toBe(paymentId);
});

test('PayOS uses one authenticated Deposit POST and protects checkout identity and UNKNOWN',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>{
    expect(c.headers.get('Idempotency-Key')).toBe('fixture-deposit-key');
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    expect(JSON.parse(c.data)).toEqual({purpose:'DEPOSIT'});
    return httpError(c,503,'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
  });
  await expect(mobileRepo.deposit(reservation,'fixture-deposit-key',owner)).rejects.toMatchObject({response:{status:503}});
  expect(adapter).toHaveBeenCalledTimes(1);
  await expect(mobileRepo.deposit(reservation,'fixture-deposit-key',other)).rejects.toThrow();
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(depositDecision(reservation,contract,[],true).kind).toBe('REVIEW');
  expect(depositDecision(reservation,contract,[{...payment,checkoutStatus:'UNKNOWN'}],false).kind).toBe('REVIEW');
  expect(depositDecision(reservation,null,[],false).kind).toBe('INELIGIBLE');
  expect(depositDecision(reservation,contract,[payment],true).kind).toBe('READY');
  expect(checkoutLink({...payment,checkoutUrl:'https://pay.payos.vn.evil.invalid/web/test'},rentalId)).toBeNull();
  expect(checkoutLink({...payment,reservationId:other},rentalId)).toBeNull();
  expect(depositDecision(reservation,contract,[{...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'}],true).kind).toBe('APPLIED');
});

test('Inventory reads owned projections and never substitutes available quantity or another owner',async()=>{
  configureApiSession('fixture-access');
  const item={_id:unitId,customerId:owner,managedReservationId:rentalId,facilityId,itemCode:'TEST-01',name:'Thùng',
    category:'Thùng',quantity:1,quantityUnit:'kiện',unitWeightKg:1,unitDimensionsM:{widthM:1,depthM:1,heightM:1},
    status:'REGISTERED',currentCellId:null};
  fixture(config=>{
    if(config.url==='/inventory-items/me')return {success:true,data:[item],pagination:{page:1,limit:20,total:1,totalPages:1}};
    return envelope({itemId:unitId,customerId:owner,managedReservationId:rentalId,facilityId,currentCellId:null,
      schemaVersion:1,source:'LEDGER_V2',version:0,onHandQuantity:0,heldQuantity:0,actualTotalWeightKg:0,actualTotalVolumeM3:0,batches:[]});
  });
  const list=await mobileRepo.inventory(owner);
  expect(list.items[0]?.itemCode).toBe(item.itemCode);
  expect((await mobileRepo.stock(list.items[0]!,owner)).availableQuantity).toBeUndefined();
  await expect(mobileRepo.inventory(other)).rejects.toThrow();
});

test('notification unread badge and read action come from owner-verified responses',async()=>{
  configureApiSession('fixture-access');
  const notice={_id:contractId,userId:owner,type:'FIXTURE',title:'Thông báo',content:'Dữ liệu kiểm thử',isRead:false,createdAt:'2098-12-01T00:00:00Z'};
  const adapter=fixture(config=>config.method==='patch'?envelope({...notice,isRead:true}):envelope([notice]));
  const inbox=await mobileRepo.notifications(owner);
  expect(inbox.unread).toBe(1);
  expect(inbox.items[0]?.destination).toBeNull();
  await expect(mobileRepo.readNotification(contractId,owner)).resolves.toEqual({_id:contractId,isRead:true});
  expect(adapter.mock.calls[1]?.[0].url).toBe('/notifications/'+contractId+'/read');
  await expect(mobileRepo.notifications(other)).rejects.toThrow();
});

test('Profile reads nullable data, saves only editable fields and verifies the refreshed account',async()=>{
  let current={...user,phone:null as string|null};
  let customerProfile={userId:owner,verificationStatus:'UNVERIFIED',address:null as string|null,taxCode:null,identityCard:null};
  const requests=fixture(c=>{
    if(c.url==='/auth/login')return envelope({accessToken:'fixture-access',refreshToken:'fixture-refresh',user});
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    if(c.url==='/users/me/profile'&&c.method==='put'){
      expect(JSON.parse(c.data)).toEqual({displayName:'Tên mới',phone:'0901234567'});
      current={...current,...JSON.parse(c.data)};
      return envelope(current);
    }
    if(c.url==='/customers/me/profile'&&c.method==='put'){
      expect(JSON.parse(c.data)).toEqual({address:'12 Nguyễn Huệ'});
      customerProfile={...customerProfile,address:'12 Nguyễn Huệ',verificationStatus:'PENDING'};
    }
    if(c.url==='/customers/me/profile')return envelope(customerProfile);
    if(c.url==='/users/me')return envelope(current);
    return {success:true};
  });
  const signIn=()=>useLiveSession.getState().login({email:user.email,password:'fixture-only'});
  await signIn();
  expect(await mobileRepo.profile(owner)).toMatchObject({address:null,taxCode:null});
  await mobileRepo.updateProfile(owner,{address:'12 Nguyễn Huệ'});
  expect(await mobileRepo.profile(owner)).toMatchObject({address:'12 Nguyễn Huệ',verificationStatus:'PENDING'});
  await mobileRepo.updateAccount(owner,{displayName:'Tên mới',phone:'0901234567'});
  await useLiveSession.getState().reloadUser(owner);
  expect(useLiveSession.getState().user?.displayName).toBe('Tên mới');
  await useLiveSession.getState().logout();
  await signIn();
  expect(useLiveSession.getState().user?.phone).toBe('0901234567');
  expect(await mobileRepo.profile(owner)).toMatchObject({address:'12 Nguyễn Huệ'});
  expect(requests.mock.calls.filter(([r])=>r.method==='put')).toHaveLength(2);
});

test('Profile rejects owner/role/verification overrides, invalid values, and another owner in the response',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(()=>envelope({userId:other,address:'12 Nguyễn Huệ',verificationStatus:'PENDING'}));
  for(const payload of [{userId:other,address:'12 Nguyễn Huệ'},{role:'ADMIN',address:'12 Nguyễn Huệ'},
    {verificationStatus:'VERIFIED',address:'12 Nguyễn Huệ'},{address:'ư'}]){
    await expect(mobileRepo.updateProfile(owner,payload)).rejects.toThrow();
  }
  await expect(mobileRepo.updateAccount(owner,{displayName:' ',email:'bad@example.invalid'})).rejects.toThrow();
  expect(adapter).not.toHaveBeenCalled();
  await expect(mobileRepo.updateProfile(owner,{address:'12 Nguyễn Huệ'})).rejects.toThrow(/scope/);
});

test.each([400,401,403])('Profile update surfaces HTTP %s without a retry or success',async status=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>httpError(c,status));
  await expect(mobileRepo.updateProfile(owner,{address:'12 Nguyễn Huệ'})).rejects.toMatchObject({response:{status}});
  expect(adapter).toHaveBeenCalledTimes(1);
});

test('duration options use only active rules effective at the UTC start across pages',async()=>{
  configureApiSession('fixture-access');
  const rule={_id:pricingId,facilityId,serviceType:'SELF_STORAGE',unitSize:'SMALL',term:{value:1,unit:'MONTH'},
    currency:'VND',price:2000,isActive:true,effectiveFrom:'2098-01-01T00:00:00Z'};
  const adapter=fixture(c=>{
    expect(c.url).toBe('/pricing-rules');
    expect(c.params).toMatchObject({facilityId,unitSize:'SMALL',serviceType:'SELF_STORAGE',isActive:true,limit:100});
    const page=c.params.page;
    return {...envelope(page===1?[rule,{...rule,term:{value:5,unit:'DAY'},effectiveTo:reservation.startDate}]:
      [{...rule,term:{value:1,unit:'YEAR'}},{...rule,term:{value:2,unit:'YEAR'},isActive:false}]),
      pagination:{page,limit:100,total:4,totalPages:2}};
  });
  expect(await mobileRepo.bookingTerms(facilityId,'SMALL',start)).toEqual([{value:1,unit:'MONTH'},{value:1,unit:'YEAR'}]);
  expect(adapter).toHaveBeenCalledTimes(2);
});

test.each(['CONFLICT','UNKNOWN','HTTP_ERROR','STALE'])('exact availability %s fails before estimate or mutation',async state=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>{
    if(c.url==='/storage-units/'+unitId)return envelope({_id:unitId,facilityId,unitCode:'O-01',size:'SMALL',status:'OCCUPIED'});
    if(c.url?.endsWith('/availability')){
      expect(c.params).toEqual({month:'2099-01',startDate:start,endDate:end});
      if(state==='HTTP_ERROR')return httpError(c,503);
      return envelope({storageUnitId:unitId,month:'2099-01',intervals:[],availabilityState:'VERIFIED',rangeAvailability:state==='STALE'?'AVAILABLE':state,
        requestedRange:{startDate:reservation.startDate,endDate:state==='STALE'?'2099-03-01T00:00:00Z':reservation.endDate},evaluatedAt:'2098-12-01T00:00:00Z'});
    }
    if(c.url==='/pricing-rules/resolve')return envelope({});
    throw Error('Unexpected request '+c.url);
  });
  await expect(mobileRepo.quote(facilityId,unitId,{start,end,value:1,unit:'MONTH'})).rejects.toThrow();
  expect(adapter.mock.calls.every(([c])=>c.method==='get')).toBe(true);
});

const historyPath='/reservations/'+rentalId+'/payments/payos';
const statusPath='/reservations/'+rentalId+'/payments/'+paymentId;
const contractPath='/contracts/reservation/'+rentalId;
const requestPaths=['/reservations/me',contractPath,historyPath,statusPath];
function depositFixture(config:InternalAxiosRequestConfig,current:Parameters<typeof checkoutLink>[0]=payment){
  expect(config.headers.get('Authorization')).toBe('Bearer fixture-access');
  switch(config.url){
    case '/reservations/me': return envelope([reservation]);
    case contractPath: return envelope(contract);
    case historyPath: return envelope({items:[{...current,createdAt:reservation.startDate}],nextCursor:null});
    case statusPath: return envelope(current);
    default: throw Error('Unexpected API '+config.url);
  }
}

test('owner opens the verified READY Hosted Checkout using the owned reservation list and current token',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(config=>depositFixture(config));
  const launch=jest.fn(async (_url:string)=>{});
  await openDeposit(rentalId,owner,()=>true,launch);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledWith(payment.checkoutUrl);
  expect(adapter.mock.calls.map(([config])=>config.url)).toEqual(requestPaths);
  expect(adapter.mock.calls.every(([config])=>config.method==='get')).toBe(true);
});

test('wrong owner, absent reservation and malformed route ID stop before Contract or Payment requests',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(()=>envelope([reservation]));
  const wrongId='a'.repeat(24);
  await expect(paymentContext(rentalId,other)).rejects.toMatchObject({step:'reservation',status:null});
  await expect(paymentContext(wrongId,owner)).rejects.toThrow('Không tìm thấy đơn thuê');
  await expect(paymentContext('not-an-id',owner)).rejects.toThrow('Mã đơn thuê không hợp lệ');
  expect(adapter.mock.calls.map(([config])=>config.url)).toEqual(['/reservations/me','/reservations/me']);
});

test.each([401,403])('owned Reservation list HTTP %s preserves phase and clears only expired session',async status=>{
  const expire=jest.fn();
  configureApiSession('fixture-access',expire);
  const adapter=fixture(c=>httpError(c,status));
  await expect(paymentContext(rentalId,owner)).rejects.toMatchObject({step:'reservation',status,code:null});
  expect(expire).toHaveBeenCalledTimes(status===401?1:0);
  expect(adapter).toHaveBeenCalledTimes(1);
});

test.each([
  [contractPath,'contract',null],
  [historyPath,'history','FIXTURE_FORBIDDEN'],
  [statusPath,'status',null],
] as const)('GET %s 403 identifies the failed step without opening or creating checkout',async (path,step,code)=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>c.url===path?httpError(c,403,code??undefined):depositFixture(c));
  const launch=jest.fn(async (_url:string)=>{});
  await expect(openDeposit(rentalId,owner,()=>true,launch)).rejects.toMatchObject({
    step,status:403,code,message:expect.stringContaining('HTTP 403'),
  });
  expect(launch).not.toHaveBeenCalled();
  expect(adapter.mock.calls.every(([config])=>config.method==='get')).toBe(true);
});

test.each(['UNKNOWN','APPLIED'] as const)('%s never opens checkout or POSTs a new attempt',async state=>{
  configureApiSession('fixture-access');
  const current:Parameters<typeof checkoutLink>[0]=state==='UNKNOWN'?{...payment,checkoutStatus:'UNKNOWN',checkoutUrl:null}:
    {...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED',checkoutUrl:null};
  const adapter=fixture(c=>depositFixture(c,current));
  const launch=jest.fn(async (_url:string)=>{});
  expect((await paymentContext(rentalId,owner)).decision.kind).toBe(state==='UNKNOWN'?'REVIEW':'APPLIED');
  await openDeposit(rentalId,owner,()=>true,launch);
  expect(launch).not.toHaveBeenCalled();
  expect(adapter.mock.calls.every(([config])=>config.method==='get')).toBe(true);
});

test.each([[403,undefined],[409,'DEPOSIT_NOT_ELIGIBLE'],[503,'PAYOS_CHECKOUT_OUTCOME_UNKNOWN']] as const)(
  'checkout HTTP %s retains the original attempt and does not retry POST',async (status,code)=>{
    configureApiSession('fixture-access');
    const adapter=fixture(c=>{
      if(c.url===historyPath&&c.method==='post')return httpError(c,status,code);
      if(c.url===historyPath)return envelope({items:[],nextCursor:null});
      return depositFixture(c);
    });
    const launch=jest.fn(async (_url:string)=>{});
    await expect(openDeposit(rentalId,owner,()=>true,launch)).rejects.toMatchObject({step:'checkout',status,code:code??null});
    await openDeposit(rentalId,owner,()=>true,launch);
    expect(adapter.mock.calls.filter(([config])=>config.method==='post')).toHaveLength(1);
    expect(launch).not.toHaveBeenCalled();
  });
