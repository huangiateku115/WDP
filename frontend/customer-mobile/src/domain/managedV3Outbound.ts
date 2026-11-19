export type OutboundSpecInput={itemSpecId:string;revision:number;quantityAvailable:number;stockKind?:string};
export type OutboundPreviewLine={sources?:Array<{cellId:string}>};

export function buildManagedOutboundLine(spec:OutboundSpecInput,rawQuantity:string|number,lineId='line-1'){
  if(spec.stockKind==='MIXED_UNSUPPORTED')throw new Error('Loại hàng đang có hình thức tồn chưa thể xử lý an toàn.');
  if(spec.stockKind==='ITEM_INSTANCE')throw new Error('Hãy chọn từng nguyên món cần xuất.');
  const quantity=typeof rawQuantity==='number'?rawQuantity:Number(rawQuantity);
  if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error('Số lượng phải là số nguyên dương theo đơn vị hàng hóa.');
  if(!Number.isSafeInteger(spec.quantityAvailable)||spec.quantityAvailable<0||quantity>spec.quantityAvailable)
    throw new Error('Số lượng vượt tồn khả dụng đã xác minh.');
  return {lineId,itemSpecId:spec.itemSpecId,itemSpecRevision:spec.revision,quantity};
}

export function managedOutboundPreviewSourceCells(lines:OutboundPreviewLine[],allowedCellIds:string[]){
  const sourceIds=Array.from(new Set(lines.flatMap(line=>(line.sources??[]).map(source=>source.cellId))));
  if(!sourceIds.length||sourceIds.some(cellId=>!allowedCellIds.includes(cellId)))
    throw new Error('Phiên hiện tại không bao gồm các ô nguồn được phân bổ. Hãy chọn phiên phù hợp.');
  return sourceIds;
}
