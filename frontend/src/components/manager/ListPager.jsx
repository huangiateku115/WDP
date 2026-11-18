import { Button } from "@/components/ui/button";

const number = new Intl.NumberFormat("vi-VN");

// One prev/next control shared by every BOM/Admin table, so a list is either paged by the backend
// (`pagination` from the response) or sliced in the browser, with the same labels and disabled
// states. `loading` keeps both buttons inert while the next page is in flight.
export function ListPager({ page, totalPages, total, loading = false, onPageChange, unit = "bản ghi", showTotal = true }) {
  const pages = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const count = total === null || total === undefined ? null : number.format(Number(total) || 0);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={`Phân trang ${unit}`}>
      <span aria-live="polite">
        Trang {current} / {pages}{showTotal && count !== null ? ` · ${count} ${unit}` : ""}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={loading || current <= 1} onClick={() => onPageChange(current - 1)}>Trang trước</Button>
        <Button variant="outline" disabled={loading || current >= pages} onClick={() => onPageChange(current + 1)}>Trang sau</Button>
      </div>
    </nav>
  );
}

export default ListPager;
