import {create} from 'zustand';
import type {Fixtures} from '../domain/models';
import {customerNotifications, careContext} from '../fixtures/customerCare';
import {supportSourceBinding} from '../domain/customerCare';
import {supportFormSchema, type SupportFormValues} from '../forms/support';

export interface SupportDraft {ownerId: string; values: SupportFormValues; sourceBinding: string; savedAt: string;}
interface CareSession {
  readOverrides: Record<string, Record<string, boolean>>; drafts: Record<string, SupportDraft>;
  markRead: (ownerId: string, notificationId?: string) => void;
  saveDraft: (data: Fixtures, values: SupportFormValues, binding: string) => boolean;
  removeDraft: (ownerId: string) => void; clear: () => void;
}
// Session memory only. Never writes source fixtures, credentials or authoritative records.
export const useCareSessionStore = create<CareSession>(set => ({
  readOverrides: {}, drafts: {},
  markRead: (ownerId, id) => {
    const rows = customerNotifications.filter(n => n.ownerId === ownerId && (!id || n.id === id));
    if (!rows.length) return;
    set(s => ({readOverrides: {...s.readOverrides, [ownerId]: {...s.readOverrides[ownerId], ...Object.fromEntries(rows.map(n => [n.id, true]))}}}));
  },
  saveDraft: (data, values, binding) => {
    const ctx = careContext(data), ownerId = data.customer?.id, parsed = supportFormSchema(ctx).safeParse(values);
    if (!ownerId || !parsed.success || binding !== supportSourceBinding(ctx)) return false;
    set(s => ({drafts: {...s.drafts, [ownerId]: {ownerId, values: {...parsed.data}, sourceBinding: binding, savedAt: new Date().toISOString()}}}));
    return true;
  },
  removeDraft: ownerId => set(s => {const drafts = {...s.drafts}; delete drafts[ownerId]; return {drafts};}),
  clear: () => set({readOverrides: {}, drafts: {}}),
}));
