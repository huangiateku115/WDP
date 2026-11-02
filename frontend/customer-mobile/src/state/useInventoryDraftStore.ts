import {create} from 'zustand';
import {inventoryFormSchema, type InventoryFormValues} from '../forms/inventory';
import {inventoryDetails, inventoryRentals} from '../fixtures/inventory';
import {customerFixtures} from '../fixtures/customer';
import {canEditItem} from '../domain/inventory';

export interface SavedInventoryDraft {ownerId: string; key: string; values: InventoryFormValues; sourceFingerprint: string; savedAt: string;}
interface DraftState {
  drafts: Record<string, SavedInventoryDraft>;
  save: (ownerId: string, key: string, values: InventoryFormValues, sourceFingerprint: string) => boolean;
  remove: (ownerId: string, key: string) => void;
  clear: () => void;
}
export const inventoryDraftKey = (ownerId: string, itemId?: string) => `${ownerId}:${itemId ? 'edit:' + itemId : 'register'}`;
// Memory-only drafts, never an InventoryItem collection or device persistence.
export const useInventoryDraftStore = create<DraftState>(set => ({
  drafts: {},
  save: (ownerId, key, values, sourceFingerprint) => {
    if (!ownerId || !key.startsWith(ownerId + ':')) return false;
    if (key !== inventoryDraftKey(ownerId)) {
      const itemId = key.slice((ownerId + ':edit:').length);
      const item = customerFixtures.items.find(i => i.id === itemId);
      const detail = inventoryDetails.find(d => d.itemId === itemId && d.ownerId === ownerId);
      if (!key.startsWith(ownerId + ':edit:') || !item || !detail || !canEditItem(item, detail)) return false;
    }
    const parsed = inventoryFormSchema(ownerId, inventoryRentals).safeParse(values);
    if (!parsed.success) return false;
    set(s => ({drafts: {...s.drafts, [key]: {ownerId, key, values: {...parsed.data, images: [...parsed.data.images]}, sourceFingerprint, savedAt: new Date().toISOString()}}}));
    return true;
  },
  remove: (ownerId, key) => set(s => {if (s.drafts[key]?.ownerId !== ownerId) return {}; const drafts = {...s.drafts}; delete drafts[key]; return {drafts};}),
  clear: () => set({drafts: {}}),
}));
