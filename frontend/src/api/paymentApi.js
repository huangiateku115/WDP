import axiosClient from "./axiosClient";
import { createPayosPaymentApi } from "./payosPaymentClient";

const payosPaymentApi = createPayosPaymentApi(axiosClient);
export const reconcilePayosPayment = (...args) => payosPaymentApi.reconcilePayosPayment(...args);

export default payosPaymentApi;
