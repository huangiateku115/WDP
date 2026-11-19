import {ManagedSkuEdit} from '../components/ManagedSkuEditor';
import {ManagedSkuStockPanel} from '../components/ManagedSkuStockPanel';
import {useRef,useState,type ComponentProps} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {Image,Pressable,View} from 'react-native';
import {apiIssue,wire,MobileInputError} from '../api/client';
import {restoreNativePaymentReturnPath} from '../api/paymentReturnLink';
import {mobileRepo} from '../api/mobileRepository';
import {managedInventory} from '../api/managedInventory';
import {refId} from '../api/contracts/core';
import {buildRegistration,mapCurrentUser} from '../api/contracts/customer';
import {accountUpdate,optionalAddress,profileUpdate} from '../api/contracts/profile';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Chip,Filter,Icon,Input,Screen,SectionTitle,StateCard,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,UnavailableScreen,useResource} from '../components/liveUI';
import {WarehouseArt} from '../components/WarehouseArt';
import {CardHeading,MetricTile,TintedPanel} from '../components/livePresentation';
import {colors} from '../theme/tokens';
import {managedReservationInventoryTarget} from '../domain/managedInventoryNavigation';
import {ManagedSpecifications} from '../components/ManagedSpecifications';
import {movementAction,movementActionLabel,movementCellIds,movementIdentifier,movementOccurredAt,movementPlacements,movementTime} from '../domain/managedV3Movements';
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
  const notices=useResource('notifications:'+owner,signal=>mobileRepo.notifications(owner,signal));
  const active=rentals.data?.filter(r=>r.status==='ACTIVE')??[];
  const soon=Date.now()+30*24*60*60*1000;
  const values=[
    {icon:'key-outline',label:'Đơn đang thuê',value:rentals.data?active.length:undefined,loading:rentals.loading},
    {icon:'home-outline',label:'Kho tự quản',value:rentals.data?active.filter(r=>r.serviceType==='SELF_STORAGE').length:undefined,loading:rentals.loading},
    {icon:'file-tray-stacked-outline',label:'Kho ký gửi',value:rentals.data?active.filter(r=>r.serviceType==='MANAGED_INVENTORY').length:undefined,loading:rentals.loading},
    {icon:'time-outline',label:'Sắp hết hạn · 30 ngày',value:rentals.data?active.filter(r=>{const end=Date.parse(r.endDate);return end>Date.now()&&end<=soon;}).length:undefined,loading:rentals.loading},
  ] as const;
  const greetingName=user?.displayName?.trim().split(/\s+/)[0]||'bạn';
  const unread=notices.data?.unread;
  return <Screen testID="screen-live-home" onRefresh={()=>{rentals.reload();notices.reload();}}
    refreshing={rentals.loading||notices.loading}>
    <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:8}}>
      <View style={{flex:1,minWidth:0}}>
        <AppText variant="label" style={{color:colors.primary}}>VAULTSPACE · KHÔNG GIAN CỦA BẠN</AppText>
        <AppText variant="title" numberOfLines={2}>Xin chào, {greetingName}</AppText>
        <AppText style={{color:colors.muted}}>Theo dõi các đơn thuê của bạn tại một nơi.</AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Mở thông báo${unread?`, ${unread} chưa đọc`:''}`}
        onPress={()=>router.push('/notifications')} style={{width:48,height:48,borderRadius:16,backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center'}}>
        <Icon name="notifications-outline" size={22}/>
        {!!unread&&unread>0&&<View style={{position:'absolute',right:-2,top:-2,minWidth:19,height:19,paddingHorizontal:4,borderRadius:10,backgroundColor:colors.orange,alignItems:'center',justifyContent:'center'}}><AppText variant="caption" style={{color:colors.white,fontSize:10}}>{unread>9?'9+':unread}</AppText></View>}
      </Pressable>
    </View>
    <TintedPanel tone="inverse">
      <AppText variant="label" style={{color:colors.inverseText}}>DỊCH VỤ LƯU TRỮ</AppText>
      <AppText variant="heading" style={{color:colors.white}}>Không gian phù hợp với bạn</AppText>
      <AppText style={{color:colors.inverseText}}>Tìm kho tự quản và cơ sở kho ký gửi.</AppText>
      <Button label="Khám phá kho" icon="compass-outline" onPress={()=>router.push('/(tabs)/explore')}/>
    </TintedPanel>
    <Card>
      <CardHeading icon="grid-outline" title="Tổng quan thuê kho" subtitle="Số liệu từ các đơn thuê của bạn"/>
      <View style={ui.wrap}>{values.map(entry=><MetricTile key={entry.label} {...entry}/>)}</View>
    </Card>
    <SectionTitle title="Đơn thuê của bạn" action="Xem tất cả" onPress={()=>router.push('/(tabs)/rentals')}/>
    <ResourceState {...rentals}/>
    {rentals.data?.length===0&&<StateCard title="Bạn chưa có đơn thuê"/>}
    {rentals.data?.slice(0,3).map(r=><RentalCard key={r._id} r={r}/>)}
  </Screen>;
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
    {data.loading&&!data.data&&<StateCard kind="loading" title="Đang tải thông báo"/>}
    {data.error&&<StateCard kind="error"
      title={data.httpStatus===401?'Phiên đăng nhập đã hết hạn':data.httpStatus===403?'Bạn không có quyền xem thông báo này':data.httpStatus===undefined&&/^(Không thể kết nối|Kết nối mất nhiều thời gian)/.test(data.error)?'Không thể kết nối':'Chưa thể tải thông báo'}
      description={data.error} onRetry={data.reload}/>}
    {!data.loading&&!data.error&&data.data?.items.length===0&&<StateCard title="Chưa có thông báo" description="Thông báo sẽ xuất hiện tại đây khi có cập nhật cho đơn thuê của bạn."/>}
    {!!error&&<StateCard kind="error" title="Chưa cập nhật được thông báo" description={error}/>}
    {data.data?.items.map(item=><Card key={item._id} style={{borderLeftWidth:3,borderLeftColor:item.isRead?colors.line:colors.primary}}>
      <View style={{flexDirection:'row',alignItems:'flex-start',gap:12}}>
        <View style={{width:42,height:42,borderRadius:14,backgroundColor:item.isRead?colors.soft:colors.mint,alignItems:'center',justifyContent:'center'}}>
          <Icon name={notificationIcon(item.type)} color={item.isRead?colors.muted:colors.primary} size={20}/>
        </View>
        <View style={{flex:1,minWidth:0,gap:4}}>
          <AppText variant="card">{item.title}</AppText>
          <AppText variant="caption" style={{color:colors.muted}}>{dateLabel(item.createdAt)}</AppText>
        </View>
        {!item.isRead&&<View accessibilityLabel="Chưa đọc" style={{width:9,height:9,borderRadius:5,backgroundColor:colors.orange,marginTop:6}}/>}
      </View>
      <AppText>{item.content}</AppText>
      {!item.isRead&&<Button label="Đánh dấu đã đọc" variant="outline" disabled={busy} onPress={()=>void mark(item._id)}/>}
    </Card>)}
  </LiveScreen>;
}

function notificationIcon(type:string):ComponentProps<typeof Icon>['name']{
  if(type==='PAYMENT_CONFIRMED'||type==='PAYMENT_REMINDER')return 'wallet-outline';
  if(type==='CONTRACT_SIGNED')return 'document-text-outline';
  if(type==='CHECKOUT_REMINDER')return 'time-outline';
  if(type==='OVERDUE_ALERT')return 'alert-circle-outline';
  return 'notifications-outline';
}

export {InventoryOverview as Inventory} from './ManagedDashboard';

function ItemDetail({id,accessSessionId,operation}:{id:string;accessSessionId?:string;operation?:string}){
  const owner=useOwner(),router=useRouter();
  const [stockRefreshRevision,setStockRefreshRevision]=useState(0);
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  return <LiveScreen title="Chi tiết hàng hóa" eyebrow="KHO KÝ GỬI" subtitle="Thông tin đăng ký, tồn kho và vị trí hiện tại."
    backButton={{disabled:!item.data,onPress:()=>item.data?.inventorySchemaVersion===3
      ?router.replace(managedReservationInventoryTarget(refId(item.data.managedReservationId),refId(item.data.facilityId),{sessionId:accessSessionId,operation}))
      :router.replace('/(tabs)/inventory')}}
    onRefresh={()=>{item.reload();setStockRefreshRevision(value=>value+1);}} refreshing={item.loading}>
    <ResourceState {...item}/>
    {item.data&&<Card><CardHeading icon="cube-outline" title={item.data.name}/><AppText>Mã hàng {item.data.itemCode}</AppText>
      {!!item.data.images?.length&&<View style={{gap:10}}>{item.data.images.map((url,index)=><Image key={`${url}-${index}`} source={{uri:url}} accessibilityLabel={`Ảnh hàng hóa ${index+1}`} resizeMode="cover" style={{width:'100%',height:220,borderRadius:12,backgroundColor:colors.surface}}/>)}</View>}
      {item.data.inventorySchemaVersion===3?<AppText>{item.data.status==='ACTIVE'?'Đang hoạt động':'Ngừng hoạt động'}. Số lượng và kích thước được quản lý theo thông tin loại hàng.</AppText>:<>
        <AppText>Đăng ký {item.data.quantity} {item.data.quantityUnit}</AppText>
        <AppText>{({REGISTERED:'Đã đăng ký',PENDING_INBOUND:'Chờ nhập kho',RECEIVED_PENDING_ACCEPTANCE:'Đã nhận, chờ xác nhận',IN_STORAGE:'Đang lưu kho',PENDING_OUTBOUND:'Chờ xuất kho',CHECKED_OUT:'Đã xuất kho',ACTIVE:'Đang hoạt động',INACTIVE:'Ngừng hoạt động'})[item.data.status]}</AppText>
        <AppText>Khối lượng đăng ký mỗi đơn vị {item.data.unitWeightKg} kg</AppText>
        {!!item.data.unitDimensionsM&&<AppText>Kích thước {item.data.unitDimensionsM.widthM} × {item.data.unitDimensionsM.depthM} × {item.data.unitDimensionsM.heightM} m</AppText>}
      </>}
      {item.data.inventorySchemaVersion===3&&<>
        <Button label="Sửa thông tin hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/inventory/edit/[id]',params:{id}})}/>
        {(!operation||operation==='OUTBOUND')&&<Button label="Xuất hàng" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/outbound',params:{id,...(accessSessionId?{sessionId:accessSessionId}:{})}} as unknown as Href)}/>}
        {(!operation||operation==='RELOCATION')&&<Button label="Chuyển vị trí" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/relocation',params:{id,...(accessSessionId?{sessionId:accessSessionId}:{})}} as unknown as Href)}/>}
        {(!operation||operation==='INBOUND')&&<Button label="Nhập hàng" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/inbound',params:{id,...(accessSessionId?{accessSessionId}:{})}} as unknown as Href)}/>}
      </>}
      <Button label="Lịch sử di chuyển" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id}})}/></Card>}
    {item.data?.inventorySchemaVersion===3&&<ManagedSpecifications item={item.data} owner={owner}/>}
    {item.data?.inventorySchemaVersion===3&&<ManagedSkuEdit key={'edit:'+owner+':'+id} item={item.data} owner={owner} onSaved={()=>{item.reload();setStockRefreshRevision(value=>value+1);}} accessSessionId={accessSessionId}/>}
    {item.data&&<ManagedSkuStockPanel item={item.data} owner={owner} refreshRevision={stockRefreshRevision}/>}
  </LiveScreen>;
}
export function Movements(){
  const {id}=useLocalSearchParams<{id:string}>(),owner=useOwner(),router=useRouter();
  const [type,setType]=useState('ALL'),[query,setQuery]=useState('');
  const data=useResource(owner+':'+id,async signal=>{
    const item=await mobileRepo.item(id,owner,signal),history=await mobileRepo.inventoryMovements(item,owner,signal);
    return {item,history};
  });
  const rows=data.data?.history.rows??[];
  const cellIds=[...new Set(rows.flatMap(row=>movementCellIds(row)))];
  const labels=useResource(data.data&&cellIds.length?owner+':movement-cells:'+data.data.item._id+':'+cellIds.join(','):'',signal=>data.data&&cellIds.length
    ?managedInventory.cellLabels(refId(data.data.item.facilityId),cellIds,signal):Promise.resolve({} as Record<string,string>));
  const filtered=rows.filter(row=>{
    const action=movementAction(row),where=movementCellIds(row).map(cellId=>labels.data?.[cellId]??'').join(' ');
    return (type==='ALL'||action===type)&&`${movementIdentifier(row)} ${action} ${where}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'));
  }).sort((a,b)=>Date.parse(String(movementOccurredAt(b)??''))-Date.parse(String(movementOccurredAt(a)??'')));
  return <LiveScreen title="Lịch sử hàng hóa" eyebrow="KHO KÝ GỬI" subtitle={data.data?`${data.data.item.itemCode} · ${data.data.item.name}. Các lần nhập, xuất và chuyển vị trí đã hoàn tất.`:'Các lần nhập, xuất và chuyển vị trí đã hoàn tất.'}
    backButton={{disabled:!data.data,onPress:()=>data.data&&router.replace({pathname:'/inventory/[id]',params:{id:data.data.item._id}} as unknown as Href)}} onRefresh={data.reload} refreshing={data.loading}>
    <ResourceState {...data} resource="lịch sử hàng hóa"/>
    <Input label="Tìm hoạt động" placeholder="Mã hoạt động hoặc vị trí" value={query} onChangeText={setQuery}/>
    <View style={ui.wrap}>{([['ALL','Tất cả'],['INBOUND','Nhập kho'],['OUTBOUND','Xuất kho'],['RELOCATION','Điều chuyển']] as const).map(([key,label])=><Filter key={key} label={label} selected={type===key} onPress={()=>setType(key)}/>)}</View>
    <AppText variant="caption">Hiển thị các hoạt động hàng hóa gần đây.</AppText>
    <ResourceState {...labels} resource="tên vị trí"/>
    {data.data&&filtered.length===0&&<StateCard title={rows.length?'Không có hoạt động phù hợp':'Chưa có hoạt động hàng hóa'} description={rows.length?'Thử thay đổi loại hoặc từ khóa tìm kiếm.':'Các lần nhập, xuất hoặc chuyển vị trí sẽ xuất hiện tại đây.'}/>}
    {data.data&&filtered.map(row=>{
      const source=movementPlacements(row,'source'),destination=movementPlacements(row,'destination'),occurred=movementOccurredAt(row);
      const action=movementActionLabel(row),movementId=String(row._id);
      return <Card key={movementId}>
        <Chip label={action} tone={movementAction(row)==='OUTBOUND'?'orange':movementAction(row)==='RELOCATION'?'neutral':'green'}/>
        <AppText variant="label">{movementIdentifier(row)}</AppText>
        <AppText>{row.quantity} {row.quantityUnit} · {movementTime(occurred)}</AppText>
        {source.map((line,index)=><AppText key={`source-${index}`}>Ô nguồn: {labels.data?.[line.cellId]??'Đang xác định vị trí'} · {line.quantity??row.quantity} {row.quantityUnit}</AppText>)}
        {destination.map((line,index)=><AppText key={`destination-${index}`}>Ô đích: {labels.data?.[line.cellId]??'Đang xác định vị trí'} · {line.quantity??row.quantity} {row.quantityUnit}</AppText>)}
        <Button label="Xem chi tiết hoạt động" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history/[movementId]',params:{id,movementId}} as unknown as Href)}/>
      </Card>;
    })}
  </LiveScreen>;
}
export function Detail(){
  const {kind,id,accessSessionId,operation}=useLocalSearchParams<{kind:string;id:string;accessSessionId?:string|string[];operation?:string|string[]}>();
  if(kind==='facility')return <FacilityDetail key={id} id={id}/>;
  if(kind==='rental')return <RentalDetail key={id} id={id}/>;
  if(kind==='inventory'||kind==='item')return <ItemDetail key={id} id={id} accessSessionId={Array.isArray(accessSessionId)?accessSessionId[0]:accessSessionId} operation={Array.isArray(operation)?operation[0]:operation}/>;
  return <UnavailableScreen/>;
}
export function InventoryItemDetail(){
  const {id,accessSessionId,operation}=useLocalSearchParams<{id:string;accessSessionId?:string|string[];operation?:string|string[]}>();
  if(!id)return <UnavailableScreen/>;
  return <ItemDetail key={id} id={id} accessSessionId={Array.isArray(accessSessionId)?accessSessionId[0]:accessSessionId} operation={Array.isArray(operation)?operation[0]:operation}/>;
}
