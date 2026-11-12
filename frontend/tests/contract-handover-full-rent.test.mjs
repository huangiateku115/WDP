import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Customer V3 full-upfront contract view requires paper evidence, not a signature button", async () => {
  const source = await readFile(new URL("../src/components/customer/RentalLifecycleIntegration.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(!fullUpfront\) return <BackendScreen title="Reservation Managed cần đối soát"/);
  assert.match(source, /const canSignV3 = false/);
  assert.match(source, /Chờ hoàn tất hợp đồng giấy tại cơ sở/);
  assert.match(source, /Hợp đồng đã được xác minh — sẵn sàng thực hiện thủ tục nhận kho/);
});

test("Customer full-rent payment status never promises Phase 7 auto-cancellation/refund", async () => {
  const source = await readFile(new URL("../src/components/customer/CustomerPaymentNavigation.jsx", import.meta.url), "utf8");
  assert.match(source, /Đã thanh toán 100% — Chờ ký hợp đồng tại cơ sở/);
  assert.match(source, /không tự hủy hoặc tự hoàn tiền/);
  assert.doesNotMatch(source, /tự động hủy đơn và khấu trừ 10%/);
});
