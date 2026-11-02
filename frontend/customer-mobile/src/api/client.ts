import axios,{AxiosError} from 'axios';

// Deliberately no base URL or credentials. Both reads and writes fail before
// transport, even when a caller supplies a custom adapter. Screens use fixtures.
export const apiClient=axios.create({timeout:10000});
apiClient.interceptors.request.use(config=>{
  throw new AxiosError('Kết nối máy chủ chưa được bật trong giai đoạn 1.','PHASE1_OFFLINE',config);
});
