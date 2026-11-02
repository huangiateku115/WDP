import {z} from 'zod';
import {ownedSupportItems, ownedSupportRentals, supportCategories, type CareContext} from '../domain/customerCare';

export const emptySupportForm = () => ({category: '', subject: '', description: '', rentalId: '', itemId: ''});
export type SupportFormValues = ReturnType<typeof emptySupportForm>;
// UI-only thresholds, not Backend DTO rules.
export function supportFormSchema(ctx: CareContext) {
  return z.object({
    category: z.string().refine(v => (supportCategories as readonly string[]).includes(v), 'Vui lòng chọn chủ đề hỗ trợ.'),
    subject: z.string().trim().min(5, 'Tiêu đề cần từ 5 ký tự.').max(120, 'Tiêu đề tối đa 120 ký tự.'),
    description: z.string().trim().min(10, 'Mô tả cần từ 10 ký tự.').max(2000, 'Mô tả tối đa 2.000 ký tự.'),
    rentalId: z.string(), itemId: z.string(),
  }).superRefine((v, issue) => {
    const rentals = ownedSupportRentals(ctx), items = ownedSupportItems(ctx);
    if (!ctx.data.customer) issue.addIssue({code: 'custom', path: ['category'], message: 'Chưa có ngữ cảnh khách hàng mẫu.'});
    if (v.rentalId && !rentals.some(r => r.id === v.rentalId)) issue.addIssue({code: 'custom', path: ['rentalId'], message: 'Kỳ thuê không có trong dữ liệu thuộc khách hàng hiện tại.'});
    const item = items.find(i => i.id === v.itemId);
    if (v.itemId && !item) issue.addIssue({code: 'custom', path: ['itemId'], message: 'Hàng hóa không thuộc khách hàng hiện tại hoặc đã thiếu dữ liệu.'});
    if (item && v.rentalId && item.rentalId !== v.rentalId) issue.addIssue({code: 'custom', path: ['itemId'], message: 'Hàng hóa và kỳ thuê liên quan không khớp.'});
  });
}
