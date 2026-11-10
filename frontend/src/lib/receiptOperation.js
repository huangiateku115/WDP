const kinds = ['inspection', 'confirm', 'return'];
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export function receiptOperation(kind, request, payload) {
  const operation = {
    kind, requestId: request._id, version: request.version,
    payload: JSON.parse(JSON.stringify(payload)),
  };
  return validateReceiptOperation(operation, request._id);
}

export function validateReceiptOperation(operation, requestId) {
  if (!operation || !kinds.includes(operation.kind) || !validId(requestId) || operation.requestId !== requestId ||
      !Number.isSafeInteger(operation.version) || operation.version < 0 || !operation.payload || typeof operation.payload !== 'object') {
    throw Error('The saved receipt operation cannot be verified. Reconcile this request before submitting again.');
  }
  const key = operation.kind === 'inspection' ? operation.payload.inspectionKey : operation.payload.idempotencyKey;
  if (typeof key !== 'string' || !key.trim()) throw Error('The saved receipt operation is missing its original key.');
  return operation;
}
