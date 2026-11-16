import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationRows, filterNotifications} from '../src/lib/facilityNotifications.js';
const older={_id:'a'.repeat(24),title:'Lịch đến kho',content:'Khách đến cơ sở',isRead:false,createdAt:'2026-11-15T18:00:00Z'};
const newer={...older,_id:'b'.repeat(24),title:'Bảo trì',isRead:true,createdAt:'2026-11-16T18:00:00Z'};
test('invalid inbox responses fail instead of appearing empty',()=>{
 for(const data of [null,{},[{...older,_id:'bad'}],[{...older,isRead:undefined}]])assert.throws(()=>notificationRows({data:{data}}));
 assert.deepEqual(notificationRows({data:{data:[]}}),[]);
 assert.deepEqual(notificationRows({data:{data:[older,newer]}}),[newer,older]);
});
test('inbox filters use Vietnam calendar dates and read state',()=>{
 assert.deepEqual(filterNotifications([older,newer],{from:'2026-11-16',to:'2026-11-16',status:'UNREAD',search:'LỊCH'}),[older]);
 assert.deepEqual(filterNotifications([older,newer],{status:'READ'}),[newer]);
 assert.deepEqual(filterNotifications([{...older,createdAt:'bad'}],{from:'2026-11-16'}),[]);
});
