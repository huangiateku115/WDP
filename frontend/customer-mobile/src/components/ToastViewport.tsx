import {useEffect,useRef,useSyncExternalStore} from 'react';
import {Animated,Platform,StyleSheet,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon,AppText} from './ui';
import {colors} from '../theme/tokens';
import {dismissToast,getToast,subscribeToast} from '../state/toastStore';

export function ToastViewport(){
  const toast=useSyncExternalStore(subscribeToast,getToast,getToast);
  const insets=useSafeAreaInsets();
  const opacity=useRef(new Animated.Value(0)).current;
  const offset=useRef(new Animated.Value(-10)).current;
  useEffect(()=>{
    if(!toast)return;
    opacity.setValue(0);offset.setValue(-10);
    const animation=Animated.sequence([
      Animated.parallel([Animated.timing(opacity,{toValue:1,duration:180,useNativeDriver:Platform.OS!=='web'}),Animated.timing(offset,{toValue:0,duration:180,useNativeDriver:Platform.OS!=='web'})]),
      Animated.delay(2640),
      Animated.parallel([Animated.timing(opacity,{toValue:0,duration:180,useNativeDriver:Platform.OS!=='web'}),Animated.timing(offset,{toValue:-8,duration:180,useNativeDriver:Platform.OS!=='web'})]),
    ]);
    animation.start(({finished})=>{if(finished)dismissToast(toast.id);});
    return()=>animation.stop();
  },[toast?.id,opacity,offset]);
  if(!toast)return null;
  return <View pointerEvents="none" style={[styles.viewport,{top:insets.top+76}]}>
    <Animated.View accessibilityRole={toast.kind==='error'?'alert':'status'} testID="global-toast" style={[styles.toast,{opacity,transform:[{translateY:offset}],borderColor:toast.kind==='error'?colors.danger:colors.primary}]}>
      <Icon name={toast.kind==='error'?'alert-circle':'checkmark-circle'} size={21} color={toast.kind==='error'?colors.danger:colors.primary}/>
      <AppText variant="medium" style={styles.message}>{toast.message}</AppText>
    </Animated.View>
  </View>;
}
const styles=StyleSheet.create({viewport:{position:'absolute',left:16,right:16,zIndex:1000,elevation:20,alignItems:'center'},toast:{width:'100%',maxWidth:520,minHeight:52,paddingHorizontal:16,paddingVertical:12,borderRadius:14,borderWidth:1,backgroundColor:colors.card,flexDirection:'row',alignItems:'center',gap:10,shadowColor:'#000',shadowOpacity:.14,shadowRadius:10,shadowOffset:{width:0,height:4}},message:{flex:1}});
