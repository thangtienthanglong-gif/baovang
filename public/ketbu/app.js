const LEGACY_STORAGE_KEY = "xep_lich_bu_teacher_v7";
const STORAGE_KEY = "xep-lich-bu-v2";
const CLOUD_STATE_ENDPOINT = "/api/ketbu/state";
const DEFAULT_BRANCH_ID = "main-branch";
const SETTINGS_PASSWORD = "thanglong@123";
const AUTO_SAVE_DELAY_MS = 900;

const defaultClassInput = [
  "8S46A - T4: H1-D2-H2; T6: H3-D3-TH - P101 - sức chứa 20 - sĩ số 18",
  "8S35A - T3: H1-D2-H2; T5: H3-D3-TH - P102 - sức chứa 20 - sĩ số 20",
  "8S34A - T3: H1-D2-H2; T4: H3-D3-TH - P103 - sức chứa 18 - sĩ số 17",
  "8S33A - T3: H1-D2-H2; T6: H3-D3-TH - P104 - sức chứa 20 - sĩ số 16",
  "8S46B - T4: H1-D2-H2; T6: H3-D3-TH - P1B - sức chứa 20 - sĩ số 18",
  "8S36B - T3: H1-D2-H2; T6: H3-D3-TH - P2B - sức chứa 20 - sĩ số 19",
  "8S45B - T4: H1-D2-H2; T5: H3-D3-TH - P3B - sức chứa 20 - sĩ số 14"
].join("\n");

const mathLessonPartOptions = [
  "H1-D2-H2",
  "H3-D3-TH"
];

const threeSessionMathLessonPartOptions = [
  ...mathLessonPartOptions,
  "D1-H4-D4"
];

const defaultParsed = parseClassData(defaultClassInput);

const defaultData = {
  rooms: defaultParsed.rooms,
  classes: defaultParsed.classes,
  classSessions: defaultParsed.classSessions,
  classInputText: defaultClassInput,
  makeupAssignments: [],
  capacityCheckEnabled: false
};

const emptyData = {
  rooms: [],
  classes: [],
  classSessions: [],
  classInputText: "",
  makeupAssignments: [],
  capacityCheckEnabled: false,
  group1Suffixes: "A, C, S, M, E",
  group2Suffixes: "B, D"
};

let cloudSyncReady = false;
let cloudSaveTimer = null;
let cloudLastUpdatedAt = "";
let autoSaveTimer = null;
let inlineAutoSaveTimer = null;
let activeInlineEditClassCode = "";
let appState = loadAppState();
let data = getActiveBranch().data;
let currentSuggestions = [];
let currentRejected = [];

const elements = {
  classInputText: document.getElementById("classInputText"),
  excelFileInput: document.getElementById("excelFileInput"),
  loadBtn: document.getElementById("loadBtn"),
  totalClasses: document.getElementById("totalClasses"),
  totalSessions: document.getElementById("totalSessions"),
  totalAssignments: document.getElementById("totalAssignments"),
  fullSessions: document.getElementById("fullSessions"),
  parsedClassesBody: document.getElementById("parsedClassesBody"),
  settingClassCode: document.getElementById("settingClassCode"),
  settingScheduleFields: document.getElementById("settingScheduleFields"),
  settingRoom: document.getElementById("settingRoom"),
  settingCapacity: document.getElementById("settingCapacity"),
  settingCount: document.getElementById("settingCount"),
  settingGroup1: document.getElementById("settingGroup1"),
  settingGroup2: document.getElementById("settingGroup2"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  configFormStatus: document.getElementById("configFormStatus"),
  autoSaveIndicator: document.getElementById("autoSaveIndicator"),
  saveClassBtn: document.getElementById("saveClassBtn"),
  clearClassFormBtn: document.getElementById("clearClassFormBtn"),
  deleteClassBtn: document.getElementById("deleteClassBtn"),
  classFormStatus: document.getElementById("classFormStatus"),
  studentClassCode: document.getElementById("studentClassCode"),
  studentNameInput: document.getElementById("studentNameInput"),
  studentInfo: document.getElementById("studentInfo"),
  missedSessionSelect: document.getElementById("missedSessionSelect"),
  missedInfo: document.getElementById("missedInfo"),
  preferredWeekday: document.getElementById("preferredWeekday"),
  preferredShift: document.getElementById("preferredShift"),
  capacityCheckToggle: document.getElementById("capacityCheckToggle"),
  findBtn: document.getElementById("findBtn"),
  resultSummary: document.getElementById("resultSummary"),
  resultCount: document.getElementById("resultCount"),
  notice: document.getElementById("notice"),
  suggestionsBody: document.getElementById("suggestionsBody"),
  rejectedBody: document.getElementById("rejectedBody"),
  assignmentsBody: document.getElementById("assignmentsBody"),
  exportDateFrom: document.getElementById("exportDateFrom"),
  exportDateTo: document.getElementById("exportDateTo"),
  exportAssignmentsBtn: document.getElementById("exportAssignmentsBtn"),
  clearAssignmentsBtn: document.getElementById("clearAssignmentsBtn"),
  branchSelect: document.getElementById("branchSelect")
};

const pageCopy = {
  planner: {
    title: "Xếp lịch học bù",
    subtitle: "Tìm lớp bù cùng phần học, cùng khối và còn sức chứa phòng."
  },
  settings: {
    title: "Cài đặt dữ liệu lớp học",
    subtitle: "Thêm, sửa, xóa lớp, đổi phòng học, đổi sức chứa và khai báo phần học theo mã lớp."
  },
  assignments: {
    title: "Lịch học bù đã xếp",
    subtitle: "Theo dõi các lượt học bù đã xác nhận và hủy khi cần điều chỉnh."
  }
};

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function createEmptyData() {
  return clone(emptyData);
}

function createBranchId(name) {
  const slug = stripAccents(name || "chi-nhanh")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "chi-nhanh";
  return `${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function createBranch(name, branchData = createEmptyData(), id = createBranchId(name)) {
  return {
    id,
    name: String(name || "Chi nhánh").trim() || "Chi nhánh",
    data: normalizeDataRecords({ ...createEmptyData(), ...clone(branchData) })
  };
}

function normalizeBranch(branch, index, usedIds) {
  const fallbackName = `Chi nhánh ${index + 1}`;
  const name = String(branch && branch.name ? branch.name : fallbackName).trim() || fallbackName;
  let id = String(branch && branch.id ? branch.id : "").trim();
  if (!id || usedIds.has(id)) id = createBranchId(name);
  usedIds.add(id);
  return createBranch(name, branch && branch.data ? branch.data : createEmptyData(), id);
}

function normalizeAppStatePayload(parsed) {
  const usedIds = new Set();
  const branches = Array.isArray(parsed?.branches)
    ? parsed.branches.map((branch, index) => normalizeBranch(branch, index, usedIds))
    : [];

  if (!branches.length) return null;

  const activeBranchId = branches.some((branch) => branch.id === parsed.activeBranchId)
    ? parsed.activeBranchId
    : branches[0].id;

  return { activeBranchId, branches };
}

function loadAppState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const normalized = normalizeAppStatePayload(parsed);
      if (normalized) return normalized;
    } catch {
      // Fall through to legacy migration/default state.
    }
  }

  const legacySaved = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacySaved) {
    try {
      const legacyData = JSON.parse(legacySaved);
      const mainBranch = createBranch("Chi nhánh chính", { ...clone(defaultData), ...legacyData }, DEFAULT_BRANCH_ID);
      return { activeBranchId: mainBranch.id, branches: [mainBranch] };
    } catch {
      // Fall through to default state.
    }
  }

  const mainBranch = createBranch("Chi nhánh chính", defaultData, DEFAULT_BRANCH_ID);
  return { activeBranchId: mainBranch.id, branches: [mainBranch] };
}

function getActiveBranch() {
  if (!appState.branches.length) {
    const mainBranch = createBranch("Chi nhánh chính", defaultData, DEFAULT_BRANCH_ID);
    appState.branches.push(mainBranch);
    appState.activeBranchId = mainBranch.id;
  }

  let branch = appState.branches.find((item) => item.id === appState.activeBranchId);
  if (!branch) {
    branch = appState.branches[0];
    appState.activeBranchId = branch.id;
  }

  return branch;
}

function persistLocalAppState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function persistAppState() {
  persistLocalAppState();
  if (cloudSyncReady) queueCloudPersist();
}

function saveData() {
  getActiveBranch().data = data;
  persistAppState();
}

async function pushCloudState() {
  try {
    const response = await fetch(CLOUD_STATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: appState })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(payload.error || "Không lưu được dữ liệu cloud.");
    cloudLastUpdatedAt = payload.updatedAt || cloudLastUpdatedAt;
  } catch (error) {
    console.warn("Cloud sync save failed:", error);
    alert("Lỗi khi lưu cấu hình lớp lên máy chủ: " + error.message + "\n\nDữ liệu chỉ được lưu tạm thời trên máy này. Vui lòng kiểm tra lại kết nối hoặc khởi động lại phần mềm.");
  }
}

function queueCloudPersist() {
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(pushCloudState, 550);
}

function applyCloudState(nextState, updatedAt, showMessage = false) {
  const normalized = normalizeAppStatePayload(nextState);
  if (!normalized) return false;

  appState = normalized;
  data = getActiveBranch().data;
  cloudLastUpdatedAt = updatedAt || cloudLastUpdatedAt;
  persistLocalAppState();
  renderAll();

  if (showMessage) setNotice("Đã đồng bộ dữ liệu lớp từ cloud.");
  return true;
}

async function pullCloudState({ seedWhenEmpty = false, showMessage = false } = {}) {
  const ts = new Date().getTime();
  const response = await fetch(`${CLOUD_STATE_ENDPOINT}?_t=${ts}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || "Không tải được dữ liệu cloud.");

  if (payload.state) {
    if (!payload.updatedAt || payload.updatedAt !== cloudLastUpdatedAt) {
      applyCloudState(payload.state, payload.updatedAt, showMessage);
    }
    return;
  }

  if (seedWhenEmpty) queueCloudPersist();
}

function startCloudPolling() {
  window.setInterval(() => {
    pullCloudState().catch((error) => console.warn("Cloud sync pull failed:", error));
  }, 30000);
}

async function initializeCloudSync() {
  try {
    cloudSyncReady = true;
    await pullCloudState({ seedWhenEmpty: true, showMessage: true });
    startCloudPolling();
  } catch (error) {
    cloudSyncReady = false;
    console.warn("Cloud sync unavailable:", error);
  }
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && cloudSyncReady) {
    fetch(CLOUD_STATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: appState }),
      keepalive: true
    }).catch(e => console.warn(e));
  }
});

function normalizeDataRecords(sourceData) {
  const normalizedData = { ...sourceData };
  delete normalizedData.students;

  normalizedData.rooms = Array.isArray(normalizedData.rooms) ? normalizedData.rooms : [];
  normalizedData.makeupAssignments = Array.isArray(normalizedData.makeupAssignments)
    ? normalizedData.makeupAssignments
    : [];
  normalizedData.capacityCheckEnabled = Boolean(normalizedData.capacityCheckEnabled);
  normalizedData.group1Suffixes = String(normalizedData.group1Suffixes || emptyData.group1Suffixes);
  normalizedData.group2Suffixes = String(normalizedData.group2Suffixes || emptyData.group2Suffixes);

  normalizedData.classes = (normalizedData.classes || []).map((classItem) => {
    const details = classCodeDetails(classItem.code);
    if (!details) return classItem;

    return {
      ...classItem,
      grade: details.grade,
      shift: details.shift,
      programGroup: details.programGroup,
      subjectCode: details.subjectCode,
      subjectLabel: details.subjectLabel,
      levelCode: details.levelCode,
      baseCode: details.baseCode
    };
  });

  const sessionsByClassCode = new Map();
  (normalizedData.classSessions || []).forEach((session) => {
    const details = classCodeDetails(session.classCode);
    const classCode = details ? details.code : String(session.classCode || "").trim().toUpperCase();
    if (!classCode) return;

    if (!sessionsByClassCode.has(classCode)) sessionsByClassCode.set(classCode, []);
    sessionsByClassCode.get(classCode).push(session);
  });

  const normalizedClassCodes = new Set();
  const normalizedSessions = [];

  normalizedData.classes.forEach((classItem) => {
    const details = classCodeDetails(classItem.code);
    const classCode = details ? details.code : String(classItem.code || "").trim().toUpperCase();
    const classSessions = sessionsByClassCode.get(classCode) || [];

    normalizedClassCodes.add(classCode);
    if (!details) {
      normalizedSessions.push(...classSessions);
      return;
    }

    normalizedSessions.push(...normalizeSessionsToClassCode(classSessions, details));
  });

  sessionsByClassCode.forEach((classSessions, classCode) => {
    if (normalizedClassCodes.has(classCode)) return;
    const details = classCodeDetails(classCode);
    normalizedSessions.push(...(details ? normalizeSessionsToClassCode(classSessions, details) : classSessions));
  });

  normalizedData.classSessions = normalizedSessions;

  return normalizedData;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function normalizeText(value) {
  return stripAccents(value).toLocaleLowerCase("vi-VN");
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function shiftLabelFromToken(token) {
  const shiftMap = { S: "Sáng", C: "Chiều", T: "Tối" };
  return shiftMap[String(token || "").toUpperCase()] || "Sáng";
}

function shiftFromClassCode(classCode) {
  const details = classCodeDetails(classCode);
  return details ? details.shift : "Sáng";
}

function gradeFromClassCode(classCode) {
  const details = classCodeDetails(classCode);
  if (details) return details.grade;
  const fallback = /^([0-9]+)/.exec(classCode);
  return fallback ? Number(fallback[1]) : 0;
}

function groupFromClassCode(classCode) {
  const details = classCodeDetails(classCode);
  return details ? details.programGroup : "";
}

function weekdayLabel(weekday) {
  return Number(weekday) === 8 ? "Chủ nhật" : `Thứ ${weekday}`;
}

function shortWeekdayLabel(weekday) {
  return Number(weekday) === 8 ? "CN" : `T${weekday}`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  })[char]);
}

function excelColumnName(index) {
  let name = "";
  let columnNumber = index + 1;

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return name;
}

function excelCellRef(rowIndex, columnIndex) {
  return `${excelColumnName(columnIndex)}${rowIndex + 1}`;
}

function buildExcelCell(value, rowIndex, columnIndex) {
  const style = rowIndex === 0 ? ' s="1"' : "";
  return `<c r="${excelCellRef(rowIndex, columnIndex)}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
}

function buildWorksheetXml(headers, rows) {
  const allRows = [headers, ...rows];
  const lastColumn = excelColumnName(headers.length - 1);
  const lastRow = Math.max(allRows.length, 1);
  const sheetRef = `A1:${lastColumn}${lastRow}`;
  const widths = [28, 12, 18, 18, 12, 18, 16, 16, 22];
  const columns = headers.map((_, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${widths[index] || 16}" customWidth="1"/>`
  ).join("");
  const sheetRows = allRows.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${headers.map((_, columnIndex) => buildExcelCell(row[columnIndex] || "", rowIndex, columnIndex)).join("")}
    </row>
  `).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${sheetRef}"/>
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="${sheetRef}"/>
</worksheet>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Lich hoc bu" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildRootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF233D83"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildCorePropsXml() {
  const createdAt = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Xếp lịch học bù</dc:creator>
  <cp:lastModifiedBy>Xếp lịch học bù</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Xếp lịch học bù</Application>
</Properties>`;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crc32Table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const records = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, data);
    records.push({ nameBytes, checksum, size: data.length, offset });
    offset += localHeader.length + data.length;
  });

  const centralDirectoryOffset = offset;
  const centralChunks = [];
  let centralDirectorySize = 0;

  records.forEach((record) => {
    const centralHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(centralHeader.buffer);

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, record.checksum, true);
    view.setUint32(20, record.size, true);
    view.setUint32(24, record.size, true);
    view.setUint16(28, record.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, record.offset, true);
    centralHeader.set(record.nameBytes, 46);

    centralChunks.push(centralHeader);
    centralDirectorySize += centralHeader.length;
  });

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, records.length, true);
  endView.setUint16(10, records.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, centralDirectoryOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...chunks, ...centralChunks, endRecord], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function createXlsxBlob(headers, rows) {
  return createZipBlob([
    { name: "[Content_Types].xml", content: buildContentTypesXml() },
    { name: "_rels/.rels", content: buildRootRelationshipsXml() },
    { name: "docProps/core.xml", content: buildCorePropsXml() },
    { name: "docProps/app.xml", content: buildAppPropsXml() },
    { name: "xl/workbook.xml", content: buildWorkbookXml() },
    { name: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelationshipsXml() },
    { name: "xl/styles.xml", content: buildStylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: buildWorksheetXml(headers, rows) }
  ]);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("vi-VN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildAssignmentExportData(assignments) {
  const headers = [
    "Học sinh",
    "Lớp chính",
    "Buổi kẹt",
    "Phần bù",
    "Lớp bù",
    "Buổi bù",
    "Phòng học",
    "Trạng thái",
    "Ngày xác nhận"
  ];
  const rows = assignments.map((item) => {
    const room = getRoom(item.roomId);

    return [
      item.studentName,
      item.mainClassCode,
      `${item.missedShift} ${weekdayLabel(item.missedWeekday)}`,
      item.missedLessonParts,
      item.makeupClassCode,
      `${item.makeupShift} ${weekdayLabel(item.makeupWeekday)}`,
      room ? room.name : "",
      item.status || "Đã xác nhận",
      formatDateTime(item.createdAt)
    ];
  });

  return { headers, rows };
}

function selectedAssignmentDateRange() {
  const fromValue = elements.exportDateFrom.value;
  const toValue = elements.exportDateTo.value;
  const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const to = toValue ? new Date(`${toValue}T23:59:59.999`) : null;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return { error: "Ngày xuất chưa hợp lệ." };
  }

  if (from && to && from > to) {
    return { error: "Ngày bắt đầu không được lớn hơn ngày kết thúc." };
  }

  return { from, to, hasRange: Boolean(from || to), fromValue, toValue };
}

function isAssignmentInDateRange(assignment, range) {
  if (!range.from && !range.to) return true;

  const createdAt = new Date(assignment.createdAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  if (range.from && createdAt < range.from) return false;
  if (range.to && createdAt > range.to) return false;
  return true;
}

function filterAssignmentsBySelectedDate(assignments) {
  const range = selectedAssignmentDateRange();
  if (range.error) return { error: range.error, assignments: [] };

  return {
    range,
    assignments: assignments.filter((assignment) => isAssignmentInDateRange(assignment, range))
  };
}

function assignmentRangeLabel(range) {
  if (!range || !range.hasRange) return "toàn bộ lịch sử";
  if (range.fromValue && range.toValue) return `từ ${range.fromValue} đến ${range.toValue}`;
  if (range.fromValue) return `từ ${range.fromValue}`;
  return `đến ${range.toValue}`;
}

function assignmentFilenameDatePart(range) {
  if (!range || !range.hasRange) return new Date().toISOString().slice(0, 10);
  if (range.fromValue && range.toValue) return `${range.fromValue}_den_${range.toValue}`;
  if (range.fromValue) return `tu_${range.fromValue}`;
  return `den_${range.toValue}`;
}

function exportAssignmentsToExcel() {
  const assignments = activeAssignments().sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

  if (!assignments.length) {
    window.alert("Chưa có lịch học bù đã xác nhận để xuất Excel.");
    return;
  }

  const filteredResult = filterAssignmentsBySelectedDate(assignments);
  if (filteredResult.error) {
    window.alert(filteredResult.error);
    return;
  }

  if (!filteredResult.assignments.length) {
    window.alert(`Không có lịch học bù trong khoảng ${assignmentRangeLabel(filteredResult.range)}.`);
    return;
  }

  const { headers, rows } = buildAssignmentExportData(filteredResult.assignments);
  const branchName = getActiveBranch().name || "chi-nhanh";
  const safeBranchName = stripAccents(branchName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "chi-nhanh";
  const datePart = assignmentFilenameDatePart(filteredResult.range);
  const filename = `lich-hoc-bu-${safeBranchName}-${datePart}.xlsx`;

  downloadBlob(createXlsxBlob(headers, rows), filename);
}

function clearAssignmentHistory() {
  const assignments = activeAssignments();
  if (!assignments.length) {
    window.alert("Chưa có lịch sử học bù để xóa.");
    return;
  }

  const filteredResult = filterAssignmentsBySelectedDate(assignments);
  if (filteredResult.error) {
    window.alert(filteredResult.error);
    return;
  }

  if (!filteredResult.assignments.length) {
    window.alert(`Không có lịch sử học bù trong khoảng ${assignmentRangeLabel(filteredResult.range)}.`);
    return;
  }

  const rangeText = assignmentRangeLabel(filteredResult.range);
  if (!confirm(`Xóa ${filteredResult.assignments.length} lịch học bù trong ${rangeText}?`)) return;

  const removedIds = new Set(filteredResult.assignments.map((assignment) => assignment.id));
  data.makeupAssignments = data.makeupAssignments.filter((assignment) => !removedIds.has(assignment.id));
  saveData();
  renderAssignments();
  renderStats();
  renderParsedClasses();
  findMakeupSuggestions();
  setNotice(`Đã xóa ${removedIds.size} lịch học bù trong ${rangeText}.`);
}

function parseWeekdayToken(token) {
  const normalized = stripAccents(token).toUpperCase().replace(/\s+/g, "");
  if (normalized === "CN" || normalized === "CHUNHAT") return 8;
  const number = Number(normalized.replace(/^T(HU)?/, ""));
  return Number.isInteger(number) && number >= 2 && number <= 8 ? number : null;
}

function normalizeRoomId(roomName) {
  return stripAccents(roomName).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function subjectLabelFromCode(subjectCode) {
  const subjectMap = {
    TOAN: "Toán",
    A: "Anh",
    V: "Văn",
    K: "KHTN"
  };
  return subjectMap[subjectCode] || subjectCode;
}

function classCodeDetails(classCode) {
  const normalizedCode = String(classCode || "").trim().toUpperCase();

  const ctMatch = normalizedCode.match(/^([0-9]{1,2})CT([12])$/);
  if (ctMatch) {
    const group = ctMatch[2];
    const weekdays = group === '1' ? [3, 5, 7] : [2, 4, 6];
    return {
      code: normalizedCode,
      grade: Number(ctMatch[1]),
      shift: "",
      shiftToken: "",
      programGroup: `CT${group}`,
      subjectCode: "TOAN",
      subjectLabel: "Toán",
      levelCode: `CT${group}`,
      baseCode: normalizedCode,
      weekdays,
      format: "generic"
    };
  }

  const mathMatch = normalizedCode.match(/^([0-9]{1,2})([SCT])([2-8]+)([A-Z]*)$/);
  if (mathMatch) {
    const weekdays = Array.from(new Set(mathMatch[3].split("").map(Number)))
      .filter((weekday) => weekday >= 2 && weekday <= 8);

    if (!weekdays.length) return null;

    const levelCode = mathMatch[4].toUpperCase();
    const baseCode = `${mathMatch[1]}${mathMatch[2].toUpperCase()}${mathMatch[3]}`;

    return {
      code: normalizedCode,
      grade: Number(mathMatch[1]),
      shift: shiftLabelFromToken(mathMatch[2]),
      shiftToken: mathMatch[2].toUpperCase(),
      programGroup: levelCode,
      subjectCode: "TOAN",
      subjectLabel: "Toán",
      levelCode,
      baseCode,
      weekdays,
      format: "math"
    };
  }

  const subjectMatch = normalizedCode.match(/^([0-9]{1,2})([A-Z]+)([SCT])([2-8]+)([A-Z]*)$/);
  if (subjectMatch) {
    const weekdays = Array.from(new Set(subjectMatch[4].split("").map(Number)))
      .filter((weekday) => weekday >= 2 && weekday <= 8);

    if (weekdays.length) {
      const subjectCode = subjectMatch[2].toUpperCase();
      const levelCode = subjectMatch[5].toUpperCase();
      const baseCode = `${subjectMatch[1]}${subjectCode}${subjectMatch[3].toUpperCase()}${subjectMatch[4]}`;

      return {
        code: normalizedCode,
        grade: Number(subjectMatch[1]),
        shift: shiftLabelFromToken(subjectMatch[3]),
        shiftToken: subjectMatch[3].toUpperCase(),
        programGroup: levelCode,
        subjectCode,
        subjectLabel: subjectLabelFromCode(subjectCode),
        levelCode,
        baseCode,
        weekdays,
        format: "subject"
      };
    }
  }

  const genericMatch = normalizedCode.match(/^([0-9]{1,2})([A-Z0-9]+)$/);
  if (genericMatch) {
    return {
      code: normalizedCode,
      grade: Number(genericMatch[1]),
      shift: "",
      shiftToken: "",
      programGroup: genericMatch[2],
      subjectCode: "TOAN",
      subjectLabel: "Toán",
      levelCode: genericMatch[2],
      baseCode: genericMatch[0],
      weekdays: [],
      format: "generic"
    };
  }

  return null;
}

function lessonOptionsForDetails(details) {
  if (!details || details.subjectCode === "TOAN") {
    const hasThreeSessions = details && Array.isArray(details.weekdays) && details.weekdays.length >= 3;
    return hasThreeSessions ? threeSessionMathLessonPartOptions : mathLessonPartOptions;
  }

  const subjectLessonMap = {
    V: ["Học Văn"],
    A: ["Học Anh"],
    K: ["KHTN"]
  };

  return subjectLessonMap[details.subjectCode] || [details.subjectLabel || details.subjectCode];
}

function normalizeLessonParts(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  const aliases = {
    "H1-D1-H2": "H1-D2-H2",
    "D3-H3-TH": "H3-D3-TH",
    "H4-D1-D4": "D1-H4-D4",
    "D1-H4-D4": "D1-H4-D4",
    "VAN": "Học Văn",
    "HOCVAN": "Học Văn",
    "HỌCVĂN": "Học Văn",
    "ANH": "Học Anh",
    "HOCANH": "Học Anh",
    "HỌCANH": "Học Anh",
    "K": "KHTN",
    "KHTN": "KHTN",
    "HOCKHTN": "KHTN",
    "HỌCKHTN": "KHTN"
  };
  return aliases[normalized] || normalized;
}

function normalizeLessonPartsForSubject(value, details) {
  const normalized = normalizeLessonParts(value);
  const options = lessonOptionsForDetails(details);

  if (!details || details.subjectCode === "TOAN") {
    return options.includes(normalized) ? normalized : options[0];
  }

  return options.includes(normalized) ? normalized : options[0];
}

function isWeekdayInClassCode(details, weekday) {
  if (!details) return false;
  if (!details.weekdays || details.weekdays.length === 0) return true;
  return Boolean(details.weekdays.some((item) => Number(item) === Number(weekday)));
}

function normalizeSessionsToClassCode(sessions, details, fallbackRoomNamesString = "") {
  if (!details) return [];

  const fallbackRooms = fallbackRoomNamesString
    ? fallbackRoomNamesString.split(",").map(r => r.trim()).filter(Boolean)
    : [];

  const fallbackSession = sessions[0] || {};
  const sessionsByValidWeekday = new Map();

  sessions.forEach((session) => {
    const weekday = Number(session.weekday);
    if (isWeekdayInClassCode(details, weekday) && !sessionsByValidWeekday.has(weekday)) {
      sessionsByValidWeekday.set(weekday, session);
    }
  });

  const targetWeekdays = details.weekdays && details.weekdays.length > 0 
    ? details.weekdays 
    : Array.from(sessionsByValidWeekday.keys()).sort();

  return targetWeekdays.map((weekday, index) => {
    const sourceSession = sessionsByValidWeekday.get(weekday) || sessions[index] || fallbackSession;
    const countValue = Number(sourceSession.officialCount ?? fallbackSession.officialCount ?? 0);

    const mappedRoomName = sourceSession.roomName || fallbackRooms[index] || fallbackRooms[fallbackRooms.length - 1] || fallbackRooms[0] || "";
    const mappedRoomId = sourceSession.roomId || (mappedRoomName ? normalizeRoomId(mappedRoomName) : "");

    return {
      ...sourceSession,
      id: `${details.code}-T${weekday}`,
      classCode: details.code,
      weekday,
      shift: details.shift,
      lessonParts: normalizeLessonPartsForSubject(sourceSession.lessonParts || defaultLessonFor(details, index), details),
      roomId: mappedRoomId,
      roomName: mappedRoomName,
      officialCount: Number.isFinite(countValue) ? countValue : 0
    };
  });
}

function parseClassLine(line, lineNumber) {
  const source = line.trim().replace(/[.a?,;]+$/, "");
  const classMatch = source.match(/^\s*([a-zA-Z0-9]+)(?:\s+|$)(.*)/i);

  if (!classMatch) {
    return { error: `Dòng ${lineNumber}: chưa nhận được mã lớp.` };
  }

  const classCode = classMatch[1].toUpperCase();
  const codeDetails = classCodeDetails(classCode);
  if (!codeDetails) {
    return { error: `Dòng ${lineNumber}: mã lớp không đúng định dạng.` };
  }

  let rest = classMatch[2].trim();
  rest = rest.replace(/^[-–—:,\t]+\s*/, "");

  const capacityMatch = rest.match(/(?:sức\s*chứa|suc\s*chua|capacity)\s*[:=]?\s*(\d+)/i);
  const capacity = capacityMatch ? Number(capacityMatch[1]) : "";
  if (capacityMatch) rest = rest.replace(capacityMatch[0], "").trim();

  const countMatch = rest.match(/(?:sĩ\s*số|si\s*so|đang\s*học|dang\s*hoc)\s*[:=]?\s*(\d+)/i);
  const officialCount = countMatch ? Number(countMatch[1]) : 0;
  if (countMatch) rest = rest.replace(countMatch[0], "").trim();

  rest = rest.replace(/\s+/g, " ").replace(/(?:\s*[-–—]\s*)+$/, "").trim();

  let roomName = "";
  let sessionSource = "";

  const hasSchedule = /^(?:T|Thứ|Thu)\s*(?:[2-8]|CN|Chủ\s*nhật|Chu\s*nhat)\s*:/i.test(rest);
  if (!hasSchedule && rest) {
    roomName = rest;
  } else {
    const roomMatch = rest.match(/[-–—]\s*([^:–—]+)\s*$/);
    if (roomMatch) {
      roomName = roomMatch[1].trim();
      sessionSource = rest.slice(0, roomMatch.index).trim();
    } else {
      sessionSource = rest;
    }
  }

  let sessions = [];
  if (sessionSource) {
    const parsedSessions = parseScheduleText(sessionSource, lineNumber);
    if (parsedSessions.error) return { error: parsedSessions.error };
    sessions = parsedSessions;
  }

  const normalizedSessions = normalizeSessionsToClassCode(sessions, codeDetails, roomName);

  return {
    classCode,
    grade: codeDetails.grade,
    shift: codeDetails.shift,
    programGroup: codeDetails.programGroup,
    subjectCode: codeDetails.subjectCode,
    subjectLabel: codeDetails.subjectLabel,
    levelCode: codeDetails.levelCode,
    baseCode: codeDetails.baseCode,
    roomName,
    capacity,
    officialCount,
    sessions: normalizedSessions
  };
}

function parseScheduleText(scheduleText, lineNumber = 1) {
  const sessionPieces = scheduleText.split(";").map((item) => item.trim()).filter(Boolean);
  const sessions = [];

  for (const piece of sessionPieces) {
    const sessionMatch = piece.match(/^(?:T|Thứ|Thu)\s*([0-9]|CN|Chủ\s*nhật|Chu nhat)\s*:\s*(.+)$/i);
    if (!sessionMatch) {
      return { error: `Dòng ${lineNumber}: không đọc được phần "${piece}".` };
    }

    const weekday = parseWeekdayToken(sessionMatch[1]);
    if (!weekday) {
      return { error: `Dòng ${lineNumber}: thứ học không hợp lệ trong "${piece}".` };
    }

    sessions.push({
      weekday,
      lessonParts: normalizeLessonParts(sessionMatch[2])
    });
  }

  if (!sessions.length) return [];
  return sessions;
}

function parseClassData(inputText) {
  const lines = inputText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const roomsById = new Map();
  const classesByCode = new Map();
  const classSessions = [];
  const errors = [];

  lines.forEach((line, index) => {
    const parsed = parseClassLine(line, index + 1);
    if (parsed.error) {
      errors.push(parsed.error);
      return;
    }

    classesByCode.set(parsed.classCode, {
      code: parsed.classCode,
      grade: parsed.grade,
      shift: parsed.shift,
      programGroup: parsed.programGroup,
      subjectCode: parsed.subjectCode,
      subjectLabel: parsed.subjectLabel,
      levelCode: parsed.levelCode,
      baseCode: parsed.baseCode,
      teacher: "Chưa khai báo"
    });

    parsed.sessions.forEach((session) => {
      if (session.roomId) {
        roomsById.set(session.roomId, {
          id: session.roomId,
          name: session.roomName,
          capacity: parsed.capacity
        });
      }
      classSessions.push({
        id: `${parsed.classCode}-T${session.weekday}`,
        classCode: parsed.classCode,
        weekday: session.weekday,
        shift: parsed.shift,
        lessonParts: session.lessonParts,
        roomId: session.roomId,
        officialCount: parsed.officialCount
      });
    });
  });

  return {
    rooms: Array.from(roomsById.values()),
    classes: Array.from(classesByCode.values()),
    classSessions,
    errors
  };
}

function getRoom(roomId) {
  return data.rooms.find((room) => room.id === roomId);
}

function getClass(classCode) {
  return data.classes.find((classItem) => classItem.code === classCode);
}

function getSession(sessionId) {
  return data.classSessions.find((session) => session.id === sessionId);
}

function classBaseCode(classCode) {
  const details = classCodeDetails(classCode);
  return details ? details.baseCode : String(classCode || "").trim().toUpperCase();
}

function classLevelCode(classCode) {
  const details = classCodeDetails(classCode);
  return details ? details.levelCode : "";
}

function sessionSort(a, b) {
  if (Number(a.weekday) !== Number(b.weekday)) return Number(a.weekday) - Number(b.weekday);
  return a.classCode.localeCompare(b.classCode, "vi");
}

function dedupeSessions(sessions) {
  const seen = new Set();
  return sessions.filter((session) => {
    const key = `${session.weekday}|${session.shift}|${session.lessonParts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSelectedStudent() {
  const mainClassCode = elements.studentClassCode.value.trim().toUpperCase();
  if (!mainClassCode) return null;

  const name = elements.studentNameInput.value.trim();
  const normalizedName = normalizeRoomId(name);

  return {
    id: `${mainClassCode}-${normalizedName || "CHUA-NHAP-TEN"}`,
    name: name || "Chưa nhập tên học sinh",
    hasName: Boolean(name),
    mainClassCode
  };
}

function getSelectedMissedSession() {
  return getSession(elements.missedSessionSelect.value);
}

function activeAssignments() {
  return data.makeupAssignments;
}

function getMakeupCount(sessionId) {
  return activeAssignments().filter((item) => item.makeupSessionId === sessionId).length;
}

function getCurrentCount(session) {
  return Number(session.officialCount || 0) + getMakeupCount(session.id);
}

function getCapacity(session) {
  const room = getRoom(session.roomId);
  return room ? Number(room.capacity || 0) : 0;
}

function getRemainingSeats(session) {
  return getCapacity(session) - getCurrentCount(session);
}

function isCapacityCheckEnabled() {
  return Boolean(data.capacityCheckEnabled);
}

function sharedRoomForSessions(sessions) {
  const rooms = sessions
    .map((session) => getRoom(session.roomId))
    .filter(Boolean);

  if (!rooms.length) return null;
  return rooms.every((room) => room.id === rooms[0].id) ? rooms[0] : null;
}

function sharedCapacityForSessions(sessions) {
  const capacities = sessions
    .map((session) => getCapacity(session))
    .filter((capacity) => capacity > 0);

  if (!capacities.length) return "";
  return capacities.every((capacity) => capacity === capacities[0]) ? capacities[0] : "";
}

function getMainClassSessions(student) {
  if (!student) return [];
  const exactSessions = data.classSessions
    .filter((session) => session.classCode === student.mainClassCode)
    .sort(sessionSort);

  if (exactSessions.length) return exactSessions;

  const mainDetails = classCodeDetails(student.mainClassCode);
  if (!mainDetails) return [];

  const familySessions = data.classSessions
    .filter((session) => {
      const sessionDetails = classCodeDetails(session.classCode);
      return sessionDetails &&
        sessionDetails.baseCode === mainDetails.baseCode;
    })
    .sort(sessionSort);

  return dedupeSessions(familySessions);
}

function hasTimeConflict(student, weekday, shift) {
  return getMainClassSessions(student).some((session) =>
    Number(session.weekday) === Number(weekday) && session.shift === shift
  );
}

function hasDuplicateMakeup(studentId, missedSessionId) {
  return activeAssignments().some((item) =>
    item.studentId === studentId && item.missedSessionId === missedSessionId
  );
}

function sessionLabel(session) {
  return `${session.shift} ${weekdayLabel(session.weekday)}`;
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function createGroupRegex(suffixesString) {
  const parts = suffixesString
    .split(",")
    .map(s => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return parts.length ? new RegExp(`(?:${parts.join('|')})$`, "i") : /(?!)/;
}

function getClassSessions(classCode) {
  return data.classSessions
    .filter((session) => session.classCode === classCode)
    .sort((a, b) => Number(a.weekday) - Number(b.weekday));
}

function classScheduleText(classCode) {
  return getClassSessions(classCode)
    .map((session) => `${shortWeekdayLabel(session.weekday)}: ${session.lessonParts}`)
    .join("; ");
}

function defaultLessonFor(details, index) {
  const options = lessonOptionsForDetails(details);
  if (details.subjectCode !== "TOAN") return options[0];

  const group1Regex = createGroupRegex(data.group1Suffixes || emptyData.group1Suffixes);
  const group2Regex = createGroupRegex(data.group2Suffixes || emptyData.group2Suffixes);

  const isGroup1 = group1Regex.test(details.code);
  const isGroup2 = group2Regex.test(details.code);

  let shiftDefaults;
  if (isGroup1) {
    shiftDefaults = ["H1-D2-H2", "H3-D3-TH", "D1-H4-D4"];
  } else if (isGroup2) {
    shiftDefaults = ["H3-D3-TH", "H1-D2-H2", "D1-H4-D4"];
  } else {
    shiftDefaults = details.shift === "Sáng"
      ? ["H1-D2-H2", "H3-D3-TH", "D1-H4-D4"]
      : ["H3-D3-TH", "H1-D2-H2", "D1-H4-D4"];
  }

  return shiftDefaults[index % shiftDefaults.length];
}

function lessonOptionMarkup(selectedValue, details) {
  const options = lessonOptionsForDetails(details);
  const normalized = normalizeLessonPartsForSubject(selectedValue, details);
  const selected = options.includes(normalized)
    ? normalized
    : options[0];

  return [
    `<option value="">Chọn phần học</option>`,
    ...options.map((option) =>
      `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`
    )
  ].join("");
}

function scheduleFieldsMarkup(classCode, existingSessions = []) {
  const details = classCodeDetails(classCode);

  if (!details) {
    return `
      <div class="schedule-empty">Nhập mã lớp như 8S35A, 8VC2, 8AT2 hoặc 8KT4 để tự tách các buổi học.</div>
    `;
  }

  const existingByDay = new Map(existingSessions.map((session) => [
    Number(session.weekday),
    session
  ]));

  return details.weekdays.map((weekday, index) => {
    const existingSession = existingByDay.get(weekday);
    const existingRoom = existingSession ? getRoom(existingSession.roomId) : null;
    const selectedLesson = existingSession
      ? normalizeLessonPartsForSubject(existingSession.lessonParts, details)
      : defaultLessonFor(details, index);
    const roomValue = existingSession && existingSession.roomName
      ? existingSession.roomName
      : existingRoom
        ? existingRoom.name
        : "";
    const capacityValue = existingSession && Number(existingSession.capacity) > 0
      ? existingSession.capacity
      : existingRoom && Number(existingRoom.capacity) > 0
        ? existingRoom.capacity
        : "";
    const label = `${details.shift} ${weekdayLabel(weekday)}`;

    return `
      <div class="schedule-field">
        <div class="schedule-field-head">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(shortWeekdayLabel(weekday))} từ mã ${escapeHtml(details.code)}</span>
        </div>
        <select class="lesson-part-input" data-weekday="${weekday}" aria-label="Phần học ${escapeHtml(label)}">
          ${lessonOptionMarkup(selectedLesson, details)}
        </select>
        <div class="schedule-room-grid">
          <label class="session-room-field">
            <span>Phòng buổi này</span>
            <input class="session-room-input" data-weekday="${weekday}" type="text" value="${escapeHtml(roomValue)}" placeholder="Để trống: dùng phòng mặc định" />
          </label>
          <label>
            <span>Sức chứa</span>
            <input class="session-capacity-input" data-weekday="${weekday}" type="number" min="1" value="${escapeHtml(capacityValue)}" placeholder="Mặc định" />
          </label>
        </div>
      </div>
    `;
  }).join("");
}

function updateScheduleDefaultRoomVisibility(container, defaultRoom) {
  if (!container) return;
  const normalizedDefaultRoom = String(defaultRoom || "").trim();
  container.classList.toggle("uses-default-room", Boolean(normalizedDefaultRoom));

  if (normalizedDefaultRoom) {
    container.querySelectorAll(".session-room-input").forEach((input) => {
      input.value = normalizedDefaultRoom;
    });
  }
}

function syncPairedMathLessonFields(container, classCode, changedField = null) {
  const details = classCodeDetails(classCode);
  if (!details || details.subjectCode !== "TOAN" || details.weekdays.length !== 2) return;

  const fields = Array.from(container.querySelectorAll(".lesson-part-input[data-weekday]"))
    .sort((a, b) => Number(a.dataset.weekday) - Number(b.dataset.weekday));
  if (fields.length !== 2) return;

  const pairOptions = mathLessonPartOptions;
  const sourceField = fields.includes(changedField) ? changedField : fields[0];
  const targetField = fields.find((field) => field !== sourceField);
  const selected = normalizeLessonPartsForSubject(sourceField.value, details);
  const targetValue = selected === pairOptions[0] ? pairOptions[1] : pairOptions[0];

  sourceField.value = selected;
  targetField.value = targetValue;
}

function renderScheduleFields(classCode, existingSessions = [], defaultRoom = "") {
  elements.settingScheduleFields.innerHTML = scheduleFieldsMarkup(classCode, existingSessions);
  updateScheduleDefaultRoomVisibility(elements.settingScheduleFields, defaultRoom);
  syncPairedMathLessonFields(elements.settingScheduleFields, classCode);
}

function renderClassCodeScheduleFields() {
  const classCode = elements.settingClassCode.value.trim().toUpperCase();
  renderScheduleFields(classCode, getClassSessions(classCode), elements.settingRoom.value);
}

function collectScheduleFieldsFrom(container, classCode, defaultRoom, defaultCapacity) {
  const details = classCodeDetails(classCode);
  if (!details) {
    return { error: "Mã lớp cần có dạng Toán 8S35A/8C24B hoặc dạng môn-ca-thứ như 8VC2, 8AT2, 8KT4." };
  }

  const fields = Array.from(container.querySelectorAll(".lesson-part-input[data-weekday]"));
  if (!fields.length) {
    return { error: "Chưa có buổi học nào được tách từ mã lớp." };
  }

  const sessions = fields.map((field) => {
    const weekday = Number(field.dataset.weekday);
    const label = `${details.shift} ${weekdayLabel(weekday)}`;
    const roomInput = container.querySelector(`.session-room-input[data-weekday="${weekday}"]`);
    const capacityInput = container.querySelector(`.session-capacity-input[data-weekday="${weekday}"]`);
    const roomName = defaultRoom || (roomInput ? roomInput.value : "").trim();
    const capacityValue = (capacityInput ? capacityInput.value : "").trim();
    const capacity = capacityValue ? Number(capacityValue) : defaultCapacity;

    return {
      weekday,
      label,
      lessonParts: normalizeLessonPartsForSubject(field.value, details),
      roomName,
      roomId: normalizeRoomId(roomName),
      capacity
    };
  });

  const missingSession = sessions.find((session) => !session.lessonParts);
  if (missingSession) {
    return { error: `Vui lòng chọn phần học cho ${details.shift} ${weekdayLabel(missingSession.weekday)}.` };
  }

  const validOptions = lessonOptionsForDetails(details);
  const invalidSession = sessions.find((session) => !validOptions.includes(session.lessonParts));
  if (invalidSession) {
    return { error: `Phần học chỉ được chọn: ${validOptions.join(", ")}.` };
  }

  const missingRoom = sessions.find((session) => !session.roomName);
  if (missingRoom) {
    return { error: `Vui lòng nhập phòng học cho ${missingRoom.label} hoặc nhập phòng mặc định.` };
  }

  const invalidCapacity = sessions.find((session) =>
    session.capacity !== "" && (!Number.isFinite(session.capacity) || session.capacity <= 0)
  );
  if (invalidCapacity) {
    return { error: `Vui lòng nhập sức chứa hợp lệ cho ${invalidCapacity.label} hoặc nhập sức chứa mặc định.` };
  }

  return { sessions };
}

function collectScheduleFields() {
  const classCode = elements.settingClassCode.value.trim().toUpperCase();
  const defaultCapacityValue = elements.settingCapacity.value.trim();
  return collectScheduleFieldsFrom(
    elements.settingScheduleFields,
    classCode,
    elements.settingRoom.value.trim(),
    defaultCapacityValue ? Number(defaultCapacityValue) : ""
  );
}

function buildClassLine(classCode) {
  const sessions = getClassSessions(classCode);
  const firstSession = sessions[0];
  const schedule = sessions
    .map((session) => {
      const room = getRoom(session.roomId);
      return `${shortWeekdayLabel(session.weekday)}: ${session.lessonParts}${room ? ` (${room.name})` : ""}`;
    })
    .join("; ");
  const capacity = Array.from(new Set(
    sessions
      .map((session) => getCapacity(session))
      .filter((item) => item > 0)
  )).join("/");
  const count = firstSession ? Number(firstSession.officialCount || 0) : 0;
  const metadata = [];
  if (capacity) metadata.push(`sức chứa ${capacity}`);
  if (count > 0) metadata.push(`sĩ số ${count}`);
  return `${classCode} - ${schedule || classScheduleText(classCode)}${metadata.length ? ` - ${metadata.join(" - ")}` : ""}`;
}

function buildClassInputText() {
  return data.classes
    .map((classItem) => buildClassLine(classItem.code))
    .join("\n");
}

function syncClassInputFromData() {
  data.classInputText = buildClassInputText();
}

function cleanupRooms() {
  const usedRooms = new Set(data.classSessions.map((session) => session.roomId));
  data.rooms = data.rooms.filter((room) => usedRooms.has(room.id));
}

function removeInvalidAssignments() {
  data.makeupAssignments = data.makeupAssignments.filter((item) =>
    getSession(item.missedSessionId) && getSession(item.makeupSessionId)
  );
}

function classDraftResult(classCode, count, scheduleResult) {
  const details = classCodeDetails(classCode);

  if (!classCode) {
    return {
      error: "Vui lòng nhập mã lớp.",
      autoText: "Chờ nhập mã lớp"
    };
  }

  if (!details) {
    return {
      error: "Mã lớp cần có dạng Toán 8S35A/8C24B hoặc dạng môn-ca-thứ như 8VC2, 8AT2, 8KT4.",
      autoText: "Chờ mã lớp hợp lệ"
    };
  }

  if (scheduleResult.error) {
    return {
      error: scheduleResult.error,
      autoText: "Chờ đủ dữ liệu"
    };
  }

  if (!Number.isFinite(count) || count < 0) {
    return {
      error: "Sĩ số hiện tại không hợp lệ.",
      autoText: "Chờ sĩ số hợp lệ"
    };
  }

  const overcrowdedSession = scheduleResult.sessions.find((session) =>
    Number.isFinite(session.capacity) && session.capacity > 0 && count > session.capacity
  );
  if (overcrowdedSession) {
    return {
      error: `Sĩ số hiện tại không được lớn hơn sức chứa của ${overcrowdedSession.label}.`,
      autoText: "Sĩ số vượt sức chứa"
    };
  }

  return {
    parsed: {
      classCode: details.code,
      grade: details.grade,
      shift: details.shift,
      programGroup: details.programGroup,
      subjectCode: details.subjectCode,
      subjectLabel: details.subjectLabel,
      levelCode: details.levelCode,
      baseCode: details.baseCode,
      officialCount: count,
      sessions: scheduleResult.sessions
    }
  };
}

function remapClassReferences(previousClassCode, nextClassCode, parsedSessions) {
  if (!previousClassCode || previousClassCode === nextClassCode) return;

  const nextWeekdays = new Set(parsedSessions.map((session) => Number(session.weekday)));
  const nextSessionId = (sessionId) => {
    const value = String(sessionId || "");
    const prefix = `${previousClassCode}-T`;
    if (!value.startsWith(prefix)) return sessionId;
    const weekday = Number(value.slice(prefix.length));
    return nextWeekdays.has(weekday) ? `${nextClassCode}-T${weekday}` : sessionId;
  };

  data.makeupAssignments = data.makeupAssignments.map((item) => ({
    ...item,
    mainClassCode: item.mainClassCode === previousClassCode ? nextClassCode : item.mainClassCode,
    makeupClassCode: item.makeupClassCode === previousClassCode ? nextClassCode : item.makeupClassCode,
    missedSessionId: nextSessionId(item.missedSessionId),
    makeupSessionId: nextSessionId(item.makeupSessionId)
  }));

  if (elements.studentClassCode.value.trim().toUpperCase() === previousClassCode) {
    elements.studentClassCode.value = nextClassCode;
  }
}

function saveParsedClass(parsed, previousClassCode = "") {
  const normalizedPreviousCode = String(previousClassCode || parsed.classCode).trim().toUpperCase();
  const existingClass = data.classes.find((item) =>
    item.code === normalizedPreviousCode || item.code === parsed.classCode
  );

  data.classes = data.classes.filter((item) =>
    item.code !== parsed.classCode && item.code !== normalizedPreviousCode
  );
  data.classSessions = data.classSessions.filter((session) =>
    session.classCode !== parsed.classCode && session.classCode !== normalizedPreviousCode
  );

  const roomsById = new Map();
  parsed.sessions.forEach((session) => {
    roomsById.set(session.roomId, {
      id: session.roomId,
      name: session.roomName,
      capacity: session.capacity
    });
  });
  data.rooms = data.rooms.filter((item) => !roomsById.has(item.id));
  data.rooms.push(...roomsById.values());

  data.classes.push({
    code: parsed.classCode,
    grade: parsed.grade,
    shift: parsed.shift,
    programGroup: parsed.programGroup,
    subjectCode: parsed.subjectCode,
    subjectLabel: parsed.subjectLabel,
    levelCode: parsed.levelCode,
    baseCode: parsed.baseCode,
    teacher: existingClass ? existingClass.teacher : "Chưa khai báo"
  });

  parsed.sessions.forEach((session) => {
    data.classSessions.push({
      id: `${parsed.classCode}-T${session.weekday}`,
      classCode: parsed.classCode,
      weekday: session.weekday,
      shift: parsed.shift,
      lessonParts: session.lessonParts,
      roomId: session.roomId,
      officialCount: parsed.officialCount
    });
  });

  remapClassReferences(normalizedPreviousCode, parsed.classCode, parsed.sessions);
  cleanupRooms();
  removeInvalidAssignments();
  syncClassInputFromData();
  saveData();
}

function setNotice(message, type = "success") {
  if (!message) {
    elements.notice.hidden = true;
    elements.notice.textContent = "";
    return;
  }

  elements.notice.hidden = false;
  elements.notice.textContent = message;
  elements.notice.dataset.type = type;
}

function setStatus(element, message, type = "success") {
  element.textContent = message;
  element.classList.toggle("error", type === "error");
}

function getActiveViewName() {
  const activePanel = document.querySelector("[data-view-panel].is-active");
  return activePanel ? activePanel.dataset.viewPanel : "planner";
}

async function confirmSettingsAccess() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "custom-prompt-overlay";
    modal.innerHTML = `
      <div class="custom-prompt-modal">
        <h3>Xác thực truy cập</h3>
        <p>Nhập mật khẩu cài đặt lớp:</p>
        <input type="password" id="settingsPasswordInput" autocomplete="off" />
        <div class="custom-prompt-actions">
          <button class="btn ghost" id="settingsPasswordCancel">Hủy</button>
          <button class="btn primary" id="settingsPasswordOk">Đồng ý</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector("#settingsPasswordInput");
    const btnOk = modal.querySelector("#settingsPasswordOk");
    const btnCancel = modal.querySelector("#settingsPasswordCancel");

    input.focus();

    const cleanup = () => document.body.removeChild(modal);
    const submit = () => {
      if (input.value === SETTINGS_PASSWORD) {
        cleanup();
        resolve(true);
      } else {
        alert("Mật khẩu không đúng.");
        cleanup();
        resolve(false);
      }
    };

    btnOk.addEventListener("click", submit);
    btnCancel.addEventListener("click", () => { cleanup(); resolve(false); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") { cleanup(); resolve(false); }
    });
  });
}

async function switchView(viewName) {
  if (viewName === "settings" && getActiveViewName() !== "settings") {
    const ok = await confirmSettingsAccess();
    if (!ok) return;
  }

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === viewName);
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });


}

function renderBranchSelector() {
  if (!elements.branchSelect) return;

  const activeBranch = getActiveBranch();
  elements.branchSelect.innerHTML = appState.branches.map((branch) =>
    `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`
  ).join("");
  elements.branchSelect.value = activeBranch.id;
}

function currentWeekdayValue(date = new Date()) {
  const day = date.getDay();
  return String(day === 0 ? 8 : day + 1);
}

function currentShiftValue(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 17 * 60) return "Tối";
  if (minutes >= 13 * 60) return "Chiều";
  return "Sáng";
}

function setPreferredMakeupToCurrentTime() {
  elements.preferredWeekday.value = currentWeekdayValue();
  elements.preferredShift.value = currentShiftValue();
}

function resetBranchWorkspace() {
  currentSuggestions = [];
  currentRejected = [];
  elements.studentClassCode.value = "";
  elements.studentNameInput.value = "";
  setPreferredMakeupToCurrentTime();
  clearClassForm();
  setStatus(elements.classFormStatus, "");
}

function switchBranch(branchId) {
  const nextBranch = appState.branches.find((branch) => branch.id === branchId);
  if (!nextBranch || nextBranch.id === appState.activeBranchId) return;

  saveData();
  appState.activeBranchId = nextBranch.id;
  data = nextBranch.data;
  resetBranchWorkspace();
  persistAppState();
  
  // Sync with main app
  localStorage.setItem('activeBranch', nextBranch.id);
  
  renderAll();
  setNotice(`Đang làm việc tại chi nhánh ${nextBranch.name}.`);
}

async function syncBranches() {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    const res = await fetch('/api/branches', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return;
    const branchesData = await res.json();
    if (!branchesData || branchesData.length === 0) return;
    
    const existingMap = new Map(appState.branches.map(b => [b.id, b]));
    appState.branches = branchesData.map(b => {
      const existing = existingMap.get(b.id);
      if (existing) {
        existing.name = b.name;
        return existing;
      }
      return createBranch(b.name, defaultData, b.id);
    });
    
    const mainAppActiveBranch = localStorage.getItem('activeBranch') || 'main';
    if (appState.branches.find(b => b.id === mainAppActiveBranch)) {
      appState.activeBranchId = mainAppActiveBranch;
    } else {
      appState.activeBranchId = appState.branches[0].id;
    }
    
    data = getActiveBranch().data;
    persistAppState();
    renderBranchSelector();
  } catch (err) {
    console.error("Failed to sync branches", err);
  }
}

function renderStats() {
  if (!elements.totalClasses) {
    return;
  }

  const fullSessions = data.classSessions.filter((session) => {
    const capacity = getCapacity(session);
    return capacity > 0 && getCurrentCount(session) >= capacity;
  }).length;

  elements.totalClasses.textContent = data.classes.length;
  elements.totalSessions.textContent = data.classSessions.length;
  elements.totalAssignments.textContent = activeAssignments().length;
  elements.fullSessions.textContent = fullSessions;
}

function renderCapacityCheckToggle() {
  if (!elements.capacityCheckToggle) return;
  elements.capacityCheckToggle.checked = isCapacityCheckEnabled();
}

function classSummaryDetails(classItem, sessions = getClassSessions(classItem.code)) {
  const firstSession = sessions[0];
  const officialCount = firstSession ? Number(firstSession.officialCount || 0) : 0;
  const currentCount = firstSession ? getCurrentCount(firstSession) : officialCount;
  const roomText = Array.from(new Set(
    sessions
      .map((session) => getRoom(session.roomId))
      .filter(Boolean)
      .map((room) => room.name)
  )).join(", ") || "-";
  const capacityText = Array.from(new Set(
    sessions
      .map((session) => getCapacity(session))
      .filter((capacity) => capacity > 0)
  )).join(", ") || "-";
  const details = classCodeDetails(classItem.code);
  const subjectText = details ? details.subjectLabel : "Không rõ môn";
  const levelText = details && details.levelCode ? ` · Nhóm ${details.levelCode}` : "";

  return {
    firstSession,
    currentCount,
    roomText,
    capacityText,
    subjectText,
    levelText
  };
}

function classSessionItemsMarkup(sessions) {
  if (!sessions.length) {
    return `<li class="tree-session-empty">Chưa có buổi học.</li>`;
  }

  return sessions.map((session) => {
    const sessionRoom = getRoom(session.roomId);
    const capacity = getCapacity(session);
    const capacityText = capacity > 0 ? capacity : "-";
    return `
      <li>
        <span class="tree-session-day">${escapeHtml(shortWeekdayLabel(session.weekday))}</span>
        <strong>${escapeHtml(session.lessonParts)}</strong>
        <span>${escapeHtml(session.shift)} · ${escapeHtml(sessionRoom ? sessionRoom.name : "-")} · ${getCurrentCount(session)}/${capacityText}</span>
      </li>
    `;
  }).join("");
}

function inlineClassEditorMarkup(classItem, sessions) {
  const summary = classSummaryDetails(classItem, sessions);
  const defaultRoom = sharedRoomForSessions(sessions);
  const defaultCapacity = sharedCapacityForSessions(sessions);
  const officialCount = summary.firstSession ? Number(summary.firstSession.officialCount || 0) : 0;

  return `
    <div class="inline-class-editor" data-original-class-code="${escapeHtml(classItem.code)}">
      <div class="inline-editor-head">
        <div>
          <strong>Chỉnh sửa tại đây</strong>
          <span class="inline-class-status" data-state="saved">Tự động lưu bật</span>
        </div>
        <button class="small-button" type="button" data-action="close-inline-editor">Đóng</button>
      </div>
      <div class="inline-editor-grid">
        <label>
          <span>Mã lớp</span>
          <input data-inline-field="code" type="text" value="${escapeHtml(classItem.code)}" />
        </label>
        <label>
          <span>Phòng mặc định</span>
          <input data-inline-field="room" type="text" value="${escapeHtml(defaultRoom ? defaultRoom.name : "")}" />
        </label>
        <label>
          <span>Sĩ số</span>
          <input data-inline-field="count" type="number" min="0" value="${escapeHtml(officialCount)}" />
        </label>
        <label>
          <span>Sức chứa</span>
          <input data-inline-field="capacity" type="number" min="1" value="${escapeHtml(defaultCapacity)}" />
        </label>
      </div>
      <div class="inline-schedule-fields schedule-fields ${defaultRoom ? "uses-default-room" : ""}">
        ${scheduleFieldsMarkup(classItem.code, sessions)}
      </div>
    </div>
  `;
}

function classNodeMarkup(classItem) {
  const sessions = getClassSessions(classItem.code);
  const summary = classSummaryDetails(classItem, sessions);
  const isEditing = activeInlineEditClassCode === classItem.code;

  return `
    <article class="tree-class-node" data-class-code="${escapeHtml(classItem.code)}">
      <div class="tree-class-row">
        <div class="tree-class-title">
          <strong>${escapeHtml(classItem.code)}</strong>
          <span>${escapeHtml(summary.subjectText)}${escapeHtml(summary.levelText)}</span>
        </div>
        <div class="tree-class-meta">
          <span><b>Phòng</b>${escapeHtml(summary.roomText)}</span>
          <span><b>Sĩ số</b>${summary.currentCount}</span>
          <span><b>Sức chứa</b>${escapeHtml(summary.capacityText)}</span>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="edit-class" data-class-code="${escapeHtml(classItem.code)}">${isEditing ? "Đang sửa" : "Sửa"}</button>
          <button class="small-button danger" type="button" data-action="delete-class" data-class-code="${escapeHtml(classItem.code)}">Xóa</button>
        </div>
      </div>
      ${isEditing ? inlineClassEditorMarkup(classItem, sessions) : ""}
      <ul class="tree-session-list">
        ${classSessionItemsMarkup(sessions)}
      </ul>
    </article>
  `;
}

function renderParsedClasses() {
  if (!data.classes.length) {
    activeInlineEditClassCode = "";
    elements.parsedClassesBody.innerHTML = `
      <div class="empty-state class-tree-empty">Chưa có dữ liệu lớp học.</div>
    `;

    return;
  }

  if (activeInlineEditClassCode && !getClass(activeInlineEditClassCode)) {
    activeInlineEditClassCode = "";
  }

  const groupedClasses = data.classes
    .slice()
    .sort((a, b) => {
      const gradeA = Number(a.grade);
      const gradeB = Number(b.grade);
      const safeGradeA = Number.isFinite(gradeA) ? gradeA : 999;
      const safeGradeB = Number.isFinite(gradeB) ? gradeB : 999;
      if (safeGradeA !== safeGradeB) return safeGradeA - safeGradeB;
      return a.code.localeCompare(b.code, "vi");
    })
    .reduce((groups, classItem) => {
      const grade = Number(classItem.grade);
      const key = Number.isFinite(grade) ? String(grade) : "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(classItem);
      return groups;
    }, new Map());

  elements.parsedClassesBody.innerHTML = Array.from(groupedClasses.entries())
    .map(([gradeKey, classes]) => {
      const gradeLabel = gradeKey === "unknown" ? "Không rõ khối" : `Khối ${gradeKey}`;
      const sessionCount = classes.reduce((total, classItem) => total + getClassSessions(classItem.code).length, 0);

      return `
        <details class="tree-grade" open>
          <summary class="tree-grade-summary">
            <span class="tree-toggle" aria-hidden="true"></span>
            <span class="tree-grade-title">${escapeHtml(gradeLabel)}</span>
            <span class="tree-grade-count">${classes.length} lớp · ${sessionCount} buổi</span>
          </summary>
          <div class="tree-class-list">
            ${classes.map((classItem) => classNodeMarkup(classItem)).join("")}
          </div>
        </details>
      `;
    }).join("");


}

function setAutoSaveState(state, text) {
  if (!elements.autoSaveIndicator) return;
  elements.autoSaveIndicator.dataset.state = state;
  elements.autoSaveIndicator.textContent = text;
}

function setInlineAutoSaveState(editor, state, text) {
  const status = editor ? editor.querySelector(".inline-class-status") : null;
  if (!status) return;
  status.dataset.state = state;
  status.textContent = text;
}

function draftScheduleValuesFrom(container) {
  if (!container) return [];

  return Array.from(container.querySelectorAll(".lesson-part-input[data-weekday]")).map((field) => {
    const weekday = Number(field.dataset.weekday);
    const roomInput = container.querySelector(`.session-room-input[data-weekday="${weekday}"]`);
    const capacityInput = container.querySelector(`.session-capacity-input[data-weekday="${weekday}"]`);
    const roomName = (roomInput ? roomInput.value : "").trim();
    const capacityValue = (capacityInput ? capacityInput.value : "").trim();

    return {
      weekday,
      lessonParts: field.value,
      roomName,
      roomId: normalizeRoomId(roomName),
      capacity: capacityValue ? Number(capacityValue) : ""
    };
  });
}

function refreshInlineScheduleFields(editor) {
  const codeInput = editor.querySelector("[data-inline-field='code']");
  const roomInput = editor.querySelector("[data-inline-field='room']");
  const scheduleContainer = editor.querySelector(".inline-schedule-fields");
  if (!codeInput || !scheduleContainer) return;

  const draftSessions = draftScheduleValuesFrom(scheduleContainer);
  scheduleContainer.innerHTML = scheduleFieldsMarkup(codeInput.value.trim().toUpperCase(), draftSessions);
  updateScheduleDefaultRoomVisibility(scheduleContainer, roomInput ? roomInput.value : "");
  syncPairedMathLessonFields(scheduleContainer, codeInput.value.trim().toUpperCase());
}

function collectInlineClassEditor(editor) {
  const codeInput = editor.querySelector("[data-inline-field='code']");
  const roomInput = editor.querySelector("[data-inline-field='room']");
  const countInput = editor.querySelector("[data-inline-field='count']");
  const capacityInput = editor.querySelector("[data-inline-field='capacity']");
  const scheduleContainer = editor.querySelector(".inline-schedule-fields");
  const classCode = (codeInput ? codeInput.value : "").trim().toUpperCase();
  const defaultRoom = (roomInput ? roomInput.value : "").trim();
  const defaultCapacityValue = (capacityInput ? capacityInput.value : "").trim();
  const defaultCapacity = defaultCapacityValue ? Number(defaultCapacityValue) : "";
  const count = Number((countInput ? countInput.value : "") || 0);

  if (codeInput) codeInput.value = classCode;

  return {
    classCode,
    count,
    previousClassCode: String(editor.dataset.originalClassCode || "").trim().toUpperCase(),
    scheduleResult: collectScheduleFieldsFrom(scheduleContainer, classCode, defaultRoom, defaultCapacity)
  };
}

function updateInlineClassNode(editor, classCode) {
  const classItem = getClass(classCode);
  const node = editor.closest(".tree-class-node");
  if (!classItem || !node) return;

  const sessions = getClassSessions(classCode);
  const summary = classSummaryDetails(classItem, sessions);
  const title = node.querySelector(".tree-class-title");
  const meta = node.querySelector(".tree-class-meta");
  const sessionList = node.querySelector(".tree-session-list");

  node.dataset.classCode = classCode;
  editor.dataset.originalClassCode = classCode;
  node.querySelectorAll("[data-class-code]").forEach((element) => {
    element.dataset.classCode = classCode;
  });

  if (title) {
    title.innerHTML = `
      <strong>${escapeHtml(classCode)}</strong>
      <span>${escapeHtml(summary.subjectText)}${escapeHtml(summary.levelText)}</span>
    `;
  }

  if (meta) {
    meta.innerHTML = `
      <span><b>Phòng</b>${escapeHtml(summary.roomText)}</span>
      <span><b>Sĩ số</b>${summary.currentCount}</span>
      <span><b>Sức chứa</b>${escapeHtml(summary.capacityText)}</span>
    `;
  }

  if (sessionList) {
    sessionList.innerHTML = classSessionItemsMarkup(sessions);
  }
}

function upsertClassFromInlineEditor(editor) {
  const draft = collectInlineClassEditor(editor);
  const draftResult = classDraftResult(draft.classCode, draft.count, draft.scheduleResult);

  if (draftResult.error) {
    setInlineAutoSaveState(editor, "error", draftResult.autoText);
    return false;
  }

  setInlineAutoSaveState(editor, "saving", "Đang tự lưu");

  const parsed = draftResult.parsed;
  const codeChanged = draft.previousClassCode && draft.previousClassCode !== parsed.classCode;
  saveParsedClass(parsed, draft.previousClassCode || parsed.classCode);
  activeInlineEditClassCode = parsed.classCode;
  renderStats();
  renderStudentInfo();
  renderMissedSessions();
  renderAssignments();

  if (codeChanged) {
    renderParsedClasses();
    const nextEditor = elements.parsedClassesBody.querySelector(".inline-class-editor");
    setInlineAutoSaveState(nextEditor, "saved", "Đã tự động lưu");
  } else {
    updateInlineClassNode(editor, parsed.classCode);
    setInlineAutoSaveState(editor, "saved", "Đã tự động lưu");
  }

  setStatus(elements.classFormStatus, `Đã tự động lưu lớp ${parsed.classCode}.`);
  return true;
}

function scheduleInlineClassAutoSave(editor) {
  window.clearTimeout(inlineAutoSaveTimer);
  setInlineAutoSaveState(editor, "pending", "Đang chờ tự lưu");
  inlineAutoSaveTimer = window.setTimeout(() => {
    upsertClassFromInlineEditor(editor);
  }, AUTO_SAVE_DELAY_MS);
}

function openInlineClassEditor(classCode) {
  window.clearTimeout(inlineAutoSaveTimer);
  activeInlineEditClassCode = String(classCode || "").trim().toUpperCase();
  renderParsedClasses();

  const editor = elements.parsedClassesBody.querySelector(".inline-class-editor");
  if (editor) {
    setInlineAutoSaveState(editor, "saved", "Tự động lưu bật");
    editor.scrollIntoView({ block: "nearest" });
  }
}

function closeInlineClassEditor() {
  window.clearTimeout(inlineAutoSaveTimer);
  activeInlineEditClassCode = "";
  renderParsedClasses();
}

function settingsFormHasAnyValue() {
  return Boolean(
    elements.settingClassCode.value.trim() ||
    elements.settingRoom.value.trim() ||
    elements.settingCapacity.value ||
    elements.settingCount.value ||
    elements.settingScheduleFields.querySelector(".lesson-part-input")
  );
}

function scheduleClassAutoSave() {
  window.clearTimeout(autoSaveTimer);

  if (!settingsFormHasAnyValue()) {
    setAutoSaveState("saved", "Tự động lưu bật");
    return;
  }

  setAutoSaveState("pending", "Đang chờ tự lưu");
  autoSaveTimer = window.setTimeout(() => {
    upsertClassFromForm({ auto: true });
  }, AUTO_SAVE_DELAY_MS);
}

function clearClassForm() {
  window.clearTimeout(autoSaveTimer);
  elements.settingClassCode.value = "";
  renderScheduleFields("");
  elements.settingRoom.value = "";
  elements.settingCapacity.value = "";
  elements.settingCount.value = "";
  setStatus(elements.classFormStatus, "");
  setAutoSaveState("saved", "Tự động lưu bật");
}

function upsertClassFromForm(options = {}) {
  const isAuto = Boolean(options.auto);
  const classCode = elements.settingClassCode.value.trim().toUpperCase();
  const count = Number(elements.settingCount.value || 0);
  const scheduleResult = collectScheduleFields();
  const draftResult = classDraftResult(classCode, count, scheduleResult);

  if (draftResult.error) {
    if (isAuto) setAutoSaveState("error", draftResult.autoText);
    else setStatus(elements.classFormStatus, draftResult.error, "error");
    return false;
  }

  if (isAuto) setAutoSaveState("saving", "Đang tự lưu");

  const parsed = draftResult.parsed;
  saveParsedClass(parsed, parsed.classCode);
  renderStats();
  renderParsedClasses();
  renderStudentInfo();
  renderMissedSessions();
  renderAssignments();

  if (isAuto) {
    setStatus(elements.classFormStatus, `Đã tự động lưu lớp ${parsed.classCode}.`);
    setAutoSaveState("saved", "Đã tự động lưu");
  } else {
    clearClassForm();
    setStatus(elements.classFormStatus, `Đã thêm/cập nhật lớp ${parsed.classCode}.`);
    setAutoSaveState("saved", "Đã thêm lớp");
  }

  return true;
}

function deleteClass(classCode) {
  const normalizedCode = (classCode || elements.settingClassCode.value).trim().toUpperCase();
  if (!normalizedCode) {
    setStatus(elements.classFormStatus, "Chưa chọn lớp để xóa.", "error");
    return;
  }

  if (!getClass(normalizedCode)) {
    setStatus(elements.classFormStatus, `Không tìm thấy lớp ${normalizedCode}.`, "error");
    return;
  }

  if (!confirm(`Xóa lớp ${normalizedCode} và các lịch bù liên quan?`)) return;

  if (activeInlineEditClassCode === normalizedCode) {
    window.clearTimeout(inlineAutoSaveTimer);
    activeInlineEditClassCode = "";
  }

  data.classes = data.classes.filter((item) => item.code !== normalizedCode);
  data.classSessions = data.classSessions.filter((session) => session.classCode !== normalizedCode);
  data.makeupAssignments = data.makeupAssignments.filter((item) =>
    item.mainClassCode !== normalizedCode && item.makeupClassCode !== normalizedCode
  );

  cleanupRooms();
  syncClassInputFromData();
  saveData();
  clearClassForm();
  setStatus(elements.classFormStatus, `Đã xóa lớp ${normalizedCode}.`);
  renderAll(false);
}

function renderStudentInfo() {
  const student = getSelectedStudent();

  if (!student) {
    elements.studentInfo.classList.add("is-compact");
    elements.studentInfo.innerHTML = `
      <p>Ví dụ: <strong>8S35</strong>, <strong>8S35A</strong>, <strong>8VC2</strong>, <strong>8AT2</strong>. Tên học sinh chỉ dùng để lưu lịch sử.</p>
    `;
    return;
  }

  elements.studentInfo.classList.remove("is-compact");

  const mainDetails = classCodeDetails(student.mainClassCode);
  if (!mainDetails) {
    elements.studentInfo.innerHTML = `
      <div class="avatar">?</div>
      <div>
        <h3>Mã lớp chưa đúng quy tắc</h3>
        <p>Dùng dạng Toán như <strong>8S35A</strong>, Văn như <strong>8VC2</strong>, Anh như <strong>8AT2</strong>, KHTN như <strong>8KT4</strong>.</p>
      </div>
    `;
    return;
  }

  const sessions = getMainClassSessions(student);
  if (!sessions.length) {
    elements.studentInfo.innerHTML = `
      <div class="avatar">?</div>
      <div>
        <h3>Chưa có dữ liệu lớp ${escapeHtml(student.mainClassCode)}</h3>
        <p>Vào <strong>Cài đặt lớp</strong> để thêm mã lớp này hoặc một lớp cùng mã gốc <strong>${escapeHtml(mainDetails.baseCode)}</strong>.</p>
      </div>
    `;
    return;
  }

  const sessionRows = sessions.map((session) =>
    `<li>${escapeHtml(sessionLabel(session))}: <strong>${escapeHtml(session.lessonParts)}</strong></li>`
  ).join("");
  const displayName = student.hasName ? student.name : "Tên sẽ nhập khi lưu lịch sử";
  const levelText = mainDetails.levelCode ? `${mainDetails.levelCode}` : "Không lọc trình độ";

  elements.studentInfo.innerHTML = `
    <div>
      <h3>${escapeHtml(displayName)}</h3>
      <p>Lớp chính: <strong>${escapeHtml(student.mainClassCode)}</strong></p>
      <p>Môn: <strong>${escapeHtml(mainDetails.subjectLabel)}</strong> - Trình độ: <strong>${escapeHtml(levelText)}</strong></p>
      <p>Lịch học:</p>
      <ul>${sessionRows || "<li>Chưa có lịch học chính.</li>"}</ul>
    </div>
  `;
}

function renderMissedSessions() {
  const student = getSelectedStudent();
  const sessions = getMainClassSessions(student);
  const previousValue = elements.missedSessionSelect.value;

  if (!sessions.length) {
    elements.missedSessionSelect.innerHTML = "";
    renderMissedInfo();
    clearResults();
    return;
  }

  elements.missedSessionSelect.innerHTML = sessions.map((session) =>
    `<option value="${escapeHtml(session.id)}">${escapeHtml(sessionLabel(session))} - ${escapeHtml(session.lessonParts)}</option>`
  ).join("");

  if (sessions.some((session) => session.id === previousValue)) {
    elements.missedSessionSelect.value = previousValue;
  }

  renderMissedInfo();
  clearResults();
}

function renderMissedInfo() {
  const session = getSelectedMissedSession();

  if (!session) {
    elements.missedInfo.innerHTML = `<p class="muted">Chưa chọn buổi bị kẹt.</p>`;
    return;
  }

  elements.missedInfo.innerHTML = `
    <p>Buổi bị kẹt: <strong>${escapeHtml(sessionLabel(session))}</strong></p>
    <p>Phần cần bù: <strong>${escapeHtml(session.lessonParts)}</strong></p>
  `;

}

function suitabilityForLevel(mainDetails, candidateDetails) {
  const mainLevel = mainDetails?.levelCode || "";
  const candidateLevel = candidateDetails?.levelCode || "";
  const levelRank = { A: 3, B: 2, C: 1 };
  const mainRank = levelRank[mainLevel];
  const candidateRank = levelRank[candidateLevel];

  if (!mainLevel || !candidateLevel) return { label: "Phù hợp trung bình", type: "warning", score: 2 };
  if (mainLevel === candidateLevel) return { label: "Phù hợp cao", type: "success", score: 3 };
  if (!mainRank || !candidateRank) return { label: "Phù hợp trung bình", type: "warning", score: 2 };

  const rankGap = mainRank - candidateRank;
  if (rankGap === 1) return { label: "Phù hợp trung bình", type: "warning", score: 2 };
  return { label: "Phù hợp thấp", type: "danger", score: 1 };
}

function evaluateCandidate(student, session) {
  const classInfo = getClass(session.classCode);
  const mainDetails = classCodeDetails(student.mainClassCode);
  const sessionDetails = classCodeDetails(session.classCode);
  const room = getRoom(session.roomId);
  const capacity = getCapacity(session);
  const currentCount = getCurrentCount(session);
  const hasCapacity = capacity > 0;
  const remainingSeats = hasCapacity ? capacity - currentCount : "";

  const candidate = {
    sessionId: session.id,
    classCode: session.classCode,
    weekday: session.weekday,
    shift: session.shift,
    lessonParts: session.lessonParts,
    roomName: room ? room.name : "Chưa có phòng",
    teacher: classInfo ? classInfo.teacher : "Chưa khai báo",
    levelCode: sessionDetails ? sessionDetails.levelCode : "",
    currentCount,
    capacity,
    remainingSeats,
    afterAssignCount: currentCount + 1,
    suitability: suitabilityForLevel(mainDetails, sessionDetails)
  };

  if (!room) return { accepted: false, row: { ...candidate, reason: "Chưa khai báo phòng học" } };
  if (session.classCode === student.mainClassCode) return { accepted: false, row: { ...candidate, reason: "Đây là lớp chính của học sinh" } };
  if (mainDetails && sessionDetails && !mainDetails.levelCode && sessionDetails.baseCode === mainDetails.baseCode) {
    return { accepted: false, row: { ...candidate, reason: "Cùng mã lớp gốc của học sinh" } };
  }
  if (hasTimeConflict(student, session.weekday, session.shift)) return { accepted: false, row: { ...candidate, reason: "Trùng lịch học chính của học sinh" } };
  if (isCapacityCheckEnabled() && hasCapacity && remainingSeats <= 0) {
    return { accepted: false, row: { ...candidate, reason: `Phòng đã đủ ${currentCount}/${capacity} học sinh` } };
  }

  return { accepted: true, row: candidate };
}

function findMakeupSuggestions() {
  const student = getSelectedStudent();
  const missedSession = getSelectedMissedSession();

  setNotice("");

  if (!student || !missedSession) {
    elements.resultSummary.innerHTML = "Vui lòng nhập mã lớp và chọn buổi bị kẹt.";
    currentSuggestions = [];
    currentRejected = [];
    renderResults();
    return;
  }

  const makeupWeekday = Number(elements.preferredWeekday.value);
  const makeupShift = elements.preferredShift.value;
  const mainDetails = classCodeDetails(student.mainClassCode);
  const mainSessions = getMainClassSessions(student);

  if (!mainDetails || !mainSessions.length) {
    elements.resultSummary.innerHTML = `Không tìm thấy dữ liệu lớp chính <strong>${escapeHtml(student.mainClassCode)}</strong>.`;
    currentSuggestions = [];
    currentRejected = [];
    renderResults();
    return;
  }

  if (student.hasName && hasDuplicateMakeup(student.id, missedSession.id)) {
    elements.resultSummary.innerHTML = `
      <span class="badge warning">Đã có lịch bù</span>
      ${escapeHtml(student.name)} đã được xếp bù cho phần <strong>${escapeHtml(missedSession.lessonParts)}</strong>.
    `;
    currentSuggestions = [];
    currentRejected = [];
    renderResults();
    return;
  }

  const matchingSessions = data.classSessions.filter((session) => {
    const candidateDetails = classCodeDetails(session.classCode);
    return candidateDetails &&
      candidateDetails.grade === mainDetails.grade &&
      candidateDetails.subjectCode === mainDetails.subjectCode &&
      isWeekdayInClassCode(candidateDetails, session.weekday) &&
      Number(session.weekday) === makeupWeekday &&
      session.shift === makeupShift &&
      session.lessonParts === missedSession.lessonParts;
  });

  const suggestions = [];
  const rejected = [];

  matchingSessions.forEach((session) => {
    const result = evaluateCandidate(student, session);
    if (result.accepted) suggestions.push(result.row);
    else rejected.push(result.row);
  });

  suggestions.sort((a, b) => {
    if (b.suitability.score !== a.suitability.score) return b.suitability.score - a.suitability.score;
    if (b.remainingSeats !== a.remainingSeats) return b.remainingSeats - a.remainingSeats;
    return a.classCode.localeCompare(b.classCode, "vi");
  });

  currentSuggestions = suggestions;
  currentRejected = rejected;

  const matchMessage = matchingSessions.length
    ? isCapacityCheckEnabled()
      ? `Tìm thấy <strong>${suggestions.length}</strong> lớp còn chỗ, <strong>${rejected.length}</strong> lớp bị loại.`
      : `Tìm thấy <strong>${suggestions.length}</strong> lớp phù hợp, <strong>${rejected.length}</strong> lớp bị loại.`
    : "Chưa có lớp nào cùng phần học trong buổi muốn bù.";

  elements.resultSummary.innerHTML = `
    Lớp chính: <strong>${escapeHtml(student.mainClassCode)}</strong> -
    học sinh lưu lịch sử: <strong>${escapeHtml(student.hasName ? student.name : "chưa nhập tên")}</strong> -
    cần bù: <strong>${escapeHtml(missedSession.lessonParts)}</strong> -
    muốn bù: <strong>${escapeHtml(makeupShift)} ${escapeHtml(weekdayLabel(makeupWeekday))}</strong>.
    ${matchMessage}
  `;

  renderResults();
  
  if (currentSuggestions.length === 0) {
    showToast("Không tìm thấy lớp bù phù hợp với yêu cầu của bạn.", "warning");
  }
}

function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `floating-toast toast-${type}`;
  toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-xmark' : type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> <span>${message}</span>`;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 10);
  
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function renderResults() {
  renderSuggestions();
  renderRejected();
  if (currentSuggestions.length > 0) {
    elements.resultCount.textContent = `(${currentSuggestions.length} lớp phù hợp)`;
  } else {
    elements.resultCount.textContent = ``;
  }
}

function renderSuggestions() {
  if (!currentSuggestions.length) {
    elements.suggestionsBody.innerHTML = `
      <tr><td colspan="7" class="empty-state">Chưa có lớp bù phù hợp. Hãy nhập mã lớp rồi bấm “Tìm lớp bù phù hợp”.</td></tr>
    `;
    return;
  }

  elements.suggestionsBody.innerHTML = currentSuggestions.map((item, index) => {
    const suitability = item.suitability || { label: "Phù hợp trung bình", type: "warning" };
    const label = `${item.shift} ${weekdayLabel(item.weekday)}`;
    const hasCapacity = Number(item.capacity) > 0;
    const capacityText = hasCapacity ? item.capacity : "?";
    const seatBadge = isCapacityCheckEnabled()
      ? hasCapacity
        ? `<span class="badge ${item.remainingSeats <= 1 ? "danger" : item.remainingSeats <= 4 ? "warning" : "success"}">${item.remainingSeats} chỗ</span>`
        : `<span class="badge warning">Chưa nhập</span>`
      : `<span class="badge warning">Không lọc</span>`;

    return `
      <tr>
        <td>
          <div class="class-cell">
            <span class="class-dot">${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.classCode)}</strong> - Lớp bù ${escapeHtml(label)}
              <span class="subtext">Trình độ: ${escapeHtml(item.levelCode || "không ghi")} - Sau khi xếp: ${item.afterAssignCount}/${capacityText}</span>
            </div>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(label)}</strong>
        </td>
        <td>${escapeHtml(item.lessonParts)}</td>
        <td>${escapeHtml(item.roomName)}</td>
        <td>${seatBadge}</td>
        <td><span class="badge ${suitability.type}">${suitability.label}</span></td>
        <td><button class="small-button" type="button" data-action="confirm" data-session-id="${escapeHtml(item.sessionId)}">Chọn lớp này</button></td>
      </tr>
    `;
  }).join("");
}

function renderRejected() {
  if (!currentRejected.length) {
    elements.rejectedBody.innerHTML = `
      <tr><td colspan="5" class="empty-state">Chưa có lớp bị loại trong lượt tìm kiếm này.</td></tr>
    `;
    return;
  }

  elements.rejectedBody.innerHTML = currentRejected.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.classCode)}</strong></td>
      <td>${escapeHtml(item.shift)} ${escapeHtml(weekdayLabel(item.weekday))}</td>
      <td>${escapeHtml(item.lessonParts)}</td>
      <td>${item.currentCount}/${item.capacity || "?"}</td>
      <td><span class="badge danger">${escapeHtml(item.reason)}</span></td>
    </tr>
  `).join("");
}

function confirmMakeup(sessionId) {
  const student = getSelectedStudent();
  const missedSession = getSelectedMissedSession();
  const makeupSession = getSession(sessionId);

  if (!student || !missedSession || !makeupSession) {
    setNotice("Thiếu dữ liệu để xếp lịch bù.", "error");
    return;
  }

  if (!student.hasName) {
    setNotice("Vui lòng nhập tên học sinh để lưu lịch sử tra cứu.", "error");
    return;
  }

  if (hasDuplicateMakeup(student.id, missedSession.id)) {
    setNotice("Học sinh này đã có lịch bù cho buổi bị kẹt đã chọn.", "error");
    findMakeupSuggestions();
    return;
  }

  const capacity = getCapacity(makeupSession);
  const currentCount = getCurrentCount(makeupSession);

  if (isCapacityCheckEnabled() && capacity > 0 && currentCount >= capacity) {
    setNotice(`Không thể xếp. Lớp ${makeupSession.classCode} đã đủ ${currentCount}/${capacity} học sinh.`, "error");
    findMakeupSuggestions();
    return;
  }

  data.makeupAssignments.push({
    id: `MB${Date.now()}`,
    studentId: student.id,
    studentName: student.name,
    mainClassCode: student.mainClassCode,
    missedSessionId: missedSession.id,
    missedWeekday: missedSession.weekday,
    missedShift: missedSession.shift,
    missedLessonParts: missedSession.lessonParts,
    makeupSessionId: makeupSession.id,
    makeupClassCode: makeupSession.classCode,
    makeupWeekday: makeupSession.weekday,
    makeupShift: makeupSession.shift,
    makeupLessonParts: makeupSession.lessonParts,
    roomId: makeupSession.roomId,
    status: "new",
    createdAt: new Date().toISOString()
  });

  saveData();
  renderAssignments();
  renderStats();
  renderParsedClasses();
  findMakeupSuggestions();
  setNotice(`Đã xếp ${student.name} bù lớp ${makeupSession.classCode} - ${sessionLabel(makeupSession)}.`);
}

function removeAssignment(assignmentId) {
  const assignment = data.makeupAssignments.find((item) => item.id === assignmentId);
  if (!assignment) return;

  if (!confirm(`Hủy lịch bù của ${assignment.studentName} ở lớp ${assignment.makeupClassCode}?`)) return;

  data.makeupAssignments = data.makeupAssignments.filter((item) => item.id !== assignmentId);
  saveData();
  renderAssignments();
  renderStats();
  renderParsedClasses();
  findMakeupSuggestions();
  setNotice(`Đã hủy lịch bù của ${assignment.studentName}.`);
}

function renderAssignments() {
  const assignments = activeAssignments().sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  elements.exportAssignmentsBtn.disabled = !assignments.length;
  elements.clearAssignmentsBtn.disabled = !assignments.length;
  elements.exportDateFrom.disabled = !assignments.length;
  elements.exportDateTo.disabled = !assignments.length;

  if (!assignments.length) {
    elements.assignmentsBody.innerHTML = `
      <tr><td colspan="7" class="empty-state">Chưa có học sinh nào được xếp lịch bù.</td></tr>
    `;
    return;
  }

  elements.assignmentsBody.innerHTML = assignments.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.studentName)}</strong></td>
      <td>${escapeHtml(item.mainClassCode)}</td>
      <td>${escapeHtml(item.missedShift)} ${escapeHtml(weekdayLabel(item.missedWeekday))}</td>
      <td>${escapeHtml(item.missedLessonParts)}</td>
      <td><strong>${escapeHtml(item.makeupClassCode)}</strong></td>
      <td>${escapeHtml(item.makeupShift)} ${escapeHtml(weekdayLabel(item.makeupWeekday))}</td>
      <td>
        <select class="status-select status-${item.status || 'new'}" data-assignment-id="${escapeHtml(item.id)}">
          <option value="new" ${(item.status || 'new') === 'new' ? 'selected' : ''}>[Mới xếp]</option>
          <option value="done" ${item.status === 'done' ? 'selected' : ''}>[Đã đi bù]</option>
          <option value="missed" ${item.status === 'missed' ? 'selected' : ''}>[Vắng bù]</option>
        </select>
      </td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="small-button primary-button" style="padding: 4px 8px;" type="button" data-action="print" data-assignment-id="${escapeHtml(item.id)}">In phiếu</button>
          <button class="small-button danger" type="button" data-action="remove" data-assignment-id="${escapeHtml(item.id)}">Hủy</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function clearResults() {
  currentSuggestions = [];
  currentRejected = [];
  elements.resultSummary.innerHTML = "Chọn đủ thông tin rồi bấm “Tìm lớp bù phù hợp”.";
  renderResults();
}

function renderAutocomplete(value = "") {
  const list = document.getElementById("classAutocompleteList");
  if (!list) return;
  list.innerHTML = "";
  
  if (!data.classes || !data.classes.length) {
    list.classList.remove("show");
    return;
  }
  
  const query = value.trim().toUpperCase();
  const matches = query 
    ? data.classes.filter(c => c.code.includes(query))
    : data.classes;
    
  if (!matches.length) {
    list.classList.remove("show");
    return;
  }
  
  matches.forEach(c => {
    const item = document.createElement("div");
    item.textContent = c.code;
    item.addEventListener("click", () => {
      elements.studentClassCode.value = c.code;
      list.classList.remove("show");
      setNotice("");
      renderStudentInfo();
      renderMissedSessions();
    });
    list.appendChild(item);
  });
  list.classList.add("show");
}

function renderAlgorithmConfigForm() {
  if (elements.settingGroup1 && elements.settingGroup2) {
    elements.settingGroup1.value = data.group1Suffixes || emptyData.group1Suffixes;
    elements.settingGroup2.value = data.group2Suffixes || emptyData.group2Suffixes;
  }
}

function saveAlgorithmConfig() {
  if (!elements.settingGroup1 || !elements.settingGroup2) return;
  data.group1Suffixes = elements.settingGroup1.value.trim();
  data.group2Suffixes = elements.settingGroup2.value.trim();
  persistAppState();
  setStatus(elements.configFormStatus, "Đã lưu cấu hình thuật toán.", "success");
  setTimeout(() => setStatus(elements.configFormStatus, "", ""), 3000);
}

function renderAll() {
  renderBranchSelector();
  renderStats();
  renderCapacityCheckToggle();
  renderAlgorithmConfigForm();
  renderParsedClasses();
  renderStudentInfo();
  renderMissedSessions();
  renderAssignments();
  renderClassCodeScheduleFields();
  clearResults();
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewShortcut));
});

elements.branchSelect.addEventListener("change", () => switchBranch(elements.branchSelect.value));

if (elements.loadBtn) {
  elements.loadBtn.addEventListener("click", () => {
    const text = elements.classInputText.value;
    const parsed = parseClassData(text);
    if (parsed.errors && parsed.errors.length > 0) {
      alert("Có lỗi xảy ra:\n" + parsed.errors.join("\n"));
      return;
    }
    data.rooms = parsed.rooms;
    data.classes = parsed.classes;
    data.classSessions = parsed.classSessions;
    data.classInputText = text;
    
    triggerAutoSave();
    renderAll();
    alert("Nhập dữ liệu thành công!");
  });
}

if (elements.excelFileInput) {
  elements.excelFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const dataBuffer = e.target.result;
        const workbook = XLSX.read(dataBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON, array of arrays
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Generate tab-separated text
        const text = jsonData
          .map(row => row.join("\t").trim())
          .filter(line => line.length > 0)
          .join("\n");
          
        elements.classInputText.value = text;
        
        // Trigger load button automatically
        elements.loadBtn.click();
        
      } catch (error) {
        alert("Lỗi đọc file Excel: " + error.message);
      }
      // Reset input so the same file can be uploaded again if needed
      elements.excelFileInput.value = "";
    };
    reader.readAsArrayBuffer(file);
  });
}

elements.saveClassBtn.addEventListener("click", () => {
  window.clearTimeout(autoSaveTimer);
  upsertClassFromForm();
});
if (elements.saveConfigBtn) {
  elements.saveConfigBtn.addEventListener("click", saveAlgorithmConfig);
}
elements.clearClassFormBtn.addEventListener("click", clearClassForm);
elements.deleteClassBtn.addEventListener("click", () => deleteClass());
elements.settingClassCode.addEventListener("input", () => {
  elements.settingClassCode.value = elements.settingClassCode.value.toUpperCase();
  renderClassCodeScheduleFields();
  scheduleClassAutoSave();
});
elements.settingRoom.addEventListener("input", () => {
  updateScheduleDefaultRoomVisibility(elements.settingScheduleFields, elements.settingRoom.value);
  scheduleClassAutoSave();
});
elements.settingCapacity.addEventListener("input", scheduleClassAutoSave);
elements.settingCount.addEventListener("input", scheduleClassAutoSave);
elements.settingScheduleFields.addEventListener("input", scheduleClassAutoSave);
elements.settingScheduleFields.addEventListener("change", (event) => {
  if (event.target.matches(".lesson-part-input")) {
    syncPairedMathLessonFields(
      elements.settingScheduleFields,
      elements.settingClassCode.value.trim().toUpperCase(),
      event.target
    );
  }

  scheduleClassAutoSave();
});

elements.parsedClassesBody.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-action='edit-class']");
  const deleteButton = event.target.closest("[data-action='delete-class']");
  const closeButton = event.target.closest("[data-action='close-inline-editor']");

  if (editButton) openInlineClassEditor(editButton.dataset.classCode);
  if (deleteButton) deleteClass(deleteButton.dataset.classCode);
  if (closeButton) closeInlineClassEditor();
});

elements.parsedClassesBody.addEventListener("input", (event) => {
  const editor = event.target.closest(".inline-class-editor");
  if (!editor) return;

  if (event.target.matches("[data-inline-field='code']")) {
    event.target.value = event.target.value.toUpperCase();
    refreshInlineScheduleFields(editor);
  }

  if (event.target.matches("[data-inline-field='room']")) {
    updateScheduleDefaultRoomVisibility(
      editor.querySelector(".inline-schedule-fields"),
      event.target.value
    );
  }

  scheduleInlineClassAutoSave(editor);
});

elements.parsedClassesBody.addEventListener("change", (event) => {
  const editor = event.target.closest(".inline-class-editor");
  if (!editor) return;

  if (event.target.matches(".lesson-part-input")) {
    const codeInput = editor.querySelector("[data-inline-field='code']");
    syncPairedMathLessonFields(
      editor.querySelector(".inline-schedule-fields"),
      codeInput ? codeInput.value.trim().toUpperCase() : "",
      event.target
    );
  }

  scheduleInlineClassAutoSave(editor);
});

elements.studentClassCode.addEventListener("input", (e) => {
  renderAutocomplete(e.target.value);
  setNotice("");
  renderStudentInfo();
  renderMissedSessions();
});

elements.studentClassCode.addEventListener("focus", (e) => {
  renderAutocomplete(e.target.value);
});

document.addEventListener("click", (e) => {
  if (e.target !== elements.studentClassCode) {
    const list = document.getElementById("classAutocompleteList");
    if (list) list.classList.remove("show");
  }
});
elements.studentNameInput.addEventListener("input", () => {
  setNotice("");
  renderStudentInfo();
});
elements.missedSessionSelect.addEventListener("change", () => {
  setNotice("");
  renderMissedInfo();
  clearResults();
});
elements.preferredWeekday.addEventListener("change", () => {
  setNotice("");
  clearResults();
});
elements.preferredShift.addEventListener("change", () => {
  setNotice("");
  clearResults();
});
elements.capacityCheckToggle.addEventListener("change", () => {
  data.capacityCheckEnabled = elements.capacityCheckToggle.checked;
  saveData();
  setNotice("");
  findMakeupSuggestions();
});
elements.findBtn.addEventListener("click", () => {
  findMakeupSuggestions();
  openResultModal();
});
elements.exportAssignmentsBtn.addEventListener("click", exportAssignmentsToExcel);
elements.clearAssignmentsBtn.addEventListener("click", clearAssignmentHistory);

elements.suggestionsBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='confirm']");
  if (!button) return;
  confirmMakeup(button.dataset.sessionId);
  closeResultModal();
});

elements.assignmentsBody.addEventListener("click", (event) => {
  const printBtn = event.target.closest("[data-action='print']");
  if (printBtn) {
    printTicket(printBtn.dataset.assignmentId);
    return;
  }
  
  const removeBtn = event.target.closest("[data-action='remove']");
  if (!removeBtn) return;
  removeAssignment(removeBtn.dataset.assignmentId);
});

function printTicket(assignmentId) {
  const assignment = data.makeupAssignments.find(a => a.id === assignmentId);
  if (!assignment) return;
  
  let printContainer = document.getElementById("printTicketContainer");
  if (!printContainer) {
    printContainer = document.createElement("div");
    printContainer.id = "printTicketContainer";
    document.body.appendChild(printContainer);
  }
  
  const now = new Date();
  const printTimeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  printContainer.innerHTML = `
    <div class="ticket" style="position: relative;">
      <div class="ticket-print-time">${printTimeStr}</div>
      <div class="ticket-header">
        <div class="ticket-logo-wrapper">
          <img src="./company-logo.png" alt="Logo" class="ticket-logo" onerror="this.style.display='none'">
        </div>
        <div class="ticket-title-group">
          <div class="ticket-center">TRUNG TÂM BDVH THĂNG TIẾN THĂNG LONG</div>
          <div class="ticket-title">PHIẾU HỌC BÙ</div>
        </div>
      </div>
      <div class="ticket-divider"></div>
      <div class="ticket-grid">
        <div class="ticket-field">
          <div class="ticket-label">HỌC SINH</div>
          <div class="ticket-value">${escapeHtml(assignment.studentName)}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-label">LỚP CHÍNH</div>
          <div class="ticket-value">${escapeHtml(assignment.mainClassCode)}</div>
        </div>
        
        <div class="ticket-divider-light" style="grid-column: 1 / -1; margin-top: 5px; margin-bottom: 5px;"></div>
        
        <div class="ticket-field">
          <div class="ticket-label">VÀO LỚP BÙ</div>
          <div class="ticket-value">${escapeHtml(assignment.makeupClassCode)}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-label">PHẦN HỌC</div>
          <div class="ticket-value">${escapeHtml(assignment.makeupLessonParts || "N/A")}</div>
        </div>
        
        <div class="ticket-divider-light" style="grid-column: 1 / -1; margin-top: 5px; margin-bottom: 5px;"></div>
        
        <div class="ticket-field">
          <div class="ticket-label">THỜI GIAN</div>
          <div class="ticket-value">${escapeHtml(assignment.makeupShift)} ${escapeHtml(weekdayLabel(assignment.makeupWeekday))}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-label">PHÒNG HỌC</div>
          <div class="ticket-value">${escapeHtml(assignment.roomId || "N/A")}</div>
        </div>
      </div>
      <div class="ticket-divider"></div>
      <div class="ticket-footer">
        Vui lòng nộp phiếu này cho giáo viên khi vào lớp.
      </div>
    </div>
  `;
  
  window.print();
}

elements.assignmentsBody.addEventListener("change", (event) => {
  const select = event.target.closest(".status-select");
  if (!select) return;
  const assignmentId = select.dataset.assignmentId;
  const newStatus = select.value;
  
  const assignment = data.makeupAssignments.find(a => a.id === assignmentId);
  if (assignment) {
    assignment.status = newStatus;
    saveData();
    
    // Update class to reflect new status color immediately
    select.className = `status-select status-${newStatus}`;
  }
});

setPreferredMakeupToCurrentTime();
renderAll();

syncBranches().then(() => {
  initializeCloudSync();
});

// Auto-fill from URL params
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const classCode = params.get('class');
  const student = params.get('student');
  
  if (classCode) {
    elements.studentClassCode.value = classCode;
    renderStudentInfo();
  }
  if (student) {
    elements.studentNameInput.value = student;
    renderStudentInfo();
  }
});

window.deleteAllClasses = function() {
  if (confirm('Bạn có chắc chắn muốn xóa TẤT CẢ các lớp không? Hành động này không thể hoàn tác.')) {
    data.classes = [];
    data.classSessions = [];
    data.rooms = [];
    syncClassInputFromData();
    if (elements.classInputText) elements.classInputText.value = data.classInputText;
    saveData();
    renderClassTree();
  }
};

function openResultModal() {
  document.getElementById('resultModalBackdrop').style.display = 'flex';
}

function closeResultModal() {
  document.getElementById('resultModalBackdrop').style.display = 'none';
}

document.getElementById('resultModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'resultModalBackdrop') {
    closeResultModal();
  }
});
