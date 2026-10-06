import axiosClient from "./axiosClient";
import userApi from "./userApi";

const authApi = {
  login: async ({ email, password }) => {
    return axiosClient.post("/auth/login", { email, password }, {skipAuth:true});
  },

  register: async ({email, password, displayName, phone}) => {
    return axiosClient.post("/users/register", {email, password, displayName, phone}, {skipAuth:true});
  },

  logout: async ({refreshToken}) => axiosClient.post("/auth/logout", {refreshToken}),

  me: async (config) => {
    return userApi.getMe(config);
  },
};

export default authApi;
