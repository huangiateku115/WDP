import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/api/facilityManagedApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';
import useFacilityResource, { announceReviewChange } from '@/lib/useFacilityResource';
import { apiRecord, apiRows, objectId, recordId, reviewError } from '@/lib/facilityReview';
import { positiveNumber, scopedTopology } from '@/lib/managedFacilityReview';
import { Screen, Panel, Input, Field, Select, Button, Table, Message, Dialog, OpenLink, Status } from '@/components/manager/ManagerUI';

const kinds = [['warehouse-zones', 'Khu vực'], ['racks', 'Kệ'], ['rack-cells', 'Ô lưu trữ']];

async function allRows(kind, facilityId, signal) {
  const rows = [], seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const response = await api.list(kind, facilityId, { page, limit: 100 }, { signal });
    const batch = apiRows(response), pagination = response.data.pagination;
    if (!pagination || pagination.page !== page || !Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0) throw Error('Phân trang cấu trúc không hợp lệ.');
    for (const row of batch) {
      if (!objectId(recordId(row)) || recordId(row.facilityId) !== facilityId || seen.has(recordId(row))) throw Error('Dữ liệu cấu trúc không khớp cơ sở.');
      seen.add(recordId(row)); rows.push(row);
    }
    if (page >= pagination.totalPages) return rows;
  }
  throw Error('Danh sách cấu trúc vượt giới hạn tải.');
}

export default function WarehouseSettingsPage() {
  const { user, accessToken } = useAuthSession();
  const facilityId = user?.assignedFacilityId;
  const permitted = user?.role === 'FACILITY_MANAGER' && objectId(facilityId);
  const [kind, setKind] = useState('warehouse-zones'), [selected, setSelected] = useState(null), [feedback, setFeedback] = useState({});
  useEffect(() => { setSelected(null); setFeedback({}); }, [facilityId, accessToken]);
  const load = useCallback(async signal => {
    const [zones, racks, cells] = await Promise.all(kinds.map(([key]) => allRows(key, facilityId, signal)));
    return { zones, racks, cells };
  }, [facilityId, accessToken]);
  const resource = useFacilityResource(load, permitted, { refreshOnFocus: !selected });
  const rows = resource.data ? resource.data[{ 'warehouse-zones': 'zones', racks: 'racks', 'rack-cells': 'cells' }[kind]] : [];
  return <Screen title="Cấu hình không gian hàng hóa" notice="Quản lý khu vực, kệ, kích thước và điều kiện sử dụng trong cơ sở được phân công." action={<OpenLink to="/manager/warehouse-map">Xem bản đồ kho</OpenLink>}>
    {!permitted ? <Panel title="Không có quyền"><p>Chỉ quản lý cơ sở được phân công có quyền cấu hình không gian.</p></Panel> : <>
      <Message {...feedback} /><Message error={resource.error} />{resource.loading && <p role="status">Đang tải cấu trúc kho…</p>}
      <Panel title="Danh mục cấu trúc"><Select label="Loại cấu trúc" value={kind} onChange={value => { setKind(value); setSelected(null); setFeedback({}); }} options={kinds} />
        <div className="my-4 flex flex-wrap gap-3"><Button variant="outline" onClick={resource.reload}>Tải lại</Button>{kind !== 'rack-cells' && resource.data && <Button onClick={() => setSelected({})}>Tạo {kind === 'racks' ? 'kệ' : 'khu vực'}</Button>}</div>
        {resource.data && <Table label="Cấu trúc không gian" rows={rows.map(row => ({ ...row, id: recordId(row) }))} columns={[
          { key: 'code', label: 'Mã', render: row => row.code || row.rackCode }, { key: 'name', label: 'Tên', render: row => row.name || '—' },
          { key: 'status', label: 'Điều kiện', render: row => <Status value={row.operationalStatus || (row.isActive ? 'ACTIVE' : 'INACTIVE')} /> },
          { key: 'maxWeightKg', label: kind === 'racks' ? 'Tải trọng mỗi tầng (kg)' : 'Tải trọng ô (kg)', render: row => kind === 'racks' ? row.maxWeightKgPerLevel : row.maxWeightKg ?? '—' },
          { key: 'action', label: 'Thao tác', render: row => <Button variant="outline" onClick={() => setSelected(row)}>Chỉnh sửa</Button> },
        ]} />}
      </Panel>
      {selected && resource.data && <TopologyForm key={`${kind}:${recordId(selected) || 'new'}:${selected.updatedAt || ''}`} kind={kind} row={selected} data={resource.data} facilityId={facilityId} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setFeedback({ success: 'Đã lưu và xác minh cấu trúc từ hệ thống.' }); announceReviewChange(); }} />}
      <Panel title="Điều kiện hình học và an toàn"><p>Thông số phải được đối chiếu với không gian thực tế. Hệ thống kiểm tra ràng buộc phân bổ và hàng đang lưu trước khi chấp nhận thay đổi.</p><p className="mt-3">Chưa có chức năng quản lý nhóm ô liền kề và hồ sơ chứng nhận hình học/tải trọng. Các trường hợp một vật chiếm nhiều ô cần được cơ sở xem xét trước khi thực hiện.</p></Panel>
    </>}
  </Screen>;
}

function TopologyForm({ kind, row, data, facilityId, onClose, onSaved }) {
  const editing = objectId(recordId(row)), busy = useRef(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(null), [uncertain, setUncertain] = useState(false);
  const session = useRef(getAccessToken());
  const [fields, setFields] = useState({
    code: row.code || row.rackCode || '', name: row.name || '', description: row.description || '', isActive: row.isActive !== false,
    zoneId: recordId(row.zoneId) || '', aisleCode: row.aisleCode || '', widthM: row.dimensions?.widthM ?? '',
    depthM: row.dimensions?.depthM ?? '', heightM: row.dimensions?.heightM ?? '', usableHeightM: row.dimensions?.usableHeightM ?? '',
    levelCount: '', cellsPerLevel: '', maxWeightKg: (kind === 'racks' ? row.maxWeightKgPerLevel : row.maxWeightKg) ?? '',
    mapX: row.mapX ?? '', mapY: row.mapY ?? '', operationalStatus: row.operationalStatus || 'AVAILABLE',
  });
  const change = (key, value) => setFields(current => ({ ...current, [key]: value }));
  function prepare(event) {
    event.preventDefault(); if (busy.current || uncertain) return;
    setError('');
    try {
      let body;
      if (kind === 'warehouse-zones') {
        if (!fields.name.trim()) throw Error('Nhập tên khu vực.');
        body = { name: fields.name.trim(), description: fields.description.trim(), isActive: fields.isActive };
        if (!editing) body = { ...body, code: fields.code.trim().toUpperCase(), facilityId };
      } else if (kind === 'racks') {
        const dimensions = { widthM: positiveNumber(fields.widthM, 'Chiều rộng'), depthM: positiveNumber(fields.depthM, 'Chiều sâu'), heightM: positiveNumber(fields.heightM, 'Chiều cao') };
        const maxWeightKgPerLevel = positiveNumber(fields.maxWeightKg, 'Tải trọng mỗi tầng');
        const mapX = Number(fields.mapX), mapY = Number(fields.mapY);
        if (!String(fields.mapX).trim() || !String(fields.mapY).trim() || !Number.isSafeInteger(mapX) || !Number.isSafeInteger(mapY) || mapX < 0 || mapY < 0 || mapX > 100000 || mapY > 100000) throw Error('Tọa độ cần là số nguyên từ 0 đến 100000.');
        body = { aisleCode: fields.aisleCode.trim().toUpperCase(), dimensions, maxWeightKgPerLevel, mapX, mapY, operationalStatus: fields.operationalStatus };
        if (!body.aisleCode) throw Error('Nhập mã dãy.');
        if (!editing) {
          if (!data.zones.some(zone => recordId(zone) === fields.zoneId && zone.isActive)) throw Error('Chọn khu vực đang hoạt động trong cơ sở.');
          const levelCount = positiveNumber(fields.levelCount, 'Số tầng', true), cellsPerLevel = positiveNumber(fields.cellsPerLevel, 'Số ô mỗi tầng', true);
          if (levelCount > 20 || cellsPerLevel > 20) throw Error('Mỗi kệ tối đa 20 tầng và 20 ô mỗi tầng.');
          const height = positiveNumber(fields.usableHeightM, 'Chiều cao sử dụng mỗi tầng');
          if (height * levelCount > dimensions.heightM) throw Error('Tổng chiều cao sử dụng vượt chiều cao kệ.');
          body = { ...body, facilityId, zoneId: fields.zoneId, rackCode: fields.code.trim().toUpperCase(), levelCount, cellsPerLevel,
            usableHeightMByLevel: Array(levelCount).fill(height), cellCapacitiesKg: Array.from({ length: levelCount }, () => Array(cellsPerLevel).fill(maxWeightKgPerLevel / cellsPerLevel)) };
        }
      } else {
        body = { maxWeightKg: positiveNumber(fields.maxWeightKg, 'Tải trọng ô'), operationalStatus: fields.operationalStatus,
          dimensions: { widthM: positiveNumber(fields.widthM, 'Chiều rộng'), depthM: positiveNumber(fields.depthM, 'Chiều sâu'), usableHeightM: positiveNumber(fields.usableHeightM, 'Chiều cao sử dụng') } };
      }
      if (!editing && !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(fields.code.trim().toUpperCase())) throw Error('Mã cần 1–40 chữ, số, dấu gạch ngang hoặc gạch dưới.');
      setPending(body);
    } catch (cause) { setError(cause.message); }
  }
  async function save(event) {
    event.preventDefault(); if (busy.current || !pending || uncertain) return;
    busy.current = true; setSaving(true); setError('');
    let sent = false;
    try {
      if (!session.current || getAccessToken() !== session.current) throw Error('Phiên đăng nhập đã thay đổi. Đóng biểu mẫu và tải lại.');
      if (editing) {
        const fresh = scopedTopology(await api.detail(kind, recordId(row)), facilityId, recordId(row));
        if (row.updatedAt && fresh.updatedAt !== row.updatedAt) throw Error('Cấu trúc đã thay đổi. Đóng biểu mẫu và tải lại để kiểm tra.');
      }
      if (getAccessToken() !== session.current) throw Error('Phiên đăng nhập đã thay đổi. Đóng biểu mẫu và tải lại.');
      sent = true;
      const response = editing ? await api.update(kind, recordId(row), pending) : await api.create(kind, pending);
      const result = apiRecord(response), saved = kind === 'racks' && !editing ? result.rack : result;
      if (!objectId(recordId(saved)) || recordId(saved.facilityId) !== facilityId || editing && recordId(saved) !== recordId(row)) throw Error('Chưa xác minh được kết quả lưu cấu trúc. Tải lại trước khi thử tiếp.');
      const verified = scopedTopology(await api.detail(kind, recordId(saved)), facilityId, recordId(saved));
      for (const key of Object.keys(pending)) {
        if (['cellCapacitiesKg', 'usableHeightMByLevel'].includes(key)) continue;
        if (JSON.stringify(verified[key]) !== JSON.stringify(pending[key])) throw Error('Dữ liệu đọc lại chưa khớp thay đổi. Tải lại để đối chiếu.');
      }
      if (getAccessToken() !== session.current) throw Error('Phiên đăng nhập đã thay đổi. Tải lại để đối chiếu kết quả.');
      onSaved();
    } catch (cause) { setUncertain(sent); setError(reviewError(cause) + (sent ? ' Đóng biểu mẫu và tải lại danh sách để đối chiếu kết quả trước khi thao tác tiếp.' : '')); }
    finally { busy.current = false; setSaving(false); setPending(null); }
  }
  const numberField = (key, label) => <Field key={key} label={label}><Input type="number" min="0" step="any" required disabled={saving} value={fields[key]} onChange={event => change(key, event.target.value)} /></Field>;
  return <Panel title={`${editing ? 'Sửa' : 'Tạo'} ${kind === 'warehouse-zones' ? 'khu vực' : kind === 'racks' ? 'kệ' : 'ô lưu trữ'}`} action={<Button variant="outline" disabled={saving} onClick={onClose}>Đóng</Button>}>
    <Message error={error} /><form onSubmit={prepare}><fieldset disabled={saving || uncertain} className="grid gap-4 sm:grid-cols-2">
      {!editing && <Field label="Mã"><Input required maxLength={40} value={fields.code} onChange={event => change('code', event.target.value)} /></Field>}
      {kind === 'warehouse-zones' ? <><Field label="Tên khu vực"><Input required maxLength={120} value={fields.name} onChange={event => change('name', event.target.value)} /></Field><Field label="Mô tả"><Input maxLength={1000} value={fields.description} onChange={event => change('description', event.target.value)} /></Field><label><input type="checkbox" checked={fields.isActive} onChange={event => change('isActive', event.target.checked)} /> Đang hoạt động</label></> : <>
        {kind === 'racks' && <>{!editing && <Field label="Khu vực"><Select label="Khu vực của kệ" value={fields.zoneId} onChange={value => change('zoneId', value)} options={[["", 'Chọn khu vực'], ...data.zones.filter(zone => zone.isActive).map(zone => [recordId(zone), `${zone.code} · ${zone.name}`])]} /></Field>}<Field label="Mã dãy"><Input required value={fields.aisleCode} onChange={event => change('aisleCode', event.target.value)} /></Field>{numberField('heightM', 'Chiều cao kệ (m)')}{numberField('mapX', 'Tọa độ ngang')}{numberField('mapY', 'Tọa độ dọc')}{!editing && <>{numberField('levelCount', 'Số tầng')}{numberField('cellsPerLevel', 'Số ô mỗi tầng')}</>}</>}
        {numberField('widthM', 'Chiều rộng (m)')}{numberField('depthM', 'Chiều sâu (m)')}{(kind === 'rack-cells' || !editing) && numberField('usableHeightM', 'Chiều cao sử dụng mỗi tầng (m)')}{numberField('maxWeightKg', kind === 'racks' ? 'Tải trọng mỗi tầng (kg)' : 'Tải trọng ô (kg)')}
        <Field label="Trạng thái vận hành"><Select label="Trạng thái cấu trúc" value={fields.operationalStatus} onChange={value => change('operationalStatus', value)} options={['AVAILABLE', 'MAINTENANCE', 'BLOCKED']} /></Field>
      </>}
      <Button type="submit" disabled={saving}>Kiểm tra và lưu</Button>
    </fieldset></form>
    {pending && <Dialog title="Xác nhận thay đổi cấu trúc" onClose={() => { if (!busy.current) setPending(null); }}><form onSubmit={save}><p className="mb-4">Thay đổi áp dụng cho cơ sở hiện tại. Các ràng buộc sử dụng và phân bổ sẽ được kiểm tra khi lưu.</p><Button disabled={saving}>{saving ? 'Đang lưu…' : 'Xác nhận'}</Button></form></Dialog>}
  </Panel>;
}
