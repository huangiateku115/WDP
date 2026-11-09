import type {ManagedRackLevel} from '../api/managedInventory';

// WarehouseRack schema limits both axes to 20. Keep rendering bounded for malformed data.
const limit=20;
const position=(value:number|null|undefined):value is number=>
  typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=limit;

export function warehouseRackLayout(levels:ManagedRackLevel[],cellsPerLevel?:number){
  const numbers=levels.map(level=>level.levelNumber);
  if(levels.length>limit||!numbers.every(position)||new Set(numbers).size!==levels.length)return null;
  if(cellsPerLevel!==undefined&&!position(cellsPerLevel))return null;

  let lastPosition=0;
  const rows=levels.map((level,index)=>{
    const byPosition=new Map<number,ManagedRackLevel['cells'][number]>();
    for(const cell of level.cells){
      if(!position(cell.cellNumber)||byPosition.has(cell.cellNumber)||
        (cellsPerLevel!==undefined&&cell.cellNumber>cellsPerLevel))return null;
      byPosition.set(cell.cellNumber,cell);
      lastPosition=Math.max(lastPosition,cell.cellNumber);
    }
    return {index,levelNumber:numbers[index]!,byPosition};
  });
  if(!rows.every(row=>row!==null))return null;
  return {columns:cellsPerLevel??lastPosition,rows:rows.sort((a,b)=>b.levelNumber-a.levelNumber)};
}
