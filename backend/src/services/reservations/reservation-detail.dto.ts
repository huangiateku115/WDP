export function reservationDetailDto(reservation: any) {
  const row = reservation && typeof reservation.toObject === 'function' ? reservation.toObject() : { ...reservation };
  return { ...row, allocatedCapacity: row.allocatedCapacity ?? null, expiresAt: row.expiresAt ?? null, rejectReason: row.rejectReason ?? null };
}
