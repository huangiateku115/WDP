import {useRef,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {View} from 'react-native';
import {apiIssue,wire,MobileInputError} from '../api/client';
import {mobileRepo} from '../api/mobileRepository';
import {buildRegistration,mapCurrentUser} from '../api/contracts/customer';
import {accountUpdate,optionalAddress,profileUpdate} from '../api/contracts/profile';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Chip,Input,StateCard,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,UnavailableScreen,useResource} from '../components/liveUI';
import {WarehouseArt} from '../components/WarehouseArt';
import {RentalCard,RentalDetail} from './LiveRental';
import {FacilityDetail} from './LiveCatalog';

const useOwner=()=>useLiveSession(s=>s.user?._id??'');

export function Login(){
  const router=useRouter(),login=useLiveSession(s=>s.login),restore=useLiveSession(s=>s.restore);
  const restoreFailed=useLiveSession(s=>s.restoreFailed);
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const busy=useRef(false);
  async function submit(){
    if(busy.current)return;
    busy.current=true;setPending(true);setError('');
    try{await login({email,password});setPassword('');}
    catch(cause){setError(apiIssue(cause));}
    finally{busy.current=false;setPending(false);}
  }
  return <LiveScreen title="Đăng nhập VaultSpace"><WarehouseArt height={155}/>
    <Card><Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" editable={!pending}/>
      <Input label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!pending}/>
      <Button label="Đăng nhập" loading={pending} onPress={()=>void submit()}/>
    </Card>
    {error&&<StateCard kind="error" title="Đăng nhập chưa thành công" description={error}/>}
    {restoreFailed&&<StateCard kind="error" title="Chưa xác minh được phiên đã lưu" onRetry={()=>void restore()}/>}
    <Button label="Tạo tài khoản" variant="quiet" onPress={()=>router.push('/(auth)/register')}/>
  </LiveScreen>;
}
export function Register(){
  const router=useRouter(),busy=useRef(false);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  async function submit(){
    if(busy.current||done)return;
    busy.current=true;setPending(true);setError('');
    try{
      if(password!==confirmation)throw new MobileInputError('Mật khẩu xác nhận chưa khớp.');
      const response=mapCurrentUser(await wire('POST','/users/register',{anonymous:true,body:buildRegistration({name,email,phone,password})}));
      if(response.email.toLowerCase()!==email.trim().toLowerCase())throw new MobileInputError('Không xác minh được tài khoản vừa tạo.');
      setDone(true);setPassword('');setConfirmation('');
    }catch(cause){setError(apiIssue(cause));}
    finally{busy.current=false;setPending(false);}
  }
  return <LiveScreen title="Tạo tài khoản">
    {done?<StateCard title="Đã tạo tài khoản" description="Đăng nhập để tiếp tục."/>:<Card>
      <Input label="Họ và tên" value={name} onChangeText={setName} editable={!pending}/>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!pending}/>
      <Input label="Số điện thoại (nếu có)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!pending}/>
      <Input label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry editable={!pending}/>
      <Input label="Xác nhận mật khẩu" value={confirmation} onChangeText={setConfirmation} secureTextEntry editable={!pending}/>
      <Button label="Tạo tài khoản" loading={pending} onPress={()=>void submit()}/>
    </Card>}
    {error&&<StateCard kind="error" title="Chưa thể tạo tài khoản" description={error}/>}
    <Button label="Về đăng nhập" variant="outline" onPress={()=>router.replace('/(auth)/login')}/>
  </LiveScreen>;
}

export function Dashboard(){
  const router=useRouter(),user=useLiveSession(s=>s.user),owner=useOwner();
  const rentals=useResource('rentals:'+owner,signal=>mobileRepo.rentals(owner,signal));
  const inventory=useResource('inventory:'+owner,signal=>mobileRepo.inventory(owner,1,signal));
  const notices=useResource('notifications:'+owner,signal=>mobileRepo.notifications(owner,signal));
  const contracts=useResource('contracts:'+owner,signal=>mobileRepo.contracts(owner,signal));
  const values=[
    {label:'Đơn thuê đang hoạt động',value:rentals.data?.filter(r=>r.status==='ACTIVE').length,loading:rentals.loading},
    {label:'Hợp đồng đã ký',value:contracts.data?.filter(c=>c.status==='SIGNED').length,loading:contracts.loading},
    {label:'Mã hàng',value:inventory.data?.pagination.total,loading:inventory.loading},
    {label:'Thông báo chưa đọc',value:notices.data?.unread,loading:notices.loading},
  ];
  return <LiveScreen title={'Xin chào, '+(user?.displayName??'khách hàng')} onRefresh={()=>{
    rentals.reload();inventory.reload();notices.reload();contracts.reload();
  }} refreshing={rentals.loading||inventory.loading||notices.loading||contracts.loading}>
    <Card><AppText variant="card">Tổng quan tài khoản</AppText>
      {values.map(entry=><View key={entry.label} style={ui.between}><AppText>{entry.label}</AppText>
        <AppText variant="label">{entry.loading?'Đang tải':entry.value??'Chưa khả dụng'}</AppText></View>)}
      <Button label="Thông báo" variant="outline" onPress={()=>router.push('/notifications')}/>
      <Button label="Khám phá kho" onPress={()=>router.push('/(tabs)/explore')}/>
    </Card>
    <ResourceState {...rentals}/>
    {rentals.data?.length===0&&<StateCard title="Bạn chưa có đơn thuê"/>}
    {rentals.data?.slice(0,3).map(r=><RentalCard key={r._id} r={r}/>)}
  </LiveScreen>;
}

export function Profile(){
  const owner=useOwner();
  return <ProfileForm key={owner} owner={owner}/>;
}

function ProfileForm({owner}:{owner:string}){
  const user=useLiveSession(s=>s.user),logout=useLiveSession(s=>s.logout),reloadUser=useLiveSession(s=>s.reloadUser);
  const data=useResource(owner,signal=>mobileRepo.profile(owner,signal));
  const [mode,setMode]=useState<'account'|'customer'>();
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[address,setAddress]=useState(''),[taxCode,setTaxCode]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const busy=useRef(false);
  const profile=data.data;
  function edit(section:'account'|'customer'){
    setError('');setNotice('');
    setName(user?.displayName??'');setPhone(user?.phone??'');
    setAddress(optionalAddress(profile?.address));setTaxCode(profile?.taxCode?.trim()??'');
    setMode(section);
  }
  async function save(){
    if(busy.current||!user||!mode)return;
    busy.current=true;setPending(true);setError('');setNotice('');
    try {
      if(mode==='account'){
        if(user.phone?.trim()&&!phone.trim())throw new MobileInputError('Máy chủ hiện chỉ hỗ trợ thay số điện thoại bằng một số hợp lệ.');
        const changes={displayName:name,...(phone.trim()!== (user.phone?.trim()??'')?{phone}:{})};
        const body=accountUpdate.safeParse(changes);
        if(!body.success)throw new MobileInputError('Kiểm tra họ tên và định dạng số điện thoại.');
        if(body.data.displayName===user.displayName&&!body.data.phone){setMode(undefined);return;}
        await mobileRepo.updateAccount(owner,body.data);
      }else{
        if(!profile)throw new MobileInputError('Hãy tải lại hồ sơ trước khi lưu.');
        const changes={
          ...(address.trim()!==optionalAddress(profile.address)?{address}:{}),
          ...(taxCode.trim()!==(profile.taxCode?.trim()??'')?{taxCode}:{}),
        };
        if(!Object.keys(changes).length){setMode(undefined);return;}
        const body=profileUpdate.safeParse(changes);
        if(!body.success)throw new MobileInputError('Kiểm tra độ dài địa chỉ và mã số thuế.');
        await mobileRepo.updateProfile(owner,body.data);
      }
      setMode(undefined);
      if(mode==='account'){
        try{await reloadUser(owner);}
        catch{setNotice('Đã lưu. Chưa tải lại được thông tin tài khoản.');return;}
      }else data.reload();
      setNotice('Đã lưu thay đổi.');
    }catch(cause){setError(apiIssue(cause));}
    finally{busy.current=false;setPending(false);}
  }
  function refresh(){
    if(busy.current)return;
    data.reload();
    void reloadUser(owner).catch(cause=>setError(apiIssue(cause)));
  }
  const cccd=profile?.identityCard?.trim();
  return <LiveScreen title="Tài khoản" onRefresh={refresh} refreshing={data.loading}>
    {user&&<Card><AppText variant="card">Thông tin tài khoản</AppText>
      <AppText>Họ và tên: {user.displayName}</AppText>
      <AppText>Email: {user.email}</AppText><AppText>Số điện thoại: {user.phone?.trim()||'Chưa cung cấp'}</AppText>
      {!mode&&<Button label="Chỉnh sửa tài khoản" variant="outline" onPress={()=>edit('account')}/>}</Card>}
    <ResourceState {...data}/>
    {profile&&<Card><AppText variant="card">Hồ sơ khách hàng</AppText>
      <Chip label={({UNVERIFIED:'Chưa xác minh',PENDING:'Đang xét duyệt',VERIFIED:'Đã xác minh',REJECTED:'Bị từ chối'})[profile.verificationStatus]}/>
      <AppText>Địa chỉ: {optionalAddress(profile.address)||'Chưa cung cấp'}</AppText>
      <AppText>Mã số thuế: {profile.taxCode?.trim()||'Chưa cung cấp'}</AppText>
      <AppText>CCCD: {cccd?'Đã cung cấp':'Chưa cung cấp'}</AppText>
      {!mode&&<Button label="Chỉnh sửa hồ sơ" variant="outline" onPress={()=>edit('customer')}/>}</Card>}
    {mode&&<Card><AppText variant="card">{mode==='account'?'Chỉnh sửa tài khoản':'Chỉnh sửa hồ sơ'}</AppText>
      {mode==='account'?<>
        <Input label="Họ và tên" value={name} onChangeText={setName} maxLength={120} editable={!pending}/>
        <Input label="Số điện thoại" value={phone} onChangeText={setPhone} maxLength={20} keyboardType="phone-pad" editable={!pending}/>
      </>:<>
        <Input label="Địa chỉ" value={address} onChangeText={setAddress} maxLength={300} editable={!pending}/>
        <Input label="Mã số thuế" value={taxCode} onChangeText={setTaxCode} maxLength={32} editable={!pending}/>
        <AppText>Thay đổi hồ sơ sẽ đưa trạng thái xác minh về Đang xét duyệt.</AppText>
      </>}
      <Button label="Lưu thay đổi" loading={pending} disabled={mode==='customer'&&!profile} onPress={()=>void save()}/>
      <Button label="Hủy chỉnh sửa" variant="quiet" disabled={pending} onPress={()=>{setMode(undefined);setError('');}}/>
    </Card>}
    {notice?<AppText accessibilityLiveRegion="polite">{notice}</AppText>:null}
    {error?<StateCard kind="error" title="Không thể hoàn tất thao tác" description={error}/>:null}
    <Button label="Đăng xuất" disabled={pending} onPress={()=>void logout().catch(cause=>setError(apiIssue(cause)))}/>
  </LiveScreen>;
}

export function Notifications(){
  const owner=useOwner(),data=useResource(owner,signal=>mobileRepo.notifications(owner,signal));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
  async function mark(id:string){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await mobileRepo.readNotification(id,owner);data.reload();}
    catch(cause){setError(apiIssue(cause));}
    finally{lock.current=false;setBusy(false);}
  }
  return <LiveScreen title="Thông báo" onRefresh={data.reload} refreshing={data.loading}>
    <ResourceState {...data}/>{data.data?.items.length===0&&<StateCard title="Chưa có thông báo"/>}
    {error&&<StateCard kind="error" title="Chưa cập nhật được thông báo" description={error}/>}
    {data.data?.items.map(item=><Card key={item._id}><AppText variant="card">{item.title}</AppText>
      <AppText>{item.content}</AppText><AppText variant="caption">{dateLabel(item.createdAt)}</AppText>
      {!item.isRead&&<Button label="Đánh dấu đã đọc" variant="quiet" disabled={busy} onPress={()=>void mark(item._id)}/>}</Card>)}
  </LiveScreen>;
}

export function Inventory(){
  const owner=useOwner(),router=useRouter(),[page,setPage]=useState(1);
  const data=useResource(owner+':'+page,signal=>mobileRepo.inventory(owner,page,signal));
  const total=data.data?.pagination.totalPages??0;
  return <LiveScreen title="Hàng hóa của tôi" onRefresh={data.reload} refreshing={data.loading}>
    <ResourceState {...data}/>{data.data?.items.length===0&&<StateCard title="Chưa có hàng hóa"/>}
    {data.data?.items.map(item=><Card key={item._id}><AppText variant="card">{item.name}</AppText><AppText>Mã hàng {item.itemCode}</AppText>
      <AppText>Đăng ký {item.quantity} {item.quantityUnit}</AppText>
      <Button label="Xem hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'inventory',id:item._id}})}/></Card>)}
    {total>1&&<View style={ui.between}><Button label="Trang trước" variant="quiet" disabled={page<=1} onPress={()=>setPage(page-1)}/>
      <AppText>{page}/{total}</AppText><Button label="Trang sau" variant="quiet" disabled={page>=total} onPress={()=>setPage(page+1)}/></View>}
  </LiveScreen>;
}

function ItemDetail({id}:{id:string}){
  const owner=useOwner(),router=useRouter();
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const stock=useResource(owner+':'+id,async signal=>mobileRepo.stock(await mobileRepo.item(id,owner,signal),owner,signal));
  return <LiveScreen title="Chi tiết hàng hóa" onRefresh={()=>{item.reload();stock.reload();}} refreshing={item.loading||stock.loading}>
    <ResourceState {...item}/>
    {item.data&&<Card><AppText variant="card">{item.data.name}</AppText><AppText>Mã hàng {item.data.itemCode}</AppText>
      <AppText>Đăng ký {item.data.quantity} {item.data.quantityUnit}</AppText>
      <AppText>{({REGISTERED:'Đã đăng ký',PENDING_INBOUND:'Chờ nhập kho',RECEIVED_PENDING_ACCEPTANCE:'Đã nhận, chờ xác nhận',IN_STORAGE:'Đang lưu kho',PENDING_OUTBOUND:'Chờ xuất kho',CHECKED_OUT:'Đã xuất kho'})[item.data.status]}</AppText>
      <AppText>Khối lượng đăng ký mỗi đơn vị {item.data.unitWeightKg} kg</AppText>
      <AppText>Kích thước {item.data.unitDimensionsM.widthM} × {item.data.unitDimensionsM.depthM} × {item.data.unitDimensionsM.heightM} m</AppText>
      <Button label="Lịch sử di chuyển" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id}})}/></Card>}
    <ResourceState {...stock}/>
    {stock.data&&<Card><AppText variant="card">Tồn kho</AppText><AppText>Đang lưu {stock.data.onHandQuantity} {stock.data.quantityUnit}</AppText>
      <AppText>Đang giữ {stock.data.heldQuantity} {stock.data.quantityUnit}</AppText>
      <AppText>Có thể xuất {stock.data.availableQuantity??'Chưa có xác nhận'}</AppText>
      {stock.data.batches.map(batch=><AppText key={batch.batchId}>Lô {batch.batchId} · {batch.quantity} {batch.quantityUnit}</AppText>)}</Card>}
  </LiveScreen>;
}
export function Movements(){
  const {id}=useLocalSearchParams<{id:string}>();
  const owner=useOwner();
  const data=useResource(owner+':'+id,async signal=>mobileRepo.movements(await mobileRepo.item(id,owner,signal),owner,signal));
  return <LiveScreen title="Lịch sử di chuyển" onRefresh={data.reload} refreshing={data.loading}><ResourceState {...data}/>
    {data.data?.length===0&&<StateCard title="Chưa có lịch sử di chuyển"/>}
    {data.data?.map(move=><Card key={move._id}><AppText variant="card">{({INBOUND:'Nhập kho',OUTBOUND:'Xuất kho',RELOCATION:'Chuyển ô'})[move.type]}</AppText>
      <AppText>{move.quantity} {move.quantityUnit} · {dateLabel(move.performedAt)}</AppText>
      {move.inspectionNote&&<AppText>{move.inspectionNote}</AppText>}</Card>)}
  </LiveScreen>;
}
export function Detail(){
  const {kind,id}=useLocalSearchParams<{kind:string;id:string}>();
  if(kind==='facility')return <FacilityDetail key={id} id={id}/>;
  if(kind==='rental')return <RentalDetail key={id} id={id}/>;
  if(kind==='inventory'||kind==='item')return <ItemDetail key={id} id={id}/>;
  return <UnavailableScreen/>;
}
