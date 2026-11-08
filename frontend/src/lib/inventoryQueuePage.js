export function inventoryQueuePage(response, requestedPage) {
  const value = response?.data?.data;
  const pagination = value?.pagination;
  if (response?.data?.success !== true || !Array.isArray(value?.data) ||
      pagination?.page !== requestedPage || !Number.isSafeInteger(pagination.total) || pagination.total < 0 ||
      !Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0 ||
      !Number.isSafeInteger(pagination.limit) || pagination.limit <= 0 ||
      pagination.totalPages !== Math.ceil(pagination.total / pagination.limit)) {
    throw Error('The queue pagination response could not be verified. Refresh the queue.');
  }
  return value;
}
