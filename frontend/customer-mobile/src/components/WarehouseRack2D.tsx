import {useState} from 'react';
import {Pressable,ScrollView,StyleSheet,View} from 'react-native';
import type {ManagedCell,ManagedRackLevel} from '../api/managedInventory';
import {managedCellState} from '../domain/managedCellSelection';
import {warehouseRackLayout} from '../domain/warehouseRackLayout';
import {colors,radius} from '../theme/tokens';
import {AppText,Icon,ui} from './ui';

type Props={
  levels:ManagedRackLevel[];
  layout:ReturnType<typeof warehouseRackLayout>;
  levelIndex:number;
  hasPeriod:boolean;
  rackAvailable:boolean;
  inspectedId:string;
  selectedIds:ReadonlySet<string>;
  onInspect:(id:string,levelIndex:number)=>void;
};
type Kind=ReturnType<typeof managedCellState>['kind'];
const statuses:Record<Kind,{label:string;background:string;ink:string}>={
  AVAILABLE:{label:'Khả dụng',background:colors.mint,ink:colors.deep},
  RESERVED:{label:'Đã giữ chỗ',background:colors.orangeTint,ink:colors.orangeText},
  OCCUPIED:{label:'Đang sử dụng',background:colors.dangerTint,ink:colors.danger},
  MAINTENANCE:{label:'Bảo trì',background:'#fff8d6',ink:'#735600'},
  BLOCKED:{label:'Đã khóa',background:'#e8ebf3',ink:'#364563'},
  UNKNOWN:{label:'Chưa xác minh',background:colors.soft,ink:colors.muted},
};
const zoomSteps=[{width:76,label:'80%'},{width:96,label:'100%'},{width:120,label:'125%'},{width:144,label:'150%'}];

export function WarehouseRack2D({levels,layout,levelIndex,hasPeriod,rackAvailable,inspectedId,selectedIds,onInspect}:Props){
  const [zoom,setZoom]=useState(1);
  const size=zoomSteps[zoom]!;
  const hasCells=levels.some(level=>level.cells.length>0);

  function tile(cell:ManagedCell,index:number,width?:number){
    const status=managedCellState(cell,hasPeriod,rackAvailable);
    const tone=statuses[status.kind];
    const selected=selectedIds.has(cell._id);
    const inspected=inspectedId===cell._id;
    return <Pressable key={cell._id} accessibilityRole="button" accessibilityLabel={'Xem ô '+cell.code}
      accessibilityHint={status.label+(selected?', đã chọn':'')+'. Mở chi tiết ô lưu trữ.'}
      accessibilityState={{selected}}
      onPress={()=>onInspect(cell._id,index)}
      style={({pressed})=>[styles.tile,width===undefined?styles.listTile:{width},
        {backgroundColor:tone.background,borderColor:selected?colors.primary:tone.ink},
        selected&&styles.selected,inspected&&styles.inspected,pressed&&styles.pressed]}>
      <AppText variant="label" numberOfLines={2} style={{color:tone.ink,textAlign:'center'}}>{cell.code}</AppText>
      <AppText variant="caption" style={{color:tone.ink,textAlign:'center'}}>{tone.label}</AppText>
      {selected&&<AppText variant="caption" style={styles.picked}>✓ Đã chọn</AppText>}
      {inspected&&<AppText variant="caption" style={styles.picked}>Đang xem</AppText>}
    </Pressable>;
  }

  if(!hasCells)return <AppText>Chưa có ô trong kệ này.</AppText>;
  return <View style={styles.panel}>
    <View style={ui.wrap}>
      {Object.values(statuses).map(({label,background,ink})=><View key={label} style={styles.legendItem}>
        <View style={[styles.swatch,{backgroundColor:background,borderColor:ink}]}/>
        <AppText variant="caption">{label}</AppText>
      </View>)}
    </View>
    {layout?<><View style={styles.toolbar}>
      <AppText variant="label" style={styles.toolbarTitle}>Mặt đứng kệ</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel="Thu nhỏ sơ đồ" accessibilityState={{disabled:zoom===0}}
        disabled={zoom===0} onPress={()=>setZoom(value=>Math.max(value-1,0))} style={[styles.zoom,zoom===0&&styles.disabled]}>
        <Icon name="remove" size={20}/>
      </Pressable>
      <AppText variant="label" accessibilityLiveRegion="polite">{size.label}</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel="Phóng to sơ đồ" accessibilityState={{disabled:zoom===zoomSteps.length-1}}
        disabled={zoom===zoomSteps.length-1} onPress={()=>setZoom(value=>Math.min(value+1,zoomSteps.length-1))}
        style={[styles.zoom,zoom===zoomSteps.length-1&&styles.disabled]}>
        <Icon name="add" size={20}/>
      </Pressable>
    </View>
    <ScrollView horizontal style={styles.viewport} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.frame}>
        {layout.rows.map(row=><View key={row.levelNumber} style={[styles.row,row.index===levelIndex&&styles.currentRow]}>
          <AppText variant="label" style={styles.level}>Tầng {row.levelNumber}</AppText>
          {Array.from({length:layout.columns},(_,index)=>{
            const cell=row.byPosition.get(index+1);
            return cell?tile(cell,row.index,size.width):<View key={'gap-'+index} style={[styles.gap,{width:size.width}]}/>;
          })}
        </View>)}
      </View>
    </ScrollView>
    <AppText variant="caption">Vuốt ngang để xem toàn kệ. Chạm vào ô để xem chi tiết.</AppText>
    </>:<>
      <AppText variant="caption">Chưa xác minh được vị trí trên kệ. Danh sách ô chỉ dùng để xem chi tiết.</AppText>
      {levels.map((level,index)=>level.cells.length>0&&<View key={index} style={styles.panel}>
        <AppText variant="label">{level.levelNumber==null?'Nhóm ô '+(index+1):'Tầng '+level.levelNumber}</AppText>
        {level.cells.map(cell=>tile(cell,index))}
      </View>)}
    </>}
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:10,minWidth:0},
  legendItem:{flexDirection:'row',gap:5,alignItems:'center',backgroundColor:colors.soft,paddingHorizontal:6,paddingVertical:4,borderRadius:radius.pill},
  swatch:{width:12,height:12,borderWidth:1,borderRadius:3},
  toolbar:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:colors.mint,borderRadius:radius.sm,paddingHorizontal:8},
  toolbarTitle:{flex:1,color:colors.primary},
  zoom:{width:44,height:44,justifyContent:'center',alignItems:'center'},
  disabled:{opacity:.4},
  viewport:{width:'100%',flexGrow:0},
  scrollContent:{padding:2},
  frame:{backgroundColor:colors.surfaceHigh,borderRadius:radius.sm,borderWidth:1,borderColor:colors.inactive,padding:4,gap:4},
  row:{flexDirection:'row',alignItems:'stretch',gap:4,backgroundColor:colors.soft,borderRadius:radius.sm,padding:3},
  currentRow:{backgroundColor:colors.mint},
  level:{width:50,alignSelf:'center',textAlign:'center',color:colors.deep},
  tile:{minHeight:72,flexShrink:0,justifyContent:'center',alignItems:'center',padding:4,gap:2,borderRadius:radius.sm,borderWidth:1},
  listTile:{width:'100%'},
  selected:{borderWidth:3},
  inspected:{borderStyle:'dashed',borderWidth:2},
  pressed:{opacity:.8},
  picked:{color:colors.deep,fontWeight:'700'},
  gap:{minHeight:72},
});
