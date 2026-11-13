import {ManagedSkuEdit} from '../components/ManagedSkuEditor';
import {ManagedOperationLookup} from '../components/ManagedOperationLookup';
import {useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {View} from 'react-native';
import {apiIssue,wire,MobileInputError} from '../api/client';
import {restoreNativePaymentReturnPath} from '../api/paymentReturnLink';
import {mobileRepo} from '../api/mobileRepository';
import {buildRegistration,mapCurrentUser} from '../api/contracts/customer';
import {accountUpdate,optionalAddress,profileUpdate} from '../api/contracts/profile';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Chip,Input,StateCard,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,UnavailableScreen,useResource} from '../components/liveUI';
import {WarehouseArt} from '../components/WarehouseArt';
import {CardHeading,MetricTile,TintedPanel} from '../components/livePresentation';
import {colors} from '../theme/tokens';
import {RentalCard,RentalDetail} from './LiveRental';
import {FacilityDetail} from './LiveCatalog';

const useOwner=()=>useLiveSession(s=>s.user?._id??'');

export function Login(){
  const router=useRouter(),{returnTo}=useLocalSearchParams<{returnTo?:string|string[]}>(),login=useLiveSession(s=>s.login),restore=useLiveSession(s=>s.restore);
  const restoreFailed=useLiveSession(s=>s.restoreFailed);
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const busy=useRef(false);
  async function submit(){
    if(busy.current)return;
    busy.current=true;setPending(true);setError('');
    try{await login({email,password});setPassword('');const target=restoreNativePaymentReturnPath(Array.isArray(returnTo)?returnTo[0]:returnTo);if(target)router.replace(target as Href);}
    catch(cause){setError(apiIssue(cause));}
    finally{busy.current=false;setPending(false);}
  }
  return <LiveScreen title="Đăng nhập VaultSpace" eyebrow="TÀI KHOẢN KHÁCH HÀNG" subtitle="Theo dõi và quản lý không gian lưu trữ của bạn."><WarehouseArt height={155}/>
    <Card><Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" editable={!pending}/>
      <Input label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!pending}/>
      <Button label="Đăng nhập" loading={pending} onPress={()=>void submit()}/>
    </Card>
    {!!error&&<StateCard kind="error" title="Đăng nhập chưa thành công" description={error}/>}
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
  return <LiveScreen title="Tạo tài khoản" eyebrow="BẮT ĐẦU VỚI VAULTSPACE">
    {done?<StateCard title="Đã tạo tài khoản" description="Đăng nhập để tiếp tục."/>:<Card>
      <Input label="Họ và tên" value={name} onChangeText={setName} editable={!pending}/>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!pending}/>
      <Input label="Số điện thoại (nếu có)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!pending}/>
      <Input label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry editable={!pending}/>
      <Input label="Xác nhận mật khẩu" value={confirmation} onChangeText={setConfirmation} secureTextEntry editable={!pending}/>
      <Button label="Tạo tài khoản" loading={pending} onPress={()=>void submit()}/>
    </Card>}
    {!!error&&<StateCard kind="error" title="Chưa thể tạo tài khoản" description={error}/>}
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
    {icon:'key-outline',label:'Đơn thuê đang hoạt động',value:rentals.data?.filter(r=>r.status==='ACTIVE').length,loading:rentals.loading},
    {icon:'document-text-outline',label:'Hợp đồng đã ký',value:contracts.data?.filter(c=>c.status==='SIGNED').length,loading:contracts.loading},
    {icon:'cube-outline',label:'Mã hàng',value:inventory.data?.pagination.total,loading:inventory.loading},
    {icon:'notifications-outline',label:'Thông báo chưa đọc',value:notices.data?.unread,loading:notices.loading},
  ] as const;
  return <LiveScreen eyebrow="VAULTSPACE · KHÔNG GIAN CỦA BẠN" title={'Xin chào, '+(user?.displayName??'khách hàng')}
    subtitle="Theo dõi đơn thuê, hợp đồng và hàng hóa tại một nơi." onRefresh={()=>{
    rentals.reload();inventory.reload();notices.reload();contracts.reload();
  }} refreshing={rentals.loading||inventory.loading||notices.loading||contracts.loading}>
    <TintedPanel tone="inverse">
      <AppText variant="label" style={{color:colors.inverseText}}>DỊCH VỤ LƯU TRỮ</AppText>
      <AppText variant="heading" style={{color:colors.white}}>Không gian phù hợp với bạn</AppText>
      <AppText style={{color:colors.inverseText}}>Tìm kho tự quản và cơ sở kho ký gửi.</AppText>
      <Button label="Khám phá kho" icon="compass-outline" onPress={()=>router.push('/(tabs)/explore')}/>
    </TintedPanel>
    <Card>
      <CardHeading icon="grid-outline" title="Tổng quan tài khoản"/>
      <View style={ui.wrap}>{values.map(entry=><MetricTile key={entry.label} {...entry}/>)}</View>
      <Button label="Thông báo" icon="notifications-outline" variant="outline" onPress={()=>router.push('/notifications')}/>
    </Card>
    <AppText variant="heading" accessibilityRole="header">Đơn thuê gần đây</AppText>
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
  return <LiveScreen title="Tài khoản" eyebrow="VAULTSPACE · HỒ SƠ" subtitle="Quản lý thông tin liên hệ và hồ sơ xác minh của bạn." onRefresh={refresh} refreshing={data.loading}>
    {user&&<Card><CardHeading icon="person-circle-outline" title={user.displayName} subtitle="Thông tin tài khoản"/>
      <AppText>Email: {user.email}</AppText><AppText>Số điện thoại: {user.phone?.trim()||'Chưa cung cấp'}</AppText>
      {!mode&&<Button label="Chỉnh sửa tài khoản" variant="outline" onPress={()=>edit('account')}/>}</Card>}
    <ResourceState {...data}/>
    {profile&&<Card><CardHeading icon="shield-checkmark-outline" title="Hồ sơ khách hàng" subtitle="Thông tin dùng để xác minh danh tính"/>
      <Chip label={({UNVERIFIED:'Chưa xác minh',PENDING:'Đang xét duyệt',VERIFIED:'Đã xác minh',REJECTED:'Bị từ chối'})[profile.verificationStatus]} tone={profile.verificationStatus==='VERIFIED'?'green':profile.verificationStatus==='REJECTED'?'danger':'orange'}/>
      <AppText>Địa chỉ: {optionalAddress(profile.address)||'Chưa cung cấp'}</AppText>
      <AppText>Mã số thuế: {profile.taxCode?.trim()||'Chưa cung cấp'}</AppText>
      <AppText>CCCD: {cccd?'Đã cung cấp':'Chưa cung cấp'}</AppText>
      {!mode&&<Button label="Chỉnh sửa hồ sơ" variant="outline" onPress={()=>edit('customer')}/>}</Card>}
    {mode&&<Card><CardHeading icon="create-outline" title={mode==='account'?'Chỉnh sửa tài khoản':'Chỉnh sửa hồ sơ'}/>
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
    {notice?<TintedPanel><AppText accessibilityLiveRegion="polite">{notice}</AppText></TintedPanel>:null}
    {error?<StateCard kind="error" title="Không thể hoàn tất thao tác" description={error}/>:null}
    <Button label="Đăng xuất" icon="log-out-outline" variant="danger" disabled={pending} onPress={()=>void logout().catch(cause=>setError(apiIssue(cause)))}/>
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
  return <LiveScreen title="Thông báo" eyebrow="HỘP THƯ" subtitle="Cập nhật về đơn thuê, thanh toán và hàng hóa." onRefresh={data.reload} refreshing={data.loading}>
    <ResourceState {...data}/>{data.data?.items.length===0&&<StateCard title="Chưa có thông báo"/>}
    {!!error&&<StateCard kind="error" title="Chưa cập nhật được thông báo" description={error}/>}
    {data.data?.items.map(item=><Card key={item._id}><CardHeading icon={item.isRead?"mail-open-outline":"mail-unread-outline"} title={item.title}/>
      <AppText>{item.content}</AppText><AppText variant="caption">{dateLabel(item.createdAt)}</AppText>
      {!item.isRead&&<Button label="Đánh dấu đã đọc" variant="quiet" disabled={busy} onPress={()=>void mark(item._id)}/>}</Card>)}
  </LiveScreen>;
}

export {ManagedDashboard as Inventory} from './ManagedDashboard';

function ItemDetail({id}:{id:string}){
  const owner=useOwner(),router=useRouter();
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const stock=useResource(owner+':'+id,async signal=>mobileRepo.inventoryStock(await mobileRepo.item(id,owner,signal),owner,signal));
  return <LiveScreen title="Chi tiết hàng hóa" eyebrow="KHO KÝ GỬI" subtitle="Thông tin đăng ký và tồn kho của mặt hàng." onRefresh={()=>{item.reload();stock.reload();}} refreshing={item.loading||stock.loading}>
    <ResourceState {...item}/>
    {item.data&&<Card><CardHeading icon="cube-outline" title={item.data.name}/><AppText>Mã hàng {item.data.itemCode}</AppText>
      <AppText>Đăng ký {item.data.quantity} {item.data.quantityUnit}</AppText>
      <AppText>{({REGISTERED:'Đã đăng ký',PENDING_INBOUND:'Chờ nhập kho',RECEIVED_PENDING_ACCEPTANCE:'Đã nhận, chờ xác nhận',IN_STORAGE:'Đang lưu kho',PENDING_OUTBOUND:'Chờ xuất kho',CHECKED_OUT:'Đã xuất kho'})[item.data.status]}</AppText>
      <AppText>Khối lượng đăng ký mỗi đơn vị {item.data.unitWeightKg} kg</AppText>
      <AppText>Kích thước {item.data.unitDimensionsM.widthM} × {item.data.unitDimensionsM.depthM} × {item.data.unitDimensionsM.heightM} m</AppText>
      <Button label="Lịch sử di chuyển" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id}})}/></Card>}
    {item.data?.inventorySchemaVersion===3&&<ManagedSkuEdit key={'edit:'+owner+':'+id} item={item.data} owner={owner} onSaved={()=>{item.reload();stock.reload();}}/>}
    <ResourceState {...stock}/>
    {stock.data?.kind==='V3'&&<Card><CardHeading icon="layers-outline" title="Sổ tồn kho V3"/>
      {stock.data.stock.reconciliationStatus==='RECONCILED'?<>
        <AppText>Đang lưu: {stock.data.stock.onHandQuantity}</AppText>
        <AppText>Đang giữ: {stock.data.stock.heldQuantity}</AppText>
        <AppText>{stock.data.stock.totalWeightKg} kg · {stock.data.stock.totalVolumeM3} m³</AppText>
        {stock.data.stock.byCell.map(row=><AppText key={row.cellId}>Ô {row.cellId} · {row.quantity} theo lô · {row.physicalUnitCount} kiện riêng</AppText>)}
        {stock.data.stock.byBatch.map(row=><AppText key={row.batchId+':'+row.cellId}>Lô {row.batchId} · {row.quantity} {row.quantityUnit} · Ô {row.cellId}</AppText>)}
        {stock.data.stock.byPhysicalUnit.map(row=><AppText key={row.physicalUnitId}>Kiện {row.physicalUnitId} · Ô {row.cellIds.join(', ')}</AppText>)}
      </>:<AppText>Tồn kho chưa được xác minh. Cần đối soát sổ kho.</AppText>}
    </Card>}
    {stock.data?.kind==='V3'&&item.data&&<ManagedOperationLookup key={owner+':'+id} item={item.data} owner={owner}/>}
    {stock.data?.kind==='LEGACY'&&<Card><CardHeading icon="layers-outline" title="Tồn kho"/>
      <AppText variant="caption">{stock.data.stock.source==='LEDGER_V2'?'Sổ tồn kho theo lô':'Số liệu tồn kho đã đối chiếu từ dữ liệu cũ'}</AppText><AppText>Đang lưu {stock.data.stock.onHandQuantity} {stock.data.stock.quantityUnit}</AppText>
      <AppText>Đang giữ {stock.data.stock.heldQuantity} {stock.data.stock.quantityUnit}</AppText>
      <AppText>Có thể xuất {stock.data.stock.availableQuantity??'Chưa có xác nhận'}</AppText>
      {stock.data.stock.batches.map(batch=><AppText key={batch.batchId}>Lô {batch.batchId} · {batch.quantity} {batch.quantityUnit}</AppText>)}</Card>}
  </LiveScreen>;
}
export function Movements(){
  const {id}=useLocalSearchParams<{id:string}>();
  const owner=useOwner();
  const data=useResource(owner+':'+id,async signal=>mobileRepo.inventoryMovements(await mobileRepo.item(id,owner,signal),owner,signal));
  return <LiveScreen title="Lịch sử di chuyển" eyebrow="KHO KÝ GỬI" subtitle="Các lần nhập, xuất và di chuyển đã ghi nhận." onRefresh={data.reload} refreshing={data.loading}><ResourceState {...data}/>
    {data.data?.rows.length===0&&<StateCard title="Chưa có lịch sử di chuyển"/>}
    {data.data?.kind==='V3'&&data.data.rows.map(move=><Card key={move._id}>
      <AppText variant="card">{{ADD:'Nhập kho',MOVE:'Chuyển ô',REMOVE:'Xuất kho'}[move.v3Effect.action]}</AppText>
      <AppText>{move.quantity} {move.quantityUnit} · {dateLabel(move.performedAt)}</AppText>
      <AppText>Thao tác {move.operationId}</AppText>
      {move.v3Effect.source?.map(row=>row.cellId).join(', ') ? <AppText>Ô nguồn: {move.v3Effect.source.map(row=>row.cellId).join(', ')}</AppText>:null}
      {move.v3Effect.destination?.map(row=>row.cellId).join(', ') ? <AppText>Ô đích: {move.v3Effect.destination.map(row=>row.cellId).join(', ')}</AppText>:null}
    </Card>)}
    {data.data?.kind==='LEGACY'&&data.data.rows.map(move=><Card key={move._id}><AppText variant="card">{({INBOUND:'Nhập kho',OUTBOUND:'Xuất kho',RELOCATION:'Chuyển ô'})[move.type]}</AppText>
      <AppText>{move.quantity} {move.quantityUnit} · {dateLabel(move.performedAt)}</AppText>
      {!!move.inspectionNote&&<AppText>{move.inspectionNote}</AppText>}</Card>)}
  </LiveScreen>;
}
export function Detail(){
  const {kind,id}=useLocalSearchParams<{kind:string;id:string}>();
  if(kind==='facility')return <FacilityDetail key={id} id={id}/>;
  if(kind==='rental')return <RentalDetail key={id} id={id}/>;
  if(kind==='inventory'||kind==='item')return <ItemDetail key={id} id={id}/>;
  return <UnavailableScreen/>;
}
