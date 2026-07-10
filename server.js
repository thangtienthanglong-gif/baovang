require('dotenv').config();
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();

// Mock req.io for Vercel Serverless (Disable real-time sync)
app.use((req, res, next) => {
  req.io = {
    emit: () => {}
  };
  next();
});

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'baovang_secret_key_12345';

// Serve login.html for root if not authenticated
// Actually we will serve index.html statically, and index.html will redirect to login.html if no token


let serviceAccount;
try {
  // Use Vercel fallback base64 file if env var is missing
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    const b64Path = path.join(process.cwd(), 'sa-b64.txt');
    if (fs.existsSync(b64Path)) {
      const b64 = fs.readFileSync(b64Path, 'utf8');
      process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(b64, 'base64').toString('utf8');
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    let saString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (saString.startsWith("'") && saString.endsWith("'")) {
      saString = saString.slice(1, -1);
    } else if (saString.startsWith('"') && saString.endsWith('"')) {
      saString = saString.slice(1, -1);
    }
    serviceAccount = JSON.parse(saString);
  } else {
    const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    }
  }
  
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
    console.log('Connected to Firebase Realtime Database');
  } else {
    console.error('LỖI: Không tìm thấy Firebase Service Account.');
  }
} catch (error) {
  console.error('Lỗi khi đọc cấu hình Firebase:', error);
}

const PORT = process.env.PORT || 3000;
// Hardcoded fallbacks for Vercel if Env Vars are missing
if (!process.env.FIREBASE_DATABASE_URL) {
  process.env.FIREBASE_DATABASE_URL = 'https://thangtienthanglong-17088-default-rtdb.firebaseio.com';
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'mat_khau_bao_mat_gi_cung_duoc_123';
}
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const DEFAULT_ZALO_ENDPOINT = 'https://openapi.zalo.me/v3.0/oa/message/cs';
const DEFAULT_COZE_BASE_URL = 'https://api.coze.com';
const DEFAULT_AI_PROVIDER = 'internal';
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const ABSENCE_STATUSES = ['Vắng', 'Có phép', 'Đi trễ', 'Về sớm', 'Cả ngày', 'Nghỉ học', 'Học phí', 'Trễ học phí'];
const pendingAiActions = new Map();

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  if (['/', '/index.html', '/app.js', '/style.css'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
}

function shortHash(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 8).toUpperCase();
}

function todayISO() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function addMinutesISO(minutes) {
  return new Date(Date.now() + Number(minutes || 0) * 60 * 1000).toISOString();
}

function delayMinutesFromSettings(settings) {
  const parsed = Number(settings?.zaloDelayMinutes);
  if (!Number.isFinite(parsed)) return defaultSettings().zaloDelayMinutes;
  return Math.max(0, Math.min(1440, Math.round(parsed)));
}

function personalTestLimitFromSettings(settings) {
  const parsed = Number(settings?.personalTestLimit);
  if (!Number.isFinite(parsed)) return defaultSettings().personalTestLimit;
  return Math.max(1, Math.min(1000, Math.round(parsed)));
}




async function readDb() {
  if (!getApps().length) return { branches: {} };
  try {
    const snapshot = await getDatabase().ref('/').once('value');
    const db = snapshot.val() || {};
    
    // Migration: If old data exists at root, move to 'main' branch
    if (db.students || db.absences || db.settings) {
      if (!db.branches) db.branches = {};
      db.branches['main'] = {
        students: db.students || [],
        absences: db.absences || [],
        callLogs: db.callLogs || [],
        notificationLogs: db.notificationLogs || [],
        settings: db.settings || defaultSettings()
      };
      delete db.students;
      delete db.absences;
      delete db.callLogs;
      delete db.notificationLogs;
      delete db.settings;
      await getDatabase().ref('/').set(db); // Save migrated structure immediately
    }
    
    if (!db.branches) db.branches = {};

    // Normalize arrays for all branches to prevent undefined errors
    for (const branchId in db.branches) {
      if (!db.branches[branchId].students) db.branches[branchId].students = [];
      if (!db.branches[branchId].absences) db.branches[branchId].absences = [];
    }

    return db;
  } catch (err) {
    console.error('Lỗi khi đọc dữ liệu từ Firebase:', err);
    return { students: [], absences: [], callLogs: [], notificationLogs: [], settings: defaultSettings() };
  }
}

async function writeDb(db) {
  if (!getApps().length) {
    console.error('Lỗi: Firebase chưa được khởi tạo, không thể lưu.');
    return;
  }
  try {
    await getDatabase().ref('/').set(db);
  } catch (err) {
    console.error('Lỗi khi ghi dữ liệu lên Firebase:', err);
  }
}

function getBranchId(req) {
  const branch = req ? (req.headers['x-branch-id'] || req.query.branchId || req.body.branchId) : null;
  return branch ? String(branch).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') : 'main';
}

async function getBranchDb(req) {
  const rootDb = await readDb();
  const branchId = getBranchId(req);
  if (!rootDb.branches) rootDb.branches = {};
  if (!rootDb.branches[branchId]) {
    rootDb.branches[branchId] = { students: [], absences: [], callLogs: [], notificationLogs: [], settings: defaultSettings() };
  }
  return rootDb.branches[branchId];
}

async function saveBranchDb(req, branchDb) {
  const rootDb = await readDb();
  const branchId = getBranchId(req);
  if (!rootDb.branches) rootDb.branches = {};
  rootDb.branches[branchId] = branchDb;
  await writeDb(rootDb);
  io.emit('data_updated', { branchId }); // Emit realtime event
}

function defaultSettings() {
  return {
    schoolName: 'Trường học',
    zaloEnabled: false,
    zaloMode: 'dry-run',
    zaloDelayMinutes: 10,
    zaloEndpoint: DEFAULT_ZALO_ENDPOINT,
    zaloAccessToken: '',
    personalZaloName: '',
    personalZaloPhone: '',
    personalTestLimit: 100,
    zaloCycleSize: 20,
    zaloCycleDelayMinutes: 1,
    aiProvider: DEFAULT_AI_PROVIDER,
    openaiModel: DEFAULT_OPENAI_MODEL,
    openaiApiKey: '',
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiApiKey: '',
    cozeEnabled: false,
    cozeBaseUrl: DEFAULT_COZE_BASE_URL,
    cozeBotId: '',
    cozeAccessToken: '',
    cozeUserId: 'bao-vang-teacher',
    messageTemplate: 'Kính gửi Quý phụ huynh, {schoolName} thông báo học sinh {studentName}, lớp {className}.\nVắng học {session} ngày {date}.\nHọc sinh: {absenceStatus}.\nPhụ huynh vui lòng phản hồi với nhà trường nếu cần bổ sung thông tin.',
    tuitionTemplate: 'Kính gửi Quý phụ huynh, {schoolName} thông báo học phí/tiền nợ của em {studentName}, lớp {className} hiện tại là: {tuitionDebt}.\nVui lòng hoàn thành sớm. Trân trọng!',
    periodicTemplate: 'Kính gửi Quý phụ huynh, {schoolName} gửi thông báo định kì/khóa mới cho em {studentName}, lớp {className}.',
    periodicImageBase64: ''
  };
}







function publicSettings(settings) {
  const aiConfig = getAiRuntimeConfig(settings);
  const cozeConfig = getCozeRuntimeConfig(settings);
  return {
    schoolName: settings.schoolName || 'Trường học',
    zaloEnabled: Boolean(settings.zaloEnabled),
    zaloMode: settings.zaloMode || 'dry-run',
    zaloDelayMinutes: Number.isFinite(Number(settings.zaloDelayMinutes)) ? Number(settings.zaloDelayMinutes) : defaultSettings().zaloDelayMinutes,
    zaloEndpoint: settings.zaloEndpoint || DEFAULT_ZALO_ENDPOINT,
    hasZaloAccessToken: Boolean(settings.zaloAccessToken || process.env.ZALO_OA_ACCESS_TOKEN),
    personalZaloName: settings.personalZaloName || '',
    personalZaloPhone: settings.personalZaloPhone || '',
    personalTestLimit: personalTestLimitFromSettings(settings),
    aiProvider: aiConfig.provider,
    aiConfigured: aiConfig.configured,
    openaiConfigured: Boolean(aiConfig.openai.apiKey),
    openaiModel: aiConfig.openai.model,
    hasOpenAiApiKey: Boolean(aiConfig.openai.apiKey),
    geminiConfigured: Boolean(aiConfig.gemini.apiKey),
    geminiModel: aiConfig.gemini.model,
    hasGeminiApiKey: Boolean(aiConfig.gemini.apiKey),
    cozeEnabled: cozeConfig.enabled,
    cozeConfigured: Boolean(cozeConfig.accessToken && cozeConfig.botId),
    cozeBaseUrl: cozeConfig.baseUrl,
    cozeBotId: cozeConfig.botId,
    cozeUserId: cozeConfig.userId,
    hasCozeAccessToken: Boolean(cozeConfig.accessToken),
    messageTemplate: settings.messageTemplate || defaultSettings().messageTemplate,
    tuitionTemplate: settings.tuitionTemplate || defaultSettings().tuitionTemplate,
    periodicTemplate: settings.periodicTemplate || defaultSettings().periodicTemplate,
    periodicImageBase64: settings.periodicImageBase64 || ''
  };
}

function requireFields(body, fields) {
  const missing = fields.filter(field => body[field] === undefined || body[field] === null || String(body[field]).trim() === '');
  if (missing.length) {
    const err = new Error(`Thiếu thông tin bắt buộc: ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanMultilineText(value) {
  return String(value ?? '').trim();
}

function normalizeAbsenceStatus(value) {
  const status = cleanText(value);
  const aliases = {
    '': 'Vắng',
    'Vắng chưa rõ lý do': 'Vắng',
    'Vắng không phép': 'Vắng',
    'Vắng có phép': 'Có phép',
    'Nghỉ bệnh': 'Nghỉ học',
    'Trễ học phí': 'Học phí'
  };
  return aliases[status] || (ABSENCE_STATUSES.includes(status) ? status : status || 'Vắng');
}

function normalizeInitialReason(value, fallbackStatus = 'Vắng') {
  const reason = cleanText(value);
  if (!reason) return fallbackStatus;
  const normalized = normalizeAbsenceStatus(reason);
  const looksLikeStatus = normalized !== reason || ABSENCE_STATUSES.includes(reason);
  return looksLikeStatus ? normalized : reason;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '').trim();
}

function extractPhones(...values) {
  const phones = [];
  values.forEach(value => {
    const text = String(value || '');
    const matches = text.match(/(?:\+?84|0)\d{8,10}/g) || [];
    matches.forEach(item => {
      let phone = normalizePhone(item);
      if (phone.startsWith('+84')) phone = '0' + phone.slice(3);
      if (phone.startsWith('84') && phone.length >= 11) phone = '0' + phone.slice(2);
      if (phone && !phones.includes(phone)) phones.push(phone);
    });
  });
  return phones;
}

function sanitizeStudent(input) {
  return {
    code: cleanText(input.code),
    fullName: cleanText(input.fullName),
    className: cleanText(input.className),
    parentName: cleanText(input.parentName),
    phone1: normalizePhone(input.phone1),
    phone2: normalizePhone(input.phone2),
    homeroomTeacher: cleanText(input.homeroomTeacher),
    zaloUserId: cleanText(input.zaloUserId),
    sourceTags: cleanText(input.sourceTags),
    status: cleanText(input.status || 'Đang học'),
    birthday: cleanText(input.birthday || ''),
    tuitionDebt: cleanText(input.tuitionDebt || '')
  };
}

function studentByIdMap(students) {
  return Object.fromEntries(students.map(student => [student.id, student]));
}

function isActiveStudent(student) {
  return student && student.status !== 'Nghỉ học';
}

function enrichAbsence(absence, studentsMap) {
  const student = studentsMap[absence.studentId] || {};
  return {
    ...absence,
    absenceStatus: normalizeAbsenceStatus(absence.absenceStatus),
    initialReason: normalizeInitialReason(absence.initialReason, normalizeAbsenceStatus(absence.absenceStatus)),
    studentCode: student.code || '',
    studentName: student.fullName || '',
    className: student.className || '',
    parentName: student.parentName || '',
    phone1: student.phone1 || '',
    phone2: student.phone2 || '',
    homeroomTeacher: student.homeroomTeacher || '',
    zaloUserId: student.zaloUserId || ''
  };
}

function filterAbsences(db, query) {
  const studentsMap = studentByIdMap(db.students || []);
  const date = query.date || '';
  const dateStart = query.dateStart || date || '';
  const dateEnd = query.dateEnd || date || '';
  const className = query.className || 'ALL';
  const absenceStatus = query.absenceStatus && query.absenceStatus !== 'ALL'
    ? normalizeAbsenceStatus(query.absenceStatus)
    : 'ALL';
  const status = query.status || 'ALL';
  const noticeStatus = query.noticeStatus || 'ALL';
  const keyword = String(query.q || '').toLowerCase().trim();

  return (db.absences || [])
    .map(absence => enrichAbsence(absence, studentsMap))
    .filter(absence => {
      let matchesDate = true;
      if (dateStart && dateEnd && dateStart !== dateEnd) {
        matchesDate = absence.date >= dateStart && absence.date <= dateEnd;
      } else if (dateStart) {
        matchesDate = absence.date === dateStart;
      }
      const matchesClass = className === 'ALL' || absence.className === className;
      const matchesAbsenceStatus = absenceStatus === 'ALL' || normalizeAbsenceStatus(absence.absenceStatus) === absenceStatus;
      const matchesStatus = status === 'ALL' || absence.callStatus === status;
      const matchesNotice = noticeStatus === 'ALL' || absence.noticeStatus === noticeStatus;
      const haystack = `${absence.studentCode} ${absence.studentName} ${absence.className} ${absence.parentName} ${absence.phone1} ${absence.phone2} ${absence.zaloUserId}`.toLowerCase();
      const matchesKeyword = !keyword || haystack.includes(keyword);
      return matchesDate && matchesClass && matchesAbsenceStatus && matchesStatus && matchesNotice && matchesKeyword;
    })
    .sort((a, b) => `${a.className} ${a.studentName}`.localeCompare(`${b.className} ${b.studentName}`, 'vi'));
}

function getSummary(absences) {
  const count = status => absences.filter(row => row.callStatus === status).length;
  const notice = status => absences.filter(row => row.noticeStatus === status).length;
  return {
    total: absences.length,
    pending: count('Chưa gọi'),
    called: count('Đã gọi'),
    noAnswer: count('Không nghe máy'),
    callBack: count('Hẹn gọi lại'),
    wrongNumber: count('Sai số'),
    noticeWaiting: notice('Chờ gửi'),
    noticeSent: notice('Đã gửi'),
    noticeFailed: notice('Lỗi gửi'),
    noticeSkipped: notice('Không gửi') + notice('Chạy thử') + notice('Chưa gửi')
  };
}

function filterCallLogs(db, query) {
  const q = String(query.q || '').toLowerCase().trim();
  const date = query.date || '';
  let rows = db.callLogs || [];

  if (date) rows = rows.filter(log => log.date === date);
  if (q) {
    rows = rows.filter(log => `${log.studentCode} ${log.studentName} ${log.className} ${log.parentName} ${log.phoneCalled} ${log.caller} ${log.callResult}`.toLowerCase().includes(q));
  }

  return rows.sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

function filterNotificationLogs(db, query) {
  const q = String(query.q || '').toLowerCase().trim();
  const date = query.date || '';
  let rows = db.notificationLogs || [];

  if (date) rows = rows.filter(log => log.date === date);
  if (q) {
    rows = rows.filter(log => `${log.studentCode} ${log.studentName} ${log.className} ${log.parentName} ${log.phone1} ${log.zaloUserId} ${log.status} ${log.result}`.toLowerCase().includes(q));
  }

  return rows.sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

function sendWorkbook(res, filename, sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(sheet => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  });
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

function buildMessage(settings, absence, student) {
  const dict = {
    schoolName: settings.schoolName || 'Trường học',
    date: absence.date || '',
    studentCode: student.code || '',
    studentName: student.fullName || '',
    className: student.className || '',
    session: absence.session || '',
    absenceStatus: normalizeAbsenceStatus(absence.absenceStatus),
    reason: normalizeInitialReason(absence.initialReason, normalizeAbsenceStatus(absence.absenceStatus)),
    parentName: student.parentName || '',
    phone: student.phone1 || '',
    tuitionDebt: student.tuitionDebt || '',
    birthday: student.birthday || ''
  };
  
  const status = normalizeAbsenceStatus(absence.absenceStatus);
  let template = settings.messageTemplate || 'Kính gửi Quý phụ huynh, {schoolName} thông báo học sinh {studentName}, lớp {className}.\nVắng học {session} ngày {date}.\nHọc sinh: {absenceStatus}.\nPhụ huynh vui lòng phản hồi với nhà trường nếu cần bổ sung thông tin.';
  if (status === 'Học phí' || status === 'Trễ học phí') {
    template = settings.tuitionTemplate || 'Kính gửi Quý phụ huynh, {schoolName} thông báo học phí/tiền nợ của em {studentName}, lớp {className} hiện tại là: {tuitionDebt}.\nVui lòng hoàn thành sớm. Trân trọng!';
  } else if (['Định kì', 'Khóa mới', 'Thông báo chung'].includes(status)) {
    template = settings.periodicTemplate || 'Kính gửi Quý phụ huynh, {schoolName} gửi thông báo định kì/khóa mới cho em {studentName}, lớp {className}.';
  }
  
  return template.replace(/\{(\w+)\}/g, (_, key) => dict[key] ?? '');
}

function normalizeCozeBaseUrl(value) {
  const baseUrl = cleanText(value || DEFAULT_COZE_BASE_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) return DEFAULT_COZE_BASE_URL;
  return baseUrl;
}

function normalizeSecretKey(value) {
  return String(value || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');
}

function normalizeCozeAccessToken(value) {
  return normalizeSecretKey(value);
}

function maskCozeAccessToken(value) {
  const token = normalizeCozeAccessToken(value);
  if (!token) return 'trống';
  if (token.length <= 12) return `${token.slice(0, 4)}... (${token.length} ký tự)`;
  return `${token.slice(0, 4)}...${token.slice(-4)} (${token.length} ký tự)`;
}

function cozeAuthErrorMessage(message, config) {
  const token = normalizeCozeAccessToken(config.accessToken);
  const tokenShape = token.startsWith('pat_')
    ? `token app nhận: ${maskCozeAccessToken(token)}`
    : `token app nhận không bắt đầu bằng pat_: ${maskCozeAccessToken(token)}`;
  return [
    `Coze báo: ${message}`,
    `Coze API: ${config.baseUrl}`,
    tokenShape,
    'Hãy tạo/copy lại Personal Access Token đầy đủ từ Authorization > Personal Access Tokens, không dùng App ID, Client Secret, OAuth token hoặc chữ Bearer.'
  ].join(' ');
}

function normalizeAiProvider(value) {
  const provider = cleanText(value || '').toLowerCase();
  if (provider === 'chatgpt') return 'openai';
  if (['internal', 'coze', 'openai', 'gemini'].includes(provider)) return provider;
  return DEFAULT_AI_PROVIDER;
}

function getCozeRuntimeConfig(settings, options = {}) {
  const envEnabled = options.ignoreEnabledEnv ? undefined : process.env.COZE_ENABLED;
  return {
    enabled: envEnabled === undefined ? Boolean(settings.cozeEnabled) : String(envEnabled) === 'true',
    baseUrl: normalizeCozeBaseUrl(process.env.COZE_BASE_URL || settings.cozeBaseUrl),
    botId: process.env.COZE_BOT_ID || settings.cozeBotId || '',
    accessToken: normalizeCozeAccessToken(process.env.COZE_ACCESS_TOKEN || settings.cozeAccessToken),
    userId: process.env.COZE_USER_ID || settings.cozeUserId || 'bao-vang-teacher'
  };
}

function getOpenAiRuntimeConfig(settings) {
  return {
    model: cleanText(process.env.OPENAI_MODEL || settings.openaiModel) || DEFAULT_OPENAI_MODEL,
    apiKey: normalizeSecretKey(process.env.OPENAI_API_KEY || settings.openaiApiKey)
  };
}

function getGeminiRuntimeConfig(settings) {
  return {
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    model: cleanText(process.env.GEMINI_MODEL || settings.geminiModel) || DEFAULT_GEMINI_MODEL,
    apiKey: normalizeSecretKey(process.env.GEMINI_API_KEY || settings.geminiApiKey)
  };
}

function getAiRuntimeConfig(settings, options = {}) {
  const providerSource = options.ignoreProviderEnv
    ? settings.aiProvider
    : (process.env.AI_PROVIDER || settings.aiProvider);
  const provider = normalizeAiProvider(providerSource || (settings.cozeEnabled ? 'coze' : DEFAULT_AI_PROVIDER));
  const coze = getCozeRuntimeConfig(settings, { ignoreEnabledEnv: options.ignoreCozeEnabledEnv });
  const openai = getOpenAiRuntimeConfig(settings);
  const gemini = getGeminiRuntimeConfig(settings);
  const configured = provider === 'coze'
    ? Boolean(coze.enabled && coze.botId && coze.accessToken)
    : (provider === 'openai'
      ? Boolean(openai.apiKey)
      : (provider === 'gemini' ? Boolean(gemini.apiKey) : false));

  return { provider, configured, coze, openai, gemini };
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countByLabel(rows, getter, fallback = 'Chưa có') {
  return rows.reduce((counts, row) => {
    const key = cleanText(getter(row)) || fallback;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts, preferredOrder = []) {
  return Object.entries(counts)
    .sort(([a], [b]) => {
      const indexA = preferredOrder.indexOf(a);
      const indexB = preferredOrder.indexOf(b);
      if (indexA !== -1 || indexB !== -1) {
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      }
      return a.localeCompare(b, 'vi');
    })
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
}

function detectClassFromMessage(db, message) {
  const query = normalizeSearchText(message);
  if (!query) return '';

  const classes = [...new Set((db.students || [])
    .filter(isActiveStudent)
    .map(student => student.className)
    .filter(Boolean))];

  return classes
    .filter(className => {
      const classText = normalizeSearchText(className);
      const classNoSpace = classText.replace(/\s+/g, '');
      const queryNoSpace = query.replace(/\s+/g, '');
      
      if (classText.length >= 2 && query.includes(classText)) return true;
      if (classNoSpace.length >= 3 && queryNoSpace.includes(classNoSpace)) return true;
      
      const parts = classText.split(/\s+/).filter(p => p.length >= 4);
      return parts.some(part => query.includes(part));
    })
    .sort((a, b) => normalizeSearchText(b).length - normalizeSearchText(a).length)[0] || '';
}

function detectAiIntent(message) {
  const text = normalizeSearchText(message);
  if (!text) return { key: 'unclear', label: 'chưa rõ' };
  if (/\b(zalo|tin nhan|gui|oa|thong bao)\b/.test(text)) return { key: 'zalo', label: 'tình trạng gửi Zalo' };
  if (/\b(excel|import|nap|tai file|danh ba)\b/.test(text)) return { key: 'import', label: 'hướng dẫn nạp Excel/danh bạ' };
  if (/\b(lich su|log|cuoc goi|da gui)\b/.test(text)) return { key: 'history', label: 'lịch sử gọi hoặc gửi' };
  if (/\bhoc sinh\b/.test(text) && /\bvang\b/.test(text) && /\b(hom nay|danh sach|nhung|nao|ai)\b/.test(text)) return { key: 'absenceList', label: 'danh sách học sinh vắng' };
  if (/\b(tim|kiem|hoc sinh|hs|sdt|so dien thoai|phu huynh|ma hoc sinh)\b/.test(text)) return { key: 'student', label: 'tìm học sinh' };
  if (/\b(thong ke|bao nhieu|tong|vang|co phep|di tre|ve som|ca ngay|nghi hoc)\b/.test(text)) return { key: 'summary', label: 'thống kê báo vắng' };
  return { key: 'general', label: 'câu hỏi chung trong app' };
}

function buildAiFocusRules(intent) {
  const rules = [
    `Ý định chính đã nhận diện: ${intent.label}.`,
    'Trả lời trực tiếp câu hỏi cuối cùng của thầy/cô ngay ở câu đầu tiên.',
    'Chỉ dùng dữ liệu trong ngữ cảnh hệ thống; không tự bịa học sinh, lớp, số điện thoại, trạng thái gọi hoặc trạng thái Zalo.',
    'Không liệt kê chức năng của app, không nói lan sang Zalo/Excel/học sinh nếu câu hỏi không hỏi phần đó.',
    'Nếu câu hỏi cần số lượng, nêu rõ phạm vi ngày/lớp/bộ lọc đang dùng và dùng số liệu đếm trong ngữ cảnh.',
    'Nếu thiếu dữ liệu để kết luận, nói ngắn gọn là chưa có dữ liệu trong app và cần kiểm tra thêm.'
  ];

  const intentRules = {
    summary: 'Với thống kê báo vắng: ưu tiên tổng theo ngày/lớp và các dòng "Theo trạng thái vắng"; chỉ thêm nhận xét ngắn khi giúp hiểu số liệu.',
    absenceList: 'Với danh sách học sinh vắng: liệt kê các dòng trong "Danh sách báo vắng trong phạm vi"; mỗi dòng nêu tên, lớp, trạng thái và SĐT/PH nếu có. Nếu không có dòng nào thì nói chưa có báo vắng.',
    student: 'Với tìm học sinh: chỉ trả các học sinh khớp câu hỏi, kèm lớp/SĐT/trạng thái nếu có; nếu không khớp thì nói chưa tìm thấy.',
    zalo: 'Với Zalo: chỉ nói chế độ gửi, số lượng theo trạng thái Zalo và thao tác tiếp theo nếu cần.',
    import: 'Với nạp Excel: trả lời bằng 2-4 bước thao tác trong app, không đưa thống kê học sinh nếu không được hỏi.',
    history: 'Với lịch sử: chỉ hướng dẫn vị trí xem/lọc lịch sử gọi hoặc Zalo và cách xuất danh sách nếu phù hợp.',
    unclear: 'Nếu câu hỏi mơ hồ: hỏi lại một câu ngắn để làm rõ lớp, ngày, tên học sinh hoặc loại thống kê.'
  };

  if (intentRules[intent.key]) rules.push(intentRules[intent.key]);
  return rules.join('\n');
}

const STUDENT_QUERY_STOP_WORDS = new Set([
  'toi', 'muon', 'minh', 'giup', 'hay', 'cho', 'hoi', 'xem', 'tim', 'kiem',
  'hoc', 'sinh', 'lop', 'em', 'ban', 'bao', 'nhieu', 'thong', 'ke', 'hom',
  'nay', 'vang', 'zalo', 'sdt', 'so', 'dien', 'thoai', 'phu', 'huynh',
  'co', 'khong', 'trong', 'danh', 'sach', 'ten', 'ma', 'thong', 'tin',
  'la', 'ai', 'o', 'dang', 'can', 'biet', 'kiem', 'tra', 'kiemtra', 'thu',
  'xemgiup', 'chohoi', 'vui', 'long', 'neu', 'voi', 'cua'
]);

function questionTokens(message) {
  return normalizeSearchText(message)
    .split(/\s+/)
    .filter(token => token.length >= 2 && !STUDENT_QUERY_STOP_WORDS.has(token))
    .slice(0, 8);
}

function searchableStudentText(student) {
  return normalizeSearchText([
    student.code,
    student.fullName,
    student.className,
    student.parentName,
    student.phone1,
    student.phone2,
    student.zaloUserId
  ].filter(Boolean).join(' '));
}

function scoreStudentMatch(student, tokens) {
  if (!tokens.length) return 0;

  const text = searchableStudentText(student);
  const nameText = normalizeSearchText(student.fullName || '');
  const codeText = normalizeSearchText(student.code || '');
  const phoneText = normalizeSearchText(`${student.phone1 || ''} ${student.phone2 || ''}`);
  const compactText = text.replace(/\s+/g, '');
  const compactQuery = tokens.join('');
  const phrase = tokens.join(' ');
  let score = 0;
  let matched = 0;

  tokens.forEach(token => {
    if (!text.includes(token)) return;
    matched += 1;
    score += token.length >= 4 ? 5 : 3;
    if (nameText.includes(token)) score += 4;
    if (codeText.includes(token)) score += 3;
    if (phoneText.includes(token)) score += 3;
  });

  if (phrase.length >= 3 && nameText.includes(phrase)) score += 20;
  if (compactQuery.length >= 4 && compactText.includes(compactQuery)) score += 12;

  const requiredMatches = tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.6));
  if (matched < requiredMatches && !(phrase.length >= 3 && nameText.includes(phrase))) return 0;
  return score + matched;
}

function buildStudentHints(db, message) {
  const tokens = questionTokens(message);
  if (!tokens.length) return [];

  return (db.students || [])
    .map(student => ({ student, score: scoreStudentMatch(student, tokens) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || `${a.student.className || ''} ${a.student.fullName || ''}`.localeCompare(`${b.student.className || ''} ${b.student.fullName || ''}`, 'vi'))
    .slice(0, 25)
    .map(({ student }) => `- ${student.fullName || ''} | lớp ${student.className || ''} | mã ${student.code || ''} | PH ${student.parentName || ''} | SĐT ${student.phone1 || student.phone2 || 'chưa có'} | trạng thái ${student.status || 'Đang học'}`);
}

function buildAiContext(db, body) {
  const filters = body.filters || {};
  let date = cleanText(filters.date || body.date || todayISO());
  let dateStart = date;
  let dateEnd = date;
  
  const msgText = normalizeSearchText(body.message || '');
  if (/\b(tuan truoc)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
    date = `từ ${dateStart} đến ${dateEnd}`;
  } else if (/\b(thang truoc)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
    date = `từ ${dateStart} đến ${dateEnd}`;
  } else if (/\b(thang nay)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(1);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
    date = `từ ${dateStart} đến ${dateEnd}`;
  }

  const selectedClass = cleanText(filters.className || body.className || 'ALL') || 'ALL';
  const askedClass = detectClassFromMessage(db, body.message || '');
  const className = askedClass || selectedClass;
  const absences = filterAbsences(db, {
    dateStart,
    dateEnd,
    className,
    absenceStatus: filters.absenceStatus || 'ALL',
    status: filters.status || 'ALL',
    noticeStatus: filters.noticeStatus || 'ALL',
    q: filters.q || ''
  });
  const dayClassAbsences = filterAbsences(db, {
    dateStart,
    dateEnd,
    className,
    absenceStatus: 'ALL',
    status: 'ALL',
    noticeStatus: 'ALL',
    q: ''
  });
  const summary = getSummary(absences);
  const dayClassSummary = getSummary(dayClassAbsences);
  const active = (db.students || []).filter(isActiveStudent);
  const classes = [...new Set(active.map(student => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const studentHints = buildStudentHints(db, body.message || '');
  const absenceStatusCounts = formatCounts(
    countByLabel(dayClassAbsences, row => normalizeAbsenceStatus(row.absenceStatus), 'Vắng'),
    ABSENCE_STATUSES
  );
  const filteredAbsenceStatusCounts = formatCounts(
    countByLabel(absences, row => normalizeAbsenceStatus(row.absenceStatus), 'Vắng'),
    ABSENCE_STATUSES
  );
  const classCounts = formatCounts(countByLabel(dayClassAbsences, row => row.className, 'Chưa có lớp'));
  const noticeCounts = formatCounts(countByLabel(dayClassAbsences, row => row.noticeStatus || 'Chưa gửi', 'Chưa gửi'));
  const callCounts = formatCounts(countByLabel(dayClassAbsences, row => row.callStatus || 'Chưa gọi', 'Chưa gọi'));
  const absenceLines = absences.slice(0, 40).map(row => (
    `- ${row.studentName} | lớp ${row.className} | ${normalizeAbsenceStatus(row.absenceStatus)} | PH ${row.parentName || ''} | SĐT ${row.phone1 || row.phone2 || 'chưa có'} | Zalo ${row.noticeStatus || 'Chưa gửi'}`
  ));
  const settings = db.settings || defaultSettings();

  return [
    `Trường: ${settings.schoolName || 'Trường học'}`,
    `Ngày hệ thống: ${todayISO()}`,
    `Phạm vi chính để trả lời: ngày ${date}; lớp ${className === 'ALL' ? 'tất cả' : className}${askedClass ? ' (nhận diện từ câu hỏi)' : ''}`,
    `Bộ lọc màn hình: lớp ${selectedClass}; trạng thái vắng ${filters.absenceStatus || 'ALL'}; trạng thái gọi ${filters.status || 'ALL'}; trạng thái Zalo ${filters.noticeStatus || 'ALL'}; từ khóa ${filters.q || 'trống'}`,
    `Số lớp: ${classes.length}`,
    `Số học sinh đang học: ${active.length}`,
    `Tổng báo vắng theo ngày/lớp, chưa áp dụng bộ lọc màn hình: ${dayClassSummary.total}`,
    `Theo trạng thái vắng: ${absenceStatusCounts || 'không có bản ghi'}`,
    `Theo lớp: ${classCounts || 'không có bản ghi'}`,
    `Theo trạng thái gọi: ${callCounts || 'không có bản ghi'}`,
    `Theo trạng thái Zalo: ${noticeCounts || 'không có bản ghi'}`,
    `Tổng trong bộ lọc màn hình hiện tại: ${summary.total}`,
    `Trong bộ lọc hiện tại - trạng thái vắng: ${filteredAbsenceStatusCounts || 'không có bản ghi'}`,
    `Trong bộ lọc hiện tại - chưa gọi: ${summary.pending}; đã gọi: ${summary.called}; chờ Zalo: ${summary.noticeWaiting}; Zalo đã gửi: ${summary.noticeSent}; Zalo lỗi: ${summary.noticeFailed}`,
    `Cấu hình Zalo: ${settings.zaloMode || 'dry-run'}, chờ gửi ${delayMinutesFromSettings(settings)} phút`,
    studentHints.length ? `Học sinh khớp câu hỏi:\n${studentHints.join('\n')}` : '',
    absenceLines.length ? `Danh sách báo vắng trong phạm vi, tối đa 40 dòng:\n${absenceLines.join('\n')}` : 'Không có bản ghi báo vắng trong phạm vi đang hỏi.'
  ].filter(Boolean).join('\n');
}

function buildAiPromptParts(db, body) {
  const message = body.message || '';
  const context = buildAiContext(db, body);
  const studentHints = buildStudentHints(db, message);
  const askedClass = detectClassFromMessage(db, message);
  let intent = detectAiIntent(message);
  if (studentHints.length > 0 && studentHints.length <= 5 && !askedClass && ['general', 'unclear', 'summary'].includes(intent.key)) {
    intent = { key: 'student', label: 'tìm học sinh' };
  }
  const instructions = [
    'Bạn là trợ lý AI cho giáo viên trong ứng dụng quản lý báo vắng học sinh.',
    'Nhiệm vụ quan trọng nhất là trả lời đúng trọng tâm câu hỏi, bằng tiếng Việt ngắn gọn. Bạn ĐƯỢC PHÉP trả lời mọi thông tin về học sinh, bao gồm cả số điện thoại phụ huynh nếu giáo viên hỏi.',
    `Quy tắc trả lời trọng tâm:\n${buildAiFocusRules(intent)}`
  ].join('\n\n');
  const input = [
    `Ngữ cảnh hệ thống:\n${context}`,
    `Câu hỏi của giáo viên:\n${cleanText(body.message)}`
  ].join('\n\n');

  return { instructions, input };
}

function detectAiActionIntent(message) {
  const text = normalizeSearchText(message);
  
  if (/\b(hoc phi|tien no|tien hoc|nhac no)\b/.test(text)) {
    if (/\b(gui|goi|nhan|thong bao|zalo|bao)\b/.test(text)) return 'send_zalo_tuition';
  }
  if (/\b(dinh ki|khoa moi|thong bao chung|thong bao|thong tin)\b/.test(text)) {
    if (/\b(gui|goi|nhan|zalo)\b/.test(text) && !/\b(hoc phi|no|vang)\b/.test(text)) return 'send_zalo_periodic';
  }

  const wantsSend = /\b(gui|goi|nhan|thong bao|bao tin|bao phu huynh|bao vang)\b/.test(text);
  const wantsZalo = /\b(zalo|tin nhan|sms|phu huynh|thong bao|bao vang)\b/.test(text);
  if (wantsSend && wantsZalo) return 'send_zalo_bulk';
  
  return '';
}

function detectDateFromActionMessage(message, fallbackDate) {
  const raw = String(message || '');
  const text = normalizeSearchText(raw);
  if (/\bhom nay\b/.test(text)) return todayISO();

  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const vnDate = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (vnDate) {
    const day = vnDate[1].padStart(2, '0');
    const month = vnDate[2].padStart(2, '0');
    return `${vnDate[3]}-${month}-${day}`;
  }

  return fallbackDate || todayISO();
}

function detectAbsenceStatusFromActionMessage(message, fallbackStatus = 'ALL') {
  const text = normalizeSearchText(message);
  if (/\bdi tre\b/.test(text)) return 'Đi trễ';
  if (/\bve som\b/.test(text)) return 'Về sớm';
  if (/\bco phep\b/.test(text)) return 'Có phép';
  if (/\bca ngay\b/.test(text)) return 'Cả ngày';
  if (/\bnghi hoc|nghi\b/.test(text)) return 'Nghỉ học';
  if (/\bvang\b/.test(text)) return 'Vắng';
  return fallbackStatus || 'ALL';
}

function buildAiActionFilters(db, body) {
  const filters = body.filters || {};
  const message = body.message || '';
  const askedClass = detectClassFromMessage(db, message);
  
  let dateStart = '';
  let dateEnd = '';
  const msgText = normalizeSearchText(message);
  if (/\b(tuan truoc)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
  } else if (/\b(thang truoc)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
  } else if (/\b(thang nay)\b/.test(msgText)) {
    const d = new Date();
    d.setDate(1);
    dateStart = d.toISOString().split('T')[0];
    dateEnd = todayISO();
  }
  
  return {
    date: dateStart && dateEnd ? '' : detectDateFromActionMessage(message, cleanText(filters.date) || todayISO()),
    dateStart,
    dateEnd,
    className: askedClass || cleanText(filters.className) || 'ALL',
    absenceStatus: detectAbsenceStatusFromActionMessage(message, filters.absenceStatus || 'ALL'),
    status: cleanText(filters.status) || 'ALL',
    noticeStatus: cleanText(filters.noticeStatus) || 'ALL',
    q: cleanText(filters.q)
  };
}

function compactActionPreviewRows(rows) {
  return rows.slice(0, 8).map(row => ({
    id: row.id,
    studentName: row.studentName || '',
    className: row.className || '',
    absenceStatus: normalizeAbsenceStatus(row.absenceStatus),
    phone: row.phone1 || row.phone2 || '',
    noticeStatus: row.noticeStatus || 'Chưa gửi'
  }));
}

function storePendingAiAction(action) {
  const actionId = id('act');
  const stored = {
    ...action,
    id: actionId,
    createdAt: Date.now()
  };
  pendingAiActions.set(actionId, stored);
  return stored;
}

function consumePendingAiAction(actionId) {
  const action = pendingAiActions.get(actionId);
  if (!action) {
    const err = new Error('Hành động AI đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu lại trong chatbox.');
    err.status = 404;
    throw err;
  }
  pendingAiActions.delete(actionId);

  const ageMs = Date.now() - Number(action.createdAt || 0);
  if (ageMs > 10 * 60 * 1000) {
    const err = new Error('Hành động AI đã quá 10 phút. Vui lòng yêu cầu lại để app kiểm tra dữ liệu mới nhất.');
    err.status = 400;
    throw err;
  }

  return action;
}

function isLocalRequest(req) {
  const remote = req.socket?.remoteAddress || req.ip || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    || remote.endsWith('127.0.0.1');
}

function runWindowsZaloPaste(message, link, imageBase64 = null) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      const err = new Error('Tự dán vào Zalo chỉ hỗ trợ khi app chạy trên Windows.');
      err.status = 400;
      reject(err);
      return;
    }

    const script = `
$ErrorActionPreference = 'Stop'
$msg = ""
if ($env:ZALO_AUTOPASTE_MESSAGE_B64) {
  $msg = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZALO_AUTOPASTE_MESSAGE_B64))
}
if ($env:ZALO_AUTOPASTE_IMAGE_B64) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $base64Image = $env:ZALO_AUTOPASTE_IMAGE_B64
    if ($base64Image -match "^data:image/.*?;base64,(.*)$") {
      $base64Image = $matches[1]
    }
    $bytes = [Convert]::FromBase64String($base64Image)
    $ms = New-Object System.IO.MemoryStream($bytes, 0, $bytes.Length)
    $img = [System.Drawing.Image]::FromStream($ms)
    [System.Windows.Forms.Clipboard]::SetImage($img)
  } catch {
    $msg = "Lỗi copy ảnh: " + $_.Exception.Message
  }
}
$link = ""
if ($env:ZALO_AUTOPASTE_LINK_B64) {
  $link = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZALO_AUTOPASTE_LINK_B64))
}
if ($link) { Start-Process $link }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32ZaloPaste {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleTime() {
    LASTINPUTINFO lastInPut = new LASTINPUTINFO();
    lastInPut.cbSize = (uint)Marshal.SizeOf(lastInPut);
    if (!GetLastInputInfo(ref lastInPut)) return 0;
    return (uint)Environment.TickCount - lastInPut.dwTime;
  }
}
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO {
  public uint cbSize;
  public uint dwTime;
}
"@

function Click-Point($x, $y) {
  [Win32ZaloPaste]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds 80
  [Win32ZaloPaste]::mouse_event(0x0002, 0, 0, 0, 0)
  [Win32ZaloPaste]::mouse_event(0x0004, 0, 0, 0, 0)
}

function Click-WindowRatio($handle, $xRatio, $yRatio) {
  try {
    $rect = New-Object RECT
    if ([Win32ZaloPaste]::GetWindowRect([IntPtr]$handle, [ref]$rect)) {
      $width = [Math]::Max(1, $rect.Right - $rect.Left)
      $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
      Click-Point ($rect.Left + ($width * $xRatio)) ($rect.Top + ($height * $yRatio))
      return $true
    }
  } catch {}
  return $false
}

function Activate-Window($handle) {
  try {
    [Win32ZaloPaste]::ShowWindowAsync($handle, 9) | Out-Null
    [Win32ZaloPaste]::SetForegroundWindow($handle) | Out-Null
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $handle } | Select-Object -First 1
    if ($proc) {
      $shell = New-Object -ComObject WScript.Shell
      $shell.AppActivate([int]$proc.Id) | Out-Null
    }
    Start-Sleep -Milliseconds 250
  } catch {}
}

function Invoke-AutomationElement($element) {
  try {
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pattern) {
      $pattern.Invoke()
      return $true
    }
  } catch {}

  try {
    $rect = $element.Current.BoundingRectangle
    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
      $x = [int]($rect.Left + ($rect.Width / 2))
      $y = [int]($rect.Top + ($rect.Height / 2))
      Click-Point $x $y
      return $true
    }
  } catch {}

  return $false
}

function Focus-ChatInputArea($handle) {
  [Win32ZaloPaste]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 150
  
  # Click trực tiếp vào tọa độ ô chat (50% X, 97% Y) để tránh trúng thanh công cụ chụp màn hình
  Click-WindowRatio $handle 0.5 0.97 | Out-Null
  return $true
}

function Find-ZaloWindowHandle {
  $windows = Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Where-Object {
      $_.MainWindowTitle -match 'Zalo' -or
      $_.ProcessName -match 'Zalo|chrome|msedge|firefox|brave'
    } |
    Sort-Object StartTime -ErrorAction SilentlyContinue

  $zaloWindow = $windows | Where-Object { $_.MainWindowTitle -match 'Zalo' } | Select-Object -Last 1
  if ($zaloWindow) { return [IntPtr]$zaloWindow.MainWindowHandle }

  $foreground = [Win32ZaloPaste]::GetForegroundWindow()
  if ($foreground -ne [IntPtr]::Zero) { return $foreground }

  $fallback = $windows | Select-Object -Last 1
  if ($fallback) { return [IntPtr]$fallback.MainWindowHandle }
  return [IntPtr]::Zero
}

$handle = [IntPtr]::Zero
$global:focused = $false
$zaloSeenCount = 0
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $handle = Find-ZaloWindowHandle
  if ($handle -ne [IntPtr]::Zero) {
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $handle } | Select-Object -First 1
    $isRealZalo = ($proc -and $proc.ProcessName -match '(?i)^Zalo$')

    Activate-Window $handle
    Start-Sleep -Milliseconds 400
    
    # Chúng ta đã bỏ UIAutomation chậm chạp, nên có thể click luôn
    if (Focus-ChatInputArea $handle) { 
      $global:focused = $true
      break 
    }
    
    if ($isRealZalo) {
      $zaloSeenCount++
      if ($zaloSeenCount -ge 12) {
        break
      }
    }
  }
}

if ($handle -eq [IntPtr]::Zero) {
  throw 'Không tìm thấy cửa sổ Zalo để dán tin nhắn.'
}

if (-not $global:focused) {
  Start-Sleep -Milliseconds 2000
  Activate-Window $handle
  Focus-ChatInputArea $handle | Out-Null
}

Start-Sleep -Milliseconds 500

if (-not $env:ZALO_AUTOPASTE_IMAGE_B64) {
  Set-Clipboard -Value $msg
}
Start-Sleep -Milliseconds 300

if ($msg -or $env:ZALO_AUTOPASTE_IMAGE_B64) {
  Start-Sleep -Milliseconds 1500
  # Sử dụng keybd_event không đồng bộ để tránh bị treo (SendWait có thể block 30s)
  [Win32ZaloPaste]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [Win32ZaloPaste]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Win32ZaloPaste]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
  [Win32ZaloPaste]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  
  Start-Sleep -Milliseconds 400
  
  [Win32ZaloPaste]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Win32ZaloPaste]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)
}

`;
    const msgB64 = Buffer.from(message || '').toString('base64');
    const linkB64 = Buffer.from(link || '').toString('base64');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    
    const child = spawn('powershell.exe', ['-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: {
        ...process.env,
        ZALO_AUTOPASTE_MESSAGE_B64: msgB64,
        ZALO_AUTOPASTE_LINK_B64: linkB64,
        ZALO_AUTOPASTE_IMAGE_B64: imageBase64 || ''
      }
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      const err = new Error('Mở Zalo và tự dán quá lâu. Hãy dùng nút Copy tin rồi dán thủ công.');
      err.status = 500;
      reject(err);
    }, 30000);

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const err = new Error(stderr.trim() || 'Không mở/dán được vào Zalo. Hãy dùng nút Copy tin rồi dán thủ công.');
      err.status = 500;
      reject(err);
    });
  });
}

function selectSpecialZaloCandidates(db, filters, checkField) {
  const className = filters.className || 'ALL';
  const keyword = String(filters.q || '').toLowerCase().trim();
  
  const allStudents = (db.students || []).filter(s => {
    if (className !== 'ALL' && s.className !== className) return false;
    if (checkField && (!s[checkField] || s[checkField].trim() === '')) return false;
    
    if (keyword) {
      const haystack = `${s.code} ${s.fullName} ${s.className} ${s.parentName} ${s.phone1} ${s.phone2} ${s.zaloUserId}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
  
  const fakeAbsences = allStudents.map(s => ({
    id: `fake-${checkField}-${s.id}`,
    studentId: s.id,
    date: filters.date || todayISO(),
    session: 'Khác',
    absenceStatus: filters.absenceStatus,
    initialReason: filters.absenceStatus,
    noticeStatus: 'Chưa gửi',
    studentCode: s.code,
    studentName: s.fullName,
    className: s.className,
    parentName: s.parentName,
    phone1: s.phone1,
    phone2: s.phone2,
    zaloUserId: s.zaloUserId
  }));
  
  const alreadySentIds = new Set(
    (db.absences || [])
    .filter(a => a.date === (filters.date || todayISO()) && a.absenceStatus === filters.absenceStatus && a.noticeStatus === 'Đã gửi')
    .map(a => a.studentId)
  );
  
  const allCandidates = fakeAbsences.filter(row => !alreadySentIds.has(row.studentId));
  
  const settings = db.settings || defaultSettings();
  const isPersonalMode = ['personal-test', 'personal-real'].includes(settings.zaloMode);
  const testLimit = isPersonalMode ? personalTestLimitFromSettings(settings) : 0;
  const candidates = testLimit > 0 ? allCandidates.slice(0, testLimit) : allCandidates;
  
  return {
    rows: fakeAbsences,
    allCandidates,
    candidates,
    alreadySent: fakeAbsences.length - allCandidates.length,
    limited: allCandidates.length - candidates.length,
    limit: testLimit,
    mode: settings.zaloMode || 'dry-run'
  };
}

function buildSendZaloActionPreview(db, body) {
  const intent = detectAiActionIntent(body.message || '');
  if (!['send_zalo_bulk', 'send_zalo_tuition', 'send_zalo_periodic'].includes(intent)) return null;

  const filters = buildAiActionFilters(db, body);
  let selection;

  if (intent === 'send_zalo_tuition') {
    filters.absenceStatus = 'Học phí';
    selection = selectBulkZaloCandidates(db, filters);
  } else if (intent === 'send_zalo_periodic') {
    filters.absenceStatus = filters.absenceStatus === 'ALL' ? 'Định kì' : filters.absenceStatus;
    selection = selectSpecialZaloCandidates(db, filters, null);
  } else {
    selection = selectBulkZaloCandidates(db, filters);
  }

  const classText = filters.className === 'ALL' ? 'tất cả lớp' : `lớp ${filters.className}`;
  const statusText = filters.absenceStatus === 'ALL' ? 'tất cả trạng thái báo vắng' : filters.absenceStatus;
  const scopeText = `${classText}, ngày ${filters.date}, ${statusText}`;

  if (!selection.rows.length) {
    return {
      answer: `Mình chưa thấy bản ghi báo vắng nào trong phạm vi ${scopeText}, nên chưa tạo lệnh gửi Zalo.`,
      pendingAction: null
    };
  }

  if (!selection.candidates.length) {
    return {
      answer: `Trong phạm vi ${scopeText} có ${selection.rows.length} bản ghi, nhưng tất cả đã gửi hoặc không còn bản ghi cần gửi.`,
      pendingAction: null
    };
  }

  const preview = compactActionPreviewRows(selection.candidates);
  const limitedText = selection.limited > 0
    ? ` Chế độ hiện tại giới hạn ${selection.limit} học sinh, còn ${selection.limited} bản ghi chưa đưa vào lượt này.`
    : '';
  const modeNote = selection.mode === 'personal-real'
    ? 'Chế độ hiện tại là Zalo cá nhân: app sẽ tạo tin và nút mở Zalo để thầy/cô gửi thủ công, không thể tự gửi API.'
    : (selection.mode === 'personal-test'
      ? 'Chế độ hiện tại là Zalo cá nhân chạy thử: app chỉ ghi log, chưa gửi thật.'
      : (selection.mode === 'dry-run'
        ? 'Chế độ hiện tại là chạy thử: app chỉ ghi log, chưa gửi thật.'
        : 'Chế độ hiện tại là Zalo OA: app sẽ gọi API gửi thật nếu có OA token và Zalo user_id của phụ huynh.'));
  const action = storePendingAiAction({
    type: intent,
    label: 'Gửi Zalo theo yêu cầu',
    filters,
    scopeText,
    total: selection.rows.length,
    candidateCount: selection.candidates.length,
    skipped: selection.alreadySent,
    limited: selection.limited,
    limit: selection.limit,
    mode: selection.mode,
    preview
  });

  const rowsText = preview.map(row => `- ${row.studentName} · ${row.className} · ${row.absenceStatus} · ${row.noticeStatus}`).join('\n');
  return {
    answer: [
      `Mình đã chuẩn bị lệnh gửi Zalo cho ${selection.candidates.length} phụ huynh trong phạm vi ${scopeText}.`,
      modeNote,
      selection.alreadySent ? `Bỏ qua ${selection.alreadySent} bản ghi đã gửi.` : '',
      limitedText.trim(),
      rowsText ? `Xem trước:\n${rowsText}` : '',
      'Bấm Xác nhận gửi nếu thầy/cô muốn app thực hiện.'
    ].filter(Boolean).join('\n'),
    pendingAction: action
  };
}

function providerApiErrorMessage(providerLabel, status, data) {
  const rawMessage = data.error?.message || data.error || data.message || `${providerLabel} API lỗi HTTP ${status}`;
  const errorCode = data.error?.code || data.code || '';
  const errorType = data.error?.type || data.type || '';
  const errorText = [rawMessage, errorCode, errorType].join(' ');

  if (providerLabel === 'OpenAI' && status === 429 && /quota|billing|credit|insufficient/i.test(errorText)) {
    return 'OpenAI API đã hết quota/credit hoặc chạm giới hạn chi tiêu. Vui lòng kiểm tra Billing/Usage trên platform.openai.com, nạp thêm credit hoặc tăng giới hạn; tạm thời có thể chuyển chatbox sang Gemini, Coze hoặc Trợ lý nội bộ.';
  }

  if (status === 429 && /rate limit|too many|quota/i.test(errorText)) {
    return `${providerLabel} đang bị giới hạn lượt gọi. Vui lòng thử lại sau hoặc kiểm tra hạn mức tài khoản.`;
  }

  if (status === 401 || status === 403) {
    return `${providerLabel} từ chối xác thực. Vui lòng kiểm tra lại API key/quyền truy cập.`;
  }

  return rawMessage;
}

async function fetchJsonApi(url, options, providerLabel) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(providerApiErrorMessage(providerLabel, response.status, data));
    err.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw err;
  }

  return data;
}

function extractOpenAiAnswer(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();

  const texts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') texts.push(content.text);
      if (typeof content?.output_text === 'string') texts.push(content.output_text);
    }
  }

  return texts.join('\n').trim();
}

function extractGeminiAnswer(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();

  const steps = Array.isArray(payload?.steps) ? [...payload.steps].reverse() : [];
  for (const step of steps) {
    const content = Array.isArray(step?.content) ? step.content : [];
    const text = content
      .map(part => (typeof part === 'string' ? part : part?.text))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }

  const candidateText = payload?.candidates?.[0]?.content?.parts
    ?.map(part => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();
  return candidateText || '';
}

async function askOpenAiAssistant(db, body, settings) {
  const config = getOpenAiRuntimeConfig(settings);
  if (!config.apiKey) {
    const err = new Error('Thiếu OpenAI API key.');
    err.status = 400;
    throw err;
  }

  const prompt = buildAiPromptParts(db, body);
  const payload = await fetchJsonApi('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      instructions: prompt.instructions,
      input: prompt.input
    })
  }, 'OpenAI');

  return {
    answer: extractOpenAiAnswer(payload) || 'ChatGPT đã xử lý nhưng chưa trả nội dung trả lời.',
    conversationId: payload.id || '',
    status: payload.status || 'completed',
    source: 'openai',
    model: config.model
  };
}

async function askGeminiAssistant(db, body, settings) {
  const config = getGeminiRuntimeConfig(settings);
  if (!config.apiKey) {
    const err = new Error('Thiếu Gemini API key.');
    err.status = 400;
    throw err;
  }

  const prompt = buildAiPromptParts(db, body);
  const requestBody = {
    model: config.model,
    system_instruction: prompt.instructions,
    input: prompt.input
  };
  if (body.conversationId) requestBody.previous_interaction_id = body.conversationId;

  const payload = await fetchJsonApi(`${config.baseUrl}/interactions`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': config.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  }, 'Gemini');

  return {
    answer: extractGeminiAnswer(payload) || 'Gemini đã xử lý nhưng chưa trả nội dung trả lời.',
    conversationId: payload.id || '',
    status: payload.state || payload.status || 'completed',
    source: 'gemini',
    model: config.model
  };
}

function cozeDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cozeApiRequest(config, apiPath, options = {}) {
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || (typeof data.code === 'number' && data.code !== 0)) {
    const rawMessage = data.msg || data.message || data.error || `Coze API lỗi HTTP ${response.status}`;
    const looksLikeAuthError = response.status === 401
      || response.status === 403
      || /auth|token|credential|permission/i.test(rawMessage);
    const err = new Error(looksLikeAuthError ? cozeAuthErrorMessage(rawMessage, config) : rawMessage);
    err.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw err;
  }

  return data;
}

function extractCozeAnswer(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.data) ? payload.data : (payload?.data?.messages || payload?.messages || []));
  const messages = [...rows].reverse();
  const answer = messages.find(message =>
    message?.content
    && message.type === 'answer'
    && (!message.content_type || message.content_type === 'text')
  );
  if (answer?.content) return answer.content;

  const assistantText = messages.find(message =>
    message?.content
    && message.role === 'assistant'
    && (!message.type || !['follow_up', 'verbose'].includes(message.type))
    && (!message.content_type || message.content_type === 'text')
  );
  return assistantText?.content || payload?.data?.content || payload?.content || '';
}

async function askCozeAssistant(db, body, overrideSettings = null, configOptions = {}) {
  const settings = overrideSettings
    ? { ...defaultSettings(), ...(db.settings || {}), ...overrideSettings }
    : (db.settings || defaultSettings());
  const config = getCozeRuntimeConfig(settings, configOptions);

  if (!config.enabled) {
    const err = new Error('Coze AI chưa được bật trong Cài đặt.');
    err.status = 400;
    throw err;
  }
  if (!config.botId || !config.accessToken) {
    const err = new Error('Thiếu Coze bot ID hoặc access token.');
    err.status = 400;
    throw err;
  }

  const promptParts = buildAiPromptParts(db, body);
  const prompt = [promptParts.instructions, promptParts.input].join('\n\n');

  const create = await cozeApiRequest(config, '/v3/chat', {
    method: 'POST',
    body: {
      bot_id: config.botId,
      user_id: config.userId,
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: 'user',
          content: prompt,
          content_type: 'text'
        }
      ]
    }
  });

  let chat = create.data || create;
  const chatId = chat.id || chat.chat_id || '';
  const conversationId = chat.conversation_id || body.conversationId || '';
  let status = chat.status || '';

  for (let attempt = 0; chatId && conversationId && !['completed', 'failed', 'canceled'].includes(status) && attempt < 12; attempt += 1) {
    await cozeDelay(900);
    const retrieved = await cozeApiRequest(config, `/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`);
    chat = retrieved.data || retrieved;
    status = chat.status || status;
  }

  if (['failed', 'canceled'].includes(status)) {
    const err = new Error(chat.last_error?.msg || chat.last_error?.message || `Coze chat ${status}.`);
    err.status = 502;
    throw err;
  }

  let answer = extractCozeAnswer(create);
  if (chatId && conversationId) {
    const messages = await cozeApiRequest(config, `/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`);
    answer = extractCozeAnswer(messages) || answer;
  }

  return {
    answer: answer || 'Coze AI đã xử lý nhưng chưa trả nội dung trả lời.',
    conversationId,
    chatId,
    status: status || 'completed',
    source: 'coze'
  };
}

async function askAiAssistant(db, body, overrideSettings = null, configOptions = {}) {
  const settings = overrideSettings
    ? { ...defaultSettings(), ...(db.settings || {}), ...overrideSettings }
    : (db.settings || defaultSettings());
  const config = getAiRuntimeConfig(settings, configOptions);

  if (config.provider === 'coze') return askCozeAssistant(db, body, settings, { ignoreEnabledEnv: configOptions.ignoreCozeEnabledEnv });
  if (config.provider === 'openai') return askOpenAiAssistant(db, body, settings);
  if (config.provider === 'gemini') return askGeminiAssistant(db, body, settings);

  const err = new Error('Chatbox đang dùng trợ lý nội bộ, không cần gọi API AI.');
  err.status = 400;
  throw err;
}

function getZaloRuntimeConfig(settings) {
  return {
    enabled: String(process.env.ZALO_ENABLED || settings.zaloEnabled) === 'true',
    mode: process.env.ZALO_MODE || settings.zaloMode || 'dry-run',
    endpoint: process.env.ZALO_ENDPOINT || settings.zaloEndpoint || DEFAULT_ZALO_ENDPOINT,
    accessToken: process.env.ZALO_OA_ACCESS_TOKEN || settings.zaloAccessToken || '',
    personalName: settings.personalZaloName || '',
    personalPhone: settings.personalZaloPhone || '',
    personalTestLimit: personalTestLimitFromSettings(settings)
  };
}

async function sendZaloNotice(db, absenceId, reason = 'auto') {
  const absence = db.absences.find(row => row.id === absenceId);
  if (!absence) {
    const err = new Error('Không tìm thấy bản ghi vắng học để gửi Zalo.');
    err.status = 404;
    throw err;
  }
  const student = db.students.find(row => row.id === absence.studentId) || {};
  const settings = db.settings || defaultSettings();
  const config = getZaloRuntimeConfig(settings);
  const message = buildMessage(settings, absence, student);
  const time = nowISO();

  const baseLog = {
    id: id('noti'),
    time,
    absenceId: absence.id,
    date: absence.date,
    studentId: student.id || '',
    studentCode: student.code || '',
    studentName: student.fullName || '',
    className: student.className || '',
    parentName: student.parentName || '',
    phone1: student.phone1 || '',
    zaloUserId: student.zaloUserId || '',
    channel: ['personal-test', 'personal-real'].includes(config.mode) ? 'Zalo cá nhân' : 'Zalo OA',
    reason,
    message
  };

  function finish(status, result, responsePayload) {
    const log = { ...baseLog, status, result, responsePayload: responsePayload || null };
    db.notificationLogs.push(log);
    const index = db.absences.findIndex(row => row.id === absence.id);
    if (index !== -1) {
      db.absences[index] = {
        ...db.absences[index],
        noticeStatus: status,
        noticeResult: result,
        noticeSentAt: ['Đã gửi', 'Chạy thử'].includes(status) ? time : db.absences[index].noticeSentAt,
        noticeDueAt: '',
        autoNotice: false,
        updatedAt: time
      };
    }
    return log;
  }

  if (config.mode === 'personal-test') {
    const sender = [config.personalName, config.personalPhone].filter(Boolean).join(' - ') || 'Zalo cá nhân';
    return finish('Chạy thử', `Chạy thử ${sender}: đã ghi log nội dung tin nhắn, chưa gửi thật.`, {
      dryRun: true,
      channel: 'Zalo cá nhân',
      sender
    });
  }

  if (config.mode === 'personal-real') {
    const phone = normalizePhone(student.phone1 || student.phone2);
    const sender = [config.personalName, config.personalPhone].filter(Boolean).join(' - ') || 'Zalo cá nhân';
    const link = phone ? `zalo://conversation?phone=${phone}` : '';

    if (reason === 'ai_confirmed_bulk_send' && process.platform === 'win32' && phone) {
      try {
        let imageBase64 = null;
        if (['Định kì', 'Khóa mới', 'Thông báo chung'].includes(normalizeAbsenceStatus(absence.absenceStatus))) {
          imageBase64 = settings.periodicImageBase64 || null;
        }
        await runWindowsZaloPaste(message, link, imageBase64);
        return finish('Đã gửi', 'Đã tự động điều khiển Zalo cá nhân (AI gửi).', { 
          channel: 'Zalo cá nhân', 
          sender, 
          phone, 
          link 
        });
      } catch (err) {
        return finish('Lỗi gửi', err.message || 'Lỗi khi mở Zalo cá nhân.', { 
          channel: 'Zalo cá nhân', 
          sender, 
          phone, 
          link 
        });
      }
    }

    return finish('Chờ gửi thủ công', `Đã tạo tin nhắn cho ${sender}. Mở Zalo cá nhân, gửi nội dung rồi đánh dấu đã gửi.`, {
      manual: true,
      channel: 'Zalo cá nhân',
      sender,
      phone,
      link,
      message
    });
  }

  if (!config.enabled || config.mode === 'dry-run') {
    return finish('Chạy thử', 'Chưa bật gửi thật. Hệ thống chỉ ghi log nội dung tin nhắn.', { dryRun: true });
  }

  if (!student.zaloUserId) {
    return finish('Không gửi', 'Thiếu Zalo user_id của phụ huynh. OA API dạng tư vấn không gửi trực tiếp theo số điện thoại.', null);
  }

  if (!config.accessToken) {
    return finish('Lỗi gửi', 'Thiếu OA access token.', null);
  }

  const payload = {
    recipient: { user_id: student.zaloUserId },
    message: { text: message }
  };

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: config.accessToken
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({ raw: 'Không đọc được JSON response từ Zalo.' }));

    if (!response.ok || (typeof data.error === 'number' && data.error !== 0)) {
      return finish('Lỗi gửi', data.message || `Zalo API trả lỗi HTTP ${response.status}`, data);
    }

    return finish('Đã gửi', 'Đã gửi thông báo qua Zalo OA.', data);
  } catch (error) {
    return finish('Lỗi gửi', error.message, null);
  }
}

let noticeSchedulerRunning = false;

async function processDueNotices() {
  if (noticeSchedulerRunning) return;
  noticeSchedulerRunning = true;
  try {
    const rootDb = await readDb();
    if (!rootDb.branches) return;
    const now = Date.now();
    let changed = false;
    
    for (const branchId of Object.keys(rootDb.branches)) {
      const db = rootDb.branches[branchId];
      const dueAbsences = (db.absences || []).filter(absence =>
        absence.autoNotice
        && absence.noticeStatus === 'Chờ gửi'
        && absence.noticeDueAt
        && !Number.isNaN(new Date(absence.noticeDueAt).getTime())
        && new Date(absence.noticeDueAt).getTime() <= now
      );

      if (!dueAbsences.length) continue;

      for (const absence of dueAbsences) {
        await sendZaloNotice(db, absence.id, 'scheduled_delay');
      }
      changed = true;
    }

    if (changed) {
      await writeDb(rootDb);
    }
  } finally {
    noticeSchedulerRunning = false;
  }
}

function getCell(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  }
  const lowerMap = Object.fromEntries(Object.keys(row).map(key => [key.toLowerCase().trim(), key]));
  for (const name of names) {
    const key = lowerMap[String(name).toLowerCase().trim()];
    if (key && row[key] !== undefined && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

function parseContactsWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '', raw: false });

  return rows.flatMap((row, index) => {
    const notesColumn = String(getCell(row, ['Notes', 'Ghi chú', 'Labels', 'Custom Field 1 - Value']) || '');
    const rawClassName = String(getCell(row, ['Lop', 'Lớp', 'Class', 'Class Name', 'Name Prefix']) || '');
    
    let classes = notesColumn.split(',').map(c => cleanText(c.replace(/\*/g, ''))).filter(Boolean);
    if (!classes.length && rawClassName) {
      classes = rawClassName.split(',').map(c => cleanText(c.replace(/\*/g, ''))).filter(Boolean);
    }
    if (!classes.length) classes.push('');

    const first = cleanText(getCell(row, ['First Name', 'Tên', 'Ten']));
    const middle = cleanText(getCell(row, ['Middle Name', 'Tên đệm', 'Ten dem']));
    const last = cleanText(getCell(row, ['Last Name', 'Họ', 'Ho']));
    const display = cleanText(getCell(row, ['HoTen', 'Họ tên', 'Full Name', 'Name', 'File As']));
    const fullName = display || [first, middle, last].filter(Boolean).join(' ');
    const phones = extractPhones(
      getCell(row, ['SDT', 'SĐT', 'DienThoai', 'Điện thoại', 'Phone', 'Phone 1 - Value', 'Phone 1 - Label']),
      getCell(row, ['Phone 2 - Value', 'Phone 2 - Label', 'SDT2', 'SĐT2']),
      getCell(row, ['Phone 3 - Value', 'Phone 3 - Label'])
    );
    const parentName = cleanText(getCell(row, ['PhuHuynh', 'Phụ huynh', 'Parent', 'Parent Name', 'Name Suffix'])) || 'Phụ huynh';
    const sourceTags = cleanText(getCell(row, ['Notes', 'Ghi chú', 'Labels', 'Custom Field 1 - Value']));
    const explicitCode = cleanText(getCell(row, ['MaHS', 'Mã HS', 'Code', 'Student Code']));
    const zaloUserId = cleanText(getCell(row, ['Zalo UID', 'Zalo User ID', 'zaloUserId', 'user_id']));
    const birthday = cleanText(getCell(row, ['NgaySinh', 'Ngày sinh', 'DOB', 'Birthday', 'SinhNhat']));
    const tuitionDebt = cleanText(getCell(row, ['TienNo', 'Tiền nợ', 'ConNo', 'HocPhi', 'Tuition', 'Nợ học phí']));

    return classes.map((className, classIndex) => {
      const code = explicitCode 
        ? (classes.length > 1 ? `${explicitCode}-${cleanText(className).replace(/\s+/g, '')}` : explicitCode) 
        : `AUTO-${shortHash(`${className}|${fullName}|${phones[0] || ''}|${index}`)}`;

      return sanitizeStudent({
        code,
        fullName,
        className,
        parentName,
        phone1: phones[0] || '',
        phone2: phones[1] || '',
        homeroomTeacher: '',
        zaloUserId,
        sourceTags,
        status: 'Đang học',
        birthday,
        tuitionDebt
      });
    });
  }).filter(student => student.fullName && student.className && student.phone1);
}

function upsertImportedStudents(db, importedStudents) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const details = [];

  importedStudents.forEach(student => {
    if (!student.fullName || !student.className || !student.phone1) {
      skipped += 1;
      return;
    }
    const existingIndex = db.students.findIndex(row =>
      row.code.toLowerCase() === student.code.toLowerCase()
      || (
        row.fullName.toLowerCase() === student.fullName.toLowerCase()
        && row.className.toLowerCase() === student.className.toLowerCase()
        && normalizePhone(row.phone1) === normalizePhone(student.phone1)
      )
    );

    if (existingIndex >= 0) {
      db.students[existingIndex] = {
        ...db.students[existingIndex],
        ...student,
        id: db.students[existingIndex].id
      };
      updated += 1;
      details.push({ action: 'updated', student: db.students[existingIndex] });
    } else {
      const newStudent = { id: id('stu'), ...student };
      db.students.push(newStudent);
      created += 1;
      details.push({ action: 'created', student: newStudent });
    }
  });

  return { created, updated, skipped, details };
}

const KETBU_STATE_FILE = path.join(DATA_DIR, 'ketbu-state.json');

app.get('/api/ketbu/state', async (req, res, next) => {
  try {
    let payload = { state: null, updatedAt: null };
    if (fs.existsSync(KETBU_STATE_FILE)) {
      payload = JSON.parse(fs.readFileSync(KETBU_STATE_FILE, 'utf8'));
    }
    res.json({ state: payload.state || null, updatedAt: payload.updatedAt || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ketbu/state', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body || typeof body.state !== 'object') {
      const err = new Error('Dữ liệu đồng bộ không hợp lệ.');
      err.status = 400;
      throw err;
    }
    const payload = {
      state: body.state,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(KETBU_STATE_FILE, JSON.stringify(payload, null, 2));
    res.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (error) {
    next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'bao-vang-hoc-sinh-zalo-oa', time: nowISO() });
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const absences = filterAbsences(db, req.query);
    const classes = [...new Set((db.students || []).filter(isActiveStudent).map(student => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    res.json({
      today: todayISO(),
      settings: publicSettings(db.settings || defaultSettings()),
      classes,
      statuses: ['ALL', 'Chưa gọi', 'Đã gọi', 'Không nghe máy', 'Hẹn gọi lại', 'Sai số'],
      noticeStatuses: ['ALL', 'Chờ gửi', 'Chờ gửi thủ công', 'Chưa gửi', 'Chạy thử', 'Đã gửi', 'Lỗi gửi', 'Không gửi'],
      absenceStatuses: ABSENCE_STATUSES,
      results: [
        '',
        'Phụ huynh xác nhận nghỉ có phép',
        'Phụ huynh không biết học sinh vắng',
        'Học sinh đi trễ',
        'Không liên hệ được',
        'Cần báo GVCN xử lý'
      ],
      absences,
      summary: getSummary(absences)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/settings', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    res.json(publicSettings(db.settings || defaultSettings()));
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const zaloDelayMinutes = delayMinutesFromSettings({ zaloDelayMinutes: req.body.zaloDelayMinutes });
    const aiProvider = normalizeAiProvider(req.body.aiProvider || (req.body.cozeEnabled ? 'coze' : DEFAULT_AI_PROVIDER));
    db.settings = {
      ...defaultSettings(),
      ...(db.settings || {}),
      schoolName: cleanText(req.body.schoolName) || 'Trường học',
      zaloEnabled: Boolean(req.body.zaloEnabled),
      zaloMode: cleanText(req.body.zaloMode) || 'dry-run',
      zaloDelayMinutes,
      zaloEndpoint: cleanText(req.body.zaloEndpoint) || DEFAULT_ZALO_ENDPOINT,
      personalZaloName: cleanText(req.body.personalZaloName),
      personalZaloPhone: normalizePhone(req.body.personalZaloPhone),
      personalTestLimit: personalTestLimitFromSettings({ personalTestLimit: req.body.personalTestLimit }),
      zaloCycleSize: Math.max(1, Math.min(500, Number(req.body.zaloCycleSize) || 20)),
      zaloCycleDelayMinutes: Math.max(0, Math.min(60, Number(req.body.zaloCycleDelayMinutes) || 1)),
      aiProvider,
      openaiModel: cleanText(req.body.openaiModel) || DEFAULT_OPENAI_MODEL,
      geminiModel: cleanText(req.body.geminiModel) || DEFAULT_GEMINI_MODEL,
      cozeEnabled: aiProvider === 'coze',
      cozeBaseUrl: cleanText(req.body.cozeBaseUrl) || DEFAULT_COZE_BASE_URL,
      cozeBotId: cleanText(req.body.cozeBotId),
      cozeUserId: cleanText(req.body.cozeUserId) || 'bao-vang-teacher',
      messageTemplate: cleanMultilineText(req.body.messageTemplate) || defaultSettings().messageTemplate,
      tuitionTemplate: cleanMultilineText(req.body.tuitionTemplate) || defaultSettings().tuitionTemplate,
      periodicTemplate: cleanMultilineText(req.body.periodicTemplate) || defaultSettings().periodicTemplate
    };
    if (req.body.zaloAccessToken !== undefined && String(req.body.zaloAccessToken).trim() !== '') {
      db.settings.zaloAccessToken = String(req.body.zaloAccessToken).trim();
    }
    if (req.body.cozeAccessToken !== undefined && String(req.body.cozeAccessToken).trim() !== '') {
      db.settings.cozeAccessToken = normalizeCozeAccessToken(req.body.cozeAccessToken);
    }
    if (req.body.openaiApiKey !== undefined && String(req.body.openaiApiKey).trim() !== '') {
      db.settings.openaiApiKey = normalizeSecretKey(req.body.openaiApiKey);
    }
    if (req.body.geminiApiKey !== undefined && String(req.body.geminiApiKey).trim() !== '') {
      db.settings.geminiApiKey = normalizeSecretKey(req.body.geminiApiKey);
    }
    await saveBranchDb(req, db);
    res.json(publicSettings(db.settings));
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai-chat/test', async (req, res, next) => {
  try {
    requireFields(req.body, ['message']);
    const db = await getBranchDb(req);
    const saved = db.settings || defaultSettings();
    const aiProvider = normalizeAiProvider(req.body.aiProvider || saved.aiProvider || (req.body.cozeEnabled ? 'coze' : DEFAULT_AI_PROVIDER));
    if (aiProvider === 'internal') {
      res.json({
        answer: 'Trợ lý nội bộ đang hoạt động. Không cần API key ngoài.',
        source: 'internal',
        status: 'completed'
      });
      return;
    }
    const overrideSettings = {
      aiProvider,
      cozeEnabled: aiProvider === 'coze',
      cozeBaseUrl: cleanText(req.body.cozeBaseUrl) || saved.cozeBaseUrl || DEFAULT_COZE_BASE_URL,
      cozeBotId: cleanText(req.body.cozeBotId) || saved.cozeBotId || '',
      cozeAccessToken: normalizeCozeAccessToken(req.body.cozeAccessToken) || saved.cozeAccessToken || '',
      cozeUserId: cleanText(req.body.cozeUserId) || saved.cozeUserId || 'bao-vang-teacher',
      openaiModel: cleanText(req.body.openaiModel) || saved.openaiModel || DEFAULT_OPENAI_MODEL,
      openaiApiKey: normalizeSecretKey(req.body.openaiApiKey) || saved.openaiApiKey || '',
      geminiModel: cleanText(req.body.geminiModel) || saved.geminiModel || DEFAULT_GEMINI_MODEL,
      geminiApiKey: normalizeSecretKey(req.body.geminiApiKey) || saved.geminiApiKey || ''
    };
    const result = await askAiAssistant(db, req.body, overrideSettings, {
      ignoreProviderEnv: true,
      ignoreCozeEnabledEnv: true
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai-chat', async (req, res, next) => {
  try {
    requireFields(req.body, ['message']);
    const db = await getBranchDb(req);
    const result = await askAiAssistant(db, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai-actions/preview', async (req, res, next) => {
  try {
    requireFields(req.body, ['message']);
    const db = await getBranchDb(req);
    const result = buildSendZaloActionPreview(db, req.body);
    if (!result) {
      res.json({ answer: '', pendingAction: null });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai-actions/confirm', async (req, res, next) => {
  try {
    requireFields(req.body, ['actionId']);
    const action = consumePendingAiAction(cleanText(req.body.actionId));
    if (!['send_zalo_bulk', 'send_zalo_tuition', 'send_zalo_birthday'].includes(action.type)) {
      const err = new Error('App chưa hỗ trợ thực hiện hành động AI này.');
      err.status = 400;
      throw err;
    }

    const db = await getBranchDb(req);
    
    if (['send_zalo_birthday'].includes(action.type)) {
      const selection = selectSpecialZaloCandidates(db, action.filters, 'birthday');
      for (const row of selection.candidates) {
        const absence = {
          id: id('abs'),
          studentId: row.studentId,
          date: row.date,
          session: row.session,
          absenceStatus: row.absenceStatus,
          initialReason: row.initialReason,
          noticeStatus: 'Chờ gửi',
          createdAt: nowISO(),
          updatedAt: nowISO()
        };
        db.absences.push(absence);
      }
    }

    const result = await runBulkZaloAction(db, action.filters, 'ai_confirmed_bulk_send');
    await saveBranchDb(req, db);
    res.json({
      actionId: action.id,
      actionType: action.type,
      scopeText: action.scopeText,
      result
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/local-zalo/open-paste', async (req, res, next) => {
  try {
    if (!isLocalRequest(req)) {
      const err = new Error('Chức năng mở và tự dán Zalo chỉ cho phép dùng trên máy đang chạy app.');
      err.status = 403;
      throw err;
    }

    requireFields(req.body, ['message']);
    const message = String(req.body.message || '').trim();
    const link = cleanText(req.body.link);
    if (link && !/^https:\/\/zalo\.me\/[0-9+]+$/i.test(link)) {
      const err = new Error('Link Zalo không hợp lệ.');
      err.status = 400;
      throw err;
    }

    await runWindowsZaloPaste(message, link);
    res.json({ ok: true, pasted: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/students', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const q = normalizeSearchText(req.query.q || '');
    let rows = db.students || [];

    if (q) {
      rows = rows.filter(student => {
        const text = normalizeSearchText(`${student.code} ${student.fullName} ${student.className} ${student.parentName} ${student.phone1} ${student.phone2} ${student.homeroomTeacher} ${student.zaloUserId} ${student.sourceTags}`);
        return text.includes(q);
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const absences = db.absences || [];

    const enrichedRows = rows.map(student => {
      const recentAbsences = absences.filter(a => 
        a.studentId === student.id && 
        a.date >= thirtyDaysAgoStr &&
        ['Vắng', 'Không phép', 'Vắng không phép', 'Đi trễ'].includes(a.absenceStatus)
      );
      return { ...student, recentAbsenceCount: recentAbsences.length };
    });

    enrichedRows.sort((a, b) => `${a.className} ${a.fullName}`.localeCompare(`${b.className} ${b.fullName}`, 'vi'));
    res.json(enrichedRows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/students', async (req, res, next) => {
  try {
    requireFields(req.body, ['code', 'fullName', 'className', 'parentName', 'phone1']);
    const db = await getBranchDb(req);
    const student = sanitizeStudent(req.body);

    if (db.students.some(row => row.code.toLowerCase() === student.code.toLowerCase())) {
      const err = new Error('Mã học sinh đã tồn tại.');
      err.status = 409;
      throw err;
    }

    const newStudent = { id: id('stu'), ...student };
    db.students.push(newStudent);
    await saveBranchDb(req, db);
    res.status(201).json(newStudent);
  } catch (error) {
    next(error);
  }
});

app.put('/api/students/:id', async (req, res, next) => {
  try {
    requireFields(req.body, ['code', 'fullName', 'className', 'parentName', 'phone1']);
    const db = await getBranchDb(req);
    const index = db.students.findIndex(student => student.id === req.params.id);
    if (index === -1) {
      const err = new Error('Không tìm thấy học sinh.');
      err.status = 404;
      throw err;
    }

    const student = sanitizeStudent(req.body);
    if (db.students.some(row => row.id !== req.params.id && row.code.toLowerCase() === student.code.toLowerCase())) {
      const err = new Error('Mã học sinh đã tồn tại.');
      err.status = 409;
      throw err;
    }

    db.students[index] = { ...db.students[index], ...student };
    await saveBranchDb(req, db);
    res.json(db.students[index]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/students/:id', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const hasAbsences = db.absences.some(absence => absence.studentId === req.params.id);
    if (hasAbsences) {
      const err = new Error('Không thể xóa học sinh đã có dữ liệu vắng. Có thể đổi trạng thái thành Nghỉ học.');
      err.status = 409;
      throw err;
    }

    db.students = db.students.filter(student => student.id !== req.params.id);
    await saveBranchDb(req, db);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/students', upload.array('contacts', 50), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      const err = new Error('Vui lòng chọn file Excel danh bạ.');
      err.status = 400;
      throw err;
    }
    const db = await getBranchDb(req);
    let totalParsed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let allSamples = [];

    for (const file of req.files) {
      const imported = parseContactsWorkbook(file.buffer);
      const result = upsertImportedStudents(db, imported);
      totalParsed += imported.length;
      totalCreated += result.created;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      allSamples = allSamples.concat(result.details);
    }
    
    await saveBranchDb(req, db);
    res.json({
      success: true,
      fileName: req.files.map(f => f.originalname).join(', '),
      parsed: totalParsed,
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
      samples: allSamples.slice(0, 10)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/absences', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const absences = filterAbsences(db, req.query);
    res.json({ absences, summary: getSummary(absences) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/absences/export-late', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const absences = filterAbsences(db, { ...req.query, absenceStatus: 'Đi trễ' });
    const rows = absences.map((row, index) => ({
      STT: index + 1,
      'Ngày': row.date,
      'Buổi': row.session,
      'Lớp': row.className,
      'Mã HS': row.studentCode,
      'Họ tên học sinh': row.studentName,
      'Phụ huynh': row.parentName,
      'SĐT phụ huynh': row.phone1 || row.phone2,
      'Trạng thái': normalizeAbsenceStatus(row.absenceStatus),
      'Trạng thái gọi': row.callStatus,
      'Kết quả gọi': row.callResult,
      'Trạng thái Zalo': row.noticeStatus,
      'Thời gian xử lý': row.noticeSentAt || row.lastCallAt || row.updatedAt || '',
      'Ghi chú': row.note || row.initialReason || ''
    }));
    const suffix = req.query.date ? cleanText(req.query.date) : 'tat-ca';
    sendWorkbook(res, `hoc-sinh-di-tre-${suffix}.xlsx`, [
      { name: 'Hoc sinh di tre', rows }
    ]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/absences/export-failed-zalo', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    // Lọc theo ngày (nếu có) và trạng thái là 'Lỗi gửi' hoặc 'Không gửi'
    const absences = filterAbsences(db, req.query).filter(a => a.noticeStatus === 'Lỗi gửi' || a.noticeStatus === 'Không gửi');
    const rows = absences.map((row, index) => {
      const student = db.students.find(s => s.id === row.studentId) || {};
      return {
        STT: index + 1,
        'Ngày': row.date,
        'Buổi': row.session,
        'Lớp': student.className || '',
        'Họ tên học sinh': student.fullName || '',
        'Phụ huynh': student.parentName || '',
        'SĐT Phụ huynh': student.phone1 || '',
        'Trạng thái Zalo': row.noticeStatus || '',
        'Lý do vắng': row.note || row.initialReason || ''
      };
    });
    const suffix = req.query.date ? cleanText(req.query.date) : 'tat-ca';
    sendWorkbook(res, `danh-sach-loi-zalo-can-goi-${suffix}.xlsx`, [
      { name: 'DS Loi Zalo', rows }
    ]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/absences', async (req, res, next) => {
  try {
    requireFields(req.body, ['date', 'studentId', 'session', 'absenceStatus']);
    const db = await getBranchDb(req);
    const student = db.students.find(row => row.id === req.body.studentId);
    if (!student) {
      const err = new Error('Không tìm thấy học sinh.');
      err.status = 404;
      throw err;
    }

    const duplicate = db.absences.some(absence => absence.date === req.body.date && absence.studentId === req.body.studentId && absence.session === req.body.session);
    if (duplicate) {
      const err = new Error('Học sinh này đã được ghi vắng trong ngày/buổi đã chọn.');
      err.status = 409;
      throw err;
    }

    const shouldAutoSend = req.body.sendZalo !== false;
    const noticeDelayMinutes = shouldAutoSend ? delayMinutesFromSettings(db.settings || defaultSettings()) : 0;
    const absenceStatus = normalizeAbsenceStatus(req.body.absenceStatus);
    const absence = {
      id: id('abs'),
      date: cleanText(req.body.date),
      studentId: student.id,
      session: cleanText(req.body.session),
      absenceStatus,
      initialReason: normalizeInitialReason(req.body.initialReason, absenceStatus),
      callStatus: 'Chưa gọi',
      callResult: '',
      caller: '',
      lastCallAt: '',
      note: '',
      noticeStatus: shouldAutoSend ? (noticeDelayMinutes > 0 ? 'Chờ gửi' : 'Chưa gửi') : 'Không gửi',
      noticeResult: '',
      noticeSentAt: '',
      noticeDueAt: shouldAutoSend && noticeDelayMinutes > 0 ? addMinutesISO(noticeDelayMinutes) : '',
      noticeDelayMinutes,
      autoNotice: shouldAutoSend && noticeDelayMinutes > 0,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    db.absences.push(absence);
    if (absenceStatus === 'Nghỉ học') {
      const studentIndex = db.students.findIndex(row => row.id === student.id);
      if (studentIndex !== -1) db.students[studentIndex] = { ...db.students[studentIndex], status: 'Nghỉ học' };
    }
    let noticeLog = null;
    if (shouldAutoSend && noticeDelayMinutes === 0) {
      noticeLog = await sendZaloNotice(db, absence.id, 'absence_created');
    }
    await saveBranchDb(req, db);
    const saved = db.absences.find(row => row.id === absence.id);
    res.status(201).json({ absence: enrichAbsence(saved, studentByIdMap(db.students)), noticeLog });
  } catch (error) {
    next(error);
  }
});

app.put('/api/absences/:id/status', async (req, res, next) => {
  try {
    requireFields(req.body, ['absenceStatus']);
    const db = await getBranchDb(req);
    const index = db.absences.findIndex(absence => absence.id === req.params.id);
    if (index === -1) {
      const err = new Error('Không tìm thấy bản ghi vắng học.');
      err.status = 404;
      throw err;
    }
    const shouldAutoSend = req.body.sendZalo !== false;
    const noticeDelayMinutes = shouldAutoSend ? delayMinutesFromSettings(db.settings || defaultSettings()) : 0;
    const absenceStatus = normalizeAbsenceStatus(req.body.absenceStatus);
    db.absences[index] = {
      ...db.absences[index],
      absenceStatus,
      initialReason: normalizeInitialReason(req.body.initialReason || db.absences[index].initialReason, absenceStatus),
      noticeStatus: shouldAutoSend && noticeDelayMinutes > 0 ? 'Chờ gửi' : db.absences[index].noticeStatus,
      noticeDueAt: shouldAutoSend && noticeDelayMinutes > 0 ? addMinutesISO(noticeDelayMinutes) : db.absences[index].noticeDueAt,
      noticeDelayMinutes,
      autoNotice: shouldAutoSend && noticeDelayMinutes > 0,
      updatedAt: nowISO()
    };
    if (absenceStatus === 'Nghỉ học') {
      const studentIndex = db.students.findIndex(row => row.id === db.absences[index].studentId);
      if (studentIndex !== -1) db.students[studentIndex] = { ...db.students[studentIndex], status: 'Nghỉ học' };
    }
    let noticeLog = null;
    if (shouldAutoSend && noticeDelayMinutes === 0) {
      noticeLog = await sendZaloNotice(db, req.params.id, 'absence_status_updated');
    }
    await saveBranchDb(req, db);
    res.json({ absence: enrichAbsence(db.absences[index], studentByIdMap(db.students)), noticeLog });
  } catch (error) {
    next(error);
  }
});

function selectBulkZaloCandidates(db, filters) {
  const rows = filterAbsences(db, filters || {});
  const allCandidates = rows.filter(row => row.noticeStatus !== 'Đã gửi');
  const settings = db.settings || defaultSettings();
  const isPersonalMode = ['personal-test', 'personal-real'].includes(settings.zaloMode);
  const candidates = allCandidates;
  return {
    rows,
    allCandidates,
    candidates,
    alreadySent: rows.length - allCandidates.length,
    limited: 0,
    limit: 0,
    mode: settings.zaloMode || 'dry-run'
  };
}

async function runBulkZaloAction(db, filters, reason = 'bulk_send') {
  const selection = selectBulkZaloCandidates(db, filters);
  const logs = [];
  
  const settings = db.settings || defaultSettings();
  const cycleSize = Number(settings.zaloCycleSize) || 20;
  const cycleDelayMs = (Number(settings.zaloCycleDelayMinutes) || 1) * 60 * 1000;

  for (let i = 0; i < selection.candidates.length; i++) {
    const row = selection.candidates[i];
    logs.push(await sendZaloNotice(db, row.id, reason));
    if (i < selection.candidates.length - 1) {
      if ((i + 1) % cycleSize === 0) {
        // Nghỉ giữa chu kì
        await new Promise(resolve => setTimeout(resolve, cycleDelayMs));
      } else {
        // Delay 2 giây giữa các tin nhắn bình thường
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return {
    total: selection.rows.length,
    processed: logs.length,
    skipped: selection.alreadySent,
    limited: selection.limited,
    limit: selection.limit,
    mode: selection.mode,
    summary: {
      sent: logs.filter(log => log.status === 'Đã gửi').length,
      dryRun: logs.filter(log => log.status === 'Chạy thử').length,
      manual: logs.filter(log => log.status === 'Chờ gửi thủ công').length,
      failed: logs.filter(log => log.status === 'Lỗi gửi').length,
      notSent: logs.filter(log => log.status === 'Không gửi').length
    },
    logs
  };
}

app.post('/api/absences/zalo/bulk', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const filters = req.body?.filters || req.query || {};
    const result = await runBulkZaloAction(db, filters, 'bulk_send');
    await saveBranchDb(req, db);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/absences/:id/zalo/manual-sent', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const index = db.absences.findIndex(absence => absence.id === req.params.id);
    if (index === -1) {
      const err = new Error('Không tìm thấy bản ghi vắng học.');
      err.status = 404;
      throw err;
    }

    const absence = db.absences[index];
    const student = db.students.find(row => row.id === absence.studentId) || {};
    const time = nowISO();
    const settings = db.settings || defaultSettings();
    const message = buildMessage(settings, absence, student);

    db.absences[index] = {
      ...absence,
      noticeStatus: 'Đã gửi',
      noticeResult: 'Đã gửi qua Zalo cá nhân, giáo viên đánh dấu thủ công.',
      noticeSentAt: time,
      noticeDueAt: '',
      autoNotice: false,
      updatedAt: time
    };

    const log = {
      id: id('noti'),
      time,
      absenceId: absence.id,
      date: absence.date,
      studentId: student.id || '',
      studentCode: student.code || '',
      studentName: student.fullName || '',
      className: student.className || '',
      parentName: student.parentName || '',
      phone1: student.phone1 || '',
      zaloUserId: student.zaloUserId || '',
      channel: 'Zalo cá nhân',
      reason: 'personal_manual_confirmed',
      message,
      status: 'Đã gửi',
      result: 'Đã gửi qua Zalo cá nhân, giáo viên đánh dấu thủ công.',
      responsePayload: { manual: true }
    };
    db.notificationLogs.push(log);
    await saveBranchDb(req, db);
    res.json({ absence: enrichAbsence(db.absences[index], studentByIdMap(db.students)), log });
  } catch (error) {
    next(error);
  }
});

app.post('/api/absences/:id/zalo', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const log = await sendZaloNotice(db, req.params.id, 'manual_resend');
    await saveBranchDb(req, db);
    res.json(log);
  } catch (error) {
    next(error);
  }
});

app.put('/api/absences/:id/call', async (req, res, next) => {
  try {
    requireFields(req.body, ['callStatus']);
    const db = await getBranchDb(req);
    const index = db.absences.findIndex(absence => absence.id === req.params.id);
    if (index === -1) {
      const err = new Error('Không tìm thấy bản ghi vắng học.');
      err.status = 404;
      throw err;
    }

    const absence = db.absences[index];
    const student = db.students.find(row => row.id === absence.studentId) || {};
    const now = nowISO();

    db.absences[index] = {
      ...absence,
      callStatus: cleanText(req.body.callStatus),
      callResult: cleanText(req.body.callResult),
      caller: cleanText(req.body.caller),
      lastCallAt: now,
      note: cleanText(req.body.note),
      updatedAt: now
    };

    db.callLogs.push({
      id: id('log'),
      time: now,
      absenceId: absence.id,
      date: absence.date,
      studentId: absence.studentId,
      studentCode: student.code || '',
      studentName: student.fullName || '',
      className: student.className || '',
      parentName: student.parentName || '',
      phoneCalled: normalizePhone(req.body.phoneCalled),
      callStatus: cleanText(req.body.callStatus),
      callResult: cleanText(req.body.callResult),
      caller: cleanText(req.body.caller),
      note: cleanText(req.body.note)
    });

    await saveBranchDb(req, db);
    res.json(enrichAbsence(db.absences[index], studentByIdMap(db.students)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/absences/:id', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const before = db.absences.length;
    db.absences = db.absences.filter(absence => absence.id !== req.params.id);
    if (db.absences.length === before) {
      const err = new Error('Không tìm thấy bản ghi vắng học.');
      err.status = 404;
      throw err;
    }
    await saveBranchDb(req, db);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/call-logs', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    res.json(filterCallLogs(db, req.query));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/call-logs', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const rows = filterCallLogs(db, req.query);
    const ids = new Set(rows.map(row => row.id));
    db.callLogs = (db.callLogs || []).filter(log => !ids.has(log.id));
    await saveBranchDb(req, db);
    res.json({ success: true, deleted: ids.size });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notification-logs', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    res.json(filterNotificationLogs(db, req.query));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/notification-logs', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const rows = filterNotificationLogs(db, req.query);
    const ids = new Set(rows.map(row => row.id));
    db.notificationLogs = (db.notificationLogs || []).filter(log => !ids.has(log.id));
    await saveBranchDb(req, db);
    res.json({ success: true, deleted: ids.size });
  } catch (error) {
    next(error);
  }
});



// ==================== AUTHENTICATION & USERS ====================

// Khởi tạo tài khoản admin mặc định
async function ensureAdminUser() {
  const rootDb = await readDb();
  if (!rootDb.users) rootDb.users = {};
  if (!rootDb.users['admin']) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin', salt);
    rootDb.users['admin'] = {
      username: 'admin',
      password: hashedPassword,
      plainPassword: password,
      role: 'admin',
      branchId: 'all' // Admin có thể vào mọi nhánh
    };
    await writeDb(rootDb);
  }
}
setTimeout(ensureAdminUser, 2000);

app.get('/api/debug', (req, res) => {
  res.json({
    hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    hasDatabaseUrl: !!process.env.FIREBASE_DATABASE_URL,
    hasJwt: !!process.env.JWT_SECRET,
    databaseUrl: process.env.FIREBASE_DATABASE_URL,
    firebaseAppsLength: getApps().length
  });
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const rootDb = await readDb();
    const users = rootDb.users || {};
    const user = users[username];

    if (!user) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Sai mật khẩu' });
    }

    const token = jwt.sign({ username: user.username, role: user.role, branchId: user.branchId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { username: user.username, role: user.role, branchId: user.branchId } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  // Cho phép bỏ qua xác thực với một số đường dẫn (webhook, login...)
  if (req.path.startsWith('/api/import') || req.path === '/api/login' || req.path.startsWith('/api/chat') || req.path.startsWith('/api/webhook')) {
    return next();
  }

  if (token == null) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
    req.user = user;
    
    // Kiểm tra quyền truy cập chi nhánh
    const targetBranch = getBranchId(req);
    if (user.role !== 'admin' && user.branchId !== 'all' && user.branchId !== targetBranch) {
       // Allow fetching branch list so they can see their branch
       if (req.path !== '/api/branches') {
         return res.status(403).json({ error: 'Bạn không có quyền truy cập chi nhánh này' });
       }
    }
    next();
  });
};

app.use('/api', authenticateToken);

app.get('/api/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới xem được' });
  const rootDb = await readDb();
  const users = Object.values(rootDb.users || {}).map(u => ({ username: u.username, role: u.role, branchId: u.branchId, plainPassword: u.plainPassword }));
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới tạo được tài khoản' });
  try {
    const { username, password, role, branchId } = req.body;
    if (!username || !password) throw new Error('Thiếu thông tin');
    
    const rootDb = await readDb();
    if (!rootDb.users) rootDb.users = {};
    if (rootDb.users[username]) throw new Error('Tài khoản đã tồn tại');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    rootDb.users[username] = {
      username,
      password: hashedPassword,
      plainPassword: password,
      role: role || 'staff',
      branchId: branchId || 'main'
    };
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới xóa được tài khoản' });
  try {
    const target = req.params.username;
    if (target === 'admin') throw new Error('Không thể xóa admin');
    const rootDb = await readDb();
    if (rootDb.users && rootDb.users[target]) {
      delete rootDb.users[target];
      await writeDb(rootDb);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================================================================

app.get('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branches = Object.keys(rootDb.branches || {}).map(id => {
      let bSettings = rootDb.branches[id].settings || {};
      let bName = bSettings.branchName || (id === 'main' ? 'Cơ sở chính (Main)' : id);
      return { id, name: bName };
    });
    if (!branches.find(b => b.id === 'main')) branches.unshift({ id: 'main', name: 'Cơ sở chính (Main)' });
    res.json(branches);
  } catch (error) {
    next(error);
  }
});

app.post('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    let branchName = String(req.body.name || '').trim();
    if (!branchName) throw new Error('Tên chi nhánh không được để trống');
    
    // Tạo ID ngẫu nhiên hoặc dựa trên thời gian
    let branchId = 'branch_' + Date.now();
    
    if (!rootDb.branches) rootDb.branches = {};
    const settings = defaultSettings();
    settings.branchName = branchName; // Lưu tên tiếng Việt
    
    rootDb.branches[branchId] = { students: [], absences: [], callLogs: [], notificationLogs: [], settings };
    await writeDb(rootDb);
    res.json({ success: true, branchId });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/branches/:id', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branchId = req.params.id;
    if (branchId === 'main') throw new Error('Không thể xóa cơ sở chính');
    if (!rootDb.branches || !rootDb.branches[branchId]) throw new Error('Không tìm thấy chi nhánh');
    
    delete rootDb.branches[branchId];
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/branches/:id', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branchId = req.params.id;
    let newName = String(req.body.name || '').trim();
    if (!newName) throw new Error('Tên chi nhánh không được để trống');
    if (!rootDb.branches || !rootDb.branches[branchId]) throw new Error('Không tìm thấy chi nhánh');
    
    if (!rootDb.branches[branchId].settings) {
      rootDb.branches[branchId].settings = defaultSettings();
    }
    rootDb.branches[branchId].settings.branchName = newName;
    
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});


app.use((req, res) => {
  res.status(404).json({ error: 'Không tìm thấy đường dẫn.' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Lỗi hệ thống.' });
});


if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`App đang chạy tại http://localhost:${PORT}`);
  });
} else {
  module.exports = app;
}


setInterval(() => {
  processDueNotices().catch(error => {
    console.error('Không xử lý được hàng chờ Zalo:', error.message);
  });
}, 30000);

processDueNotices().catch(error => {
  console.error('Không xử lý được hàng chờ Zalo:', error.message);
});
