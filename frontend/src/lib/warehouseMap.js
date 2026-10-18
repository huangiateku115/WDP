const id = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const coordinate = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {throw Error('The warehouse response is invalid. Please retry; no layout has been substituted.');};

// displayStatus/bookingStatus describe now; periodStatus describes the requested interval.
// Ownership and inventory membership are annotations, never evidence of physical occupancy.
export function cellPeriodStatus(cell){
  if(['RESERVED','OCCUPIED'].includes(cell?.periodStatus))return cell.periodStatus;
  if(cell?.periodStatus!=='AVAILABLE')return 'UNKNOWN';
  if(cell.isBookable===false)return 'UNAVAILABLE';
  if(cell.isBookable!==true||cell.operationalStatus!=='AVAILABLE'||cell.physicalUsageKnown!==true||cell.usedWeightKg!==0||cell.usedVolumeM3!==0)return 'UNKNOWN';
  return 'AVAILABLE';
}

export function validateWarehouseMap(data, facilityId) {
  if (!object(data) || !id(data.facilityId) || data.facilityId.toLowerCase() !== facilityId.toLowerCase() || !Array.isArray(data.zones)) invalid();
  for (const zone of data.zones) {
    if (!object(zone) || !id(zone._id) || !Array.isArray(zone.aisles)) invalid();
    const positions = new Set();
    for (const aisle of zone.aisles) {
      if (!object(aisle) || typeof aisle.aisleCode !== 'string' || !Array.isArray(aisle.racks)) invalid();
      for (const rack of aisle.racks) {
        if (!object(rack) || !id(rack._id) || !coordinate(rack.mapX) || !coordinate(rack.mapY) || ![0,90,180,270].includes(rack.orientation)) invalid();
        const position = `${rack.mapX}:${rack.mapY}`;
        if (positions.has(position)) invalid();
        positions.add(position);
      }
    }
  }
  return data;
}

export function validateRackDetail(data, facilityId, rackId) {
  if (!object(data) || !object(data.rack) || !object(data.capacity) || !Array.isArray(data.levels) || !id(data.rack._id) || !id(data.rack.facilityId) || data.rack._id.toLowerCase() !== rackId.toLowerCase() || data.rack.facilityId.toLowerCase() !== facilityId.toLowerCase()) invalid();
  const numbers = new Set();
  for (const level of data.levels) {
    if (!object(level) || !Number.isSafeInteger(level.levelNumber) || level.levelNumber < 1 || numbers.has(level.levelNumber) || !Array.isArray(level.cells)) invalid();
    numbers.add(level.levelNumber);
    const cells = new Set();
    for (const cell of level.cells) {
      if (!object(cell) || !id(cell._id) || !Number.isSafeInteger(cell.cellNumber) || cell.cellNumber < 1 || cells.has(cell.cellNumber)) invalid();
      cells.add(cell.cellNumber);
    }
  }
  return data;
}

// Preserve gaps at ordinary coordinates without allocating an array up to mapX/mapY.
// Very large empty spans are explicitly condensed to keep the map navigable.
export function warehouseAxis(values) {
  const sorted = [...new Set(values)].sort((a,b) => a-b), positions = new Map();
  let track = 1, condensed = false;
  sorted.forEach((value,index) => {
    if (index) {
      const gap = value-sorted[index-1]-1;
      track += Math.min(gap,8);
      if (gap > 8) condensed = true;
    }
    positions.set(value,track++);
  });
  return {positions, count:Math.max(1,track-1), condensed};
}

export const weightText = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toLocaleString()} kg` : 'Not returned';
export const measurementText = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value} m` : 'Not returned';
