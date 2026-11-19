import {Pressable,StyleSheet} from 'react-native';
import {colors} from '../theme/tokens';
import {Icon} from './ui';

export function CustomerBackButton({onPress,disabled=false,testID}:{onPress:()=>void;disabled?:boolean;testID?:string}){
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel="Quay lại" accessibilityHint="Trở về màn hình cha" accessibilityState={{disabled}}
    disabled={disabled} hitSlop={8} onPress={onPress} style={({pressed})=>[styles.button,disabled&&styles.disabled,pressed&&!disabled&&styles.pressed]}>
    <Icon name="arrow-back-outline" size={23} color={disabled?colors.inactive:colors.primary}/>
  </Pressable>;
}
const styles=StyleSheet.create({button:{width:48,height:48,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.card,borderWidth:1,borderColor:colors.line},disabled:{backgroundColor:colors.surface},pressed:{backgroundColor:colors.surfaceHigh,borderColor:colors.primary}});
