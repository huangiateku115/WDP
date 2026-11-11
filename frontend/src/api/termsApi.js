import client from './axiosClient';

const params = (serviceType, config = {}) => ({ ...config, params: { ...config.params, serviceType }, skipAuth: true });
export const termsApi = {
  list: (serviceType, config) => client.get('/public/terms', params(serviceType, config)),
  current: (serviceType, config) => client.get('/public/terms/current', params(serviceType, config)),
  version: (serviceType, version, config) => client.get(`/public/terms/${encodeURIComponent(version)}`, params(serviceType, config)),
};
