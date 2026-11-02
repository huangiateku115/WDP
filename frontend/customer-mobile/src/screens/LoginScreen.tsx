import {useState} from 'react';
import {Alert,Pressable,View} from 'react-native';
import {useRouter} from 'expo-router';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {loginSchema,type LoginValues} from '../forms/auth';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Button,Card,FixtureNotice,Icon,Input,Screen,ui} from '../components/ui';
import {Brand} from '../components/customer';
import {WarehouseArt} from '../components/WarehouseArt';
import {colors} from '../theme/tokens';

export default function LoginScreen(){
 const router=useRouter(),enterDemo=useCustomerStore(s=>s.enterDemo);const [visible,setVisible]=useState(false);
 const {control,handleSubmit,formState:{errors,isSubmitting}}=useForm<LoginValues>({resolver:zodResolver(loginSchema),defaultValues:{email:'demo@vaultspace.vn',password:''}});
 return <Screen testID="screen-login"><Brand large/><WarehouseArt height={175}/><View style={{gap:8}}><AppText variant="title">Chào mừng trở lại!</AppText><AppText style={ui.muted}>Một nơi an tâm cho đồ dùng và hàng hóa của bạn.</AppText></View><FixtureNotice/><Card style={{gap:18}}>
  <Controller control={control} name="email" render={({field:{onChange,onBlur,value}})=><Input label="Email bản mẫu" placeholder="demo@vaultspace.vn" autoCapitalize="none" autoComplete="off" keyboardType="email-address" value={value} onBlur={onBlur} onChangeText={onChange} error={errors.email?.message}/>}/>
  <Controller control={control} name="password" render={({field:{onChange,onBlur,value}})=><Input label="Mật khẩu bản mẫu" placeholder="Nhập ít nhất 8 ký tự mẫu" autoCapitalize="none" autoComplete="off" secureTextEntry={!visible} value={value} onBlur={onBlur} onChangeText={onChange} error={errors.password?.message}/>}/>
  <View style={ui.between}><Pressable accessibilityRole="button" accessibilityLabel={visible?'Ẩn mật khẩu':'Hiện mật khẩu'} onPress={()=>setVisible(v=>!v)} style={[ui.row,{minHeight:44}]}><Icon name={visible?'eye-off-outline':'eye-outline'} size={18}/><AppText variant="label">{visible?'Ẩn mật khẩu':'Hiện mật khẩu'}</AppText></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Quên mật khẩu" onPress={()=>Alert.alert('Chưa kết nối máy chủ','Khôi phục mật khẩu sẽ được tích hợp ở giai đoạn API. Vui lòng không nhập mật khẩu thật.')} style={{minHeight:44,justifyContent:'center'}}><AppText variant="label" style={{color:colors.primary}}>Quên mật khẩu?</AppText></Pressable></View>
  <Button label="Đăng nhập bản mẫu" testID="enter-demo" loading={isSubmitting} onPress={handleSubmit(()=>{enterDemo();router.replace('/(tabs)');})}/>
  <AppText variant="caption" style={ui.muted}>Không xác thực tài khoản. Nhập chuỗi mẫu từ 8 ký tự, ví dụ VaultDemo123!; không nhập thông tin đăng nhập thật.</AppText>
 </Card><View style={{gap:4,alignItems:'center'}}><AppText style={ui.muted}>Lần đầu đến VaultSpace?</AppText><Button label="Khám phá đăng ký" variant="quiet" onPress={()=>router.push('/(auth)/register')}/></View><AppText variant="caption" style={{textAlign:'center',color:colors.muted}}>Chỉ dành cho khách hàng · Phiên bản giao diện 0.1</AppText></Screen>;
}
