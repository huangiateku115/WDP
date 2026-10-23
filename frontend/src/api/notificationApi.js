import axiosClient from "./axiosClient";

// Personal notification inbox. The backend exposes the current user's own notifications
// for every authenticated role (GET /notifications/me, PATCH /notifications/:id/read),
// so BOM and Admin use the same endpoints as the customer portal.
const encode = (id) => encodeURIComponent(id);

export const notificationApi = {
  list: (config) => axiosClient.get("/notifications/me", config),
  markRead: (id) => axiosClient.patch(`/notifications/${encode(id)}/read`),
};

export default notificationApi;
