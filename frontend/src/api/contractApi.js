import axiosClient from "./axiosClient";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const contractApi = {
  detailReal: (id,config)=>axiosClient.get(`/contracts/${encodeURIComponent(id)}`,config),
  byReservationReal: (reservationId,config)=>axiosClient.get(`/contracts/reservation/${encodeURIComponent(reservationId)}`,config),
  mineReal: config=>axiosClient.get('/contracts/me',config),
  // Backend contract.routes/controller confirm PATCH, no request body, owner + DRAFT.
  signReal: id=>axiosClient.patch(`/contracts/${encodeURIComponent(id)}/sign`),
  signFacilityReal: id=>axiosClient.patch(`/contracts/${encodeURIComponent(id)}/sign/facility`),
  getByReservation: async (reservationId) => {
    if (USE_MOCK) {
      await delay();
      return {
        data: {
          id: `CONTRACT-${reservationId}`,
          contractNumber: `VS-C-${reservationId.replace("RES-", "").slice(-6)}`,
          reservationId,
          status: "AWAITING_SIGNATURE",
          terms: [
            "The customer agrees to use the storage only for lawful purposes.",
            "Hazardous, illegal, explosive, flammable or prohibited goods may not be stored.",
            "Rental fees must be paid according to the agreed billing schedule.",
            "The customer must comply with SelfStorage facility policies.",
            "Storage access is subject to the selected service model and facility rules.",
          ],
        },
      };
    }
    return axiosClient.get(`/contracts/reservation/${reservationId}`);
  },

  sign: async (contractId, payload) => {
    if (USE_MOCK) {
      await delay(600);
      const signed = {
        id: contractId,
        status: "SIGNED",
        signedBy: payload.signedBy,
        signedAt: new Date().toISOString(),
      };
      sessionStorage.setItem(`contract_${contractId}`, JSON.stringify(signed));
      return { data: signed };
    }
    return axiosClient.patch(`/contracts/${contractId}/sign`);
  },
};

export default contractApi;
