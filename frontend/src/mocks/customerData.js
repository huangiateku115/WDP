// Customer-only preview fixtures. No endpoint or authentication behavior is defined here.
export const inventoryCategories = ['Documents', 'Household goods', 'Business stock', 'Equipment'];
export const inventoryUnits = ['box', 'piece', 'carton', 'pallet'];
export const customerSeed = {
  profile: { fullName: 'Nguyen Van An', email: 'nguyen.van.an@example.com', phone: '0908 123 456', address: 'District 1, Ho Chi Minh City', company: '' },
  rentals: [
    { id: 'RNT-SELF-001', model: 'SELF_STORAGE', facility: 'SelfStorage Central Saigon', unitCode: 'A-203', status: 'ACTIVE', accessStatus: 'ACTIVE', startDate: '2026-05-19', endDate: '2026-10-19', monthlyRate: 1350000, size: 3, contract: 'VS-C-0849', demoPin: 'DEMO-4821' },
    { id: 'RNT-MANAGED-001', model: 'MANAGED_INVENTORY', facility: 'SelfStorage Central Saigon', status: 'ACTIVE', startDate: '2026-07-01', endDate: '2026-12-31', monthlyRate: 2000000, allocated_capacity_m3: 10, used_capacity_m3: 4, capacityRatePerM3Month: 200000, contract: 'VS-C-0850' },
    { id: 'RNT-SELF-002', model: 'SELF_STORAGE', facility: 'SelfStorage Thu Duc', unitCode: 'B-105', status: 'ACTIVE', accessStatus: 'SUSPENDED', startDate: '2026-08-01', endDate: '2026-11-01', monthlyRate: 1500000, size: 3, contract: 'VS-C-0851', suspensionReason: 'Access is suspended pending a billing review. Please contact support.' },
  ],
  items: [
    { id: 'INV-001', code: 'VS-INV-001', name: 'Archive cartons', description: 'Business records in sealed cartons.', category: 'Documents', quantity: 6, unit: 'carton', length: 1, width: 1, height: .5, weight: 8, volume_m3: .5, rentalId: 'RNT-MANAGED-001', status: 'InStorage', current_location: { zone:'Z-A', rack:'R-02', shelf:'S-03' } },
    { id: 'INV-002', code: 'VS-INV-002', name: 'Display equipment', description: 'Event display packed for storage.', category: 'Equipment', quantity: 1, unit: 'piece', length: 1, width: 1, height: 1, weight: 22, volume_m3: 1, rentalId:'RNT-MANAGED-001', status:'InStorage', current_location:{ zone:'Z-B', rack:'R-01', shelf:'S-02' } },
    { id: 'INV-003', code:'VS-INV-003', name:'Seasonal stock', description:'Five cartons awaiting inbound.', category:'Business stock', quantity:5, unit:'carton', length:.5, width:.5, height:.4, weight:3, volume_m3:.1, rentalId:'RNT-MANAGED-001', status:'Registered', current_location:null },
    { id:'INV-004', code:'VS-INV-004', name:'Collected samples', description:'Previously released goods.', category:'Business stock', quantity:2, unit:'carton', length:.5, width:.5, height:.5, weight:2, volume_m3:.125, rentalId:'RNT-MANAGED-001', status:'Outside', current_location:null },
  ],
  movements: [
    { id:'MOV-004', itemId:'INV-004', type:'INBOUND', from:null, to:{zone:'Z-A',rack:'R-03',shelf:'S-01'}, performer:'Facility staff · Le Thi Mai', timestamp:'2026-08-12T10:00:00+07:00', notes:'Received two sample cartons.' },
    { id:'MOV-005', itemId:'INV-004', type:'OUTBOUND', from:{zone:'Z-A',rack:'R-03',shelf:'S-01'}, to:null, performer:'Facility staff · Le Thi Mai', timestamp:'2026-09-10T15:00:00+07:00', notes:'Released to the registered customer.' },
    { id:'MOV-001', itemId:'INV-001', type:'INBOUND', from:null, to:{zone:'Z-A',rack:'R-01',shelf:'S-01'}, performer:'Facility staff · Tran Minh Hoang', timestamp:'2026-09-18T09:00:00+07:00', notes:'Received six cartons.' },
    { id:'MOV-002', itemId:'INV-001', type:'RELOCATION', from:{zone:'Z-A',rack:'R-01',shelf:'S-01'}, to:{zone:'Z-A',rack:'R-02',shelf:'S-03'}, performer:'Facility staff · Tran Minh Hoang', timestamp:'2026-09-25T14:30:00+07:00', notes:'Moved during rack reorganization.' },
    { id:'MOV-003', itemId:'INV-002', type:'INBOUND', from:null, to:{zone:'Z-B',rack:'R-01',shelf:'S-02'}, performer:'Facility staff · Le Thi Mai', timestamp:'2026-09-20T10:00:00+07:00', notes:'Equipment inspected at handover.' },
  ],
  requests: [],
  payments: [
    {id:'PAY-001',reference:'VS-PAY-0849',rentalId:'RNT-SELF-001',contract:'VS-C-0849',type:'Rental fee',amount:1350000,status:'PAID',date:'2026-10-01T09:00:00+07:00',provider:'PAYOS'},
    {id:'PAY-002',reference:'VS-PAY-0850',rentalId:'RNT-MANAGED-001',contract:'VS-C-0850',type:'Managed storage',amount:2000000,status:'PENDING',date:'2026-10-03T10:00:00+07:00',provider:'PAYOS'},
    {id:'PAY-003',reference:'VS-PAY-0851',rentalId:'RNT-SELF-002',contract:'VS-C-0851',type:'Rental fee',amount:1500000,status:'FAILED',date:'2026-10-02T11:00:00+07:00',provider:'PAYOS'},
  ],
  refunds: [{id:'REF-001',paymentId:'PAY-001',rentalId:'RNT-SELF-001',amount:150000,status:'PROCESSING',date:'2026-10-03T10:30:00+07:00',reason:'Approved billing adjustment.',reference:'VS-REF-001'}],
  charges: [{id:'CHG-001',rentalId:'RNT-SELF-001',type:'Extra handling',amount:200000,status:'PAYMENT_REQUIRED',date:'2026-10-03T12:00:00+07:00',dueDate:'2026-10-15',reason:'Additional loading assistance requested.',reference:'VS-CHG-001'}, {id:'CHG-002',rentalId:'RNT-SELF-001',type:'Damage charge',amount:100000,status:'PAID',date:'2026-09-28T10:00:00+07:00',reason:'Approved repair charge after inspection.',reference:'VS-CHG-002'}],
  notifications: [
    ...['Reservation','Approval / rejection','Contract','Payment','Rental reminder','Overdue','Support','Inventory inbound','Inventory outbound'].map((category,index)=>({id:`NOT-${index+1}`,category,title:['Reservation received','Reservation approved','Contract ready for review','Payment requires attention','Your rental ends soon','Access suspended for billing review','Support team replied','Inbound request received','Outbound request updated'][index],message:['Your reservation is ready for the next step.','View approval details in your reservation.','Review and confirm your rental agreement.','Review your payment status in the portal.','Request an extension before your current end date.','Please contact support about the suspended rental.','Your facility support conversation has an update.','Staff will assign the item location after acceptance.','View movement history after staff completes outbound.'][index],timestamp:`2026-10-0${index%3+1}T09:00:00+07:00`,read:index>3,href:['/portal/contracts','/portal/contracts','/portal/contracts','/portal/payments','/portal/rentals/RNT-SELF-001/extend','/portal/rentals/RNT-SELF-002/access','/portal/support','/portal/inventory/INV-003/inbound','/portal/inventory/INV-001/history'][index]})),
  ],
};
