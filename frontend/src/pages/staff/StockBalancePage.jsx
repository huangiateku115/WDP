import {useEffect, useRef, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import inventoryApi from '@/api/inventoryApi';
import {getAccessToken, useAuthSession} from '@/lib/authSession';
import {inventoryId, validInventoryId} from '@/lib/inventoryRegistration';
import {Screen, Panel, Details, Table, Button, Input, OpenLink, Message} from '@/components/manager/ManagerUI';

export default function StockBalancePage() {
  const navigate = useNavigate();
  const {user, accessToken} = useAuthSession();
  const workspace = user?.role === 'FACILITY_MANAGER' ? 'manager' : 'staff';
  const [params] = useSearchParams();
  const [itemId, setItemId] = useState(params.get('itemId') || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setResult(null);
    setError('');
    setLoading(false);
    return () => { request.current += 1; };
  }, [accessToken, user?.assignedFacilityId]);

  async function load(event) {
    event.preventDefault();
    if (!validInventoryId(itemId)) {
      setError("Nhập mã mặt hàng hợp lệ.");
      return;
    }
    const currentRequest = ++request.current;
    const token = getAccessToken();
    setResult(null);
    setLoading(true);
    setError('');
    try {
      const itemResponse = await inventoryApi.get(itemId);
      const item = itemResponse.data?.data;
      if (itemResponse.data?.success !== true || inventoryId(item) !== itemId ||
          inventoryId(item.facilityId) !== inventoryId(user?.assignedFacilityId)) {
        throw Error('This Item is outside your assigned Facility.');
      }
      if (currentRequest !== request.current || token !== getAccessToken()) return;
      if (item.inventorySchemaVersion === 3) { navigate(`/${workspace}/managed?itemId=${itemId}`, {replace:true}); return; }
      const response = await inventoryApi.stockBalance(itemId);
      const balance = response.data?.data;
      if (response.data?.success !== true || inventoryId(balance?.itemId) !== itemId ||
          inventoryId(balance.facilityId) !== inventoryId(user?.assignedFacilityId) ||
          !Number.isSafeInteger(balance.onHandQuantity) || !Number.isSafeInteger(balance.heldQuantity) ||
          balance.onHandQuantity < 0 || balance.heldQuantity < 0 || balance.heldQuantity > balance.onHandQuantity ||
          !Array.isArray(balance.batches)) {
        throw Error("Không xác minh được dữ liệu tồn kho. Tải lại trước khi tiếp tục.");
      }
      if (currentRequest === request.current && token === getAccessToken()) setResult({item, balance});
    } catch (failure) {
      if (currentRequest === request.current && token === getAccessToken()) {
        setError(failure.response?.data?.message || failure.message || "Chưa thể xem tồn kho.");
      }
    } finally {
      if (currentRequest === request.current && token === getAccessToken()) setLoading(false);
    }
  }

  const balance = result?.balance;
  return <Screen title="Tồn kho theo lô (luồng cũ)" description="Tra cứu tồn và lô hàng của luồng trước. Hàng hóa tự quản dùng trang Giám sát hàng hóa tự quản." notice="Tải lại tồn sau nhập, xuất hoặc di chuyển để xem số lượng mới nhất.">
    <OpenLink to={`/${workspace}/managed`}>Về Hàng hóa và tồn kho</OpenLink>
    <Panel title="Tìm mặt hàng">
      <form className="facility-filter-row" onSubmit={load}>
        <Input aria-label="Mã mặt hàng" value={itemId} onChange={event => setItemId(event.target.value.trim())}/>
        <Button disabled={loading}>{loading ? "Đang tải…" : "Tải / cập nhật tồn kho"}</Button>
      </form>
    </Panel>
    <Message error={error}/>
    {result && <>
      <Panel title={`${result.item.itemCode} · ${result.item.name}`}>
        <Details values={[
          ["Trạng thái mặt hàng", result.item.status], ["Ô hiện tại", inventoryId(balance.currentCellId) || "Chưa có vị trí"],
          ["Số lượng hiện tại", balance.onHandQuantity], ["Số lượng đang giữ", balance.heldQuantity],
          ["Số lượng khả dụng", balance.onHandQuantity - balance.heldQuantity],
          ["Khối lượng thực tế (kg)", balance.actualTotalWeightKg], ["Thể tích thực tế (m³)", balance.actualTotalVolumeM3],
          ["Nguồn tính tồn", balance.source], ["Phiên bản tính tồn", balance.version],
        ]}/>
        <OpenLink to={`/${workspace}/inventory/items/${inventoryId(result.item)}/history`}>Mở lịch sử nhập xuất</OpenLink>
      </Panel>
      <Panel title="Các lô nhập hàng">
        <Table rows={balance.batches.map(batch => ({...batch, id: batch.batchId}))} columns={[
          {key:'batchId', label:"Lô hàng"}, {key:'quantity', label:"Số lượng hiện tại"},
          {key:'heldQuantity', label:"Số lượng đang giữ"}, {key:'quantityUnit', label:"Kho"},
          {key:'actualUnitWeightKg', label:"Khối lượng mỗi đơn vị (kg)"}, {key:'arithmeticPolicy', label:"Chính sách hạch toán"},
          {key:'receivedAt', label:"Thời điểm nhập", render: batch => new Date(batch.receivedAt).toLocaleString('vi-VN')},
        ]}/>
      </Panel>
    </>}
  </Screen>;
}
