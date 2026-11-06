import {Tabs} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon} from '../../src/components/ui';
import {colors,fonts} from '../../src/theme/tokens';

export default function CustomerTabs(){const insets=useSafeAreaInsets();return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:colors.primary,tabBarInactiveTintColor:colors.inactive,tabBarStyle:{backgroundColor:colors.card,borderTopColor:colors.line,height:64+insets.bottom,paddingTop:8,paddingBottom:Math.max(insets.bottom,8)},tabBarLabelStyle:{fontFamily:fonts.medium,fontSize:10},tabBarHideOnKeyboard:true}}>
 <Tabs.Screen name="index" options={{title:'Trang chủ',tabBarIcon:({color})=><Icon name="home-outline" color={color}/>}}/>
 <Tabs.Screen name="explore" options={{title:'Khám phá',tabBarIcon:({color})=><Icon name="compass-outline" color={color}/>}}/>
 <Tabs.Screen name="rentals" options={{title:'Kho thuê',tabBarIcon:({color})=><Icon name="key-outline" color={color}/>}}/>
 <Tabs.Screen name="inventory" options={{title:'Hàng hóa',tabBarIcon:({color})=><Icon name="file-tray-stacked-outline" color={color}/>}}/>
 <Tabs.Screen name="profile" options={{title:'Tài khoản',tabBarIcon:({color})=><Icon name="person-outline" color={color}/>}}/>
 </Tabs>;}
