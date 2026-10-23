// Shared read-model helpers for the live BOM pages (oversight, utilization report,
// facility detail). Kept in one place so the three pages aggregate identically.

export const countBy = (rows, key, value) => rows.filter((row) => row[key] === value).length;

export const sumBy = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

export const percent = (used, total) => (total > 0 ? Math.min(100, (used / total) * 100) : 0);

export const formatKg = (value) => `${Number(value || 0).toLocaleString("en-GB")} kg`;

export const formatM3 = (value) => `${Number(value || 0).toFixed(2)} m³`;
