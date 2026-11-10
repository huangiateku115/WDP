import { Button } from '@/components/ui/button';

export default function QueuePagination({ page, pagination, loading, onPageChange }) {
  return <nav aria-label="Phân trang yêu cầu" className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
    <Button variant="outline" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Trang trước</Button>
    <p role="status" className="text-sm">Trang {page} / {Math.max(1, pagination.totalPages)} · {pagination.total} yêu cầu</p>
    <Button variant="outline" disabled={loading || page >= pagination.totalPages} onClick={() => onPageChange(page + 1)}>Trang sau</Button>
  </nav>;
}
