import {z} from 'zod';
export const loginSchema=z.object({
  email:z.string().trim().email('Vui lòng nhập email hợp lệ.').max(254,'Email quá dài.'),
  password:z.string().min(8,'Mật khẩu mẫu cần ít nhất 8 ký tự.').max(128,'Mật khẩu quá dài.'),
});
export type LoginValues=z.infer<typeof loginSchema>;
export const registrationSchema=loginSchema.extend({
  name:z.string().trim().min(2,'Vui lòng nhập họ và tên.').max(100,'Tên quá dài.').transform(v=>v.replace(/\s+/g,' ')),
  email:loginSchema.shape.email.toLowerCase(),
  phone:z.string().trim().regex(/^0\d{9}$/,'Nhập số điện thoại 10 chữ số, bắt đầu bằng 0.'),
  password:loginSchema.shape.password.regex(/^(?=.*[A-Za-z])(?=.*\d)/,'Mật khẩu mẫu cần có chữ cái và chữ số.').refine(v=>v===v.trim(),'Mật khẩu không được có khoảng trắng ở đầu hoặc cuối.'),
  confirmation:z.string(),consent:z.boolean().refine(v=>v,'Vui lòng xác nhận điều khoản/quyền riêng tư minh họa và chỉ dùng thông tin mẫu.'),
}).refine(v=>v.password===v.confirmation,{path:['confirmation'],message:'Mật khẩu xác nhận chưa khớp.'});
export type RegistrationValues=z.infer<typeof registrationSchema>;
