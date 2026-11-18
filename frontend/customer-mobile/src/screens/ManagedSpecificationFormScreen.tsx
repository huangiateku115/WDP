import {useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {apiIssueWithStatus} from '../api/client';
import {managedSpecifications,type ManagedSpecification} from '../api/managedSpecifications';
import {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {showToast} from '../state/toastStore';
import {AppText,Button,Card,Filter,Input,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';

type Values={code:string;name:string;description:string;unit:string;width:string;depth:string;height:string;weight:string};
const blank:Values={code:'',name:'',description:'',unit:'',width:'',depth:'',height:'',weight:''};

export function ManagedSpecificationFormScreen(){
  const {id='',specId}=useLocalSearchParams<{id:string;specId?:string}>();
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const units=useResource(owner+':quantity-units',signal=>managedSpecifications.units(signal));
  const specs=useResource(owner+':'+id+':specifications:'+String(!!item.data),signal=>item.data?managedSpecifications.list(item.data,owner,signal):Promise.resolve([]));
  const [values,setValues]=useState<Values>(blank),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const lock=useRef(false),initialized=useRef(false);
  const editing:ManagedSpecification|undefined=specId?specs.data?.find(row=>row._id===specId):undefined;
  useEffect(()=>{
    if(!specId||initialized.current||!editing)return;
    initialized.current=true;
    setValues({code:editing.code,name:editing.name,description:editing.description??'',unit:editing.quantityUnitId,
      width:String(editing.dimensionsM.widthM),depth:String(editing.dimensionsM.depthM),height:String(editing.dimensionsM.heightM),weight:String(editing.unitWeightKg)});
  },[editing,specId]);
  async function save(){
    if(lock.current||!item.data||!values.unit)return;
    const code=values.code.trim().toUpperCase(),name=values.name.trim();
    const numbers=[values.width,values.depth,values.height,values.weight].map(value=>Number(value));
    if(!/^[A-Z0-9][A-Z0-9_-]{0,47}$/.test(code)){setError('Mã loại hàng phải dài 1–48 ký tự, bắt đầu bằng chữ hoặc số; chỉ dùng chữ, số, gạch ngang hoặc gạch dưới.');return;}
    if(!name||name.length>160){setError('Tên loại hàng là bắt buộc và tối đa 160 ký tự.');return;}
    if(values.description.trim().length>2000){setError('Mô tả tối đa 2.000 ký tự.');return;}
    if(!units.data?.some(unit=>unit._id===values.unit)){setError('Hãy chọn đơn vị tính đang hoạt động do Backend cung cấp.');return;}
    if(numbers.some(value=>!Number.isFinite(value)||value<=0)){setError('Khối lượng và ba kích thước phải là số dương hợp lệ.');return;}
    lock.current=true;setPending(true);setError('');
    try{
      const current=()=>useLiveSession.getState().user?._id===owner;
      await managedSpecifications.save(item.data,owner,{code:values.code,name:values.name,description:values.description||undefined,
        quantityUnitId:values.unit,dimensionsM:{widthM:Number(values.width),depthM:Number(values.depth),heightM:Number(values.height)},unitWeightKg:Number(values.weight)},current,editing);
      showToast(editing?'Đã cập nhật loại hàng':'Đã thêm loại hàng');
      router.replace({pathname:'/inventory/[id]',params:{id}} as unknown as Href);
    }catch(cause){setError(apiIssueWithStatus(cause));}
    finally{lock.current=false;setPending(false);}
  }
  const canSave=!!item.data&&item.data.inventorySchemaVersion===3&&item.data.status==='ACTIVE'&&!!values.unit&&!units.loading&&!units.error&&!!units.data?.some(row=>row._id===values.unit);
  return <LiveScreen title={editing?'Sửa loại hàng':'Khai báo hàng hóa'} eyebrow="ITEM SPECIFICATION" subtitle="Thông tin này mô tả quy cách hàng, chưa tạo tồn kho."
    onRefresh={()=>{item.reload();units.reload();specs.reload();}} refreshing={item.loading||units.loading||specs.loading}>
    <Button label="Quay lại SKU" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...item} resource="SKU"/>
    {item.data&&<Card>
      <AppText variant="medium">{item.data.itemCode} · {item.data.name}</AppText>
      {specId&&<ResourceState {...specs} resource="Item Specification"/>}
      {specId&&!specs.loading&&!editing&&<StateCard kind="error" title="Không tìm thấy loại hàng" description="Tải lại SKU hoặc quay lại danh sách Item Specification."/>}
      <Input label="Mã loại hàng" value={values.code} onChangeText={code=>setValues(old=>({...old,code}))} autoCapitalize="characters" maxLength={48} editable={!pending&&!editing}/>
      <Input label="Tên loại hàng" value={values.name} onChangeText={name=>setValues(old=>({...old,name}))} maxLength={160} editable={!pending}/>
      <AppText variant="label">ĐƠN VỊ TÍNH</AppText>
      <ResourceState {...units} resource="đơn vị tính"/>
      {!units.loading&&!units.error&&units.data?.length===0&&<StateCard title="Chưa có đơn vị tính đang hoạt động" description="Chỉ Admin/BOM có quyền quản lý danh mục. Hãy liên hệ quản trị viên."/>}
      {units.data?.map(unit=><Filter key={unit._id} label={`${unit.name} · ${unit.code}`} selected={values.unit===unit._id} onPress={()=>{if(!pending)setValues(old=>({...old,unit:unit._id}));}}/>)}
      <Input label="Khối lượng mỗi đơn vị (kg)" value={values.weight} keyboardType="decimal-pad" onChangeText={weight=>setValues(old=>({...old,weight}))} editable={!pending}/>
      <Input label="Chiều rộng (m)" value={values.width} keyboardType="decimal-pad" onChangeText={width=>setValues(old=>({...old,width}))} editable={!pending}/>
      <Input label="Chiều sâu (m)" value={values.depth} keyboardType="decimal-pad" onChangeText={depth=>setValues(old=>({...old,depth}))} editable={!pending}/>
      <Input label="Chiều cao (m)" value={values.height} keyboardType="decimal-pad" onChangeText={height=>setValues(old=>({...old,height}))} editable={!pending}/>
      <Input label="Mô tả (không bắt buộc)" value={values.description} onChangeText={description=>setValues(old=>({...old,description}))} maxLength={2000} multiline editable={!pending}/>
      {!!error&&<StateCard kind="error" title="Không thể lưu loại hàng" description={error}/>}
    </Card>}
    <Button label={editing?'Lưu thay đổi':'Lưu loại hàng'} loading={pending} disabled={!canSave||!!(specId&&!editing)} onPress={()=>void save()}/>
  </LiveScreen>;
}
