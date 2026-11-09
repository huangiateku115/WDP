import {useEffect} from 'react';
import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {useFonts} from 'expo-font';
const fontAssets={
 Inter_400Regular:require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
 Inter_500Medium:require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
 Inter_600SemiBold:require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
 Inter_700Bold:require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
};
import {ActivityIndicator,Text,View} from 'react-native';
import {colors} from '../src/theme/tokens';
import {useLiveSession} from '../src/state/useLiveSession';

export default function RootLayout(){
 const [loaded,error]=useFonts(fontAssets);
 const user=useLiveSession(s=>s.user);
 const restoring=useLiveSession(s=>s.restoring);
 const restore=useLiveSession(s=>s.restore);
 useEffect(()=>{void restore();},[restore]);
 useEffect(()=>{if(error)console.warn('Không tải được phông chữ cục bộ.');},[error]);
 if(!loaded||restoring)return <SafeAreaProvider><View style={{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:colors.background,gap:12}}>{error?<Text accessibilityRole="alert">Không tải được phông chữ. Vui lòng khởi động lại ứng dụng.</Text>:<><ActivityIndicator accessibilityLabel="Đang khởi động" color={colors.primary}/><Text>Đang chuẩn bị không gian của bạn…</Text></>}</View></SafeAreaProvider>;
 return <SafeAreaProvider><StatusBar style="dark"/><Stack screenOptions={{headerStyle:{backgroundColor:colors.card},headerTintColor:colors.primary,headerTitleStyle:{fontFamily:'Inter_700Bold',fontSize:17},headerShadowVisible:false,contentStyle:{backgroundColor:colors.background},headerBackButtonDisplayMode:'minimal'}}>
  <Stack.Screen name="index" options={{headerShown:false}}/>
  <Stack.Protected guard={!user} redirectTo="/(tabs)"><Stack.Screen name="(auth)" options={{headerShown:false}}/></Stack.Protected>
  <Stack.Protected guard={!!user} redirectTo="/(auth)/login"><Stack.Screen name="notifications" options={{title:'Thông báo'}}/><Stack.Screen name="support" options={{title:'Hỗ trợ'}}/><Stack.Screen name="(tabs)" options={{headerShown:false}}/><Stack.Screen name="rentals" options={{title:'Hồ sơ thuê'}}/><Stack.Screen name="inventory" options={{title:'Hàng hóa'}}/><Stack.Screen name="managed" options={{title:'Kho ký gửi'}}/><Stack.Screen name="booking" options={{title:'Đặt kho'}}/><Stack.Screen name="preview/[kind]/[id]" options={{title:'Chi tiết'}}/></Stack.Protected>
  <Stack.Screen name="+not-found" options={{title:'Không tìm thấy'}}/>
 </Stack></SafeAreaProvider>;
}
