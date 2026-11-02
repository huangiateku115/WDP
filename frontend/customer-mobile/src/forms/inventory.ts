import {z} from 'zod';
import type {Illustration, InventoryDetail, InventoryRental} from '../domain/inventory';
import type {InventoryItem} from '../domain/models';

export const inventoryCategories = ['Thực phẩm đóng gói', 'Bao bì', 'Hàng tiêu dùng', 'Hồ sơ'] as const;
export const inventoryUnits = ['túi', 'kiện', 'thùng', 'hộp'] as const;
export interface InventoryFormValues {
  name: string; description: string; category: string; quantity: string; unit: string;
  widthM: string; depthM: string; heightM: string; weightKg: string;
  rentalId: string; preferredCell: string; images: Illustration[];
}
export const emptyInventoryForm = (): InventoryFormValues => ({name: '', description: '', category: '', quantity: '', unit: '', widthM: '', depthM: '', heightM: '', weightKg: '', rentalId: '', preferredCell: '', images: []});
const positiveDecimal = z.string().trim().refine(v => /^\d+(?:[.,]\d{1,3})?$/.test(v) && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) > 0, 'Nhập số dương, tối đa 3 chữ số thập phân.');
export function inventoryFormSchema(ownerId: string, rentals: InventoryRental[]) {
  return z.object({
    name: z.string().trim().min(2, 'Nhập tên hàng ít nhất 2 ký tự.').max(120, 'Tên tối đa 120 ký tự.'),
    description: z.string().trim().max(1000, 'Mô tả tối đa 1.000 ký tự.'),
    category: z.string().refine(v => (inventoryCategories as readonly string[]).includes(v), 'Chọn danh mục hàng.'),
    quantity: z.string().trim().refine(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0, 'Nhập số lượng nguyên dương hợp lệ.'),
    unit: z.string().refine(v => (inventoryUnits as readonly string[]).includes(v), 'Chọn đơn vị tính.'),
    widthM: positiveDecimal, depthM: positiveDecimal, heightM: positiveDecimal, weightKg: positiveDecimal,
    rentalId: z.string().min(1, 'Chọn kỳ thuê kho ký gửi mẫu.'), preferredCell: z.string(),
    images: z.array(z.enum(['box', 'stack', 'label'])).max(3, 'Tối đa 3 hình minh họa.').refine(v => new Set(v).size === v.length, 'Hình minh họa không được trùng.'),
  }).superRefine((v, ctx) => {
    const rental = rentals.find(r => r.id === v.rentalId && r.ownerId === ownerId);
    if (!rental?.canRegister || !['DEPOSIT_PAID', 'ACTIVE'].includes(rental.stage)) ctx.addIssue({code: 'custom', path: ['rentalId'], message: 'Kỳ thuê mẫu chưa đủ điều kiện chuẩn bị danh mục.'});
    if (v.preferredCell && !rental?.preferredCells.includes(v.preferredCell)) ctx.addIssue({code: 'custom', path: ['preferredCell'], message: 'Ô ưu tiên không thuộc kỳ thuê mẫu đã chọn.'});
  });
}
export function initialInventoryForm(item: InventoryItem, detail: InventoryDetail): InventoryFormValues {
  const m = detail.declaredMeasurements;
  return {name: item.name, description: detail.description, category: item.category, quantity: String(item.registeredQuantity), unit: item.unit,
    widthM: m?.widthM == null ? '' : String(m.widthM), depthM: m?.depthM == null ? '' : String(m.depthM), heightM: m?.heightM == null ? '' : String(m.heightM), weightKg: m?.weightKg == null ? '' : String(m.weightKg),
    rentalId: detail.rentalId ?? '', preferredCell: detail.preferredCell ?? '', images: [...detail.images]};
}
