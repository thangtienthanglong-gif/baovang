const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const express = require('express');
const XLSX = require('xlsx-js-style');
const { registerAttendanceAlertRoutes, alertRange } = require('../lib/attendance-alerts');

async function setup(t, db) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const context = vm.createContext({ XLSX });
  vm.runInContext(source.slice(source.indexOf('function sendWorkbook('), source.indexOf('function buildMessage(')), context);
  const app = express();
  registerAttendanceAlertRoutes(app, {
    getBranchDb: async req => {
      const branch = req.headers['x-branch-id'];
      if (branch === 'other') return { students: [], absences: [] };
      if (branch !== 'main') { const error = new Error('Unknown branch'); error.status = 404; throw error; }
      return structuredClone(db);
    },
    sendWorkbook: context.sendWorkbook
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return (query = {}, branch = 'main') => fetch(
    `http://127.0.0.1:${server.address().port}/api/attendance-alerts/export?${new URLSearchParams(query)}`,
    { headers: { 'X-Branch-Id': branch } }
  );
}

function fixture() {
  const students = ['An', 'Bình', 'Chi'].map((name, index) => ({
    id: `s${index}`, fullName: `Nguyễn ${name}`, className: '8T3M+', phone1: '0901234567'
  }));
  const absent = (id, studentId, date, extra = {}) => ({ id, studentId, date, session: 'Tối', absenceStatus: 'Vắng', ...extra });
  return { students, absences: [
    absent('a1', 's0', '2026-10-01'), absent('a2', 's0', '2026-10-17'),
    absent('duplicate', 's0', '2026-10-01', { session: 'Buổi Tối' }),
    absent('old', 's0', '2026-09-30'), absent('future', 's0', '2026-10-18'),
    absent('excused', 's0', '2026-10-05', { absenceStatus: 'Có phép' }),
    absent('b1', 's1', '2026-10-01'), absent('b-old', 's1', '2026-09-30'),
    absent('c1', 's2', '2026-10-01'),
    absent('c2', 's2', '2026-10-02', { attendanceClass: '8VT2' })
  ] };
}

async function readFile(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Vang tu 2 buoi']);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return { sheet, rows: XLSX.utils.sheet_to_json(sheet) };
}

test('monthly Excel counts distinct unexcused sessions per subject and exports contact and session details', async t => {
  const db = fixture();
  const before = structuredClone(db);
  const request = await setup(t, db);
  const response = await request({ period: 'month', endDate: '2026-10-17' });
  assert.match(response.headers.get('content-disposition'), /hoc-sinh-vang-tu-2-buoi-2026-10-01_den_2026-10-17\.xlsx/);
  const { rows } = await readFile(response);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Họ tên học sinh'], 'Nguyễn An');
  assert.equal(rows[0]['Số buổi vắng không phép'], 2);
  assert.equal(rows[0]['SĐT phụ huynh'], '0901234567');
  assert.equal(rows[0]['Môn'], 'Toán');
  assert.equal(rows[0]['Lớp hiện tại'], '8T3M+');
  assert.equal(rows[0]['Vắng gần nhất'], '2026-10-17');
  assert.equal(rows[0]['Chi tiết các buổi vắng'], '2026-10-17 · Tối · 8T3M+\n2026-10-01 · Tối · 8T3M+');
  assert.equal(rows[0]['Từ ngày'], '2026-10-01');
  assert.equal(rows[0]['Đến ngày'], '2026-10-17');
  assert.deepEqual(db, before);
});

test('export includes already handled pupils and those with more than two sessions', async t => {
  const db = fixture();
  db.absences.push({ id: 'third', studentId: 's0', date: '2026-10-03', session: 'Sáng', absenceStatus: 'Không phép' });
  const { buildAttendanceAlerts } = require('../lib/attendance-alerts');
  const alert = buildAttendanceAlerts(db, { period: 'month', endDate: '2026-10-17' }).alerts[0];
  db.attendanceAlertActions = [{ alertId: alert.id, sessionKeys: alert.sessions.map(row => row.key), note: 'Đã trao đổi' }];
  const request = await setup(t, db);
  const { rows } = await readFile(await request({ endDate: '2026-10-17' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Số buổi vắng không phép'], 3);
  assert.equal(rows[0]['Trạng thái xử lý'], 'Đã xử lý');
  assert.equal(rows[0]['Ghi chú xử lý'], 'Đã trao đổi');
});

test('default export uses the current Vietnam month and empty branches retain Excel column headings', async t => {
  const db = fixture();
  const range = alertRange({ period: 'month' });
  db.absences = ['Sáng', 'Tối'].map((session, index) => ({
    id: `current-${index}`, studentId: 's0', date: range.endDate, session, absenceStatus: 'Vắng không phép'
  }));
  const request = await setup(t, db);
  const { rows } = await readFile(await request());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Từ ngày'], range.startDate);
  const empty = await readFile(await request({}, 'other'));
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.sheet.A1.v, 'STT');
  assert.equal(empty.sheet.B1.v, 'Họ tên học sinh');
  assert.equal(empty.sheet.G1.v, 'Số buổi vắng không phép');
  assert.equal((await request({ endDate: '2026-02-30' })).status, 400);
  assert.equal((await request({}, 'unknown')).status, 404);
});
