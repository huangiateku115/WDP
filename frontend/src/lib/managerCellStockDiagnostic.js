const id = value => String(value?._id ?? value?.id ?? value ?? '');

export function validateCellStockResponse(response, cellId, facilityId) {
  const payload = response?.data?.data;
  if (response?.data?.success !== true || !payload) throw Error('Backend chưa trả dữ liệu đối soát cho Cell này.');
  if (id(payload.cellId) !== id(cellId) || id(payload.facilityId) !== id(facilityId)) {
    throw Error('Đối soát trả về dữ liệu ngoài phạm vi Facility được phân công.');
  }
  return payload;
}

export function cellStockDiagnosticError(cause) {
  if (cause?.response?.status === 403) return 'Tài khoản hiện tại không có quyền xem đối soát tồn kho của Facility.';
  if (cause?.response?.status === 404) return 'Không tìm thấy Cell trong Facility được phân công.';
  return cause?.response?.data?.message || cause?.message || 'Không thể tải dữ liệu đối soát Cell.';
}

export function cellStockDiagnosticState({ loading = false, error = '', data = null } = {}) {
  if (loading) return 'LOADING';
  if (error) return 'ERROR';
  if (!data) return 'UNKNOWN';
  const diagnostic = data.diagnostics;
  if (diagnostic?.evidenceStatus !== 'COMPLETE' || diagnostic.ledger?.status === 'UNKNOWN' ||
      diagnostic.projection?.status === 'UNKNOWN' || !Number.isFinite(diagnostic.counter?.weightKg) || !Number.isFinite(diagnostic.counter?.volumeM3)) return 'UNKNOWN';
  if (data.reconciliationStatus === 'MISMATCH' || diagnostic.ledger?.status === 'MISMATCH' || diagnostic.projection?.status === 'MISMATCH') return 'MISMATCH';
  return 'READY';
}
