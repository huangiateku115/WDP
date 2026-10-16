import {useEffect,useId,useLayoutEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {weightText,measurementText} from '@/lib/warehouseMap';
import {cellTilePresentation,cellWeightUsageText} from '@/lib/managedBookingDisplay';

export function WarehouseStatus({status}) {
  const kind=['AVAILABLE','BLOCKED','MAINTENANCE','RESERVED','OCCUPIED'].includes(status)?status.toLowerCase():'unknown';
  return <span className={`wm-status wm-${kind}`}>{status||'Not returned'}</span>;
}
export function CellInformation({cell,level,rack,requestedPeriod=false}) {
  const fields=[['Zone',rack.zoneCode],['Aisle',rack.aisleCode],['Rack',rack.rackCode],['Level',level.levelNumber],['Cell',cell.cellNumber],['Maximum capacity',cell.maxWeightKg==null?null:weightText(cell.maxWeightKg)],['Current usage',cell.maxWeightKg==null?null:cellWeightUsageText(cell.usedWeightKg,cell.maxWeightKg,cell.physicalUsageKnown!==false)],['Width',cell.dimensions?.widthM==null?null:measurementText(cell.dimensions.widthM)],['Depth',cell.dimensions?.depthM==null?null:measurementText(cell.dimensions.depthM)],['Usable clearance',cell.dimensions?.usableHeightM==null?null:measurementText(cell.dimensions.usableHeightM)],['Utilization',cell.utilizationStatus],['Current booking status',cell.bookingStatus],...(requestedPeriod?[['Requested-period status',cell.periodStatus]]:[]),['Remaining weight',cell.remainingWeightKg==null?null:weightText(cell.remainingWeightKg)],['Used volume',cell.physicalUsageKnown===false?'Unknown':cell.usedVolumeM3==null?null:`${cell.usedVolumeM3} m³`],['Remaining volume',cell.remainingVolumeM3==null?null:`${cell.remainingVolumeM3} m³`]];
  return <><div className="wm-info-heading"><strong>{cell.code||`Cell C${cell.cellNumber}`}</strong><WarehouseStatus status={cell.displayStatus||cell.operationalStatus}/></div><dl className="wm-definition">{fields.filter(([,value])=>value!==undefined&&value!==null).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>;
}
export default function WarehouseCells({data,selected,onSelect,query,booking,myInventoryOnly=false}) {
  const [hover,setHover]=useState(null),[position,setPosition]=useState({left:12,top:12}),id=useId();
  useEffect(()=>{if(!selected)setHover(null);},[selected?.cell._id]);
  useLayoutEffect(()=>{
    if(!hover)return;
    const place=()=>{const anchor=hover.anchor;if(!anchor.isConnected){setHover(null);return;}const rect=anchor.getBoundingClientRect(),width=Math.min(288,innerWidth-24),height=document.getElementById(id)?.getBoundingClientRect().height||350;let left=rect.right+12;if(left+width>innerWidth-12)left=rect.left-width-12;setPosition({left:Math.max(12,Math.min(left,innerWidth-width-12)),top:Math.max(12,Math.min(rect.top,innerHeight-height-12))});};
    const escape=e=>{if(e.key==='Escape')setHover(null);};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);window.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.removeEventListener('keydown',escape);};
  },[hover,id]);
  const levels=[...data.levels].sort((a,b)=>b.levelNumber-a.levelNumber),context=[data.rack.rackCode,data.rack.zoneCode,data.rack.aisleCode].join(' ').toLowerCase(),q=query.trim().toLowerCase();
  return <section className="wm-cell-area" aria-label="Rack levels and cells"><div className="wm-section-heading"><div><small>RACK STRUCTURE</small><h3>{data.rack.rackCode}</h3></div><span>{data.levels.reduce((n,l)=>n+l.cells.length,0)} returned cells</span></div>
    {!levels.some(l=>l.cells.length)&&<p>No cells are configured for this rack.</p>}
    {levels.map(level=>{const cells=[...level.cells].sort((a,b)=>a.cellNumber-b.cellNumber).filter(c=>!q||context.includes(q)||String(c.code||`C${c.cellNumber}`).toLowerCase().includes(q));return <div className="wm-level" key={level.levelNumber}><h4>Level {level.levelNumber}</h4><div className="wm-cell-row">{cells.map(cell=>{const tile=cellTilePresentation(cell),selectedForBooking=booking?.selectedCellIds?.includes(cell._id),dimmed=myInventoryOnly&&!cell.isMine&&!cell.hasMyInventory;return <button type="button" key={cell._id} disabled={!!booking&&!cell.isBookable&&!selectedForBooking} className={`wm-cell wm-${tile.status.toLowerCase()} ${selected?.cell._id===cell._id?'is-selected':''} ${selectedForBooking?'is-booking-selected':''} ${dimmed?'is-dimmed':''}`} aria-pressed={booking?!!selectedForBooking:selected?.cell._id===cell._id} aria-label={`${booking?(selectedForBooking?'Remove':'Select'):'Inspect'} ${cell.code||`Cell C${cell.cellNumber}`}, Level ${level.levelNumber}, ${tile.status}, ${tile.requestedPeriodStatus}`} aria-describedby={hover?.cell._id===cell._id?id:undefined} data-cell-number={cell.cellNumber}
      onPointerEnter={e=>{if(e.pointerType==='mouse')setHover({cell,level,anchor:e.currentTarget});}} onPointerLeave={()=>setHover(current=>selected?.cell._id===current?.cell._id?current:null)} onFocus={e=>setHover({cell,level,anchor:e.currentTarget})} onBlur={()=>setHover(null)} onClick={e=>{onSelect({cell,level});if(!booking)setHover(innerWidth<1200?null:{cell,level,anchor:e.currentTarget});}}>
      <span className="wm-cell-code">{cell.code||`C${cell.cellNumber}`}</span><span>{tile.status}</span><small>{tile.weightUsage}</small>{tile.volume&&<small>{tile.volume}</small>}
    </button>})}</div>{!cells.length&&level.cells.length>0&&<p className="wm-muted">No loaded cells match this search.</p>}</div>;})}
    {hover&&createPortal(<div id={id} role="tooltip" className="warehouse-cell-tooltip" style={{...position,width:'min(288px, calc(100vw - 24px))'}}><CellInformation cell={hover.cell} level={hover.level} rack={data.rack} requestedPeriod={!!booking?.startDate&&!!booking?.endDate}/></div>,document.fullscreenElement||document.body)}
  </section>;
}
