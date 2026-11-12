import {useState} from 'react';
import type {ComponentProps,PropsWithChildren,ReactNode} from 'react';
import {ActivityIndicator,KeyboardAvoidingView,Platform,Pressable,RefreshControl,ScrollView,StyleSheet,Text,TextInput,View,type TextProps,type TextInputProps,type ViewStyle,type StyleProp} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import {colors,spacing,radius,typography,elevation,fonts} from '../theme/tokens';

export function AppText({variant='body',style,...props}:TextProps&{variant?:keyof typeof typography}){
  return <Text {...props} style={[{color:colors.text},typography[variant],style]}/>;
}
export function Icon({name,size=22,color=colors.primary}:{name:ComponentProps<typeof Ionicons>['name'];size?:number;color?:ComponentProps<typeof Ionicons>['color']}){return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/>;}
export function Screen({children,safeTop=true,testID,footer,onRefresh,refreshing}:PropsWithChildren<{safeTop?:boolean;testID?:string;footer?:ReactNode;onRefresh?:()=>void;refreshing?:boolean}>){return <SafeAreaView testID={testID} style={s.screen} edges={safeTop?['top','left','right']:['left','right','bottom']}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.card}/> : undefined} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>{footer&&<View style={{borderTopWidth:1,borderTopColor:colors.line,backgroundColor:colors.card,padding:12}}>{footer}</View>}</KeyboardAvoidingView></SafeAreaView>;}
export function Card({children,style,testID}:PropsWithChildren<{style?:StyleProp<ViewStyle>;testID?:string}>){return <View testID={testID} style={[s.card,style]}>{children}</View>;}
export function Button({label,onPress,variant='primary',disabled=false,loading=false,testID,icon}:{label:string;onPress:()=>void;variant?:'primary'|'orange'|'outline'|'quiet'|'danger';disabled?:boolean;loading?:boolean;testID?:string;icon?:ComponentProps<typeof Icon>['name']}){
  const filled=variant==='primary'||variant==='orange';
  const labelColor=variant==='orange'?colors.text:filled?colors.white:variant==='danger'?colors.danger:colors.primary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:disabled||loading,busy:loading}} disabled={disabled||loading} onPress={onPress} style={({pressed})=>[s.button,{backgroundColor:variant==='primary'?colors.primary:variant==='orange'?colors.orange:variant==='outline'?colors.soft:variant==='danger'?colors.dangerTint:'transparent',borderColor:variant==='outline'?colors.line:'transparent',opacity:disabled ? .45 : pressed ? .8 : 1}]}>{loading?<ActivityIndicator color={labelColor}/>:icon?<Icon name={icon} size={19} color={labelColor}/>:null}<AppText variant="medium" style={{color:labelColor,textAlign:'center',flexShrink:1}}>{label}</AppText></Pressable>;
}
export function Input({label,error,style,onFocus,onBlur,...props}:TextInputProps&{label:string;error?:string}){
  const [focused,setFocused]=useState(false);
  return <View style={s.field}>
    <AppText variant="label">{label}</AppText>
    <TextInput {...props} onFocus={event=>{setFocused(true);onFocus?.(event);}} onBlur={event=>{setFocused(false);onBlur?.(event);}}
      accessibilityLabel={label} accessibilityHint={error} placeholderTextColor={colors.inactive}
      style={[s.input,focused&&s.inputFocused,props.editable===false&&s.inputDisabled,error&&{borderColor:colors.danger},style]}/>
    {error&&<AppText accessibilityRole="alert" variant="caption" style={{color:colors.danger}}>{error}</AppText>}
  </View>;
}
export function SectionTitle({title,action,onPress}:{title:string;action?:string;onPress?:()=>void}){return <View style={s.sectionTitle}><AppText variant="card" style={{flex:1}}>{title}</AppText>{action&&onPress&&<Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onPress} style={{minHeight:44,justifyContent:'center',paddingLeft:12}}><AppText variant="label" style={{color:colors.primary}}>{action} →</AppText></Pressable>}</View>;}
export function Chip({label,tone='green'}:{label:string;tone?:'green'|'orange'|'neutral'|'danger'}){return <View style={[s.chip,{backgroundColor:tone==='orange'?colors.orangeTint:tone==='neutral'?colors.surface:tone==='danger'?colors.dangerTint:colors.mint}]}><AppText variant="label" style={{color:tone==='orange'?colors.orangeText:tone==='neutral'?colors.muted:tone==='danger'?colors.danger:colors.primary}}>{label}</AppText></View>;}
export function Filter({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected}} onPress={onPress} style={[s.filter,selected&&s.filterActive]}><AppText variant="label" style={{color:selected?colors.white:colors.muted}}>{label}</AppText></Pressable>;}
export function FixtureNotice(){return <View style={s.fixture}><Icon name="flask-outline" size={14}/><AppText variant="caption" style={{color:colors.primary,flex:1}}>Bản mẫu ngoại tuyến · Không kết nối tài khoản hoặc giao dịch thật</AppText></View>;}
export function StateCard({kind='empty',title,description,onRetry}:{kind?:'loading'|'empty'|'error';title:string;description?:string;onRetry?:()=>void}){
  return <Card style={s.state}>
    <View style={[s.stateIcon,kind==='error'&&s.errorIcon]}>
      {kind==='loading'?<ActivityIndicator accessibilityLabel="Đang tải" color={colors.primary}/>:<Icon name={kind==='error'?'alert-circle-outline':'file-tray-outline'} size={25} color={kind==='error'?colors.danger:colors.primary}/>}
    </View>
    <AppText variant="card" accessibilityRole={kind==='error'?'alert':'header'} style={s.stateTitle}>{title}</AppText>
    {description&&<AppText style={s.stateDescription}>{description}</AppText>}
    {onRetry&&<Button label="Thử lại" variant="outline" icon="refresh-outline" onPress={onRetry}/>}
  </Card>;
}
export const ui=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:10},between:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},muted:{color:colors.muted},gap:{gap:16}});
const s=StyleSheet.create({
  flex:{flex:1},screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.page,paddingBottom:32,gap:16,width:'100%',maxWidth:720,alignSelf:'center'},
  card:{backgroundColor:colors.card,borderRadius:radius.lg,borderWidth:1,borderColor:colors.line,padding:spacing.lg,gap:12,...elevation},
  button:{minHeight:48,paddingHorizontal:16,paddingVertical:12,borderWidth:1,borderRadius:radius.md,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  field:{gap:6},inputFocused:{borderColor:colors.primary,backgroundColor:colors.card},inputDisabled:{opacity:.65},
  input:{minHeight:52,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,backgroundColor:colors.soft,paddingHorizontal:14,paddingVertical:12,color:colors.text,fontFamily:fonts.regular,fontSize:15},
  sectionTitle:{flexDirection:'row',alignItems:'center',gap:8},chip:{alignSelf:'flex-start',paddingHorizontal:10,paddingVertical:5,borderRadius:radius.pill},
  filter:{minHeight:44,paddingHorizontal:14,paddingVertical:12,borderWidth:1,borderColor:colors.line,borderRadius:radius.pill,backgroundColor:colors.card},
  filterActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  state:{alignItems:'center',padding:24,gap:10},stateIcon:{width:48,height:48,borderRadius:24,backgroundColor:colors.mint,alignItems:'center',justifyContent:'center'},
  errorIcon:{backgroundColor:colors.dangerTint},stateTitle:{textAlign:'center'},stateDescription:{textAlign:'center',color:colors.muted},
  fixture:{flexDirection:'row',alignItems:'center',gap:7,padding:10,backgroundColor:colors.mint,borderRadius:radius.sm},
});
