import {useEffect,useState} from 'react';
import {Image,StyleSheet,View} from 'react-native';
import {colors,radius} from '../theme/tokens';
import {AppText,Chip,Icon} from './ui';

type FacilityView={
  _id?:string;
  name:string;
  address:Record<string,unknown>;
  description?:string;
  images?:string[];
};

export function ManagedFacilityVisual({facility,variant='compact'}:{facility:FacilityView;variant?:'compact'|'detail'}){
  const image=facility.images?.find(value=>value.trim());
  const [imageFailed,setImageFailed]=useState(false);
  useEffect(()=>setImageFailed(false),[image]);
  const text=(value:unknown)=>typeof value==='string'?value:'';
  const address=[text(facility.address.line1)||text(facility.address.street),text(facility.address.district),text(facility.address.city)].filter(Boolean).join(', ');
  return <View style={styles.container}>
    <View style={[styles.artwork,variant==='detail'&&styles.detailArtwork]}>
      {image&&!imageFailed?<Image source={{uri:image}} resizeMode="cover" accessibilityLabel={'Ảnh cơ sở '+facility.name}
        style={StyleSheet.absoluteFill} onError={()=>setImageFailed(true)}/>:<>
        <View style={styles.orbOne}/><View style={styles.orbTwo}/>
        <View style={styles.iconTile}><Icon name="business-outline" size={34} color={colors.primary}/></View>
        <AppText variant="caption" style={styles.artworkLabel}>VAULTSPACE · KHO KÝ GỬI</AppText>
      </>}
    </View>
    <View style={styles.content}>
      <View style={styles.topline}>
        <Chip label="Kho ký gửi"/>
        {variant==='detail'&&<AppText variant="caption" style={styles.verifiedCopy}>Thông tin cơ sở</AppText>}
      </View>
      <AppText variant={variant==='detail'?'title':'card'} accessibilityRole="header">{facility.name}</AppText>
      {!!address&&<View style={styles.address}>
        <Icon name="location-outline" size={17} color={colors.muted}/>
        <AppText style={styles.addressText}>{address}</AppText>
      </View>}
      {variant==='detail'&&facility.description?<AppText style={styles.description}>{facility.description}</AppText>:null}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  container:{overflow:'hidden',borderRadius:radius.md,backgroundColor:colors.white},
  artwork:{height:132,backgroundColor:colors.mint,alignItems:'center',justifyContent:'center',overflow:'hidden'},
  detailArtwork:{height:184},
  orbOne:{position:'absolute',width:190,height:190,borderRadius:95,backgroundColor:colors.surface,top:-105,right:-28},
  orbTwo:{position:'absolute',width:128,height:128,borderRadius:64,backgroundColor:colors.surfaceHigh,bottom:-84,left:-25},
  iconTile:{width:68,height:68,borderRadius:22,backgroundColor:colors.white,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.line},
  artworkLabel:{position:'absolute',bottom:12,right:14,color:colors.primary,letterSpacing:1.1},
  content:{paddingTop:14,gap:8},
  topline:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  verifiedCopy:{color:colors.muted},
  address:{flexDirection:'row',alignItems:'flex-start',gap:5},
  addressText:{flex:1,color:colors.muted},
  description:{color:colors.muted,marginTop:2},
});
