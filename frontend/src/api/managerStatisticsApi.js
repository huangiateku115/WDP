import client from './axiosClient';
import {statisticsReports,exportReports} from '@/lib/managerStatistics';
export const managerStatisticsApi={
 filters:(facilityId,signal)=>client.get('/statistics/filters',{params:{facilityId},signal}),
 report:(report,params,signal)=>{if(!statisticsReports.some(([key])=>key===report))throw Error('Báo cáo không hợp lệ.');return client.get(`/statistics/${report}`,{params,signal});},
 export:(format,report,params,signal)=>{if(!['csv','xlsx','pdf'].includes(format)||!exportReports.includes(report))throw Error('Báo cáo chưa hỗ trợ định dạng xuất này.');return client.get(`/statistics/export/${format}`,{params:{...params,reportType:report},responseType:'blob',timeout:30000,signal});},
};
