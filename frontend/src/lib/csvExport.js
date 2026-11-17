// Client-side CSV export for the report/audit screens that already have their rows loaded.
// Server-side export (large ranges) still needs BACKEND_CAPABILITIES.serverExport.
const escapeCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(headers, rows) {
  const head = headers.map(([key, label]) => escapeCell(label ?? key)).join(",");
  const body = rows.map((row) => headers.map(([key]) => escapeCell(typeof key === "function" ? key(row) : row[key])).join(","));
  return [head, ...body].join("\r\n");
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob([`\uFEFF${toCsv(headers, rows)}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
