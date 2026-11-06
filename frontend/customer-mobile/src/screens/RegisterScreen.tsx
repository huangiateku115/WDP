import {useState} from 'react';
import {Pressable, View} from 'react-native';
import {useRouter} from 'expo-router';
import {Controller, useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {registrationSchema, type RegistrationValues} from '../forms/auth';
import {AppText, Button, Card, FixtureNotice, Icon, Input, Screen, ui} from '../components/ui';
import {Brand} from '../components/customer';
import {colors} from '../theme/tokens';

export default function RegisterScreen() {
  const router = useRouter(), [checked, setChecked] = useState(false);
  const {control, handleSubmit, reset, watch, formState: {errors, isSubmitting}} = useForm<RegistrationValues>({resolver: zodResolver(registrationSchema), defaultValues: {name: '', phone: '', email: '', password: '', confirmation: '', consent: false}});
  const password = watch('password');
  return <Screen testID="screen-register"><Brand large/><View style={{gap: 8}}><AppText variant="title">Khởi đầu không gian mới</AppText><AppText style={ui.muted}>Tìm nơi lưu trữ và theo dõi hàng hóa trong không gian dành riêng cho bạn.</AppText></View><FixtureNotice/><Card><View style={ui.row}><Icon name="person-add-outline"/><AppText variant="card">Tài khoản khách hàng</AppText></View><AppText variant="caption" style={ui.muted}>Chỉ thử biểu mẫu với thông tin giả. Chưa tạo tài khoản, chưa xác thực danh tính hoặc gửi email. Các quy tắc dưới đây chỉ là validation UI.</AppText>
    {(['name', 'phone', 'email'] as const).map(name => <Controller key={name} control={control} name={name} render={({field}) => <Input label={name === 'name' ? 'Họ và tên mẫu' : name === 'phone' ? 'Số điện thoại mẫu' : 'Email mẫu'} value={field.value} onBlur={field.onBlur} onChangeText={value => {setChecked(false); field.onChange(value);}} autoCapitalize={name === 'name' ? 'words' : 'none'} keyboardType={name === 'phone' ? 'phone-pad' : name === 'email' ? 'email-address' : 'default'} autoComplete="off" maxLength={name === 'email' ? 254 : name === 'phone' ? 10 : 100} error={errors[name]?.message}/>}/>)}
    <Controller name="password" control={control} render={({field}) => <RegistrationPasswordField label="Mật khẩu mẫu" value={field.value} onChange={value => {setChecked(false); field.onChange(value);}} onBlur={field.onBlur} error={errors.password?.message}/>}/>
    <PasswordStrengthHint value={password}/>
    <Controller name="confirmation" control={control} render={({field}) => <RegistrationPasswordField label="Xác nhận mật khẩu" value={field.value} onChange={value => {setChecked(false); field.onChange(value);}} onBlur={field.onBlur} error={errors.confirmation?.message}/>}/>
    <Controller name="consent" control={control} render={({field}) => <Pressable accessibilityRole="checkbox" accessibilityLabel="Đồng ý điều khoản và quyền riêng tư minh họa" accessibilityState={{checked: field.value}} onPress={() => {setChecked(false); field.onChange(!field.value);}} style={[ui.row, {minHeight: 50, paddingVertical: 8}]}><Icon name={field.value ? 'checkbox' : 'square-outline'}/><AppText style={{flex: 1}}>Tôi ghi nhận điều khoản dịch vụ và quyền riêng tư trong bản mẫu, chỉ dùng thông tin giả để thử giao diện.</AppText></Pressable>}/>{errors.consent && <AppText accessibilityRole="alert" style={{color: colors.danger}}>{errors.consent.message}</AppText>}
    <AppText variant="caption" style={ui.muted}>Văn bản điều khoản/chính sách chính thức chưa được kết nối. Checkbox không phải xác nhận giao kết hoặc đồng ý sử dụng dữ liệu thật.</AppText>
    <Button label="Tạo tài khoản · bản mẫu" loading={isSubmitting} onPress={handleSubmit(values => {reset({...values, password: '', confirmation: ''}); setChecked(true);})}/>
    {checked && <Card style={{backgroundColor: colors.mint}}><AppText accessibilityRole="alert">Biểu mẫu hợp lệ. Chức năng tạo tài khoản sẽ khả dụng sau khi kết nối hệ thống.</AppText><AppText variant="caption">Mật khẩu mẫu đã được xóa khỏi biểu mẫu. Không tạo tài khoản, phiên đăng nhập, email xác minh hoặc mã xác thực.</AppText></Card>}
  </Card><Button label="Trở về đăng nhập" variant="outline" onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}/><AppText variant="caption" style={{textAlign: 'center', color: colors.muted}}>Không lưu mật khẩu trên thiết bị hoặc trong bộ nhớ trạng thái dùng chung.</AppText></Screen>;
}
function RegistrationPasswordField({label, value, onChange, onBlur, error}: {label: string; value: string; onChange: (value: string) => void; onBlur: () => void; error?: string}) {
  const [visible, setVisible] = useState(false);
  return <View style={{gap: 4}}><Input label={label} value={value} onChangeText={onChange} onBlur={onBlur} secureTextEntry={!visible} autoCapitalize="none" autoComplete="off" textContentType="none" autoCorrect={false} spellCheck={false} maxLength={128} error={error}/><Pressable accessibilityRole="button" accessibilityLabel={(visible ? 'Ẩn ' : 'Hiện ') + label.toLocaleLowerCase('vi')} onPress={() => setVisible(v => !v)} style={[ui.row, {minHeight: 44, alignSelf: 'flex-start'}]}><Icon name={visible ? 'eye-off-outline' : 'eye-outline'} size={18}/><AppText variant="label">{visible ? 'Ẩn' : 'Hiện'} {label.toLocaleLowerCase('vi')}</AppText></Pressable></View>;
}
function PasswordStrengthHint({value}: {value: string}) {
  const checks = [value.length >= 8, /[A-Za-z]/.test(value), /[0-9]/.test(value)];
  return <View style={{gap: 6}}><AppText variant="caption" style={ui.muted}>Hướng dẫn mẫu: 8–128 ký tự, có chữ và số, không khoảng trắng ở đầu/cuối. Đây không phải chứng nhận bảo mật.</AppText><View style={{flexDirection: 'row', gap: 6}}>{checks.map((ok, index) => <View key={index} style={{height: 4, flex: 1, borderRadius: 2, backgroundColor: ok ? colors.primaryContainer : colors.line}}/>)}</View></View>;
}
