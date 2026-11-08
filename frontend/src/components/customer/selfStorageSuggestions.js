const objectId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export function selfStorageAlternatives(error,excludedId) {
  const rows=error?.response?.status===409?error.response.data?.suggestedUnits:null;
  if(!Array.isArray(rows)||rows.length>5)return [];
  const seen=new Set();
  return rows.filter(row=>{
    if(!objectId(row?._id)||row._id.toLowerCase()===String(excludedId).toLowerCase()||seen.has(row._id.toLowerCase())||typeof row.unitCode!=='string'||!row.unitCode.trim()||row.unitCode.length>100||!['SMALL','MEDIUM','LARGE'].includes(row.size)||typeof row.sameSize!=='boolean')return false;
    seen.add(row._id.toLowerCase());return true;
  }).map(({_id,unitCode,size,sameSize})=>({_id,unitCode,size,sameSize}));
}
