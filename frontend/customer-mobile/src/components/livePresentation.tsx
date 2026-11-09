import type {ComponentProps,PropsWithChildren,ReactNode} from 'react';
import {StyleSheet,View} from 'react-native';
import {colors,radius} from '../theme/tokens';
import {AppText,Icon} from './ui';

type IconName=ComponentProps<typeof Icon>['name'];
export function IconBadge({name,tone='green'}:{name:IconName;tone?:'green'|'amber'|'inverse'}){
  return <View style={[styles.badge,tone==='amber'&&styles.amber,tone==='inverse'&&styles.inverse]}>
    <Icon name={name} size={20} color={tone==='amber'?colors.orangeText:tone==='inverse'?colors.inverseText:colors.primary}/>
  </View>;
}

export function ScreenHeading({title,eyebrow,subtitle,accessory}:{
  title:string;eyebrow?:string;subtitle?:string;accessory?:ReactNode;
}){
  return <View style={styles.heading}>
    <View style={styles.copy}>
      {eyebrow&&<AppText variant="label" style={styles.eyebrow}>{eyebrow}</AppText>}
      <AppText variant="title" accessibilityRole="header">{title}</AppText>
      {subtitle&&<AppText style={styles.muted}>{subtitle}</AppText>}
    </View>
    {accessory}
  </View>;
}

export function CardHeading({icon,title,subtitle,tone='green'}:{icon:IconName;title:string;subtitle?:string;tone?:'green'|'amber'}){
  return <View style={styles.heading}>
    <IconBadge name={icon} tone={tone}/>
    <View style={styles.copy}>
      <AppText variant="card" accessibilityRole="header">{title}</AppText>
      {subtitle&&<AppText variant="caption" style={styles.muted}>{subtitle}</AppText>}
    </View>
  </View>;
}

export function TintedPanel({children,tone='green'}:PropsWithChildren<{tone?:'green'|'amber'|'inverse'}>){
  return <View style={[styles.panel,tone==='amber'&&styles.amber,tone==='inverse'&&styles.inverse]}>{children}</View>;
}

export function MetricTile({icon,label,value,loading=false}:{icon:IconName;label:string;value?:number;loading?:boolean}){
  return <View style={styles.metric}>
    <Icon name={icon} size={18}/>
    <AppText variant="heading" style={styles.eyebrow}>{loading?'…':value??'—'}</AppText>
    <AppText variant="caption" style={styles.muted}>{label}</AppText>
    {!loading&&value===undefined&&<AppText variant="caption" style={styles.muted}>Chưa khả dụng</AppText>}
  </View>;
}

const styles=StyleSheet.create({
  heading:{flexDirection:'row',alignItems:'center',gap:12},
  copy:{flex:1,minWidth:0,gap:3},
  eyebrow:{color:colors.primary},
  muted:{color:colors.muted},
  badge:{width:42,height:42,borderRadius:radius.md,backgroundColor:colors.mint,alignItems:'center',justifyContent:'center'},
  panel:{backgroundColor:colors.mint,borderRadius:radius.md,padding:14,gap:10},
  amber:{backgroundColor:colors.amber},
  inverse:{backgroundColor:colors.inverse},
  metric:{flexGrow:1,flexBasis:'46%',minWidth:0,backgroundColor:colors.soft,borderRadius:radius.md,padding:12,gap:3},
});
