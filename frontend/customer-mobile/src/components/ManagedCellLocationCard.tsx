import type {ManagedCellLocation} from '../api/managedInventory';
import {AppText,Card} from './ui';

export function ManagedCellLocationCard({location,cellId,title,detail}:{location?:ManagedCellLocation;cellId?:string;title?:string;detail?:string}){
  return <Card style={{padding:12,gap:3}}>
    {!!title&&<AppText variant="label">{title}</AppText>}
    <AppText>Kệ {location?.rackCode??'Đang xác định'}</AppText>
    <AppText>Tầng {location?.levelNumber??'—'}</AppText>
    <AppText>Ô {location?.cellNumber!=null?`L${location.levelNumber??'—'}-C${location.cellNumber}`:location?.cellCode??(cellId?.slice(-6)??'Chưa xác minh')}</AppText>
    {!!detail&&<AppText variant="caption">{detail}</AppText>}
    {!!location?.cellCode&&<AppText variant="caption">Mã vị trí · {location.cellCode}</AppText>}
  </Card>;
}
