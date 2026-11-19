const { test } = require('node:test');
const assert = require('node:assert/strict');
const NotificationModel = require('../dist/models/notifications/notification.model').default;
const NotificationController = require('../dist/controllers/notifications/notification.controller');

function response(){return {body:null,statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}

test('customer inbox reads only the authenticated user and returns the API array shape',async t=>{
  const userId='111111111111111111111111';
  const rows=[{_id:'222222222222222222222222',userId,type:'PAYMENT_CONFIRMED',title:'Đã xác nhận thanh toán',content:'Đơn đã được ghi nhận.',isRead:false}];
  t.mock.method(NotificationModel,'find',filter=>{
    assert.deepEqual(filter,{userId});
    return {sort:sort=>{assert.deepEqual(sort,{createdAt:-1});return Promise.resolve(rows);}};
  });
  const res=response();
  await NotificationController.getMyNotifications({user:{_id:userId}},res);
  assert.deepEqual(res.body,{success:true,data:rows});
});

test('marking a notification read scopes the update to the authenticated recipient',async t=>{
  const userId='111111111111111111111111',notificationId='222222222222222222222222';
  const row={_id:notificationId,userId,isRead:true};
  t.mock.method(NotificationModel,'findOneAndUpdate',(filter,update,options)=>{
    assert.deepEqual(filter,{_id:notificationId,userId});
    assert.deepEqual(update,{isRead:true});
    assert.equal(options.returnDocument,'after');
    return Promise.resolve(row);
  });
  const res=response();
  await NotificationController.markAsRead({params:{id:notificationId},user:{_id:userId}},res);
  assert.deepEqual(res.body,{success:true,data:row});
});

test('a notification owned by another user is not disclosed by read-one',async t=>{
  t.mock.method(NotificationModel,'findOneAndUpdate',()=>Promise.resolve(null));
  const res=response();
  await NotificationController.markAsRead({params:{id:'222222222222222222222222'},user:{_id:'111111111111111111111111'}},res);
  assert.equal(res.statusCode,404);
  assert.equal(res.body.success,false);
});
