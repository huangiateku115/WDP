import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Image,Keyboard,Modal,Platform,Pressable,View,StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import axios from 'axios';
import {ZodError} from 'zod';
import * as ImagePicker from 'expo-image-picker';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {managedInventory} from '../api/managedInventory';
import {managedSkuCategories,managedSkuEligible,saveManagedSku} from '../api/managedSkuV3';
import {refId} from '../api/contracts/core';
import type {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Input,Screen} from './ui';
import {useRouter,type Href} from 'expo-router';
import {ScreenHeading} from './livePresentation';
import {ResourceState,useResource} from './liveUI';
import {colors} from '../theme/tokens';
import {managedImageUploads,type InventoryImageAsset,type UploadedInventoryImage,validateInventoryImageAsset} from '../api/managedImageUploads';
import {showToast} from '../state/toastStore';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type Category=Awaited<ReturnType<typeof managedSkuCategories>>[number];
export function ManagedSkuEditor({r,item,onSaved}:{r:ReservationDto;item?:Item;onSaved:(row:Item)=>void}){
  const owner=useLiveSession(s=>s.user?._id??'');
  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[pickerOpen,setPickerOpen]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState('');
  const [values,setValues]=useState({name:item?.name??'',categoryId:item?.categoryId?refId(item.categoryId):'',description:typeof item?.description==='string'?item.description:'',code:''});
  const [images,setImages]=useState<string[]>(item?.images??[]),[uploadedImages,setUploadedImages]=useState<Record<string,UploadedInventoryImage>>({});
  const [pickedAsset,setPickedAsset]=useState<ImagePicker.ImagePickerAsset|null>(null),[imageBusy,setImageBusy]=useState(false),[imageError,setImageError]=useState('');
  const busy=useRef(false),mounted=useRef(false);
  const categories=useResource(owner+':managed-sku-categories',signal=>managedSkuCategories(signal));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const selectedCategory=categories.data?.find(category=>category.categoryId===values.categoryId);
  const filtered=useMemo(()=>categories.data?.filter(category=>`${category.name} ${category.code}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')))??[],[categories.data,query]);
  const eligible=managedSkuEligible(r)&&( !item||(item.inventorySchemaVersion===3&&item.status==='ACTIVE'&&item.currentCellId==null));
  const sessionCurrent=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
  async function uploadAsset(asset:ImagePicker.ImagePickerAsset){
    if(imageBusy||!sessionCurrent())return;
    setImageBusy(true);setImageError('');setPickedAsset(asset);
    try{
      const uploaded=await managedImageUploads.upload(r._id,asset as InventoryImageAsset);
      if(!sessionCurrent())return;
      setImages(current=>current.length<10?[...current,uploaded.secureUrl]:current);
      setUploadedImages(current=>({...current,[uploaded.secureUrl]:uploaded}));setPickedAsset(null);
    }catch(cause){setImageError(axios.isAxiosError(cause)&&cause.response?.status===503?'Tính năng tải ảnh hiện chưa khả dụng. Hãy thử lại sau.':axios.isAxiosError(cause)?apiIssue(cause):cause instanceof Error?cause.message:'Không thể tải ảnh lên. Vui lòng thử lại.');}
    finally{setImageBusy(false);}
  }
  async function chooseImage(source:'library'|'camera'){
    if(imageBusy||images.length>=10)return;
    setImageError('');
    try{
      if(source==='camera'){
        const permission=await ImagePicker.requestCameraPermissionsAsync();
        if(!permission.granted){setImageError('Hãy cho phép truy cập camera để chụp ảnh.');return;}
      }else{
        const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
        if(!permission.granted){setImageError('Hãy cho phép truy cập thư viện ảnh để chọn ảnh.');return;}
      }
      const result=source==='camera'
        ?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:1})
        :await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:1});
      if(!result.canceled&&result.assets?.[0]){validateInventoryImageAsset(result.assets[0] as InventoryImageAsset);setPickedAsset(result.assets[0]);}
    }catch(cause){setImageError(cause instanceof Error?cause.message:'Không thể mở ảnh. Vui lòng thử lại.');}
  }
  async function removeImage(url:string){
    if(imageBusy)return;setImageBusy(true);setImageError('');
    try{const upload=uploadedImages[url];if(upload)await managedImageUploads.remove(upload.uploadId);
      setImages(current=>current.filter(value=>value!==url));setUploadedImages(current=>{const next={...current};delete next[url];return next;});
    }catch(cause){setImageError(axios.isAxiosError(cause)&&cause.response?.status===503?'Hiện chưa thể gỡ ảnh tải lên. Hãy thử lại sau.':cause instanceof Error?cause.message:'Không thể gỡ ảnh. Vui lòng thử lại.');}
    finally{setImageBusy(false);}
  }
  async function save(){
    if(busy.current||uncertain||pending)return;
    const code=values.code.trim().toUpperCase(),name=values.name.trim(),description=values.description.trim();
    if(!item&&(!code||code.length>48||!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))){setError('Mã SKU bắt buộc, tối đa 48 ký tự; chỉ dùng chữ, số, dấu gạch ngang hoặc gạch dưới.');return;}
    if(!name||name.length>160){setError('Tên SKU bắt buộc và tối đa 160 ký tự.');return;}
    if(!values.categoryId){setError('Hãy chọn danh mục SKU đang hoạt động.');return;}
    if(description.length>2000){setError('Mô tả tối đa 2.000 ký tự.');return;}
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(!current())return;
    busy.current=true;setPending(true);setError('');Keyboard.dismiss();
    const metadata={name,categoryId:values.categoryId,description,images};
    try{
      const row=await saveManagedSku(r,owner,item?metadata:{...metadata,managedReservationId:r._id,itemCode:code},current,item);
      if(current()){showToast(item?'Đã cập nhật hàng hóa':'Đã lưu hàng hóa');onSaved(row);}
    }catch(cause){
      if(current()){
        const ambiguous=axios.isAxiosError(cause)&&(!cause.response||cause.response.status>=500);
        if(ambiguous)setUncertain(true);
        setError(ambiguous?'Chưa rõ kết quả lưu. Hãy kiểm tra danh sách SKU trước khi gửi lại.':cause instanceof ZodError?'Mã SKU, tên hoặc danh mục chưa đúng định dạng.':apiIssue(cause));
      }
    }finally{busy.current=false;if(current())setPending(false);}
  }
  if(!eligible)return <Screen><ScreenHeading title={item?'Sửa thông tin SKU':'Khai báo hàng hóa'}/><Card><AppText accessibilityRole="alert">Reservation hoặc SKU chưa đủ điều kiện chỉnh sửa.</AppText></Card></Screen>;
  return <>
    <Screen testID="managed-sku-form" footer={<Button label={item?'Lưu thông tin SKU':'Lưu SKU'} loading={pending} disabled={!eligible||uncertain||categories.loading||!!categories.error||imageBusy||!!pickedAsset} onPress={()=>void save()}/> }>
      <ScreenHeading title={item?'Sửa thông tin hàng hóa':'Khai báo hàng hóa'} eyebrow="KHO KÝ GỬI" subtitle={`Đơn ${r.reservationCode}`}/>
      <Card>
        <AppText>Khai báo thông tin hàng hóa để quản lý và nhập kho.</AppText>
        {!item&&<Input label="Mã SKU" value={values.code} editable={!pending&&!uncertain} maxLength={48} autoCapitalize="characters" onChangeText={value=>{setValues(previous=>({...previous,code:value}));setError('');}} placeholder="Ví dụ: BOX-001"/>}
        <Input label="Tên SKU" value={values.name} editable={!pending&&!uncertain} maxLength={160} onChangeText={value=>{setValues(previous=>({...previous,name:value}));setError('');}} placeholder="Tên hàng hóa"/>
        <View style={{gap:6}}><AppText variant="label">Danh mục</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Chọn danh mục SKU" accessibilityState={{disabled:pending||uncertain}} disabled={pending||uncertain||categories.loading||!!categories.error} onPress={()=>{setQuery('');setPickerOpen(true);}} style={styles.categoryButton}>
            <AppText style={{color:selectedCategory?colors.text:colors.muted}}>{selectedCategory?.name??(categories.loading?'Đang tải danh mục…':categories.error?'Không tải được danh mục':'Chọn danh mục')}</AppText>
            {categories.loading?<ActivityIndicator color={colors.primary}/>:null}
          </Pressable>
          <ResourceState {...categories}/>
          {categories.data?.length===0&&!categories.loading&&!categories.error&&<AppText variant="caption" style={{color:colors.muted}}>Chưa có danh mục đang hoạt động.</AppText>}
        </View>
        <Input label="Mô tả (không bắt buộc)" value={values.description} editable={!pending&&!uncertain} maxLength={2000} multiline numberOfLines={4} onChangeText={value=>{setValues(previous=>({...previous,description:value}));setError('');}} placeholder="Thông tin bổ sung về hàng hóa" style={{minHeight:92,textAlignVertical:'top'}}/>
        <View style={{gap:10}}><View style={styles.imageHeading}><AppText variant="label">Ảnh hàng hóa</AppText><AppText variant="caption" style={{color:colors.muted}}>{images.length}/10 · JPEG, PNG, WebP · tối đa 8 MiB/ảnh</AppText></View>
          <View style={styles.imageActions}><Button label="Chọn từ thư viện" variant="outline" disabled={pending||imageBusy||images.length>=10} onPress={()=>void chooseImage('library')}/>{Platform.OS!=='web'&&<Button label="Chụp ảnh" variant="outline" disabled={pending||imageBusy||images.length>=10} onPress={()=>void chooseImage('camera')}/>}</View>
          {imageBusy&&<View style={styles.uploading}><ActivityIndicator color={colors.primary}/><AppText>Đang tải ảnh lên…</AppText></View>}
          {!!pickedAsset&&<View style={styles.imageGrid}><View style={styles.imageCard}><Image source={{uri:pickedAsset.uri}} style={styles.imagePreview} resizeMode="cover"/><AppText variant="caption" style={{color:colors.muted}}>Xem trước ảnh</AppText><Button label={imageError?'Thử tải lại':'Tải ảnh lên'} variant="outline" loading={imageBusy} onPress={()=>void uploadAsset(pickedAsset)} disabled={imageBusy}/><Button label="Bỏ ảnh" variant="quiet" disabled={imageBusy} onPress={()=>{setPickedAsset(null);setImageError('');}}/></View></View>}
          <View style={styles.imageGrid}>{images.map(url=><View key={url} style={styles.imageCard}><Image source={{uri:url}} style={styles.imagePreview} resizeMode="cover"/><Button label="Gỡ ảnh" variant="quiet" disabled={pending||imageBusy} onPress={()=>void removeImage(url)}/></View>)}</View>
          <AppText variant="caption" style={{color:colors.muted}}>Chỉ tải ảnh hàng hóa phù hợp, không chứa thông tin cá nhân hoặc nhạy cảm.</AppText>
          {!!imageError&&<AppText accessibilityRole="alert" style={{color:colors.danger}}>{imageError}</AppText>}
        </View>
        {!!error&&<AppText accessibilityRole="alert" style={{color:colors.danger}}>{error}</AppText>}
      </Card>
    </Screen>
    <Modal visible={pickerOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={()=>setPickerOpen(false)}>
      <View style={styles.scrim}><SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHandle}/><View style={styles.sheetHeader}><AppText variant="card">Chọn danh mục</AppText><Pressable accessibilityRole="button" accessibilityLabel="Đóng danh mục" onPress={()=>setPickerOpen(false)} hitSlop={12}><AppText variant="medium" style={{color:colors.primary}}>Đóng</AppText></Pressable></View>
        <Input label="Tìm danh mục" value={query} onChangeText={setQuery} placeholder="Nhập tên hoặc mã danh mục" autoCorrect={false}/>
        {categories.loading?<ActivityIndicator accessibilityLabel="Đang tải danh mục" color={colors.primary}/>:categories.error?<ResourceState {...categories}/>:filtered.length===0?<AppText style={{padding:18,textAlign:'center',color:colors.muted}}>Không tìm thấy danh mục phù hợp.</AppText>:
          <FlatList data={filtered} keyExtractor={row=>row.categoryId} keyboardShouldPersistTaps="handled" style={{maxHeight:'68%'}} renderItem={({item:category})=><Pressable accessibilityRole="button" accessibilityLabel={`Chọn ${category.name}`} accessibilityState={{selected:values.categoryId===category.categoryId}} onPress={()=>{setValues(previous=>({...previous,categoryId:category.categoryId}));setError('');setPickerOpen(false);}} style={[styles.categoryRow,values.categoryId===category.categoryId&&styles.categorySelected]}>
            <View style={{flex:1}}><AppText variant="medium">{category.name}</AppText><AppText variant="caption" style={{color:colors.muted}}>{category.code}</AppText></View>{values.categoryId===category.categoryId&&<AppText style={{color:colors.primary}}>✓</AppText>}
          </Pressable>}/>
        }
      </SafeAreaView></View>
    </Modal>
  </>;
}

export function ManagedSkuEdit({item,owner,onSaved,accessSessionId}:{item:Item;owner:string;onSaved:(row:Item)=>void;accessSessionId?:string}){
  const router=useRouter();
  const r=useResource(owner+':'+item._id,signal=>managedInventory.rental(refId(item.managedReservationId),owner,refId(item.facilityId),signal));
  return <><ResourceState {...r} resource="Reservation liên kết với SKU"/>{r.data&&<Button label="Kiểm tra nhập kho" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/inbound',params:{id:item._id,...(accessSessionId?{accessSessionId}:{})}} as unknown as Href)}/>}</>;
}

const styles=StyleSheet.create({categoryButton:{minHeight:52,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:colors.soft,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},scrim:{flex:1,justifyContent:'flex-end',backgroundColor:'#103D2B88'},sheet:{maxHeight:'88%',backgroundColor:colors.card,borderTopLeftRadius:22,borderTopRightRadius:22,padding:18,gap:14},sheetHandle:{width:42,height:4,borderRadius:2,backgroundColor:colors.line,alignSelf:'center'},sheetHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},categoryRow:{minHeight:58,paddingHorizontal:12,paddingVertical:8,borderBottomWidth:1,borderBottomColor:colors.line,flexDirection:'row',alignItems:'center'},categorySelected:{backgroundColor:colors.mint},imageHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},imageActions:{gap:8},imageGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},imageCard:{width:'48%',borderWidth:1,borderColor:colors.line,borderRadius:12,padding:8,gap:6},imagePreview:{width:'100%',height:140,borderRadius:8,backgroundColor:colors.surface},uploading:{minHeight:60,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:colors.mint,borderRadius:12}});
