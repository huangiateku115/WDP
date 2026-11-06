import axiosClient from "./axiosClient";
import { createPayosPaymentApi } from "./payosPaymentClient";

const payosPaymentApi = createPayosPaymentApi(axiosClient);

export default payosPaymentApi;
