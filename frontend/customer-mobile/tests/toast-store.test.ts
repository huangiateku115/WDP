import {dismissToast,getToast,showToast,subscribeToast} from '../src/state/toastStore';

afterEach(()=>{const toast=getToast();if(toast)dismissToast(toast.id);});

it('publishes one toast to subscribers and dismisses only its own id',()=>{
  const listener=jest.fn();const unsubscribe=subscribeToast(listener);
  showToast('Đặt lịch đến kho thành công');const first=getToast();
  expect(first).toMatchObject({message:'Đặt lịch đến kho thành công',kind:'success'});
  showToast('Đã lưu hàng hóa');const second=getToast();
  expect(second?.id).not.toBe(first?.id);
  dismissToast(first!.id);expect(getToast()).toEqual(second);
  dismissToast(second!.id);expect(getToast()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(3);unsubscribe();
});
