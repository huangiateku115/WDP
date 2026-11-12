import client from "./axiosClient";
const id = (value) => encodeURIComponent(value);
export const customerReviewApi = {
  list: (config) => client.get("/customers", config),
  detail: (profileId, config) =>
    client.get(`/customers/${id(profileId)}`, config),
  verify: (profileId, status, note) =>
    client.patch(`/customers/${id(profileId)}/verify`, { status, note }),
};
export const facilityReservationApi = {
  list: (facilityId, config = {}) =>
    client.get(`/reservations/facility/${id(facilityId)}`, config),

  listManaged: (facilityId, config = {}) =>
    client.get(`/reservations/facility/${id(facilityId)}`, {
      ...config,
      params: {
        ...config.params,
        serviceType: "MANAGED_INVENTORY",
      },
    }),

  detail: (reservationId, managed, config) =>
    client.get(
      `/reservations/${managed ? "managed/" : ""}${id(reservationId)}`,
      config,
    ),
  decide: (reservationId, managed, decision, reason) =>
    client.patch(
      `/reservations/${managed ? "managed/" : ""}${id(reservationId)}/${decision}`,
      decision === "reject" ? { reason } : {},
    ),
};
