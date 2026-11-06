import {create} from 'zustand';
import type {Fixtures} from '../domain/models';
import {inboundRequestSchema, outboundRequestSchema, requestActionEligibility, requestFingerprint, type InboundValues, type OutboundValues, type RequestIntent, type RequestKind} from '../domain/inventoryRequests';
import {requestContext, scopedRequest} from '../fixtures/inventoryRequests';

export interface RequestDraft {
  ownerId: string; itemId: string; kind: RequestKind; intent: RequestIntent; requestId?: string;
  values: InboundValues | OutboundValues | null; sourceFingerprint: string; updatedAt: string;
  localStatus: 'PREVIEW_ONLY';
}
export interface RequestDraftCommand {
  ownerId: string; itemId: string; kind: RequestKind; intent: RequestIntent; requestId?: string;
  values: InboundValues | OutboundValues | null; sourceFingerprint: string; expectedVersion?: number | null;
}
export const requestDraftKey = (c: Pick<RequestDraft, 'ownerId' | 'itemId' | 'kind' | 'intent' | 'requestId'>) => JSON.stringify([c.ownerId, c.itemId, c.kind, c.intent, c.requestId ?? null]);
interface RequestDraftState {
  drafts: Record<string, RequestDraft>;
  confirm: (data: Fixtures, command: RequestDraftCommand) => {ok: boolean; reason?: string};
  remove: (ownerId: string, key: string) => void;
  clear: () => void;
}
// No request IDs, stock holds or synthetic responses. One memory draft per workflow.
export const useRequestDraftStore = create<RequestDraftState>((set, get) => ({
  drafts: {},
  confirm: (data, command) => {
    const c = command, context = requestContext(data, c.itemId, c.kind);
    if (c.intent === 'CREATE' && c.requestId !== undefined || c.intent !== 'CREATE' && !c.requestId) return {ok: false, reason: 'Tham chiếu yêu cầu không phù hợp với thao tác bản nháp.'};
    if (!context || context.ownerId !== c.ownerId) return {ok: false, reason: 'Không tìm thấy Item thuộc khách hàng hiện tại.'};
    const request = c.intent === 'CREATE' ? undefined : scopedRequest(c.ownerId, c.itemId, c.requestId);
    const eligibility = requestActionEligibility(context, request, c.intent, c.kind);
    if (!eligibility.eligible) return {ok: false, reason: eligibility.reason};
    if (c.intent !== 'CREATE' && (!request || !Number.isSafeInteger(c.expectedVersion) || c.expectedVersion !== request.version)) return {ok: false, reason: 'Thiếu phiên bản hoặc phiên bản mẫu đã thay đổi; không lưu thay đổi cũ.'};
    if (requestFingerprint(context, request) !== c.sourceFingerprint) return {ok: false, reason: 'Dữ liệu nguồn đã thay đổi. Quay lại kiểm tra, không xác nhận bản xem trước cũ.'};
    const parsed = c.intent === 'CANCEL' ? null : (c.kind === 'INBOUND' ? inboundRequestSchema(context) : outboundRequestSchema(context)).safeParse(c.values);
    if (parsed && !parsed.success || c.intent !== 'CANCEL' && !parsed) return {ok: false, reason: 'Dữ liệu yêu cầu chưa hợp lệ.'};
    const values = parsed?.success ? parsed.data : null, key = requestDraftKey(c), previous = get().drafts[key];
    if (previous && previous.sourceFingerprint === c.sourceFingerprint && JSON.stringify(previous.values) === JSON.stringify(values)) return {ok: false, reason: 'Bản xem trước này đã được lưu trong phiên; không tạo bản trùng.'};
    set(s => ({drafts: {...s.drafts, [key]: {ownerId: c.ownerId, itemId: c.itemId, kind: c.kind, intent: c.intent, requestId: c.requestId, values, sourceFingerprint: c.sourceFingerprint, updatedAt: new Date().toISOString(), localStatus: 'PREVIEW_ONLY'}}}));
    return {ok: true};
  },
  remove: (ownerId, key) => set(s => {if (s.drafts[key]?.ownerId !== ownerId) return {}; const drafts = {...s.drafts}; delete drafts[key]; return {drafts};}),
  clear: () => set({drafts: {}}),
}));
