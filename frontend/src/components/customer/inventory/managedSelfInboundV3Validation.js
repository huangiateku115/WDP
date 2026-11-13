const positiveFinite = value => Number.isFinite(Number(value)) && Number(value) > 0;

export function buildA2InboundPayload({ sessionId, sessionRevision, selectedCells, quantities, quantity, quantityUnit, weight, dimensions }) {
  const placements = selectedCells.map(cellId => ({ cellId, quantity: Number(quantities[cellId] ?? 0) })).filter(line => line.quantity > 0);
  const totalQuantity = placements.reduce((sum, line) => sum + line.quantity, 0);
  return {
    payload: {
      itemKind: 'A2_BATCH', accessSessionId: sessionId, sessionRevision, cellIds: selectedCells,
      quantity: totalQuantity, quantityUnit, actualUnitWeightKg: Number(weight),
      dimensionsM: { widthM: Number(dimensions.widthM), depthM: Number(dimensions.depthM), heightM: Number(dimensions.heightM) },
      placements,
    },
    errors: {
      ...(!sessionId ? { accessSessionId: 'Chọn phiên đến kho còn hiệu lực.' } : {}),
      ...(!selectedCells.length ? { cellIds: 'Chọn ít nhất một ô kệ đã được phân bổ.' } : {}),
      ...(!Number.isInteger(Number(quantity)) || Number(quantity) < 1 ? { quantity: 'Số lượng phải là số nguyên lớn hơn 0.' } : {}),
      ...(!Number.isInteger(totalQuantity) || totalQuantity < 1 ? { placements: 'Nhập số lượng nguyên lớn hơn 0 cho từng ô kệ.' } : {}),
      ...(totalQuantity !== Number(quantity) ? { placementsTotal: 'Tổng số lượng tại các ô kệ phải bằng số lượng dự kiến.' } : {}),
      ...(!positiveFinite(weight) ? { actualUnitWeightKg: 'Khối lượng mỗi đơn vị phải lớn hơn 0.' } : {}),
      ...(!positiveFinite(dimensions.widthM) ? { 'dimensionsM.widthM': 'Chiều rộng phải lớn hơn 0.' } : {}),
      ...(!positiveFinite(dimensions.depthM) ? { 'dimensionsM.depthM': 'Chiều sâu phải lớn hơn 0.' } : {}),
      ...(!positiveFinite(dimensions.heightM) ? { 'dimensionsM.heightM': 'Chiều cao phải lớn hơn 0.' } : {}),
    },
  };
}

const errorMessages = {
  INVALID_INPUT: 'Dữ liệu nhập chưa đúng định dạng. Kiểm tra số lượng, khối lượng, kích thước và phân bổ theo từng ô kệ.',
  CAPACITY_EXCEEDED: 'Hàng vượt quá sức chứa của ô kệ. Hãy giảm số lượng hoặc chọn ô kệ khác.',
  LEVEL_CAPACITY_EXCEEDED: 'Hàng vượt quá sức chịu tải của tầng kệ. Hãy giảm tải hoặc chọn vị trí khác.',
  ACCESS_SESSION_SCOPE_INVALID: 'Phiên đến kho không bao gồm ô kệ đã chọn hoặc không còn hợp lệ. Hãy tải lại phiên và vị trí.',
  TOPOLOGY_INVALID: 'Cấu trúc kho chưa hợp lệ để kiểm tra vị trí. Hãy tải lại sơ đồ hoặc liên hệ nhân viên kho.',
  TOPOLOGY_UNCERTIFIED: 'Vị trí chưa có xác nhận cấu trúc kho cần thiết để kiểm tra.',
};

export function inboundErrorMessage(error) {
  const data = error?.response?.data;
  const code = data?.code || data?.errorCode || data?.error?.code;
  if (typeof code === 'string' && (code.startsWith('TOPOLOGY_') || code.includes('_TOPOLOGY_'))) return errorMessages.TOPOLOGY_INVALID;
  return errorMessages[code] || data?.message || error?.message || 'Không thể hoàn tất yêu cầu. Hãy tải lại dữ liệu.';
}

export function inboundFieldErrors(error) {
  const source = error?.response?.data?.errors || error?.response?.data?.details?.errors || error?.response?.data?.details;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value]));
}
