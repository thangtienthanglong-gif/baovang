
    let currentSession = null;
    let studentData = [];
    window.studentEvidenceUrls = {};
    let isAttendanceSubmitted = false;
    let currentPart = ''; 
    let currentShift = '';

    function getBranchId() { return localStorage.getItem('selectedBranchId') || 'main'; }

    async function apiRequest(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json', 'x-branch-id': getBranchId() };
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(endpoint, options);
        if (!res.ok) {
            let errMsg = 'API Error';
            let errData = {};
            try {
                errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch(e) {}
            const err = new Error(errMsg);
            err.data = errData;
            throw err;
        }
        return await res.json();
    }

    async function loadClasses() {
        try {
            const res = await apiRequest('/api/students');
            const classNames = [...new Set(res.filter(s => s.status !== 'Nghỉ học').map(s => s.className).filter(c => c))].sort();
            const select = document.getElementById('className');
            if (classNames.length === 0) {
                select.innerHTML = '<option value="">-- Chưa có lớp nào --</option>';
            } else {
                select.innerHTML = classNames.map(c => `<option value="${c}">${c}</option>`).join('');
            }

            // Restore from localStorage
            if(localStorage.getItem('savedTeacherName')) document.getElementById('teacherName').value = localStorage.getItem('savedTeacherName');
            if(localStorage.getItem('savedShiftName')) document.getElementById('shiftName').value = localStorage.getItem('savedShiftName');
            if(localStorage.getItem('savedPartName')) document.getElementById('partName').value = localStorage.getItem('savedPartName');
            if(localStorage.getItem('savedClassName') && classNames.includes(localStorage.getItem('savedClassName'))) {
                document.getElementById('className').value = localStorage.getItem('savedClassName');
            }
        } catch(e) {}
    }
    loadClasses();

    async function startShift() {
        currentShift = document.getElementById('shiftName').value; // Ca 1
        currentPart = document.getElementById('partName').value; // H1
        const teacherName = document.getElementById('teacherName').value.trim();
        if(!teacherName) return showToast("Vui lòng nhập Tên Giáo viên");
        
        const className = document.getElementById('className').value;
        
        if(!className) return showToast("Vui lòng chọn Lớp học");

        // Save to localStorage
        localStorage.setItem('savedTeacherName', teacherName);
        localStorage.setItem('savedShiftName', currentShift);
        localStorage.setItem('savedPartName', currentPart);
        localStorage.setItem('savedClassName', className);

        document.getElementById('startBtn').textContent = "Đang vào lớp...";
        document.getElementById('startBtn').disabled = true;

        try {
            const payload = {
                teacherName: `${teacherName} (${currentShift})`, 
                className, shift: currentPart, lessonName: "", exercises: ""
            };
            
            let res;
            try {
                res = await apiRequest('/api/teaching-sessions', 'POST', payload);
            } catch (e) {
                if (e.data && e.data.canTakeOver) {
                    const takeOverConfirmed = await showCustomConfirm(e.message);
                    if (takeOverConfirmed) {
                        payload.takeOver = true;
                        res = await apiRequest('/api/teaching-sessions', 'POST', payload);
                    } else {
                        throw new Error("Đã hủy vào lớp.");
                    }
                } else {
                    throw e;
                }
            }
            
            currentSession = res.session;

            document.getElementById('screen-1').style.display = 'none';
            document.getElementById('screen-2').style.display = 'block';
            
            document.getElementById('header-title').textContent = `${className}`;
            
            const banner = document.getElementById('caBannerInfo');
            banner.style.display = 'inline-flex';
            banner.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${currentShift}: ${teacherName} - Dạy ${currentPart}`;
            document.getElementById('editLessonName').value = "";
            document.getElementById('editExercises').value = "";
            
            if (currentShift !== 'Ca 1') {
                document.getElementById('submitAttendanceBtn').style.display = 'none';
                isAttendanceSubmitted = true; // For Ca 2, 3, allow Về sớm freely without submitting attendance
            }

            await loadStudents(currentPart);
        } catch(e) {
            showToast(e.message);
            document.getElementById('startBtn').textContent = "Bắt đầu vào lớp";
            document.getElementById('startBtn').disabled = false;
        }
    }

    async function cancelCurrentSession() {
        if (!currentSession || !currentSession.id) return;
        
        const confirmCancel = await showCustomConfirm("Bạn có chắc chắn muốn hủy ca dạy này không? Thao tác này sẽ xóa ca dạy khỏi hệ thống (Dùng khi vào nhầm lớp).");
        if (!confirmCancel) return;
        
        try {
            await apiRequest(`/api/teaching-sessions/${currentSession.id}`, 'DELETE');
            showToast("Đã hủy ca dạy thành công!");
            // Reset UI to start
            document.getElementById('screen-2').style.display = 'none';
            document.getElementById('screen-1').style.display = 'block';
            currentSession = null;
            document.getElementById('className').value = '';
            document.getElementById('teacherName').value = '';
            document.getElementById('startBtn').textContent = "Bắt đầu vào lớp";
            document.getElementById('startBtn').disabled = false;
        } catch(e) {
            showToast("Lỗi khi hủy ca dạy: " + e.message);
        }
    }

    async function updateLessonInfo() {
        if (!currentSession) return;
        try {
            await apiRequest(`/api/teaching-sessions/${currentSession.id}`, 'PUT', {
                lessonName: document.getElementById('editLessonName').value,
                exercises: document.getElementById('editExercises').value
            });
        } catch(e) {}
    }

    async function loadStudents(partName) {
        const className = document.getElementById('className').value;
        try {
            const res = await apiRequest(`/api/ketbu/students?part=${partName}&className=${encodeURIComponent(className)}`);
            studentData = res;
            renderStudents();
        } catch(e) {
            document.getElementById('studentListContainer').innerHTML = "<p style='color:red;'>Lỗi tải danh sách</p>";
        }
    }

    function getSvgIcon(textStr, typeClass = 'text', shape = 'none') {
        let svg = `<svg viewBox="0 0 40 40" style="display:block; margin:auto;"><text x="20" y="26" text-anchor="middle" class="${typeClass}">${textStr}</text>`;
        if (shape === 'arc') svg += `<path d="M 10 12 Q 20 2 30 12" class="stroke-orange"/>`;
        if (shape === 'circle') svg += `<circle cx="20" cy="20" r="16" class="stroke-red"/>`;
        if (shape === 'cross') svg += `<circle cx="20" cy="20" r="16" class="stroke-red"/><line x1="8" y1="8" x2="32" y2="32" class="stroke-red"/>`;
        svg += `</svg>`;
        return svg;
    }

    function renderStudents() {
        const container = document.getElementById('studentListContainer');
        if(studentData.length === 0) {
            container.innerHTML = "<p>Lớp chưa có học sinh.</p>";
            return;
        }

        const textBoard = currentPart.toUpperCase(); 
        const textNotebook = currentPart.toLowerCase(); 

        container.innerHTML = studentData.map(st => {
            let trendHtml = '';
            const displayParts = (st.trend_parts && st.trend_parts.length > 0) ? st.trend_parts.join(' & ') : currentPart;
            if (st.trend_status === 'down') trendHtml = `<span class="trend-badge-down" style="color:#ef4444; font-weight:bold; margin-left: 5px;"><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b; margin-right: 3px;"></i>${displayParts} <i class="fa-solid fa-arrow-down"></i></span>`;
            else if (st.trend_status === 'up') trendHtml = `<span class="trend-badge-up" style="color:#10b981; font-weight:bold; margin-left: 5px;"><i class="fa-solid fa-star" style="color:#f59e0b; margin-right: 3px;"></i>${displayParts} <i class="fa-solid fa-arrow-up"></i></span>`;

            let isAbsent = st.todayAbsenceStatus === 'Vắng';
            let isEarly = st.todayAbsenceStatus === 'Về sớm';
            let rowClasses = 'student-row';
            if (isAbsent) rowClasses += ' is-absent';
            if (isEarly) rowClasses += ' is-early';
            if (st.isMakeupToday) rowClasses += ' is-makeup';
            if (st.isStuckToday) rowClasses += ' is-stuck';
            
            let statusBadgeHtml = '';
            if (st.isStuckToday) {
                statusBadgeHtml = `<span class="status-badge" style="display:inline-block; background:#f59e0b;">KẸT LỊCH</span>`;
            } else {
                statusBadgeHtml = `<span class="status-badge" style="display:${(isAbsent || isEarly) ? 'inline-block' : 'none'}; background:${isEarly ? '#10b981' : '#ef4444'}">${isEarly ? 'VỀ SỚM' : 'VẮNG'}</span>`;
            }
            let makeupBadgeHtml = st.isMakeupToday ? `<span class="makeup-badge">${st.makeupType === 'bu_tam' ? 'BÙ TẠM' : 'HỌC BÙ'}</span>` : '';
            let stuckSubText = '';
            if (st.allExceptions && st.allExceptions.length > 0) {
                stuckSubText = st.allExceptions.map(e => {
                    const typeText = e.type === 'bu_tam' ? 'Bù tạm' : 'Bù';
                    return `<div style="font-size:12px; color:#3b82f6; font-weight:bold; margin-top:2px;">Kẹt T${e.stuckDay || ''} ➔ ${typeText} T${e.makeupDay || ''} (${e.makeupClass || ''})</div>`;
                }).join('');
            }

            return `
            <div class="${rowClasses}" id="row-${st.id}">
                <div class="student-info" onclick="openHistoryPanel('${st.id}')" title="Bấm để xem lịch sử đánh giá">
                    <div class="avatar">${(st.name || st.fullName || 'X').charAt(0)}</div>
                    <div class="name">
                        <div class="name-wrapper">${makeupBadgeHtml} ${st.name || st.fullName} ${trendHtml} ${statusBadgeHtml}</div>
                        ${stuckSubText}
                    </div>
                </div>
                <div class="actions">
                    <button class="icon-btn absent-toggle ${isAbsent ? 'active' : ''}" onclick="toggleAbsent('${st.id}', this)" ${(isEarly || st.isStuckToday) ? 'disabled' : ''}>
                        <i class="fa-solid fa-user-xmark"></i> Vắng
                    </button>
                    <button class="icon-btn early-toggle ${isEarly ? 'active' : ''}" onclick="toggleEarly('${st.id}', this)" ${(isAbsent || isEarly || st.isStuckToday) ? 'disabled' : ''}>
                        <i class="fa-solid fa-person-walking-arrow-right"></i> Về sớm
                    </button>

                    <div class="eval-buttons" id="eval-btns-${st.id}" style="opacity: ${(isAbsent || isEarly || st.isStuckToday) ? '0.2' : '1'}; pointer-events: ${(isAbsent || isEarly || st.isStuckToday) ? 'none' : 'auto'}">
                        <!-- Khảo bài chung -->
                        <div class="action-btn" onclick="event.stopPropagation(); toggleMenu(this, 'Khảo Bài', '${currentPart}')">
                            <span style="color:#94a3b8; font-size:14px; font-weight:bold;">KB</span>
                            <div class="popup-menu" onclick="event.stopPropagation()">
                                <div class="menu-item" onclick="submitEval(this, 'Tốt (T)', '${st.id}', 'T', 'none', 'text-kb', '#10b981')"><svg viewBox="0 0 40 40"><text x="20" y="27" text-anchor="middle" class="text-kb" style="fill:#10b981;">T</text></svg></div>
                                <div class="menu-item" onclick="submitEval(this, 'Kém (K)', '${st.id}', 'K', 'none', 'text-kb', '#ef4444')"><svg viewBox="0 0 40 40"><text x="20" y="27" text-anchor="middle" class="text-kb" style="fill:#ef4444;">K</text></svg></div>
                                <div class="menu-item" style="color: #ef4444; font-size: 16px;" onclick="undoEval(this, '${st.id}')" title="Hoàn tác đánh giá (trong 3 phút)"><i class="fa-solid fa-rotate-left"></i></div>
                            </div>
                        </div>
                        
                        <!-- BẢNG -->
                        <div class="action-btn" onclick="event.stopPropagation(); toggleMenu(this, 'Bảng', '${currentPart}')">
                            <span style="color:#94a3b8; font-size:13px; font-weight:bold;">Bảng</span>
                            <div class="popup-menu" onclick="event.stopPropagation()">
                                <div class="menu-item" onclick="submitEval(this, 'Đúng', '${st.id}', '${textBoard}', 'none')">${getSvgIcon(textBoard)}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Sai nhẹ', '${st.id}', '${textBoard}', 'arc')">${getSvgIcon(textBoard, 'text', 'arc')}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Sai hẳn', '${st.id}', '${textBoard}', 'circle')">${getSvgIcon(textBoard, 'text', 'circle')}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Chép bài', '${st.id}', '${textBoard}', 'cross')">${getSvgIcon(textBoard, 'text', 'cross')}</div>
                                <div class="menu-item" style="color: #ef4444; font-size: 16px;" onclick="undoEval(this, '${st.id}')" title="Hoàn tác đánh giá (trong 3 phút)"><i class="fa-solid fa-rotate-left"></i></div>
                            </div>
                        </div>

                        <!-- VỞ -->
                        <div class="action-btn" onclick="event.stopPropagation(); toggleMenu(this, 'Vở', '${currentPart}')">
                            <span style="color:#94a3b8; font-size:13px; font-weight:bold;">Vở</span>
                            <div class="popup-menu" onclick="event.stopPropagation()">
                                <div class="menu-item" onclick="submitEval(this, 'Đúng', '${st.id}', '${textNotebook}', 'none')">${getSvgIcon(textNotebook)}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Sai nhẹ', '${st.id}', '${textNotebook}', 'arc')">${getSvgIcon(textNotebook, 'text', 'arc')}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Sai hẳn', '${st.id}', '${textNotebook}', 'circle')">${getSvgIcon(textNotebook, 'text', 'circle')}</div>
                                <div class="menu-item" onclick="submitEval(this, 'Chép bài', '${st.id}', '${textNotebook}', 'cross')">${getSvgIcon(textNotebook, 'text', 'cross')}</div>
                                <div class="menu-item" style="color: #ef4444; font-size: 16px;" onclick="undoEval(this, '${st.id}')" title="Hoàn tác đánh giá (trong 3 phút)"><i class="fa-solid fa-rotate-left"></i></div>
                            </div>
                        </div>
                        
                        <!-- GHI CHU -->
                        <div style="display: flex; align-items: center; gap: 4px; margin-left: 5px;">
                            <input type="text" placeholder="Ghi chú..." class="note-input" style="width: 90px; padding: 6px 8px; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 12px; outline: none;" onchange="saveNote('${st.id}', this.value)" />
                            <label style="cursor: pointer; color: #64748b; font-size: 16px; margin: 0; padding: 4px;" title="Đính kèm ảnh">
                                <i class="fa-solid fa-camera"></i>
                                <input type="file" accept="image/*" style="display: none;" onchange="uploadEvidence('${st.id}', this)" />
                            </label>
                            <div id="evidence-preview-${st.id}" style="display: none;">
                                <i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 14px;" title="Đã đính kèm ảnh"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    async function toggleAbsent(id, btn) {
        if (btn.disabled) return;
        const row = document.getElementById(`row-${id}`);
        
        if (isAttendanceSubmitted && row.classList.contains('is-absent')) {
            if(confirm("Học sinh đi trễ? Xác nhận đính chính.")) {
                try {
                    const timeStr = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
                    const evUrl = window.studentEvidenceUrls[id] || '';
                    await apiRequest('/api/absences', 'POST', {
                        studentId: id, date: new Date().toISOString().slice(0, 10),
                        session: currentShift,
                        absenceStatus: 'Đi trễ', className: document.getElementById('className').value, reason: `Đi trễ lúc ${timeStr}`,
                        evidenceUrl: evUrl
                    });
                    row.classList.remove('is-absent');
                    row.classList.add('is-late');
                    row.querySelector('.status-badge').textContent = 'ĐI TRỄ';
                    btn.classList.remove('active');
                    btn.innerHTML = '<i class="fa-solid fa-user-clock"></i> Trễ';
                    btn.style.borderColor = '#f59e0b'; btn.style.color = '#f59e0b';
                    btn.disabled = true;
                    row.querySelector('.eval-buttons').style.opacity = '1';
                    row.querySelector('.eval-buttons').style.pointerEvents = 'auto';
                } catch(e) {}
            }
            return;
        } else if (isAttendanceSubmitted && currentShift === 'Ca 1') {
            showToast("Đã chốt sổ, không thể đánh vắng nữa.");
            return;
        }

        const isAbsent = row.classList.toggle('is-absent');
        btn.classList.toggle('active');
        const badge = row.querySelector('.status-badge');
        badge.style.display = isAbsent ? 'inline-block' : 'none';
        badge.textContent = 'VẮNG';
        
        const evalBtns = row.querySelector('.eval-buttons');
        evalBtns.style.opacity = isAbsent ? '0.2' : '1';
        evalBtns.style.pointerEvents = isAbsent ? 'none' : 'auto';
    }

    async function toggleEarly(id, btn) {
        if (btn.disabled) return;
        
        const now = new Date();
        const currentTimeString = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        
        const row = document.getElementById(`row-${id}`);
        
        try {
            const evUrl = window.studentEvidenceUrls[id] || '';
            await apiRequest('/api/absences', 'POST', {
                studentId: id, date: new Date().toISOString().slice(0, 10),
                absenceStatus: 'Về sớm',
                session: document.getElementById('shiftName').value || 'Không rõ',
                className: document.getElementById('className').value, 
                initialReason: `Về sớm lúc ${currentTimeString}`,
                evidenceUrl: evUrl
            });
            
            row.classList.add('is-early');
            const badge = row.querySelector('.status-badge');
            badge.style.display = 'inline-block';
            badge.textContent = 'VỀ SỚM';
            badge.style.background = '#10b981';
            
            const evalBtns = row.querySelector('.eval-buttons');
            if (evalBtns) {
                evalBtns.style.opacity = '0.2';
                evalBtns.style.pointerEvents = 'none';
            }
            
            btn.classList.add('active');
            btn.disabled = true;
        } catch(e) {
            if (e.message && e.message.includes('đã được ghi vắng')) {
                showToast("Học sinh này đã được đánh dấu vắng/về sớm trước đó!");
                // Vô hiệu hóa nút đánh giá luôn vì đã vắng/về sớm
                const evalBtns = row.querySelector('.eval-buttons');
                if (evalBtns) {
                    evalBtns.style.opacity = '0.2';
                    evalBtns.style.pointerEvents = 'none';
                }
                btn.classList.add('active');
                btn.disabled = true;
            } else {
                showToast(e.message || "Lỗi cập nhật về sớm!");
            }
        }
    }

    async function submitAttendance() {
        if(!confirm("Chốt điểm danh? Hệ thống tự gửi Zalo báo vắng.")) return;
        try {
            await apiRequest(`/api/teaching-sessions/${currentSession.id}/submit-attendance`, 'PUT');
            isAttendanceSubmitted = true;
            
            document.getElementById('submitAttendanceBtn').disabled = true;
            document.getElementById('submitAttendanceBtn').textContent = "Đã gửi Zalo Vắng mặt";
            document.getElementById('submitAttendanceBtn').className = "btn-disabled";
            
            const absentRows = document.querySelectorAll('.student-row.is-absent');
            for(let row of absentRows) {
               const stId = row.id.replace('row-', '');
               const evUrl = window.studentEvidenceUrls[stId] || '';
               await apiRequest('/api/absences', 'POST', {
                   studentId: stId, date: new Date().toISOString().slice(0, 10),
                   session: currentShift,
                   absenceStatus: 'Vắng', className: document.getElementById('className').value, reason: 'Vắng mặt',
                   evidenceUrl: evUrl
               }).catch(e=>{});
            }
            showToast("Đã chốt sổ!");
        } catch(e) { showToast("Lỗi chốt điểm danh: " + e.message); }
    }

    document.addEventListener('click', () => {
        document.querySelectorAll('.popup-menu').forEach(menu => menu.classList.remove('active'));
    });

    function toggleMenu(btn, location, partName) {
        if (btn.classList.contains('disabled')) return;
        document.querySelectorAll('.popup-menu').forEach(menu => {
            if (menu !== btn.querySelector('.popup-menu')) menu.classList.remove('active');
        });
        btn.querySelector('.popup-menu').classList.toggle('active');
        btn.dataset.location = location; 
        btn.dataset.part = partName;
    }

    async function submitEval(item, statusLabel, studentId, textVal, shapeType, typeClass='text', colorFill='') {
        const actionBtn = item.closest('.action-btn');
        const location = actionBtn.dataset.location;
        const part = actionBtn.dataset.part;
        const studentName = actionBtn.closest('.student-row').querySelector('.name-wrapper').childNodes[0].nodeValue.trim();

        const popupMenuDiv = actionBtn.querySelector('.popup-menu');
        const popupHtml = popupMenuDiv ? popupMenuDiv.outerHTML : '';
        const oldHtml = actionBtn.innerHTML;
        
        actionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#3b82f6;"></i>';
        
        try {
            const evUrl = window.studentEvidenceUrls[studentId] || '';
            const res = await apiRequest('/api/evaluations', 'POST', {
                sessionId: currentSession.id, studentId, location, status: statusLabel, part, evidenceUrl: evUrl
            });

            let svgStr = `<svg viewBox="0 0 40 40" style="display:block; margin:auto;"><text x="20" y="26" text-anchor="middle" class="${typeClass}" style="fill:${colorFill}">${textVal}</text>`;
            if (shapeType === 'arc') svgStr += `<path d="M 10 12 Q 20 2 30 12" class="stroke-orange"/>`;
            if (shapeType === 'circle') svgStr += `<circle cx="20" cy="20" r="16" class="stroke-red"/>`;
            if (shapeType === 'cross') svgStr += `<circle cx="20" cy="20" r="16" class="stroke-red"/><line x1="8" y1="8" x2="32" y2="32" class="stroke-red"/>`;
            svgStr += `</svg>`;

            actionBtn.innerHTML = svgStr + popupHtml;
            actionBtn.classList.add('has-value');
        } catch(e) {
            actionBtn.innerHTML = oldHtml;
        }
    }

    async function undoEval(item, studentId) {
        event.stopPropagation();
        const actionBtn = item.closest('.action-btn');
        const location = actionBtn.dataset.location;
        const part = actionBtn.dataset.part;
        
        const popupMenuDiv = actionBtn.querySelector('.popup-menu');
        const popupHtml = popupMenuDiv ? popupMenuDiv.outerHTML : '';
        const oldHtml = actionBtn.innerHTML;
        
        actionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#ef4444;"></i>';
        
        try {
            const res = await apiRequest('/api/evaluations/undo', 'DELETE', {
                sessionId: currentSession.id, studentId, location, part
            });
            
            showToast(res.message || "Đã hoàn tác đánh giá", "success");
            
            // Trả nút về trạng thái mặc định ban đầu
            let defaultText = location === 'Khảo Bài' ? 'KB' : location;
            let defaultFontSize = location === 'Khảo Bài' ? '14px' : '13px';
            actionBtn.innerHTML = `<span style="color:#94a3b8; font-size:${defaultFontSize}; font-weight:bold;">${defaultText}</span>` + popupHtml;
            actionBtn.classList.remove('has-value');
        } catch(e) {
            showToast(e.message || "Lỗi hoàn tác", "error");
            actionBtn.innerHTML = oldHtml;
        }
    }

    async function uploadEvidence(studentId, inputEl) {
        if (!inputEl.files || inputEl.files.length === 0) return;
        const file = inputEl.files[0];
        
        try {
            showToast("Đang nén và tải ảnh lên...", "info");
            const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true };
            const compressedFile = await imageCompression(file, options);
            
            const formData = new FormData();
            formData.append('evidence', compressedFile, compressedFile.name);
            
            const res = await fetch('/api/upload-evidence', {
                method: 'POST',
                headers: { 'x-branch-id': getBranchId() },
                body: formData
            });
            
            if(!res.ok) {
                const errText = await res.text();
                throw new Error("Mã lỗi: " + res.status + ". Chi tiết: " + errText);
            }
            const data = await res.json();
            
            window.studentEvidenceUrls[studentId] = data.url;
            document.getElementById(`evidence-preview-${studentId}`).style.display = 'block';
            showToast("Đã đính kèm ảnh thành công!", "success");
            
            const noteInput = document.querySelector(`#row-${studentId} .note-input`);
            if (noteInput && noteInput.value) {
                saveNote(studentId, noteInput.value);
            }
        } catch (error) {
            console.error(error);
            showToast("Lỗi tải ảnh: " + error.message);
        }
    }

    async function saveNote(studentId, noteVal) {
        if (!currentSession) return;
        try {
            const evUrl = window.studentEvidenceUrls[studentId] || '';
            await apiRequest('/api/evaluations', 'POST', {
                sessionId: currentSession.id, studentId, location: 'Ghi chú', status: noteVal, part: currentPart, evidenceUrl: evUrl
            });
            event.target.style.borderColor = '#10b981';
            setTimeout(() => { event.target.style.borderColor = '#cbd5e1'; }, 2000);
        } catch(e) {}
    }

    async function openHistoryPanel(studentId) {
        document.getElementById('panelOverlay').classList.add('active');
        document.getElementById('historyPanel').classList.add('active');
        document.getElementById('panelContent').innerHTML = '<div style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</div>';
        
        try {
            const res = await apiRequest(`/api/ketbu/students/${studentId}/history`);
            const st = res.student || {};
            const cachedSt = studentData.find(s => s.id === studentId) || {};
            
            
            // Lọc ra các đánh giá từ mốc "Đã báo phụ huynh" gần nhất
            let relevantHistory = res.history || [];
            const checkPartsForHistory = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
            const partHistory = relevantHistory.filter(h => checkPartsForHistory.includes(h.part));
            const lastNotifiedIdx = partHistory.findIndex(h => h.status === 'Đã báo phụ huynh');
            if (lastNotifiedIdx !== -1) {
                relevantHistory = partHistory.slice(0, lastNotifiedIdx);
            } else {
                relevantHistory = partHistory;
            }

            let warningBanner = '';
            if (cachedSt.trend_status === 'down') {
                const checkParts = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
                const badEvals = relevantHistory.filter(h => checkParts.includes(h.part) && ['Sai hẳn', 'Kém (K)', 'Chép bài'].includes(h.status)).slice(0,3);
                let reason = 'Học sinh liên tục đạt kết quả yếu';
                let suggestion = 'Đề nghị quản lý xem xét chuyển lớp.';
                let title = `⚠️ CẢNH BÁO CHUYỂN XUỐNG LỚP (Phần ${checkParts.join(' & ')})`;
                if (badEvals.length > 0) {
                    const statusCount = {};
                    const locCount = {};
                    badEvals.forEach(h => {
                        let st = h.status;
                        if (h.location === 'Khảo Bài') {
                            if (st === 'Kém (K)') st = 'Không thuộc';
                            if (st === 'Tốt (T)') st = 'Thuộc';
                        }
                        statusCount[st] = (statusCount[st]||0)+1;
                        if (h.location) locCount[h.location] = (locCount[h.location]||0)+1;
                    });
                    const topStatus = Object.keys(statusCount).sort((a,b) => statusCount[b]-statusCount[a])[0];
                    const topLoc = Object.keys(locCount).sort((a,b) => locCount[b]-locCount[a])[0];
                    
                    const locText = topLoc ? `ở [${topLoc}] ` : '';
                    reason = `Học sinh liên tục bị ${topStatus} ${locText}nhiều lần`;
                    
                    if (topLoc === 'Khảo Bài') {
                        title = `⚠️ CẢNH BÁO KHẢO BÀI (Phần ${checkParts.join(' & ')})`;
                        if (statusCount['Không thuộc'] >= 3) {
                            suggestion = 'Đề nghị xem xét báo phụ huynh.';
                        } else {
                            suggestion = 'Cần chú ý nhắc nhở học sinh học bài.';
                        }
                    }
                }
                warningBanner = `<div style="background:#fef2f2; border-left:4px solid #ef4444; padding:10px; margin-bottom:15px; border-radius:4px;"><strong style="color:#b91c1c;">${title}:</strong> <br><span style="font-size:13px; color:#7f1d1d;">${reason}. ${suggestion}</span></div>`;
            } else if (cachedSt.trend_status === 'up') {
                const checkParts = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
                const goodEvals = relevantHistory.filter(h => checkParts.includes(h.part) && ['Đúng', 'Tốt (T)'].includes(h.status)).slice(0,3);
                let reason = 'Học sinh liên tục đạt kết quả Tốt';
                if (goodEvals.length > 0) {
                    const statusCount = {};
                    const locCount = {};
                    goodEvals.forEach(h => {
                        let st = h.status;
                        if (h.location === 'Khảo Bài') {
                            if (st === 'Kém (K)') st = 'Không thuộc';
                            if (st === 'Tốt (T)') st = 'Thuộc';
                        }
                        statusCount[st] = (statusCount[st]||0)+1;
                        if (h.location) locCount[h.location] = (locCount[h.location]||0)+1;
                    });
                    const topStatus = Object.keys(statusCount).sort((a,b) => statusCount[b]-statusCount[a])[0];
                    const topLoc = Object.keys(locCount).sort((a,b) => locCount[b]-locCount[a])[0];
                    
                    const locText = topLoc ? `ở [${topLoc}] ` : '';
                    reason = `Học sinh liên tục đạt ${topStatus} ${locText}nhiều lần`;
                }
                warningBanner = `<div style="background:#f0fdf4; border-left:4px solid #10b981; padding:10px; margin-bottom:15px; border-radius:4px;"><strong style="color:#047857;">🏆 KHEN THƯỞNG THĂNG LỚP (Phần ${checkParts.join(' & ')}):</strong> <br><span style="font-size:13px; color:#065f46;">${reason}. Đề nghị quản lý xem xét thăng lớp.</span></div>`;
            }
            
            let html = `
                <div style="margin-bottom: 20px;">
                    <h4 style="margin:0 0 5px 0; font-size:22px; color:#1e293b;">${st.name || st.fullName || 'Chưa rõ tên'}</h4>
                    <div style="font-size:13px; color:#64748b; margin-bottom: 15px;">
                        Mã HS: <b>${st.code || 'N/A'}</b> | Lớp: <b>${st.className || 'N/A'}</b>
                    </div>
                    

                    ${(function(){
                        if (!res.exams || res.exams.length === 0) return '';
                        const seen = new Set();
                        const unique = [];
                        [...res.exams].reverse().forEach(e => {
                            if(!seen.has(e.examName)) {
                                seen.add(e.examName);
                                unique.push(e);
                            }
                        });
                        let examHtml = `<h4 style="margin: 20px 0 10px 0; color:#8b5cf6; font-size:15px;"><i class="fa-solid fa-star"></i> Lịch sử điểm thi</h4>`;
                        examHtml += unique.map(e => `
                          <div style="border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
                            <strong style="color: #3b82f6;">${e.examName}</strong>: <span style="font-weight:bold; color:#0f172a;">${e.score}</span>
                            <div style="font-size: 12px; color: #475569; margin-top: 4px; font-style: italic;">${e.comment || ''}</div>
                          </div>
                        `).join('');
                        return examHtml;
                    })()}

                    ${warningBanner}
                    
                    <div style="font-size:12px; color:#94a3b8; font-weight:bold; margin-bottom:8px; text-transform:uppercase;">THÔNG TIN CHUNG</div>
                    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:6px;">
                        <span style="color:#64748b;">Số điện thoại:</span>
                        <span style="font-weight:bold; color:#1e293b;">${st.phone1 || 'Chưa có'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:6px;">
                        <span style="color:#64748b;">Trường chính:</span>
                        <span style="font-weight:bold; color:#1e293b;">${st.parentName || 'Chưa có'}</span>
                    </div>
                </div>
            `;
            
            if (res.absences && res.absences.length > 0) {
                html += `<h4 style="margin-bottom:10px; color:#ef4444; font-size:14px;"><i class="fa-solid fa-triangle-exclamation"></i> Lịch sử gần đây (Chuyên cần)</h4>`;
                html += res.absences.slice(0,5).map(a => {
                    const evLink = a.evidenceUrl ? `<a href="${a.evidenceUrl}" target="_blank" style="margin-left:8px; font-size:12px; color:#3b82f6; text-decoration: none;"><i class="fa-solid fa-image"></i> Ảnh</a>` : '';
                    return `
                    <div class="history-item" style="padding: 10px; margin-bottom: 8px; border: 1px solid #fee2e2; border-radius: 6px; background: #fef2f2;">
                        <div class="history-date" style="color: #991b1b; font-weight:bold;">${new Date(a.date).toLocaleDateString('vi-VN')}</div>
                        <div class="history-title" style="color: #991b1b;">Trạng thái: ${
                            ((a.absenceStatus === 'Về sớm' || a.absenceStatus === 'Đi trễ') && a.initialReason && (a.initialReason.startsWith('Về sớm lúc') || a.initialReason.startsWith('Đi trễ lúc'))) 
                            ? `<b>${a.initialReason}</b>` 
                            : `<b>${a.absenceStatus || 'Không rõ'}</b>${(a.initialReason && a.initialReason !== a.absenceStatus) ? ' (' + a.initialReason + ')' : ''}`
                        }${evLink}</div>
                    </div>
                `}).join('');
            }
            
            
html += `<h4 style="margin: 20px 0 10px 0; color:#3b82f6; font-size:15px;"><i class="fa-solid fa-clock-rotate-left"></i> Lịch sử đánh giá</h4>`;
            
            if (!res.history || res.history.length === 0) {
                html += `<div style="font-size:13px; color:#94a3b8; font-style:italic;">Chưa có dữ liệu đánh giá.</div>`;
            } else {
                // Group history by date
                const grouped = {};
                res.history.forEach(h => {
                    const d = h.date || 'Không rõ ngày';
                    if (!grouped[d]) grouped[d] = [];
                    grouped[d].push(h);
                });
                
                for (const dateKey in grouped) {
                    const dateStr = dateKey !== 'Không rõ ngày' ? new Date(dateKey).toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}) : dateKey;
                    
                    html += `<div style="margin-top: 15px; margin-bottom: 10px; font-weight:bold; font-size: 15px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px;">Ngày ${dateStr}</div>`;
                    
                    const deduplicated = {};
                    grouped[dateKey].forEach(h => {
                        const key = `${h.part}|${h.location}|${h.status}|${h.lessonName}`;
                        if(!deduplicated[key]) deduplicated[key] = {...h, count: 1};
                        else deduplicated[key].count++;
                    });
                    
                    html += Object.values(deduplicated).map(h => {
                        let displayStatus = h.status;
                        if (h.location === 'Khảo Bài') {
                            if (displayStatus === 'Kém (K)') displayStatus = 'Không thuộc';
                            if (displayStatus === 'Tốt (T)') displayStatus = 'Thuộc';
                        }
                        let statusHtml = displayStatus;
                        if(h.status.includes('Sai') || h.status.includes('Kém') || h.status.includes('Chép')) statusHtml = `<span style="color:#ef4444; font-weight:bold;">${displayStatus}</span>`;
                        if(h.status.includes('Đúng') || h.status.includes('Tốt')) statusHtml = `<span style="color:#10b981; font-weight:bold;">${displayStatus}</span>`;
                        
                        const countText = h.count > 1 ? ` <span style="color:#ef4444; font-weight:bold;">(x${h.count})</span>` : '';
                        const lessonName = h.lessonName ? ` <span style="color:#94a3b8; font-weight:normal;">(${h.lessonName})</span>` : '';
                        const locText = h.location ? `[${h.location}] ` : '';
                        const evLink = h.evidenceUrl ? `<a href="${h.evidenceUrl}" target="_blank" style="margin-left:8px; font-size:12px; color:#3b82f6; text-decoration: none;"><i class="fa-solid fa-image"></i> Ảnh</a>` : '';
                        
                        return `
                        <div class="history-item" style="padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            <div class="history-title" style="font-size: 14px; color: #1e293b;">${locText}<b>${h.part}</b>: ${statusHtml}${countText}${lessonName}${evLink}</div>
                        </div>`;
                    }).join('');
                }
            }
            
            document.getElementById('panelContent').innerHTML = html;
        } catch(e) {
            document.getElementById('panelContent').innerHTML = '<div style="color:red; text-align:center;">Lỗi tải dữ liệu.</div>';
        }
    }

    
    async function markAsNotified(studentId) {
        if (!confirm('Đánh dấu là đã báo phụ huynh? Hành động này sẽ tạo một mốc lịch sử và xóa cảnh báo hiện tại.')) return;
        try {
            const evUrl = window.studentEvidenceUrls ? window.studentEvidenceUrls[studentId] : '';
            await apiRequest('/api/evaluations', 'POST', {
                sessionId: currentSession ? currentSession.id : null,
                studentId,
                location: 'Hệ thống',
                status: 'Đã báo phụ huynh',
                part: 'Thông báo',
                evidenceUrl: evUrl || ''
            });
            showToast('Đã lưu mốc lịch sử thành công!');
            // Reload the history panel
            setTimeout(() => openHistoryPanel(studentId), 500);
        } catch(e) {
            console.error(e);
            showToast('Lỗi: ' + e.message);
        }
    }

    function closeHistoryPanel() {
        document.getElementById('panelOverlay').classList.remove('active');
        document.getElementById('historyPanel').classList.remove('active');
    }

    async function endShift() {
        const lessonName = document.getElementById('editLessonName').value.trim();
        const exercises = document.getElementById('editExercises').value.trim();
        
        if (!lessonName || !exercises) {
            showToast("Giáo viên vui lòng nhập tên bài học và bài tập khi kết thúc ca.");
            return;
        }
        
        await updateLessonInfo();
        if(confirm("Bạn có chắc chắn muốn kết thúc ca dạy này?")) {
            location.reload();
        }
    }
