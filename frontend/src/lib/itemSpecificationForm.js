export function itemSpecificationPayload(form) {
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const unitWeightKg = Number(form.unitWeightKg);
  const dimensionsM = { widthM: Number(form.widthCm) / 100, depthM: Number(form.depthCm) / 100, heightM: Number(form.heightCm) / 100 };
  if (!positive(unitWeightKg) || !Object.values(dimensionsM).every(positive)) throw new Error('Nhập khối lượng và ba kích thước dương, hợp lệ.');
  const volume = Math.round((dimensionsM.widthM * dimensionsM.depthM * dimensionsM.heightM + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (!positive(volume)) throw new Error('Thể tích tính được không hợp lệ.');
  if (!/^[a-f\d]{24}$/i.test(form.quantityUnitId || '')) throw new Error('Vui lòng chọn đơn vị tính đang hoạt động.');
  const images=Array.isArray(form.images)?form.images:[];
  if(images.length>10||images.some(url=>typeof url!=='string'||!/^https?:\/\//i.test(url)))throw new Error('Danh sách ảnh không hợp lệ.');
  return { code: String(form.code || '').trim(), name: String(form.name || '').trim(), quantityUnitId: form.quantityUnitId,
    unitWeightKg, dimensionsM, description: String(form.description || '').trim(), images };
}
