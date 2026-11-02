import {create} from 'zustand';
import {vietnamToday} from '../domain/booking';
import {assessManagedDraft, cellEligibility, cellEntries, type ManagedDraft} from '../domain/managedBooking';
import {findManagedWarehouse} from '../fixtures/managedWarehouse';

interface ManagedState {
  draft: ManagedDraft | null;
  begin: (facilityId: string) => boolean;
  toggle: (cellId: string) => boolean;
  remove: (cellId: string) => void;
  setPeriod: (start: string, months: number) => void;
  preview: () => boolean;
  clear: () => void;
}
export const useManagedBookingStore = create<ManagedState>((set, get) => ({
  draft: null,
  begin: facilityId => {
    const f = findManagedWarehouse(facilityId);
    if (!f?.managedInventory || f.status !== 'ACTIVE') return false;
    if (get().draft?.facilityId !== facilityId) set({draft: {facilityId, cellIds: [], start: vietnamToday(), months: 1, previewed: false}});
    return true;
  },
  toggle: cellId => {
    const d = get().draft;
    if (!d) return false;
    if (d.cellIds.includes(cellId)) {
      set({draft: {...d, cellIds: d.cellIds.filter(id => id !== cellId), previewed: false, previewFingerprint: undefined}});
      return true;
    }
    const f = findManagedWarehouse(d.facilityId), entry = cellEntries(f).find(e => e.cell.id === cellId);
    if (!f || !entry || !cellEligibility(f, entry.zone, entry.rack, entry.cell, d.start, d.months).eligible) return false;
    set({draft: {...d, cellIds: [...d.cellIds, cellId], previewed: false, previewFingerprint: undefined}});
    return true;
  },
  remove: cellId => set(s => ({draft: s.draft ? {...s.draft, cellIds: s.draft.cellIds.filter(id => id !== cellId), previewed: false, previewFingerprint: undefined} : null})),
  // Keep invalid selections visible so the customer can resolve them explicitly.
  setPeriod: (start, months) => set(s => ({draft: s.draft ? {...s.draft, start, months, previewed: false, previewFingerprint: undefined} : null})),
  preview: () => {
    const d = get().draft, check = assessManagedDraft(findManagedWarehouse(d?.facilityId), d);
    if (!d || !check.valid || !check.quote || d.previewed) return false;
    set({draft: {...d, previewed: true, previewFingerprint: check.fingerprint!}});
    return true;
  },
  clear: () => set({draft: null}),
}));
