import { CardHeading, IconBadge, TintedPanel } from "../components/livePresentation";
import {ContractSigningNotice} from '../components/ContractSigningNotice';
import { useEffect, useRef, useState, type ReactNode } from "react";
import axios from "axios";
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { apiIssue, MobileInputError } from "../api/client";
import { mobileRepo } from "../api/mobileRepository";
import { lifecycle, type ReservationDto } from "../api/contracts/customer";
import { journal, newAttempt } from "../state/attemptJournal";
import { useLiveSession } from "../state/useLiveSession";
import {
  openSelfStoragePayment,
  createFullRentIntent,
  paymentContext,
  readRentalPayment,
} from "../api/selfStoragePayment";
import {
  AppText,
  Button,
  Card,
  Chip,
  Filter,
  Icon,
  NavigationRow,
  StateCard,
  ui,
} from "../components/ui";
import {
  dateLabel,
  LiveScreen,
  money,
  ResourceState,
  serviceLabel,
  useResource,
} from "../components/liveUI";

import { ReservationProgressTracker } from "../components/ReservationProgressTracker";
import { SelfStorageCheckoutRequest } from "../components/SelfStorageCheckoutRequest";
import { FullRentCheckout } from "../components/FullRentCheckout";
import {TermsModal,TermsReviewCard} from "../components/TermsReview";
import { reservationProgress } from "../domain/reservationProgress";
import {rentalDetailTarget} from '../domain/rentalDetailTarget';
import {colors} from '../theme/tokens';
import {selfBookingTermsAcceptanceKey} from "../domain/bookingTermsAcceptance";
import {activeRentalFilterCount,emptyRentalFilters,filterAndSortRentals,rentalFacilityId,rentalFacilityName,rentalStatusOptions,type RentalListFilters,type RentalServiceFilter,type RentalSort,type RentalStatusFilter,type RentalTimeFilter} from '../domain/rentalList';
import {
  BookingCalendar,
  bookingDateLabel,
} from "../components/BookingCalendar";
import {
  canStartOn,
  rentalEndDate,
  termKey,
  termLabels,
  todayInVietnam,
  type RentalTerm,
} from "../domain/liveBooking";

function rentalLabel(r: ReservationDto) {
  const progress = reservationProgress(r);
  if (progress) return progress.summary;
  const label = lifecycle(r).label;
  return label !== r.status
    ? label
    : ({
        OVERDUE: "Quá hạn",
        CHECKED_OUT: "Đã trả kho",
        CLOSED: "Đã đóng",
        CANCELLED: "Đã hủy",
      }[r.status as string] ?? "Đang cập nhật");
}

function extensionStatusLabel(status:string){return ({PENDING_PAYMENT:'Chờ thanh toán',PAID:'Đã thanh toán · chờ ký phụ lục',ACTIVE:'Đã gia hạn',CANCELLED:'Đã hủy',REJECTED:'Không được chấp thuận'} as Record<string,string>)[status]??'Đang cập nhật';}

export function RentalCard({ r,variant='compact' }: { r: ReservationDto;variant?:'compact'|'detailed' }) {
  const router = useRouter();
  const openRental = () => router.push(rentalDetailTarget(r) as Href);
  const facilityName=typeof r.facilityId==='object'&&typeof r.facilityId.name==='string'?r.facilityId.name:undefined;
  const unit=typeof r.storageUnitId==='object'?r.storageUnitId:undefined;
  const unitCount=r.serviceType==='SELF_STORAGE'?(r.storageUnitId?1:undefined):r.allocatedCellIds?.length;
  const estimatedRent=r.estimatedRent;
  const endAt=Date.parse(r.endDate),now=Date.now();
  const expiringSoon=r.status==='ACTIVE'&&endAt>now&&endAt<=now+30*24*60*60*1000;
  const statusTone=r.status==='CANCELLED'||r.status==='OVERDUE'?'danger':r.status==='CLOSED'||r.status==='CHECKED_OUT'?'neutral':r.status==='ACTIVE'?'green':'orange';
  const sizeLabel=unit?.size==='SMALL'?'Nhỏ':unit?.size==='MEDIUM'?'Vừa':unit?.size==='LARGE'?'Lớn':undefined;
  return (
    <Card style={[r.status==='ACTIVE'?rentalCardStyles.activeCard:undefined,variant==='detailed'?rentalCardStyles.detailedCard:undefined]}>
      <View style={rentalCardStyles.topRow}>
        <View style={rentalCardStyles.titleGroup}>
          <IconBadge name={r.serviceType==='SELF_STORAGE'?'key-outline':'file-tray-stacked-outline'}/>
          <View style={rentalCardStyles.titleCopy}>
            <AppText variant="card" numberOfLines={1}>{r.reservationCode}</AppText>
            <AppText variant="caption" style={{color:colors.muted}}>{serviceLabel(r.serviceType)}</AppText>
          </View>
        </View>
        {variant==='compact'&&<Chip label={rentalLabel(r)} tone={statusTone}/>}
      </View>
      {variant==='detailed'&&<View style={rentalCardStyles.statusRow}><Chip label={rentalLabel(r)} tone={statusTone}/></View>}
      <ContractSigningNotice reservation={r}/>
      {expiringSoon&&<TintedPanel tone="amber"><AppText variant="label" style={{color:colors.orangeText}}>Đơn thuê sẽ kết thúc trong 30 ngày</AppText></TintedPanel>}
      <RentalInfo label="Cơ sở" value={facilityName}/>
      {r.serviceType==='SELF_STORAGE'?<>
        <RentalInfo label="Kho" value={unit?.unitCode}/>
        {(sizeLabel||unit?.volumeM3!==undefined)&&<View style={rentalCardStyles.chips}>
          {sizeLabel&&<Chip label={`Kích thước ${sizeLabel}`} tone="neutral"/>}
          {unit?.volumeM3!==undefined&&<Chip label={`Thể tích ${unit.volumeM3.toLocaleString('vi-VN')} m³`} tone="neutral"/>}
          {unitCount!==undefined&&<Chip label={`${unitCount} kho`} tone="neutral"/>}
        </View>}
      </>:<>
        <RentalInfo label="Số ô được phân bổ" value={unitCount===undefined?undefined:String(unitCount)}/>
      </>}
      <RentalInfo label="Thời hạn" value={`${dateLabel(r.startDate)} – ${dateLabel(r.endDate)}`}/>
      {estimatedRent!==undefined&&<View style={rentalCardStyles.priceRow}>
        <AppText style={{color:colors.muted}}>Tổng tiền thuê</AppText>
        <AppText variant="medium" style={{color:colors.primary}}>{money(estimatedRent)}</AppText>
      </View>}
      <NavigationRow label="Xem chi tiết" onPress={openRental}/>
    </Card>
  );
}

function RentalInfo({label,value}:{label:string;value?:string}){
  return <View style={rentalCardStyles.infoRow}>
    <AppText variant="caption" style={{color:colors.muted}}>{label}</AppText>
    <AppText variant="medium" style={rentalCardStyles.infoValue}>{value||'Chưa có thông tin'}</AppText>
  </View>;
}

const rentalCardStyles=StyleSheet.create({
  activeCard:{borderColor:'#cce7d8',borderWidth:1},
  detailedCard:{padding:18},
  topRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  statusRow:{alignItems:'flex-start'},
  titleGroup:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:10},
  titleCopy:{flex:1,minWidth:0},
  infoRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12},
  infoValue:{flex:1,textAlign:'right'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  priceRow:{borderTopWidth:1,borderColor:colors.line,paddingTop:10,flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
});
export function Rentals() {
  const router=useRouter();
  const owner = useLiveSession((s) => s.user?._id ?? "");
  const data = useResource(owner, (signal) =>
    mobileRepo.rentals(owner, signal),
  );
  const [query,setQuery]=useState('');
  const [filters,setFilters]=useState<RentalListFilters>(emptyRentalFilters);
  const [draft,setDraft]=useState<RentalListFilters>(emptyRentalFilters);
  const [filterOpen,setFilterOpen]=useState(false);
  const facilities=Array.from(new Map((data.data??[]).map(r=>{const id=rentalFacilityId(r);return [id,{id,name:rentalFacilityName(r)||`Cơ sở · ${id.slice(-4)}`} ] as const;})).values());
  const visible=data.data?filterAndSortRentals(data.data,query,filters):[];
  const activeCount=activeRentalFilterCount(filters)+(filters.service!=='ALL'?1:0)+(query.trim()?1:0);
  const clearFilters=()=>{setQuery('');setFilters(emptyRentalFilters);};
  return (
    <LiveScreen
      title="Kho của tôi"
      eyebrow="ĐƠN THUÊ"
      subtitle="Quản lý và theo dõi các đơn thuê kho"
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <ResourceState {...data} />
      {data.data&&<>
        <View style={rentalListStyles.searchRow}>
          <View style={rentalListStyles.searchBox}><Icon name="search-outline" size={19} color={colors.muted}/><TextInput accessibilityLabel="Tìm mã đơn, cơ sở, mã kho" placeholder="Tìm mã đơn, cơ sở, mã kho..." placeholderTextColor={colors.inactive} value={query} onChangeText={setQuery} returnKeyType="search" style={rentalListStyles.searchInput}/>{!!query&&<Pressable accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm" hitSlop={10} onPress={()=>setQuery('')}><Icon name="close-circle" size={20} color={colors.muted}/></Pressable>}</View>
          <Button label={activeCount?`Bộ lọc · ${activeCount}`:'Bộ lọc'} variant="outline" icon="options-outline" onPress={()=>{setDraft({...filters,statuses:[...filters.statuses]});setFilterOpen(true);}}/>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rentalListStyles.serviceRow}>{([['ALL','Tất cả'],['SELF_STORAGE','Kho tự quản'],['MANAGED_INVENTORY','Kho ký gửi']] as [RentalServiceFilter,string][]).map(([value,label])=><Filter key={value} label={label} selected={filters.service===value} onPress={()=>setFilters(current=>({...current,service:value}))}/>)}</ScrollView>
        <View style={rentalListStyles.resultRow}><AppText variant="caption" style={{color:colors.muted}}>{visible.length} đơn thuê</AppText>{activeCount>0&&<Pressable accessibilityRole="button" onPress={clearFilters}><AppText variant="caption" style={{color:colors.primary}}>Xóa bộ lọc</AppText></Pressable>}</View>
        {data.data.length===0?<><StateCard title="Bạn chưa có đơn thuê nào." description="Khám phá các cơ sở và lựa chọn kho phù hợp với nhu cầu của bạn."/><Button label="Khám phá kho" onPress={()=>router.push('/(tabs)/explore')}/></>:visible.length===0?<><StateCard title="Không tìm thấy đơn thuê phù hợp." description="Thử đổi từ khóa hoặc xóa bộ lọc đang áp dụng."/><Button label="Xóa bộ lọc" variant="outline" onPress={clearFilters}/></>:visible.map(r=><RentalCard key={r._id} r={r} variant="detailed"/>)}
        <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={()=>setFilterOpen(false)}>
          <Pressable style={rentalListStyles.scrim} onPress={()=>setFilterOpen(false)}><View/></Pressable>
          <View style={rentalListStyles.sheet}><View style={rentalListStyles.sheetHeader}><AppText variant="heading">Bộ lọc</AppText><Pressable accessibilityRole="button" accessibilityLabel="Đóng bộ lọc" hitSlop={10} onPress={()=>setFilterOpen(false)}><Icon name="close-outline"/></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:16,paddingBottom:12}}>
              <FilterGroup title="Trạng thái"><View style={ui.wrap}>{rentalStatusOptions.map(option=><Filter key={option.id} label={option.label} selected={draft.statuses.includes(option.id)} onPress={()=>setDraft(current=>({...current,statuses:current.statuses.includes(option.id)?current.statuses.filter(s=>s!==option.id):[...current.statuses,option.id]}))}/>)}</View></FilterGroup>
              <FilterGroup title="Cơ sở"><View style={ui.wrap}><Filter label="Tất cả" selected={draft.facilityId==='ALL'} onPress={()=>setDraft(current=>({...current,facilityId:'ALL'}))}/>{facilities.map(f=><Filter key={f.id} label={f.name} selected={draft.facilityId===f.id} onPress={()=>setDraft(current=>({...current,facilityId:f.id}))}/>)}</View></FilterGroup>
              <FilterGroup title="Thời hạn thuê"><View style={ui.wrap}>{([['ALL','Tất cả'],['ENDING_30_DAYS','Sắp hết hạn trong 30 ngày'],['ENDED_TERM','Đã hết thời hạn']] as [RentalTimeFilter,string][]).map(([value,label])=><Filter key={value} label={label} selected={draft.time===value} onPress={()=>setDraft(current=>({...current,time:value}))}/>)}</View></FilterGroup>
              <FilterGroup title="Sắp xếp"><View style={ui.wrap}>{([['NEWEST','Mới nhất'],['OLDEST','Cũ nhất'],['END_ASC','Ngày kết thúc gần nhất'],['END_DESC','Ngày kết thúc xa nhất']] as [RentalSort,string][]).map(([value,label])=><Filter key={value} label={label} selected={draft.sort===value} onPress={()=>setDraft(current=>({...current,sort:value}))}/>)}</View></FilterGroup>
            </ScrollView>
            <View style={rentalListStyles.sheetActions}><Button label="Đặt lại" variant="outline" onPress={()=>setDraft({...emptyRentalFilters,statuses:[]})}/><View style={{flex:1}}/><Button label="Áp dụng" onPress={()=>{setFilters({...draft,statuses:[...draft.statuses]});setFilterOpen(false);}}/></View>
          </View>
        </Modal>
      </>}
    </LiveScreen>
  );
}
function FilterGroup({title,children}:{title:string;children:ReactNode}){return <View style={{gap:9}}><AppText variant="label">{title}</AppText>{children}</View>;}
const rentalListStyles=StyleSheet.create({searchRow:{flexDirection:'row',alignItems:'center',gap:8},searchBox:{flex:1,minWidth:0,minHeight:48,flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:colors.card,paddingHorizontal:12},searchInput:{flex:1,minWidth:0,color:colors.text,paddingVertical:10,fontSize:14},serviceRow:{gap:8,paddingRight:8},resultRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},scrim:{...StyleSheet.absoluteFill,backgroundColor:'rgba(12,24,20,0.45)'},sheet:{position:'absolute',left:0,right:0,bottom:0,maxHeight:'88%',backgroundColor:colors.card,borderTopLeftRadius:22,borderTopRightRadius:22,padding:20,paddingBottom:28,gap:16},sheetHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},sheetActions:{flexDirection:'row',alignItems:'center',gap:10,borderTopWidth:1,borderColor:colors.line,paddingTop:12}});
export function RentalDetail({ id }: { id: string }) {
  const owner = useLiveSession((s) => s.user?._id ?? ""),
    router = useRouter();
  const data = useResource(owner + ":" + id, (signal) =>
    mobileRepo.rental(id, owner, signal),
  );
  const r = data.data;
  const cancellation = r?.serviceType === "SELF_STORAGE" && r.rentalPaymentFlow === "FULL_UPFRONT_V1" &&
    ["RESERVED","CONTRACTED"].includes(r.status) && r.customerCancellationEligible === true;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancelBusy = useRef(false);
  useEffect(() => { setCancelOpen(false); setCancelError(""); }, [id, owner]);
  async function cancel() {
    if (!r || !cancellation || cancelBusy.current) return;
    cancelBusy.current = true;
    setCancelPending(true);
    setCancelError("");
    try {
      const latest = await mobileRepo.rental(id, owner);
      if (useLiveSession.getState().user?._id !== owner) return;
      await mobileRepo.cancelUpfrontRental(latest, owner);
      if (useLiveSession.getState().user?._id === owner) {
        setCancelOpen(false);
        data.reload();
      }
    } catch (cause) {
      if (useLiveSession.getState().user?._id === owner) setCancelError(apiIssue(cause));
    } finally {
      cancelBusy.current = false;
      setCancelPending(false);
    }
  }
  const facility =
    typeof r?.facilityId === "object" && typeof r.facilityId.name === "string"
      ? r.facilityId.name
      : undefined;
  const unit =
    typeof r?.storageUnitId === "object" &&
    typeof r.storageUnitId?.unitCode === "string"
      ? r.storageUnitId.unitCode
      : undefined;
  return (
    <LiveScreen
      title="Chi tiết đơn thuê"
      eyebrow="HỒ SƠ THUÊ"
      subtitle="Thông tin kho, hợp đồng và tiến độ của đơn thuê."
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <ResourceState {...data} />
      {r && (
        <Card>
          <AppText variant="card">{r.reservationCode}</AppText>
          <AppText>{rentalLabel(r)}</AppText>
          <ContractSigningNotice reservation={r}/>
          {r.serviceType === "SELF_STORAGE" && r.rentalPaymentFlow === "FULL_UPFRONT_V1" && r.status === "ACTIVE" &&
            <AppText>Kho đã được bàn giao. Vui lòng liên hệ cơ sở để được hướng dẫn truy cập.</AppText>}
          <AppText>
            {dateLabel(r.startDate)} – {dateLabel(r.endDate)}
          </AppText>
          {r.serviceType === "SELF_STORAGE" && (
            <>
              <AppText>Cơ sở: {facility ?? "Chưa có thông tin"}</AppText>
              <AppText>Kho: {unit ?? "Chưa có thông tin"}</AppText>
            </>
          )}
          <Button
            label="Xem hợp đồng"
            icon="document-text-outline"
            variant="outline"
            onPress={() =>
              router.push({
                pathname: "/rentals/[id]/contract",
                params: { id },
              })
            }
          />
          {r.serviceType === "SELF_STORAGE" && r.status !== "CANCELLED" && (
            <Button
              label="Thanh toán và lịch sử"
              icon="card-outline"
              onPress={() =>
                router.push({
                  pathname: "/rentals/[id]/payment",
                  params: { id },
                })
              }
            />
          )}
          {r.serviceType === "SELF_STORAGE" && r.status === "ACTIVE" && (
            <Button
              label="Gia hạn hợp đồng"
              icon="calendar-outline"
              variant="outline"
              onPress={() => router.push((`/rentals/${encodeURIComponent(id)}/renewal`) as Href)}
            />
          )}
        </Card>
      )}
      <SelfStorageCheckoutRequest key={"checkout:" + owner + ":" + id} rental={r} owner={owner} id={id} reload={data.reload} />
      {r?.serviceType === "SELF_STORAGE" && (
        <Card>
          <AppText variant="card">Lịch sử gia hạn</AppText>
          {!r.extendContract?.length && <AppText>Chưa có yêu cầu gia hạn.</AppText>}
          {r.extendContract?.map((extension, index) => (
            <View key={extension._id ?? `${extension.status}:${index}`} style={{gap:6,borderTopWidth:index?1:0,borderTopColor:'#DCE7E1',paddingTop:index?12:0}}>
              <AppText variant="label">{extension.status==='ACTIVE'?'Gia hạn thành công':extensionStatusLabel(extension.status)}</AppText>
              {extension.extensionCode && <AppText>Mã gia hạn: {extension.extensionCode}</AppText>}
              {extension.createdAt && extension.status!=='ACTIVE' && <AppText>Ngày tạo yêu cầu: {dateLabel(extension.createdAt)}</AppText>}
              {extension.durationMonths !== undefined && <AppText>Kỳ hạn gia hạn: {extension.durationMonths} tháng</AppText>}
              {extension.amount !== undefined && <AppText>Phí gia hạn: {money(extension.amount)}</AppText>}
              {extension.oldEndDate && <AppText>Hạn thuê trước gia hạn: {dateLabel(extension.oldEndDate)}</AppText>}
              {extension.newEndDate && <AppText>Hạn thuê sau gia hạn: {dateLabel(extension.newEndDate)}</AppText>}
              {extension.verifiedAt && <AppText>Ngày xác nhận: {dateLabel(extension.verifiedAt)}</AppText>}
              {extension.rejectionReason && <AppText>{extension.rejectionReason}</AppText>}
            </View>
          ))}
        </Card>
      )}
      {cancellation && <Button label="Hủy đơn thuê" variant="outline" onPress={() => { setCancelError(""); setCancelOpen(true); }} />}
      <Modal visible={cancelOpen} transparent animationType="none" onRequestClose={() => { if (!cancelBusy.current) setCancelOpen(false); }}>
        <View accessibilityViewIsModal style={{flex:1, justifyContent:"center", padding:20, backgroundColor:"rgba(0,0,0,0.55)"}}>
          <Card>
            <AppText variant="heading">Hủy đơn thuê</AppText>
            <AppText>Hủy đơn sẽ kết thúc giữ chỗ sau khi máy chủ xác nhận. Giao dịch PayOS được xử lý riêng.</AppText>
            {!!cancelError && <AppText accessibilityRole="alert">{cancelError}</AppText>}
            <Button label="Giữ đơn thuê" variant="outline" disabled={cancelPending} onPress={() => setCancelOpen(false)} />
            <Button label="Xác nhận hủy đơn thuê" loading={cancelPending} disabled={!cancellation} onPress={() => void cancel()} />
          </Card>
        </View>
      </Modal>
      {r?.serviceType === "SELF_STORAGE" && (
        <RentalProgress
          key={"progress:" + owner + ":" + id}
          reservation={r}
          owner={owner}
          onRetry={data.reload}
        />
      )}
    </LiveScreen>
  );
}

function RentalProgress({
  reservation,
  owner,
  onRetry,
}: {
  reservation: ReservationDto;
  owner: string;
  onRetry: () => void;
}) {
  const router = useRouter();
  const read = useResource(owner + ":" + reservation._id, (signal) =>
    readRentalPayment(reservation, owner, signal, true),
  );
  if (read.error)
    return (
      <StateCard
        kind="error"
        title="Chưa thể xác minh tiến độ"
        description={read.error}
        onRetry={read.reload}
      />
    );
  const progress = read.data
    ? reservationProgress(reservation, {
        ...read.data,
        decision: read.data.decision.kind,
      })
    : null;
  if (!progress) return <ResourceState {...read} />;
  return (
    <View style={{gap:12}}>
    {!!read.data?.historyError&&<StateCard kind="error" title="Chưa tải được lịch sử thanh toán" description={read.data.historyError} onRetry={read.reload}/>}
    <ReservationProgressTracker
      progress={progress}
      onAction={(action) =>
        router.push(
          action.destination === "PAYMENT"
            ? {
                pathname: "/rentals/[id]/payment",
                params: {
                  id: reservation._id,
                  ...(action.purpose ? { purpose: action.purpose } : {}),
                },
              }
            : {
                pathname: "/rentals/[id]/contract",
                params: { id: reservation._id },
              },
        )
      }
    />
    </View>
  );
}

export { Contract } from "./LiveContract";

export function BookingReview() {
  const { facilityId, unitId } = useLocalSearchParams<{
    facilityId: string;
    unitId: string;
  }>();
  return (
    <BookingForm
      key={facilityId + ":" + unitId}
      facilityId={facilityId}
      unitId={unitId}
    />
  );
}

function BookingForm({
  facilityId,
  unitId,
}: {
  facilityId: string;
  unitId: string;
}) {
  const owner = useLiveSession((s) => s.user?._id ?? ""),
    router = useRouter();
  const [start, setStart] = useState(""),
    [month, setMonth] = useState(() => todayInVietnam().slice(0, 7));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [durationUnit, setDurationUnit] = useState<RentalTerm["unit"]>("MONTH"),
    [selectedTerm, setSelectedTerm] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false);
  const preflight = useRef<AbortController | null>(null);
  useEffect(() => () => preflight.current?.abort(), []);
  const unitData = useResource(facilityId + ":" + unitId, (signal) =>
    mobileRepo.unit(facilityId, unitId, signal),
  );
  const status = unitData.data?.status;
  const unitReady =
    status === "AVAILABLE" || status === "OCCUPIED" || status === "HELD";
  const monthly = useResource(
    unitId + ":" + month + ":" + unitReady,
    (signal) =>
      unitReady
        ? mobileRepo.monthlyAvailability(unitId, month, signal)
        : Promise.resolve(null),
  );
  const size = unitReady ? unitData.data?.size : undefined;
  const terms = useResource(facilityId + ":" + size + ":" + start, (signal) =>
    start && size
      ? mobileRepo.bookingTerms(facilityId, size, start, signal)
      : Promise.resolve([]),
  );
  const term = terms.data?.find((option) => termKey(option) === selectedTerm);
  const end = term ? rentalEndDate(start, term) : undefined;
  const period =
    start && start >= todayInVietnam() && end && term ? { start, end, ...term } : null;
  const scope = period
    ? JSON.stringify([facilityId, unitId, start, end, selectedTerm])
    : "";
  const review = useResource(owner + ":" + scope, async (signal) => {
    if (!period) return null;
    const store = await journal(
      "booking",
      owner,
      JSON.stringify([facilityId, unitId, start, end]),
    );
    const attempt = await store.read();
    const quote = attempt
      ? null
      : await mobileRepo.quote(facilityId, unitId, period, signal);
    return { quote, attempt, store };
  });

  const facility = useResource("booking-facility:" + facilityId, signal => mobileRepo.facility(facilityId, signal));
  const supportedFacility = facility.data?.serviceTypes.includes("SELF_STORAGE") === true;
  const policy = useResource("self-storage-policy", signal => mobileRepo.bookingPolicy(signal));
  const [acceptedKey, setAcceptedKey] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const termsVersionId=policy.data?.versionId;
  const termsAcceptanceKey=selfBookingTermsAcceptanceKey(termsVersionId,{facilityId,unitId,start,termKey:selectedTerm,quote:review.data?.quote});

  async function confirm() {
    const currentReview = review.data;
    if (busy.current || !period || !currentReview || !supportedFacility) return;
    busy.current = true;
    setPending(true);
    setError("");
    const { store, quote } = currentReview;
    const controller = new AbortController();
    preflight.current = controller;
    async function continueWithReservation(rental: ReservationDto) {
      if (controller.signal.aborted || useLiveSession.getState().user?._id !== owner) return;
      if (rental.status !== "CONTRACTED") {
        router.replace({pathname:"/preview/[kind]/[id]",params:{kind:"rental",id:rental._id}});
        return;
      }
      const contract = await mobileRepo.contract(rental, owner, controller.signal);
      if (!contract || contract.status !== "DRAFT")
        throw new MobileInputError("Đã lưu mã đơn. Chưa xác minh được hợp đồng nháp; hãy kiểm tra Kho của tôi trước khi thanh toán.");
      if (!controller.signal.aborted && useLiveSession.getState().user?._id === owner)
        router.replace({pathname:"/rentals/[id]/payment",params:{id:rental._id}});
    }
    let creating = false;
    try {
      let attempt = await store.read();
      if (attempt?.resourceId) {
        const r = await mobileRepo.rental(
          attempt.resourceId,
          owner,
          controller.signal,
        );
        await continueWithReservation(r);
        return;
      }
      if (!attempt) {
        if (!quote || !termsAcceptanceKey || acceptedKey !== termsAcceptanceKey || !termsVersionId)
          throw new MobileInputError("Không xác minh được lần đặt kho đã lưu.");
        const currentPolicy = await mobileRepo.bookingPolicy(controller.signal);
        if (currentPolicy.versionId !== termsVersionId) {
          setAcceptedKey("");
          policy.reload();
          throw new MobileInputError("Điều khoản đã thay đổi. Vui lòng đọc và xác nhận phiên bản mới.");
        }
        const fresh = await mobileRepo.quote(
          facilityId,
          unitId,
          period,
          controller.signal,
        );
        if (
          JSON.stringify(fresh.estimate) !== JSON.stringify(quote.estimate) ||
          JSON.stringify(fresh.body) !== JSON.stringify(quote.body)
        ) {
          throw new MobileInputError(
            "Giá hoặc kỳ thuê đã thay đổi. Vui lòng kiểm tra và xác nhận lại.",
          );
        }
        if (
          controller.signal.aborted ||
          useLiveSession.getState().user?._id !== owner
        )
          return;
        attempt = { ...newAttempt(), bookingBody: { ...fresh.body, termsAccepted: true, termsVersionId } };
        if (!(await store.claim(attempt)))
          throw new MobileInputError(
            "Đã có lần đặt kho. Vui lòng kiểm tra lại.",
          );
      }
      if (!attempt.bookingBody)
        throw new MobileInputError(
          "Không xác minh được lần đặt kho đã lưu. Hãy kiểm tra Kho của tôi.",
        );
      if (
        controller.signal.aborted ||
        useLiveSession.getState().user?._id !== owner
      )
        return;
      creating = true;
      const r = await mobileRepo.book(attempt.bookingBody, attempt.key, owner);
      creating = false;
      await store.write({ ...attempt, resourceId: r._id }).catch(() => {});
      await continueWithReservation(r);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const conflict =
        creating && axios.isAxiosError(cause) && cause.response?.status === 409;
      setError(
        conflict
          ? "Kho không còn trống hoặc trạng thái đặt kho đã thay đổi. Hãy kiểm tra Kho của tôi hoặc chọn kỳ thuê khác."
          : apiIssue(cause),
      );
      if (conflict) {
        setStart("");
        setSelectedTerm("");
      }
      monthly.reload();
      review.reload();
    } finally {
      preflight.current = null;
      busy.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const quote = review.data?.quote;
  const availableUnits = (["DAY", "MONTH", "YEAR"] as const).filter((unit) =>
    terms.data?.some((term) => term.unit === unit),
  );
  const activeUnit = availableUnits.includes(durationUnit)
    ? durationUnit
    : availableUnits[0];
  return (
    <LiveScreen
      title="Kỳ thuê và xác nhận"
      eyebrow="ĐẶT KHO · THỜI HẠN"
      subtitle="Chọn ngày bắt đầu và kỳ hạn để xem báo giá."
    >
      <ResourceState {...facility} />
      <ResourceState {...unitData} />
      {facility.data && !supportedFacility && <StateCard title="Cơ sở không hỗ trợ kho tự quản" />}
      {unitData.data && !unitReady ? (
        <StateCard
          title="Kho không khả dụng"
          description="Vui lòng quay lại và chọn kho khác."
        />
      ) : null}
      {unitReady && supportedFacility && (
        <Card>
          <CardHeading
            icon="calendar-outline"
            title={`Kho ${unitData.data?.unitCode ?? ""}`}
          />
          <AppText>Cơ sở: {facility.data?.name}</AppText>
          <AppText variant="label">Ngày bắt đầu</AppText>
          <Button
            label={
              calendarOpen
                ? "Đóng lịch"
                : start
                  ? bookingDateLabel(start)
                  : "Chọn ngày bắt đầu"
            }
            variant="outline"
            disabled={pending}
            onPress={() => setCalendarOpen(!calendarOpen)}
          />
          {calendarOpen && (
            <BookingCalendar
              month={month}
              setMonth={setMonth}
              selected={start}
              resource={monthly}
              onSelect={(date) => {
                if (!pending && canStartOn(date, monthly.data ?? undefined)) {
                  monthly.reload();
                  setStart(date);
                  setSelectedTerm("");
                  setCalendarOpen(false);
                  setError("");
                }
              }}
            />
          )}
          {start ? (
            <>
              <AppText variant="label">Thời hạn thuê</AppText>
              <ResourceState {...terms} />
              {terms.data?.length === 0 ? (
                <AppText>Không có kỳ hạn áp dụng cho ngày này.</AppText>
              ) : null}
              {!pending && (
                <View style={ui.wrap}>
                  {availableUnits.map((unit) => (
                    <Filter
                      key={unit}
                      label={termLabels[unit]}
                      selected={activeUnit === unit}
                      onPress={() => {
                        if (activeUnit !== unit) {
                          setDurationUnit(unit);
                          setSelectedTerm("");
                          setError("");
                        }
                      }}
                    />
                  ))}
                </View>
              )}
              {!pending && (
                <View style={ui.wrap}>
                  {terms.data
                    ?.filter((term) => term.unit === activeUnit)
                    .map((option) => (
                      <Filter
                        key={termKey(option)}
                        label={
                          option.value +
                          " " +
                          termLabels[option.unit].toLowerCase()
                        }
                        selected={selectedTerm === termKey(option)}
                        onPress={() => {
                          setSelectedTerm(termKey(option));
                          setError("");
                        }}
                      />
                    ))}
                </View>
              )}
            </>
          ) : null}
          {end ? (
            <AppText>Ngày kết thúc: {bookingDateLabel(end)}</AppText>
          ) : null}
          {period && <ResourceState {...review} />}
          {quote && (
            <TintedPanel>
              <AppText variant="label">CHI PHÍ DỰ KIẾN</AppText>
              <AppText>
                Tổng tiền thuê dự kiến {money(quote.estimate.estimatedRent)}
              </AppText>
              <AppText>Thanh toán 100% qua PayOS. Số tiền giao dịch do máy chủ xác nhận.</AppText>
              <AppText>Kho còn trống trong kỳ thuê đã chọn theo kiểm tra của máy chủ.</AppText>
            </TintedPanel>
          )}
          {quote&&<>
            <ResourceState {...policy}/>
            {policy.data&&<>
              <TermsReviewCard title="Điều khoản thuê kho tự quản" version={policy.data.version}
                accepted={acceptedKey===termsAcceptanceKey&&!!termsAcceptanceKey} onOpen={()=>setPolicyOpen(true)}/>
              <TermsModal visible={policyOpen} title="Điều khoản thuê kho tự quản" version={policy.data.version}
                disabled={pending} onClose={()=>setPolicyOpen(false)} onAccept={()=>{
                  if(policy.data?.versionId===termsVersionId&&termsAcceptanceKey){setAcceptedKey(termsAcceptanceKey);setPolicyOpen(false);}
                }}>
                {policy.data.groups.filter(group=>group.appliesTo.includes("SELF_STORAGE")).map(group=><View key={group.id} style={{gap:8}}>
                  <AppText variant="label">{group.title}</AppText>
                  {group.sections.SELF_STORAGE?.map((line,index)=><AppText key={index}>{line}</AppText>)}
                </View>)}
              </TermsModal>
            </>}
          </>}
          <Button
            label={
              review.data?.attempt
                ? "Khôi phục lần đặt kho"
                : "Xác nhận đặt kho"
            }
            loading={pending}
            disabled={
              !review.data || (!review.data.attempt && (!review.data.quote || !termsAcceptanceKey || acceptedKey !== termsAcceptanceKey || !termsVersionId))
            }
            onPress={() => void confirm()}
          />
        </Card>
      )}
      {review.data?.attempt && <Button label="Mở Kho của tôi" variant="outline" onPress={() => router.push("/rentals")} />}
      {error ? (
        <StateCard
          kind="error"
          title="Chưa thể hoàn tất đặt kho"
          description={error}
        />
      ) : null}
    </LiveScreen>
  );
}

export function Payment() {
  const { id, purpose } = useLocalSearchParams<{
    id: string;
    purpose?: string;
  }>();
  return (
    <PaymentScreen
      key={id + ":" + purpose}
      id={id}
      purpose={purpose === "BALANCE" ? "BALANCE" : "DEPOSIT"}
    />
  );
}

const paymentStatus = {
  PENDING: "Đang chờ xác nhận",
  SUCCEEDED: "Đã nhận thanh toán",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy thanh toán",
  RECONCILIATION_REQUIRED: "Cần đối soát",
} as const;
const checkoutStatus = {
  NOT_CREATED: "Chưa tạo",
  CREATING: "Đang tạo",
  READY: "Sẵn sàng",
  UNKNOWN: "Chưa rõ kết quả",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  RECONCILIATION_REQUIRED: "Cần đối soát",
} as const;
const applicationStatus = {
  APPLIED: "Đã ghi nhận vào đơn",
  NOT_APPLIED: "Chưa ghi nhận vào đơn",
  MANUAL_REVIEW: "Chờ đối soát",
} as const;

function PaymentScreen({
  id,
  purpose,
}: {
  id: string;
  purpose: "DEPOSIT" | "BALANCE";
}) {
  const router = useRouter();
  const owner = useLiveSession((s) => s.user?._id ?? "");
  const data = useResource(owner + ":" + id, (signal) =>
    paymentContext(id, owner, signal, true),
  );
  const busy = useRef(false),
    redirected = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const upfront = data.data?.reservation.rentalPaymentFlow === "FULL_UPFRONT_V1";
  const full = data.data?.fullRentDecision;
  const balance = purpose === "BALANCE" && !upfront;
  const decision = balance
    ? data.data?.balanceDecision.kind
    : data.data?.decision.kind;
  const state = data.data?.reservation.status;
  const currentPayment = data.data?.payments.find(row => row.purpose === "FULL_RENT" && row.status === "PENDING");
  const lastCheck = useRef<{id: string; at: number} | null>(null);
  const [blockedIntent, setBlockedIntent] = useState("");
  const paymentId = currentPayment?.id;
  async function verifyFullRent() {
    const reservation = data.data?.reservation;
    if (!reservation || !paymentId || busy.current) { if (!busy.current) data.reload(); return; }
    busy.current = true;
    setBlockedIntent(paymentId);
    setPending(true);
    setError("");
    lastCheck.current = {id: paymentId, at: Date.now()};
    try {
      const verified = await mobileRepo.reconcilePayment(reservation, paymentId, owner);
      if (useLiveSession.getState().user?._id === owner) {
        data.reload();
        if (verified.status === "PENDING" && verified.checkoutStatus === "READY" && !verified.reconciliationRequired) setBlockedIntent("");
      }
    } catch (cause) {
      if (useLiveSession.getState().user?._id === owner) setError(apiIssue(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => {
      if (next !== "active" || busy.current) return;
      if (upfront && paymentId) {
        if (lastCheck.current?.id !== paymentId || Date.now() - lastCheck.current.at >= 15000) void verifyFullRent();
      } else data.reload();
    });
    return () => subscription.remove();
  }, [upfront, paymentId, data.data?.reservation, owner]);
  useEffect(() => {
    if (!redirected.current && upfront && full?.kind === "APPLIED" && ["PAID","CHECKIN_READY","ACTIVE"].includes(state ?? "")) {
      redirected.current = true;
      router.replace({ pathname: "/rentals/[id]/contract", params: { id } });
    }
  }, [upfront, full?.kind, state, router, id]);

  async function createFullPayment() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await createFullRentIntent(id, owner, () => useLiveSession.getState().user?._id === owner);
    } catch (cause) {
      if (useLiveSession.getState().user?._id === owner) setError(apiIssue(cause));
    } finally {
      busy.current = false;
      setPending(false);
      data.reload();
    }
  }
  useEffect(() => {
    if (
      !redirected.current &&
      balance &&
      decision === "APPLIED" &&
      (state === "PAID" || state === "ACTIVE")
    ) {
      redirected.current = true;
      router.replace({
        pathname: "/preview/[kind]/[id]",
        params: { kind: "rental", id },
      });
    }
  }, [balance, decision, state, router, id]);

  async function pay() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await openSelfStoragePayment(
        id,
        owner,
        purpose,
        () => useLiveSession.getState().user?._id === owner,
        (url) => Linking.openURL(url),
      );
    } catch (cause) {
      setError(apiIssue(cause));
    } finally {
      busy.current = false;
      setPending(false);
      data.reload();
    }
  }

  const progress = data.data
    ? reservationProgress(data.data.reservation, {
        ...data.data,
        decision: data.data.decision.kind,
      })
    : null;
  const checkout = !upfront && (decision === "CREATE" || decision === "READY") && (
    <Button
      label={
        decision === "READY"
          ? "Mở liên kết PayOS hiện có"
          : balance
            ? "Xác nhận tạo liên kết PayOS"
            : "Tạo liên kết thanh toán"
      }
      loading={pending}
      onPress={() => void pay()}
    />
  );
  return (
    <LiveScreen
      title={balance ? "Thanh toán phần còn lại" : "Thanh toán PayOS"}
      eyebrow="TÀI CHÍNH ĐƠN THUÊ"
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <AppText>
        Trạng thái thanh toán sẽ được cập nhật sau khi hệ thống xác minh giao dịch.
      </AppText>
      {data.error ? (
        <StateCard
          kind="error"
          title="Chưa thể xác minh tiến độ"
          description={data.error}
          onRetry={data.reload}
        />
      ) : (
        <ResourceState {...data} />
      )}
      {data.data && (
        <Card>
          <CardHeading
            icon="wallet-outline"
            title={data.data.reservation.reservationCode}
            subtitle={
              upfront ? "Thanh toán 100% tiền thuê" : balance ? "Thanh toán phần còn lại" : "Thanh toán tiền cọc"
            }
          />
          <AppText>{rentalLabel(data.data.reservation)}</AppText>
          {!upfront && decision === "APPLIED" && (
            <TintedPanel>
              <AppText accessibilityLiveRegion="polite">
                {balance
                  ? "Số dư đã được xác minh và ghi nhận."
                  : "Tiền đặt cọc đã được xác minh và ghi nhận."}
              </AppText>
            </TintedPanel>
          )}
          {!upfront && decision === "REVIEW" && (
            <TintedPanel tone="amber">
              <AppText>
                {balance
                  ? "Giao dịch cần được kiểm tra. Vui lòng không thanh toán lại."
                  : "Đã có lần thanh toán. Kiểm tra trạng thái hoặc liên hệ hỗ trợ để đối soát."}
              </AppText>
            </TintedPanel>
          )}
          {decision === "VERIFYING" && (
            <AppText>
              Đã nhận thông tin thanh toán, đang chờ hệ thống ghi nhận.
            </AppText>
          )}
          {decision === "PENDING" && (
            <AppText>Đang chờ xác nhận thanh toán.</AppText>
          )}
          {decision === "ZERO" && (
            <AppText>
              Không có số dư dương. Vui lòng liên hệ cơ sở để xác nhận bước tiếp
              theo.
            </AppText>
          )}
          {!upfront && decision === "INELIGIBLE" && (
            <AppText>
              {balance
                ? "Đơn thuê chưa đủ điều kiện thanh toán số dư."
                : "Đơn thuê hoặc hợp đồng chưa đủ điều kiện thanh toán tiền cọc."}
            </AppText>
          )}
          {upfront && full?.kind === "REVIEW" && <AppText accessibilityLiveRegion="polite">Giao dịch đang chờ xác minh hoặc đối soát. Hãy kiểm tra trạng thái trước khi thử lại.</AppText>}
          {upfront && full?.kind === "INELIGIBLE" && <AppText>Đơn thuê hiện chưa đủ điều kiện tạo giao dịch.</AppText>}
          {upfront && full?.kind === "APPLIED" && <AppText accessibilityLiveRegion="polite">Thanh toán đã được xác minh và ghi nhận.</AppText>}
          {balance && decision === "CREATE" && (
            <AppText>
              Máy chủ xác định số tiền phải trả khi tạo liên kết.
            </AppText>
          )}
        </Card>
      )}
      {progress && (
        <ReservationProgressTracker
          progress={progress}
          paymentScreen
          paymentPurpose={upfront ? "FULL_RENT" : purpose}
          onAction={(action) =>
            router.push(
              action.destination === "PAYMENT"
                ? {
                    pathname: "/rentals/[id]/payment",
                    params: { id, purpose: action.purpose ?? "DEPOSIT" },
                  }
                : { pathname: "/rentals/[id]/contract", params: { id } },
            )
          }
        >
          {checkout}
          {upfront && full?.kind === "CREATE" && <Button label={full.retry ? "Thanh toán lại" : "Tạo giao dịch PayOS"}
            loading={pending} onPress={() => void createFullPayment()} />}
          {upfront && full?.kind === "READY" && blockedIntent !== full.payment.id && !pending &&
            <FullRentCheckout payment={full.payment} url={full.url} />}
          {upfront && <Button label="Kiểm tra trạng thái PayOS" variant="outline" loading={pending} onPress={() => void verifyFullRent()} />}
        </ReservationProgressTracker>
      )}
      {!!error && (
        <StateCard
          kind="error"
          title="Không mở được thanh toán"
          description={error}
          onRetry={data.reload}
        />
      )}
      {data.data && <AppText variant="heading">Lịch sử thanh toán</AppText>}
      {data.data?.payments.map((p) => (
        <Card key={p.id}>
          <CardHeading
            icon="card-outline"
            title={p.purpose === "FULL_RENT" ? "100% tiền thuê" : p.purpose === "DEPOSIT" ? "Đặt cọc" : p.purpose === "BALANCE" ? "Tiền thuê còn lại" : "Gia hạn hợp đồng"}
            subtitle={p.provider}
          />
          <AppText variant="heading">{money(p.amount)}</AppText>
          {p.extensionId&&<AppText>Mã gia hạn: {p.extensionId}</AppText>}
          <Chip
            label={paymentStatus[p.status]}
            tone={p.reconciliationRequired ? "orange" : "neutral"}
          />
          <AppText>Liên kết: {checkoutStatus[p.checkoutStatus]}</AppText>
          <AppText>
            Xác minh thanh toán:{" "}
            {p.providerSettlementStatus === "VERIFIED"
              ? "Đã xác minh"
              : "Chưa xác minh"}
          </AppText>
          <AppText>{applicationStatus[p.applicationStatus]}</AppText>
          <AppText>
            Kiểm tra giao dịch:{" "}
            {p.reconciliationRequired || p.checkoutStatus === "UNKNOWN"
              ? "Cần kiểm tra"
              : "Không có yêu cầu"}
          </AppText>
          <AppText>
            Ngày tạo: {p.createdAt ? dateLabel(p.createdAt) : "Chưa có dữ liệu"}
          </AppText>
          {!!p.succeededAt && (
            <AppText>Ngày thanh toán: {dateLabel(p.succeededAt)}</AppText>
          )}
        </Card>
      ))}
      {data.data?.historyError&&<StateCard kind="error" title="Chưa tải được lịch sử thanh toán" description={data.data.historyError} onRetry={data.reload}/>}
      <Button
        label="Kiểm tra trạng thái"
        icon="refresh-outline"
        variant="outline"
        disabled={pending}
        onPress={data.reload}
      />
    </LiveScreen>
  );
}
