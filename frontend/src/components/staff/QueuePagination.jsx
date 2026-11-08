import { Button } from '@/components/ui/button';

export default function QueuePagination({ page, pagination, loading, onPageChange }) {
  return <nav aria-label="Request queue pagination" className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
    <Button variant="outline" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous page</Button>
    <p role="status" className="text-sm">Page {page} of {Math.max(1, pagination.totalPages)} · {pagination.total} requests</p>
    <Button variant="outline" disabled={loading || page >= pagination.totalPages} onClick={() => onPageChange(page + 1)}>Next page</Button>
  </nav>;
}
