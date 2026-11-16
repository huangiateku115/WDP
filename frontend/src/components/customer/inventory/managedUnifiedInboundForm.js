const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export function createUnifiedInboundLine(specification, cellId, lineId) {
  const specId = specification && typeof specification === 'object' ? String(specification._id ?? specification.id ?? '') : String(specification || '');
  const revisionValue = specification && typeof specification === 'object' ? Number(specification.revision) : 0;
  return { lineId, itemSpecId: specId, itemSpecRevision: Number.isSafeInteger(revisionValue) && revisionValue >= 0 ? revisionValue : 0,
    quantity: 1, measurementMode: 'SPECIFICATION', cellAllocations: cellId ? [{ cellId, quantity: 1 }] : [], indivisible: false, instanceAllocations: [] };
}

export function refreshUnifiedInboundLines(lines, specifications, defaultCellId) {
  const current = Array.isArray(lines) ? lines : [], available = Array.isArray(specifications) ? specifications : [];
  if (current.length === 1 && !current[0].itemSpecId && available[0]) {
    return [createUnifiedInboundLine(available[0], defaultCellId, current[0].lineId)];
  }
  return current.map(line => {
    const specification = available.find(row => String(row?._id ?? row?.id ?? '') === line.itemSpecId);
    return specification ? { ...line, itemSpecRevision: Number(specification.revision) } : line;
  });
}

export function buildUnifiedInboundPayload({ accessSessionId, sessionRevision, skuRevision, lines }) {
  const errors = {};
  if (!accessSessionId) errors.accessSessionId = 'Chọn phiên đến kho đang hoạt động.';
  if (!Number.isSafeInteger(sessionRevision) || sessionRevision < 0) errors.sessionRevision = 'Phiên đến kho cần được tải lại.';
  if (!Number.isSafeInteger(skuRevision) || skuRevision < 0) errors.skuRevision = 'SKU cần được tải lại.';
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) errors.lines = 'Cần từ 1 đến 50 dòng hàng.';
  const normalized = (lines || []).map((line, index) => {
    const prefix = `lines.${index}`;
    const quantity = Number(line.quantity);
    if (!line.itemSpecId) errors[`${prefix}.itemSpecId`] = 'Chọn Item Specification.';
    if (!Number.isSafeInteger(quantity) || quantity < 1) errors[`${prefix}.quantity`] = 'Số lượng phải là số nguyên dương.';
    const cells = (line.cellAllocations || []).map(row => ({ cellId: row.cellId, quantity: Number(row.quantity) }));
    if (line.indivisible) {
      const instanceAllocations = (line.instanceAllocations || []).map(row => ({ cellId: row.cellId, weightKg: Number(row.weightKg), volumeM3: Number(row.volumeM3) }));
      if (quantity !== 1 || instanceAllocations.length < 2 || instanceAllocations.some(row => !row.cellId || !positive(row.weightKg) || !positive(row.volumeM3))) errors[`${prefix}.instanceAllocations`] = 'Món nguyên khối cần quantity 1 và phần tải hợp lệ cho ít nhất hai ô.';
      if (new Set(instanceAllocations.map(row => row.cellId)).size !== instanceAllocations.length) errors[`${prefix}.instanceAllocations`] = 'Không được lặp ô kệ trong phần tải.';
      return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: Number(line.itemSpecRevision), quantity, measurementMode: line.measurementMode,
        ...(line.measurementMode === 'MEASURED' ? { actualUnitWeightKg: Number(line.actualUnitWeightKg), dimensionsM: { widthM: Number(line.dimensionsM?.widthM), depthM: Number(line.dimensionsM?.depthM), heightM: Number(line.dimensionsM?.heightM) } } : {}),
        cellAllocations: cells, instanceAllocations };
    }
    if (!cells.length || cells.some(row => !row.cellId || !Number.isSafeInteger(row.quantity) || row.quantity < 1) || cells.reduce((sum, row) => sum + row.quantity, 0) !== quantity) errors[`${prefix}.cellAllocations`] = 'Tổng phân bổ theo ô phải bằng số lượng dòng.';
    if (new Set(cells.map(row => row.cellId)).size !== cells.length) errors[`${prefix}.cellAllocations`] = 'Không được lặp ô kệ trong cùng dòng.';
    if (line.measurementMode === 'MEASURED' && (!positive(Number(line.actualUnitWeightKg)) || ![line.dimensionsM?.widthM, line.dimensionsM?.depthM, line.dimensionsM?.heightM].every(value => positive(Number(value))))) errors[`${prefix}.measurements`] = 'Nhập khối lượng và kích thước thực tế hợp lệ.';
    return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: Number(line.itemSpecRevision), quantity, measurementMode: line.measurementMode,
      ...(line.measurementMode === 'MEASURED' ? { actualUnitWeightKg: Number(line.actualUnitWeightKg), dimensionsM: { widthM: Number(line.dimensionsM?.widthM), depthM: Number(line.dimensionsM?.depthM), heightM: Number(line.dimensionsM?.heightM) } } : {}), cellAllocations: cells };
  });
  return { errors, payload: { accessSessionId, sessionRevision, skuRevision, lines: normalized } };
}
