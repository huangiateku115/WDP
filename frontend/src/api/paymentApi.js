import axiosClient from "./axiosClient";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const paymentApi = {
  createPayment: async (payload) => {
    if (USE_MOCK) {
      await delay();
      const payment = {
        id: `PAY-${Date.now()}`,
        reservationId: payload.reservationId,
        amount: payload.amount,
        status: "PENDING",
        provider: "PAYOS",
        qrCode: "MOCK-PAYOS-QR",
        checkoutUrl: null,
      };
      sessionStorage.setItem(`payment_${payment.id}`, JSON.stringify(payment));
      return { data: payment };
    }
    return axiosClient.post("/payments/payos/create", payload);
  },

  getStatus: async (paymentId) => {
    if (USE_MOCK) {
      await delay(250);
      const saved = sessionStorage.getItem(`payment_${paymentId}`);
      return { data: saved ? JSON.parse(saved) : null };
    }
    return axiosClient.get(`/payments/${paymentId}/status`);
  },

  simulateSuccess: async (paymentId) => {
    if (!USE_MOCK) throw new Error("Mock only");
    await delay();
    const key = `payment_${paymentId}`;
    const saved = sessionStorage.getItem(key);
    if (!saved) throw new Error("Payment not found");
    const updated = { ...JSON.parse(saved), status: "PAID", paidAt: new Date().toISOString() };
    sessionStorage.setItem(key, JSON.stringify(updated));
    return { data: updated };
  },
};

export default paymentApi;
