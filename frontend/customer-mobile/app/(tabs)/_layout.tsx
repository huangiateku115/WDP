import {Tabs} from 'expo-router';
import type {ComponentProps} from 'react';
import type {ColorValue} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon} from '../../src/components/ui';
import {colors,fonts} from '../../src/theme/tokens';

function tabIcon(name: ComponentProps<typeof Icon>['name']) {
  return ({color, focused}: {color: ColorValue; focused: boolean}) => {
    const tint = color == null || typeof color === 'number'
      ? (focused ? colors.primary : colors.inactive)
      : color;
    return <Icon name={name} color={tint}/>;
  };
}

export default function CustomerTabs(){const insets=useSafeAreaInsets();return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:colors.primary,tabBarInactiveTintColor:colors.inactive,tabBarStyle:{backgroundColor:colors.card,borderTopColor:colors.line,height:64+insets.bottom,paddingTop:8,paddingBottom:Math.max(insets.bottom,8)},tabBarLabelStyle:{fontFamily:fonts.medium,fontSize:10},tabBarHideOnKeyboard:true}}>
 <Tabs.Screen name="index" options={{title:'Trang chủ',tabBarIcon:tabIcon('home-outline')}}/>
 <Tabs.Screen name="explore" options={{title:'Khám phá',tabBarIcon:tabIcon('compass-outline')}}/>
 <Tabs.Screen name="rentals" options={{title:'Kho thuê',tabBarIcon:tabIcon('key-outline')}}/>
 <Tabs.Screen name="inventory" options={{title:'Hàng hóa',tabBarIcon:tabIcon('file-tray-stacked-outline')}}/>
 <Tabs.Screen name="profile" options={{title:'Tài khoản',tabBarIcon:tabIcon('person-outline')}}/>
 </Tabs>;}
