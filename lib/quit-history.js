const { subjectForClass } = require('./attendance-alerts');
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

function studentIdentity(student, index) {
  if (clean(student.personId)) return ['person', clean(student.personId)];
  const name = clean(student.fullName).toLocaleLowerCase('vi');
  let phone = clean(student.phone1 || student.phone2).replace(/\D/g, '');
  if (/^84\d{9}$/.test(phone)) phone = `0${phone.slice(2)}`;
  if (/^\d{9}$/.test(phone)) phone = `0${phone}`;
  if (name && /^\d{10,15}$/.test(phone)) return ['contact', name, phone];
  const code = clean(student.code);
  if (name && code && !/^AUTO-/i.test(code)) return ['code', name, code.toUpperCase()];
  return ['enrollment', student.id || `row-${index}`];
}

function groupQuitStudents(rows) {
  const groups = new Map();
  const sorted = [...rows].sort((a, b) => String(b.quitDate || '').localeCompare(String(a.quitDate || '')));
  sorted.forEach((student, index) => {
    const subject = subjectForClass(student.className);
    const key = JSON.stringify([studentIdentity(student, index), subject.key]);
    if (!groups.has(key)) groups.set(key, {
      ...student, subject: subject.label, subjectKey: subject.key,
      phone1: student.phone1 || student.phone2 || '', studentIds: [], classNames: [], quitDates: [], withdrawals: []
    });
    const group = groups.get(key);
    if (student.id && !group.studentIds.includes(student.id)) group.studentIds.push(student.id);
    const className = clean(student.className);
    if (className && !group.classNames.some(name => name.toUpperCase() === className.toUpperCase())) group.classNames.push(className);
    if (student.quitDate && !group.quitDates.includes(student.quitDate)) group.quitDates.push(student.quitDate);
    group.withdrawals.push({ studentId: student.id || '', className, quitDate: student.quitDate || '', quitReason: clean(student.quitReason) });
  });
  return [...groups.values()].map(group => {
    const reasons = [...new Set(group.withdrawals.map(row => row.quitReason))];
    const quitReason = reasons.length <= 1 ? reasons[0] || ''
      : group.withdrawals.filter(row => row.quitReason).map(row => {
        const date = row.quitDate ? row.quitDate.split('-').reverse().join('/') : '';
        return `${[date, row.className].filter(Boolean).join(' · ')}: ${row.quitReason}`;
      }).join('\n');
    return { ...group, className: group.classNames.join(', '), quitReason };
  });
}

module.exports = { groupQuitStudents };
