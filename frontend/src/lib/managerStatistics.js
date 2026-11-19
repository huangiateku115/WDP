import {facilityLabel} from './facilityLabels.js';
export const statisticsReports = [
 ['overview','Tổng quan','Tổng quan'],['facilities-kpi','Chỉ số cơ sở','Tổng quan'],
 ['revenue','Tiền đã thu','Tài chính'],['payments-analysis','Phân tích thanh toán','Tài chính'],['financial-analytics','Phân tích thu tiền','Tài chính'],
 ['utilization','Mức sử dụng kho riêng','Sức chứa'],['storage-capacity','Tình trạng kho riêng','Sức chứa'],['managed-capacity','Sức chứa hàng hóa','Sức chứa'],
 ['reservations','Đơn đặt thuê','Đơn và hợp đồng'],['contracts-lifecycle','Vòng đời hợp đồng','Đơn và hợp đồng'],
 ['managed-operations','Nhập, xuất và di chuyển','Vận hành'],['incidents','Sự cố và bảo trì','Vận hành'],['product-and-operations','Dịch vụ và vận hành','Vận hành'],
 ['customers','Khách hàng','Phân tích'],['service-mix','Cơ cấu dịch vụ','Phân tích'],['unit-demand','Nhu cầu kho','Phân tích'],['rental-trends','Xu hướng thuê','Phân tích'],['facilities-ranking','Chỉ số theo cơ sở','Phân tích'],
];
export const snapshotReports=['storage-capacity','managed-capacity'];
// Only chart mutually exclusive counts as a whole; customers and lifecycle
// counters can overlap and must not be represented as pie slices.
export function reportChart(report,data){
 const records=(source,label,metric)=>Array.isArray(source)?source.map(row=>({label:statisticLabel(String(row[label]??'Chưa xác định')),value:row[metric]})):null;
 let type='bar',title='',rows=null,unit='';
 if(report==='overview'){type='pie';title='Cơ cấu đơn theo dịch vụ';rows=data.reservationByService&&Object.entries(data.reservationByService).map(([label,value])=>({label:statisticLabel(label),value}));}
 if(report==='service-mix'){type='pie';title='Cơ cấu đơn theo dịch vụ';rows=records(data.items,'serviceType','reservationCount');}
 if(report==='storage-capacity'){type='pie';title='Tình trạng kho riêng';rows=['occupiedUnits','reservedUnits','availableUnits','maintenanceUnits','unavailableUnits'].map(key=>({label:statisticLabel(key),value:data[key]}));}
 if(report==='revenue'){title='Tiền đã thu theo dịch vụ';rows=records(data.collectedByService,'serviceType','collectedAmount');unit='đ';}
 if(report==='financial-analytics'){title='Tiền đã thu theo dịch vụ';rows=records(data.collectedByService,'serviceType','amount');unit='đ';}
 if(report==='unit-demand'){title='Nhu cầu theo kích thước kho';rows=records(data.items,'unitType','paidRentalCount');}
 if(report==='managed-operations'){title='Số lần nhập xuất và di chuyển';rows=records(data.operationsByAction,'action','operationCount');}
 if(!rows?.length)return null;
 if(rows.some(row=>typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<0))return {type,title,unit,rows:[],unknown:true};
 return {type,title,unit,rows,unknown:false};
}
export const exportReports=['facilities-kpi','revenue','financial-analytics','managed-operations','storage-capacity','managed-capacity','reservations','contracts-lifecycle','incidents'];
const dateFields=['fromDate','toDate'];
const compatibility={
 overview:['serviceType','comparePrevious'],revenue:['serviceType','granularity','comparePrevious'],
 'facilities-ranking':['serviceType'],customers:['serviceType','granularity'],'service-mix':['serviceType'],'unit-demand':['serviceType','unitSize'],'rental-trends':['serviceType','granularity'],
 utilization:[],'storage-capacity':['unitSize','status'],'managed-capacity':[],reservations:['serviceType','unitSize','granularity'],
 'contracts-lifecycle':['serviceType','unitSize','expiringWithinDays'],'managed-operations':['serviceType','granularity','action'],incidents:['granularity','status'],
 'payments-analysis':['serviceType','granularity','paymentStatus'],'financial-analytics':['serviceType','granularity','comparePrevious'],
 'product-and-operations':['serviceType','granularity'],'facilities-kpi':['serviceType','expiringWithinDays'],
};
export const reportFields=report=>compatibility[report]||[];
export function validateStatisticsDates(from,to){
 const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(!valid(from)||!valid(to))throw Error('Nhập đầy đủ ngày bắt đầu và ngày kết thúc hợp lệ.');
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(days<1)throw Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
 if(days>366)throw Error('Chọn khoảng thời gian tối đa 366 ngày.');
}
export function statisticsQuery(report,filters,facilityId,{page=1,exporting=false}={}){
 if(!statisticsReports.some(([key])=>key===report)||!/^[a-f\d]{24}$/i.test(facilityId||''))throw Error('Cần báo cáo hợp lệ và cơ sở được phân công.');
 if(!snapshotReports.includes(report))validateStatisticsDates(filters.fromDate,filters.toDate);
 const keys=[...(snapshotReports.includes(report)?[]:dateFields),...reportFields(report)];
 const params={facilityId};for(const key of keys)if(filters[key]!==''&&filters[key]!=null)params[key]=filters[key];
 if(!exporting&&['facilities-ranking','facilities-kpi','managed-operations'].includes(report)){params.page=page;params.limit=20;}
 return params;
}
export function scopedStatistics(response,facilityId){
 const body=response?.data;
 if(body?.success!==true||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||body.meta?.facilityScope?.type!=='FACILITY'||String(body.meta.facilityScope.facilityId)!==facilityId)throw Error('Báo cáo không khớp cơ sở được phân công.');
 function check(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='facilityId'&&child!=null&&String(child)!==facilityId)throw Error('Báo cáo chứa dữ liệu ngoài cơ sở.');if(child&&typeof child==='object')check(child);}}
 check(body.data);return body;
}
export const statisticsLabels={
 missingUsableHeightCells:'Ô thiếu chiều cao sử dụng',capacityKnown:'Đã xác minh sức chứa',usageKnown:'Đã xác minh lượng sử dụng',availableWeightCapacityKg:'Tải trọng còn lại (kg)',availableVolumeCapacityM3:'Thể tích còn lại (m³)',
 facilityCount:'Số cơ sở',reservationCount:'Đơn đặt thuê',paidReservationCount:'Đơn có tiền thu xác minh',uniquePaidCustomers:'Khách đã thanh toán',collectedAmount:'Tiền đã thu (đ)',
 totalReservations:'Tổng đơn thuê',paidReservations:'Đơn đã thanh toán',pendingPaymentReservations:'Đơn chờ thanh toán',awaitingContractReservations:'Đơn chờ hợp đồng',activeReservations:'Đơn đang sử dụng',cancelledReservations:'Đơn đã hủy',completedReservations:'Đơn hoàn tất',overdueReservations:'Đơn quá hạn',cancellationRate:'Tỷ lệ hủy (%)',
 captureCount:'Lần ghi nhận tiền',paymentCount:'Giao dịch',refundedAmount:'Tiền hoàn (đ)',netCashFlow:'Dòng tiền ròng (đ)',recognizedRevenue:'Doanh thu ghi nhận (đ)',financialDataStatus:'Mức đầy đủ dữ liệu',
 totalUnits:'Tổng kho riêng',occupiedUnits:'Kho đang sử dụng',reservedUnits:'Kho đã giữ',availableUnits:'Kho trống',maintenanceUnits:'Kho bảo trì',unavailableUnits:'Kho ngừng sử dụng',rentableUnits:'Kho có thể cho thuê',occupancyRate:'Tỷ lệ sử dụng (%)',availabilityRate:'Tỷ lệ còn trống (%)',
 totalZones:'Khu vực',totalRacks:'Kệ',totalCells:'Ô lưu trữ',availableCells:'Ô còn trống',reservedCells:'Ô đang giữ',allocatedCells:'Ô đã phân bổ',nonAvailableCells:'Ô không khả dụng',
 capacityWeightKg:'Sức chứa tải trọng (kg)',usedWeightKg:'Tải trọng đang dùng (kg)',capacityVolumeM3:'Sức chứa thể tích (m³)',usedVolumeM3:'Thể tích đang dùng (m³)',weightUtilizationRate:'Tỷ lệ dùng tải trọng (%)',volumeUtilizationRate:'Tỷ lệ dùng thể tích (%)',reconciliationStatus:'Đối soát',
 totalContracts:'Tổng hợp đồng',signedContracts:'Đã ký',unsignedContracts:'Chưa ký',activeContracts:'Hợp đồng đang hiệu lực',expiringSoonContracts:'Sắp hết hạn',expiredContracts:'Đã hết hạn',completedContracts:'Đã hoàn tất',renewedContracts:'Đã gia hạn',renewalCount:'Lần gia hạn',renewalRate:'Tỷ lệ gia hạn (%)',
 newIncidents:'Sự cố mới',openIncidents:'Sự cố đang mở',resolvedIncidents:'Sự cố đã giải quyết',averageResolutionHours:'Thời gian xử lý TB (giờ)',resolutionDurationSampleCount:'Mẫu tính thời gian',distinctStorageUnitsWithMaintenance:'Kho có bảo trì',averageIncidentSlaHours:'Thời hạn xử lý TB (giờ)',incidentSlaBreachRate:'Tỷ lệ trễ hạn (%)',
 inboundOperations:'Lần nhập hàng',outboundOperations:'Lần xuất hàng',relocationOperations:'Lần di chuyển',totalCommittedOperations:'Tổng thao tác đã ghi nhận',inboundQuantity:'Số lượng nhập',outboundQuantity:'Số lượng xuất',movedQuantity:'Số lượng di chuyển',
 inboundWeightKg:'Khối lượng nhập (kg)',outboundWeightKg:'Khối lượng xuất (kg)',movedWeightKg:'Khối lượng di chuyển (kg)',inboundVolumeM3:'Thể tích nhập (m³)',outboundVolumeM3:'Thể tích xuất (m³)',movedVolumeM3:'Thể tích di chuyển (m³)',
 totalCustomers:'Tổng khách hàng',uniqueCustomers:'Khách hàng duy nhất',newCustomers:'Khách mới',returningCustomers:'Khách quay lại',totalPayments:'Tổng giao dịch',successfulPayments:'Giao dịch thành công',pendingPayments:'Giao dịch chờ xử lý',failedPayments:'Giao dịch thất bại',
 reservationByService:'Đơn theo dịch vụ',paidReservationByService:'Đơn có tiền thu theo dịch vụ',reservationByStatus:'Đơn theo trạng thái',reservationsByService:'Đơn theo dịch vụ',reservationsByFacility:'Đơn theo cơ sở',reservationsByStatus:'Đơn theo trạng thái',reservationTrend:'Xu hướng đặt thuê',
 collectedByFacility:'Tiền thu theo cơ sở',collectedByService:'Tiền thu theo dịch vụ',collectedByPurpose:'Tiền thu theo mục đích',collectedTrend:'Xu hướng tiền thu',capacityByFacility:'Sức chứa theo cơ sở',capacityByUnitSize:'Theo kích thước kho',capacityByZone:'Sức chứa theo khu vực',capacityByRack:'Sức chứa theo kệ',
 contractsByFacility:'Hợp đồng theo cơ sở',contractsByService:'Hợp đồng theo dịch vụ',contractTrend:'Xu hướng hợp đồng',incidentsByFacility:'Sự cố theo cơ sở',incidentsByCategory:'Sự cố theo nhóm',incidentsByPriority:'Sự cố theo mức ưu tiên',incidentTrend:'Xu hướng sự cố',checkoutInspectionFindings:'Hiện trạng khi trả kho',
 operationsByAction:'Theo thao tác',operationsByFacility:'Vận hành theo cơ sở',operationsByItemSpecification:'Theo quy cách hàng',operationsByTime:'Xu hướng nhập/xuất',quantityByActionAndUnit:'Số lượng theo đơn vị',items:'Chi tiết chỉ số',
 facilityId:'Mã cơ sở',facilityName:'Cơ sở',facilityCode:'Mã cơ sở',code:'Mã',name:'Tên',serviceType:'Dịch vụ',serviceTypes:'Dịch vụ',status:'Trạng thái',unitSize:'Kích thước',size:'Kích thước',bucketStart:'Thời điểm',date:'Ngày',action:'Thao tác',purpose:'Mục đích',quantity:'Số lượng',quantityUnit:'Đơn vị',weightKg:'Khối lượng (kg)',volumeM3:'Thể tích (m³)',operationCount:'Số thao tác',total:'Tổng',count:'Số lượng',active:'Đang sử dụng',paid:'Đã thanh toán',cancelled:'Đã hủy',incidentCount:'Số sự cố',openCount:'Đang mở',zoneId:'Mã khu vực',rackId:'Mã kệ',
 storageOccupancyRate:'Tỷ lệ sử dụng kho (%)',managedVolumeUtilizationRate:'Tỷ lệ thể tích (%)',managedWeightUtilizationRate:'Tỷ lệ tải trọng (%)',expiringContracts:'Hợp đồng sắp hết hạn',managedOperations:'Vận hành hàng hóa',
};
export const statisticLabel=key=>statisticsLabels[key]||({SELF_STORAGE:'Thuê kho riêng',MANAGED_INVENTORY:'Lưu trữ hàng hóa',ADD:'Nhập hàng',REMOVE:'Xuất hàng',MOVE:'Di chuyển',GENERAL:'Chung',LOW:'Thấp',MEDIUM:'Trung bình',HIGH:'Cao',URGENT:'Khẩn cấp'})[key]||(facilityLabel(key)!==key?facilityLabel(key):key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' '));
export function statisticValue(value){if(value==null)return 'Chưa có dữ liệu';if(typeof value==='number')return Number.isFinite(value)?value.toLocaleString('vi-VN',{maximumFractionDigits:3}):'Chưa xác minh';if(typeof value==='boolean')return value?'Có':'Không';return ({PARTIAL:'Chưa đầy đủ',UNKNOWN:'Chưa xác minh',MISMATCH:'Chưa khớp',NOT_REQUIRED:'Chưa phát sinh',RECONCILED:'Đã đối soát',REPLAYED:'Đã đối chiếu sổ tồn'})[value]||statisticLabel(String(value));}
