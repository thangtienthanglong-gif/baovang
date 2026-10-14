function historyDateRange(query = {}) {
  const start = query.dateStart ?? query.date ?? '';
  const end = query.dateEnd ?? query.date ?? '';
  for (const date of [start, end]) {
    if (date === '') continue;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      const error = new Error('Ngày lọc lịch sử không hợp lệ.'); error.status = 400; throw error;
    }
  }
  if (start && end && start > end) {
    const error = new Error('Từ ngày phải trước hoặc bằng Đến ngày.'); error.status = 400; throw error;
  }
  return { start, end };
}

function matchesHistoryDate(date, range) {
  if (!range.start && !range.end) return true;
  return Boolean(date) && (!range.start || date >= range.start) && (!range.end || date <= range.end);
}

function historyExportSuffix(query) {
  const { start, end } = historyDateRange(query);
  if (start && start === end) return start;
  if (start && end) return `${start}_den_${end}`;
  if (start) return `tu-${start}`;
  if (end) return `den-${end}`;
  return 'tat-ca';
}

module.exports = { historyDateRange, matchesHistoryDate, historyExportSuffix };
