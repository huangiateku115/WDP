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
const {loadContractReview,submitReviewedContract}=require('../src/api/selfStorageContract') as typeof import('../src/api/selfStorageContract');
const {paymentContext,openDeposit,openSelfStoragePayment}=require('../src/api/selfStoragePayment') as typeof import('../src/api/selfStoragePayment');
const {checkoutLink,depositDecision,fullRentDecision}=require('../src/domain/livePayment') as typeof import('../src/domain/livePayment');

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
    expect(JSON.parse(c.data)).toEqual({facilityId,storageUnitId:unitId,pricingPolicyId:pricingId,startDate:reservation.startDate,endDate:reservation.endDate,termsAccepted:true,termsVersionId:'FIXTURE@1'});
    return envelope({...reservation,rentalPaymentFlow:'FULL_UPFRONT_V1'});
  });
  const quote=await mobileRepo.quote(facilityId,unitId,{start,end,value:'1',unit:'MONTH'});
  expect(quote.estimate.depositAmount).toBe(1000);
  await expect(mobileRepo.book({...quote.body,termsAccepted:true,termsVersionId:'FIXTURE@1'},'fixture-attempt',owner)).resolves.toMatchObject({_id:rentalId});
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
  await second.clear();
  expect(await second.read()).toBeNull();
});

test('PayOS uses one authenticated Deposit POST and protects checkout identity and UNKNOWN',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>{
    expect(c.headers.get('Idempotency-Key')).toBe('fixture-deposit-key');
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    expect(c.headers.get('X-WDP-Payment-Client')).toBe('MOBILE');
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
  expect(depositDecision(reservation,contract,[{...payment,status:'CANCELLED',checkoutStatus:'CANCELLED',checkoutUrl:null,
    cancelVerifiedAt:'2099-01-02T00:00:00.000Z',retryAllowed:true}],false).kind).toBe('CREATE');
  expect(depositDecision(reservation,contract,[{...payment,status:'CANCELLED',checkoutStatus:'CANCELLED',checkoutUrl:null,
    cancelVerifiedAt:null,retryAllowed:true}],false).kind).toBe('REVIEW');
  expect(checkoutLink({...payment,checkoutUrl:'https://pay.payos.vn.evil.invalid/web/test'},rentalId)).toBeNull();
  expect(checkoutLink({...payment,reservationId:other},rentalId)).toBeNull();
  expect(depositDecision(reservation,contract,[{...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'}],true).kind).toBe('APPLIED');
});

test('Mobile cancellation return reconciles through the owner-bound Backend endpoint',async()=>{
  configureApiSession('fixture-access');
  const cancelled={...payment,status:'CANCELLED',checkoutStatus:'CANCELLED',checkoutUrl:null,
    cancelVerifiedAt:'2099-01-02T00:00:00.000Z',retryAllowed:true};
  const adapter=fixture(c=>{
    expect(c.method).toBe('post');
    expect(c.url).toBe('/reservations/'+rentalId+'/payments/'+paymentId+'/reconcile');
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    expect(JSON.parse(c.data)).toEqual({});
    return envelope(cancelled);
  });
  await expect(mobileRepo.reconcilePayment(reservation,paymentId,owner)).resolves.toMatchObject({
    status:'CANCELLED',cancelVerifiedAt:cancelled.cancelVerifiedAt,retryAllowed:true,
  });
  expect(adapter).toHaveBeenCalledTimes(1);
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

function signingFixture(options:{patchStatus?:number;timeout?:boolean;unsettled?:boolean;draft?:boolean}={}){
  let signed=options.draft===false;
  let terms=['Điều khoản chính thức'];
  const signatureTime='2099-01-02T10:00:00Z';
  const signPath='/contracts/'+contractId+'/sign';
  const adapter=fixture(config=>{
    if(config.url==='/reservations/me')return envelope([{...reservation,status:'DEPOSIT_PAID'}]);
    if(config.url===contractPath)return envelope({...contract,terms,status:signed?'SIGNED':'DRAFT',signedByCustomerAt:signed?signatureTime:undefined});
    if(config.url===signPath){
      expect(config.method).toBe('patch');
      expect(config.data).toBeUndefined();
      expect(config.headers.get('Authorization')).toBe('Bearer fixture-access');
      if(options.patchStatus)return httpError(config,options.patchStatus);
      signed=true;
      if(options.timeout)throw new AxiosError('Fixture timeout','ECONNABORTED',config);
      return envelope({...contract,status:'SIGNED',signedByCustomerAt:signatureTime});
    }
    const settled={...payment,status:'SUCCEEDED' as const,providerSettlementStatus:'VERIFIED' as const,
      applicationStatus:'APPLIED' as const,checkoutUrl:null};
    return depositFixture(config,options.unsettled?payment:settled);
  });
  return {adapter,changeTerms:()=>{terms=['Điều khoản mới'];}};
}

test('reviews the owned draft, signs by Contract ID, then GET confirms signature awaiting staff',async()=>{
  configureApiSession('fixture-access');
  const {adapter}=signingFixture();
  const review=await loadContractReview(rentalId,owner);
  expect(review.canSign).toBe(true);
  expect(await submitReviewedContract(review,owner,()=>true)).toMatchObject({_id:contractId,status:'SIGNED'});
  const refreshed=await loadContractReview(rentalId,owner);
  expect(refreshed.canSign).toBe(false);
  expect(refreshed.reason).toMatch(/chờ nhân viên xác minh/);
  await submitReviewedContract(refreshed,owner,()=>true);
  expect(adapter.mock.calls.filter(([c])=>c.method==='patch')).toHaveLength(1);
  expect(adapter.mock.calls.some(([c])=>c.method==='post')).toBe(false);
});

test('unapplied deposit, wrong owner or changed terms prevent PATCH',async()=>{
  configureApiSession('fixture-access');
  let run=signingFixture({unsettled:true});
  const unpaid=await loadContractReview(rentalId,owner);
  expect(unpaid.canSign).toBe(false);
  await submitReviewedContract(unpaid,owner,()=>true);
  await expect(loadContractReview(rentalId,other)).rejects.toThrow();
  expect(run.adapter.mock.calls.some(([c])=>c.method==='patch')).toBe(false);
  run=signingFixture();
  const reviewed=await loadContractReview(rentalId,owner);
  run.changeTerms();
  await expect(submitReviewedContract(reviewed,owner,()=>true)).rejects.toThrow(/đã thay đổi/);
  expect(run.adapter.mock.calls.some(([c])=>c.method==='patch')).toBe(false);
});

test.each([400,401,403,409])('signing HTTP %s sends one PATCH and does not retry',async status=>{
  configureApiSession('fixture-access');
  const {adapter}=signingFixture({patchStatus:status});
  await expect(submitReviewedContract(await loadContractReview(rentalId,owner),owner,()=>true))
    .rejects.toMatchObject({response:{status}});
  expect(adapter.mock.calls.filter(([c])=>c.method==='patch')).toHaveLength(1);
});

test('signing timeout reconciles via GET, without re-signing or initiating checkout',async()=>{
  configureApiSession('fixture-access');
  const {adapter}=signingFixture({timeout:true});
  await expect(submitReviewedContract(await loadContractReview(rentalId,owner),owner,()=>true)).rejects.toMatchObject({code:'ECONNABORTED'});
  const read=await loadContractReview(rentalId,owner);
  expect(read.contract?.status).toBe('SIGNED');
  expect(read.canSign).toBe(false);
  expect(adapter.mock.calls.filter(([c])=>c.method==='patch')).toHaveLength(1);
  expect(adapter.mock.calls.some(([c])=>c.method==='post')).toBe(false);
});

const balanceId='b'.repeat(24);
const balanceUrl='https://pay.payos.vn/web/balance-fixture';
const checkin={...reservation,status:'CHECKIN_READY',estimatedRent:3000,depositAmount:2000,depositPaymentId:paymentId};
const proof={...contract,status:'SIGNED',signedProofUrl:'https://example.invalid/proof.png',signedProofPublicId:'proof',
  verifiedAt:'2098-12-01T00:00:00Z'};
const verifiedDeposit={...payment,status:'SUCCEEDED' as const,providerSettlementStatus:'VERIFIED' as const,applicationStatus:'APPLIED' as const,checkoutUrl:null};
const readyBalance={...payment,id:balanceId,purpose:'BALANCE' as const,amount:1079,checkoutUrl:balanceUrl};
type FixturePayment=Parameters<typeof checkoutLink>[0];

function balanceFixture(options:{r?:object;document?:object|null;deposit?:FixturePayment;balance?:FixturePayment;timeout?:boolean}={}){
  const launch=jest.fn(async (_url:string)=>{});
  const adapter=fixture(c=>{
    expect(c.headers.get('Authorization')).toBe('Bearer fixture-access');
    if(c.url==='/reservations/me')return envelope([options.r??checkin]);
    if(c.url===contractPath)return envelope(options.document===undefined?proof:options.document);
    if(c.url===historyPath&&c.method==='post'){
      expect(JSON.parse(c.data)).toEqual({purpose:'BALANCE'});
      expect(c.headers.get('Idempotency-Key')).toMatch(/^wdp-mobile-/);
      if(options.timeout)throw new AxiosError('Fixture timeout','ECONNABORTED',c);
      return {success:true,data:readyBalance,outcome:'CREATED'};
    }
    if(c.url===historyPath)return envelope({items:[{...(options.deposit??verifiedDeposit),createdAt:'2098-12-01T00:00:00Z'},
      ...(options.balance?[{...options.balance,createdAt:'2098-12-02T00:00:00Z'}]:[])],nextCursor:null});
    if(c.url===statusPath)return envelope(options.deposit??verifiedDeposit);
    if(c.url==='/reservations/'+rentalId+'/payments/'+balanceId)return envelope(options.balance);
    throw Error('Unexpected '+c.url);
  });
  return {adapter,launch,open:()=>openSelfStoragePayment(rentalId,owner,'BALANCE',()=>true,launch)};
}

test('Balance is created once, opens the verified URL and stores a key separate from Deposit',async()=>{
  configureApiSession('fixture-access');
  const depositStore=await journal('deposit',owner,rentalId);
  const depositAttempt=newAttempt();
  await depositStore.claim(depositAttempt);
  const {adapter,launch,open}=balanceFixture();
  await Promise.all([open(),open()]);
  const posts=adapter.mock.calls.filter(([c])=>c.method==='post');
  expect(posts).toHaveLength(1);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledWith(balanceUrl);
  const balanceStore=await journal('balance',owner,rentalId);
  const stored=await balanceStore.read();
  expect(stored?.key).toBe(posts[0]?.[0].headers.get('Idempotency-Key'));
  expect(stored?.key).not.toBe(depositAttempt.key);
  expect((await depositStore.read())?.key).toBe(depositAttempt.key);
});

test.each([
  {r:{...checkin,status:'CONTRACTED'}},
  {r:{...checkin,status:'DEPOSIT_PAID'}},
  {document:{...proof,status:'DRAFT'}},
  {document:{...proof,signedProofUrl:undefined}},
  {deposit:payment},
  {r:{...checkin,estimatedRent:2000}},
])('ineligible Balance never sends checkout (%#)',async options=>{
  configureApiSession('fixture-access');
  const {adapter,launch,open}=balanceFixture(options);
  await open();
  expect(adapter.mock.calls.some(([c])=>c.method==='post')).toBe(false);
  expect(launch).not.toHaveBeenCalled();
});

test.each([
  [readyBalance,'READY'],
  [{...readyBalance,checkoutUrl:null,checkoutStatus:'NOT_CREATED'},'PENDING'],
  [{...readyBalance,checkoutStatus:'UNKNOWN',checkoutUrl:null},'REVIEW'],
  [{...readyBalance,providerSettlementStatus:'VERIFIED',checkoutUrl:null},'VERIFYING'],
  [{...readyBalance,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED',checkoutUrl:null},'APPLIED'],
] as const)('Balance status %s is read from Backend without an extra POST (%#)',async (balance,kind)=>{
  configureApiSession('fixture-access');
  const {adapter,launch,open}=balanceFixture({balance});
  const context=await paymentContext(rentalId,owner,undefined,true);
  expect(context.balanceDecision.kind).toBe(kind);
  expect(context.payments.map(p=>[p.purpose,p.amount])).toEqual([['BALANCE',1079],['DEPOSIT',2000]]);
  await open();
  expect(launch).toHaveBeenCalledTimes(kind==='READY'?1:0);
  expect(adapter.mock.calls.every(([c])=>c.method==='get')).toBe(true);
});

test('Balance timeout retains the original attempt, refresh and second click do not retry POST',async()=>{
  configureApiSession('fixture-access');
  const {adapter,launch,open}=balanceFixture({timeout:true});
  await expect(open()).rejects.toMatchObject({step:'checkout',status:null});
  expect((await paymentContext(rentalId,owner,undefined,true)).balanceDecision.kind).toBe('REVIEW');
  await open();
  expect(adapter.mock.calls.filter(([c])=>c.method==='post')).toHaveLength(1);
  expect(launch).not.toHaveBeenCalled();
});

test('older UNKNOWN Balance on a second history page blocks even the latest READY checkout',async()=>{
  configureApiSession('fixture-access');
  const oldBalance={...readyBalance,id:'c'.repeat(24),checkoutStatus:'UNKNOWN',checkoutUrl:null};
  const adapter=fixture(c=>{
    if(c.url==='/reservations/me')return envelope([checkin]);
    if(c.url===contractPath)return envelope(proof);
    if(c.method==='get'&&c.url===historyPath){
      return c.params.cursor
        ?envelope({items:[{...oldBalance,createdAt:'2098-12-02T00:00:00Z'},
          {...verifiedDeposit,createdAt:'2098-12-01T00:00:00Z'}],nextCursor:null})
        :envelope({items:[{...readyBalance,createdAt:'2098-12-03T00:00:00Z'}],nextCursor:'next-page'});
    }
    if(c.url===statusPath)return envelope(verifiedDeposit);
    if(c.url==='/reservations/'+rentalId+'/payments/'+balanceId)return envelope(readyBalance);
    throw Error('Unexpected '+c.method+' '+c.url);
  });
  const context=await paymentContext(rentalId,owner,undefined,true);
  expect(context.payments.map(p=>p.id)).toEqual([balanceId,oldBalance.id,paymentId]);
  expect(context.balanceDecision.kind).toBe('REVIEW');
  const launch=jest.fn(async (_url:string)=>{});
  await openSelfStoragePayment(rentalId,owner,'BALANCE',()=>true,launch);
  expect(launch).not.toHaveBeenCalled();
  expect(adapter.mock.calls.every(([c])=>c.method==='get')).toBe(true);
});

test('upfront checkout only sends FULL_RENT and keeps transfer data on the same intent', async()=>{
  configureApiSession('fixture-access');
  const upfront={...reservation,rentalPaymentFlow:'FULL_UPFRONT_V1' as const};
  const transferDetails={bin:'970436',accountNumber:'00001234',accountName:'TEST',description:'REF1'};
  const adapter=fixture(c=>{
    expect(c.url).toBe('/reservations/'+rentalId+'/payments/payos');
    expect(c.method).toBe('post');
    expect(c.headers.get('Idempotency-Key')).toBe('fixture-full-rent-key');
    expect(JSON.parse(c.data)).toEqual({purpose:'FULL_RENT'});
    return {...envelope({...payment,purpose:'FULL_RENT',qrCode:'fixture-qr',transferDetails}),outcome:'CREATED'};
  });
  await expect(mobileRepo.checkout(upfront,'fixture-full-rent-key',owner,'FULL_RENT')).resolves.toMatchObject({
    id:paymentId,qrCode:'fixture-qr',checkoutUrl:payment.checkoutUrl,transferDetails
  });
  await expect(mobileRepo.checkout(upfront,'fixture-full-rent-key',owner,'DEPOSIT')).rejects.toThrow();
  await expect(mobileRepo.checkout(upfront,'fixture-full-rent-key',owner,'BALANCE')).rejects.toThrow();
  expect(adapter).toHaveBeenCalledTimes(1);
});

test('cancels an upfront reservation only on explicit Backend eligibility', async()=>{
  configureApiSession('fixture-access');
  const upfront={...reservation,rentalPaymentFlow:'FULL_UPFRONT_V1' as const,customerCancellationEligible:true};
  const adapter=fixture(c=>{
    expect(c.url).toBe('/reservations/'+rentalId+'/cancel');
    expect(c.method).toBe('patch');
    return envelope({...upfront,status:'CANCELLED'});
  });
  await expect(mobileRepo.cancelUpfrontRental({...upfront,customerCancellationEligible:false},owner)).rejects.toThrow();
  await expect(mobileRepo.cancelUpfrontRental(upfront,other)).rejects.toThrow();
  await expect(mobileRepo.cancelUpfrontRental(upfront,owner)).resolves.toMatchObject({status:'CANCELLED'});
  expect(adapter).toHaveBeenCalledTimes(1);
});

test('full-rent recovery never exposes an unresolved or canceled link',()=>{
  const upfront={...reservation,rentalPaymentFlow:'FULL_UPFRONT_V1' as const};
  const ready={...payment,purpose:'FULL_RENT' as const};
  const cancelled={...ready,status:'CANCELLED' as const,checkoutStatus:'CANCELLED' as const,
    cancelVerifiedAt:'2099-01-02T00:00:00Z',retryAllowed:true};
  expect(fullRentDecision(upfront,contract,[ready]).kind).toBe('READY');
  expect(fullRentDecision(upfront,contract,[{...ready,checkoutStatus:'UNKNOWN'}]).kind).toBe('REVIEW');
  expect(fullRentDecision(upfront,contract,[{...ready,checkoutUrl:'https://pay.payos.vn.evil.invalid/web/a'}]).kind).toBe('REVIEW');
  expect(fullRentDecision(upfront,contract,[{...cancelled,cancelVerifiedAt:null}]).kind).toBe('REVIEW');
  expect(fullRentDecision(upfront,contract,[cancelled],{resourceId:paymentId})).toEqual({kind:'CREATE',retry:true});
  expect(fullRentDecision(upfront,contract,[cancelled],{}).kind).toBe('REVIEW');
  expect(fullRentDecision(upfront,contract,[{...ready,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'}]).kind).toBe('APPLIED');
  expect(fullRentDecision(upfront,contract,[{...ready,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'NOT_APPLIED'}]).kind).toBe('REVIEW');
});

test('full rent retry replaces only the journal entry it verified',async()=>{
  const store=await journal('full-rent',owner,rentalId);
  const prior={...newAttempt(),resourceId:paymentId};
  await store.claim(prior);
  const replacement=newAttempt();
  expect(await Promise.all([store.claim(replacement,prior.key),store.claim(newAttempt(),prior.key)])).toEqual([true,false]);
  expect(await store.read()).toEqual(replacement);
  expect(await (await journal('full-rent',other,rentalId)).read()).toBeNull();
});

test('upfront contract reads owned Backend paper state without calling checkout or sign',async()=>{
  configureApiSession('fixture-access');
  for (const status of ['PAID','CHECKIN_READY','ACTIVE','CANCELLED'] as const) {
    const upfront={...reservation,status,rentalPaymentFlow:'FULL_UPFRONT_V1' as const};
    const current=status==='PAID'?contract:{...contract,status:'SIGNED',verifiedAt:'2026-11-12T00:00:00Z'};
    const adapter=fixture(c=>{
      expect(c.method).toBe('get');
      return c.url==='/reservations/me' ? envelope([upfront]) : envelope(current);
    });
    const review=await loadContractReview(rentalId,owner);
    expect(review.canSign).toBe(false);
    expect(review.reservation.status).toBe(status);
    await submitReviewedContract(review,owner,()=>true);
    expect(adapter).toHaveBeenCalledTimes(2);
  }
});

test('booking range conflict blocks estimate and reservation writes',async()=>{
  configureApiSession('fixture-access');
  const adapter=fixture(c=>{
    expect(c.method).toBe('get');
    if(c.url==='/storage-units/'+unitId)return envelope({_id:unitId,facilityId,unitCode:'A-01',size:'SMALL',status:'OCCUPIED'});
    if(c.url==='/pricing-rules/resolve')return envelope({});
    expect(c.url).toBe('/storage-units/'+unitId+'/availability');
    return envelope({storageUnitId:unitId,month:'2099-01',intervals:[],availabilityState:'VERIFIED',
      rangeAvailability:'CONFLICT',requestedRange:{startDate:reservation.startDate,endDate:reservation.endDate},evaluatedAt:'2098-12-01T00:00:00Z'});
  });
  await expect(mobileRepo.quote(facilityId,unitId,{start,end,value:1,unit:'MONTH'})).rejects.toThrow('Kho không còn trống');
  expect(adapter).toHaveBeenCalledTimes(3);
});

test('uncertain booking makes one request and can recover using its saved key and payload',async()=>{
  configureApiSession('fixture-access');
  const body={facilityId,storageUnitId:unitId,pricingPolicyId:pricingId,startDate:reservation.startDate,
    endDate:reservation.endDate,termsAccepted:true as const,termsVersionId:'FIXTURE@1'};
  const store=await journal('booking',owner,'fixture-range');
  const attempt={...newAttempt(),bookingBody:body};
  expect(await store.claim(attempt)).toBe(true);
  let posts=0;
  const adapter=fixture(c=>{
    expect(c.method).toBe('post');
    expect(c.url).toBe('/reservations');
    expect(c.headers.get('Idempotency-Key')).toBe(attempt.key);
    expect(JSON.parse(c.data)).toEqual(body);
    if (++posts===1) return httpError(c,503);
    return envelope({...reservation,rentalPaymentFlow:'FULL_UPFRONT_V1'});
  });
  await expect(mobileRepo.book(body,attempt.key,owner)).rejects.toMatchObject({response:{status:503}});
  expect(adapter).toHaveBeenCalledTimes(1);
  const saved=await store.read();
  await expect(mobileRepo.book(saved!.bookingBody!,saved!.key,owner)).resolves.toMatchObject({_id:rentalId,status:'CONTRACTED'});
  expect(adapter).toHaveBeenCalledTimes(2);
});

test('reads published Self Storage terms and rejects a response without applicable text',async()=>{
  const data={version:'2.1',versionId:'FIXTURE@2.1',status:'PUBLISHED',services:['SELF_STORAGE'],
    groups:[{id:'P01',title:'Điều khoản fixture',appliesTo:['SELF_STORAGE'],sections:{SELF_STORAGE:['Văn bản fixture']}}]};
  fixture(c=>{
    expect(c.url).toBe('/public/terms/current');
    expect(c.params).toEqual({serviceType:'SELF_STORAGE'});
    expect(c.headers.has('Authorization')).toBe(false);
    return envelope(data);
  });
  await expect(mobileRepo.bookingPolicy()).resolves.toMatchObject({versionId:data.versionId});
  fixture(()=>envelope({...data,groups:[]}));
  await expect(mobileRepo.bookingPolicy()).rejects.toThrow();
});
