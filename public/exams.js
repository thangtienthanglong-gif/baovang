let currentExamClass = '';
let currentExamName = '';

document.addEventListener('DOMContentLoaded', () => {
  const openExamSelectBtn = document.getElementById('openExamSelectBtn');
  if (openExamSelectBtn) {
    openExamSelectBtn.addEventListener('click', () => {
      const cls = document.getElementById('filterClass').value;
      if (!cls || cls === 'ALL') {
        toast('Vui lòng chọn một lớp trước.', 'warning');
        return;
      }
      document.getElementById('examSelectClass').value = cls;
      document.getElementById('examSelectModal').style.display = 'flex';
    });
  }

  const examSelectForm = document.getElementById('examSelectForm');
  if (examSelectForm) {
    examSelectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cls = document.getElementById('examSelectClass').value;
      const dropdownValue = document.getElementById('examSelectDropdown').value;
      const customValue = document.getElementById('examCustomName').value;
      
      const examName = dropdownValue === 'Khác...' ? customValue.trim() : dropdownValue;
      if (!examName) {
        toast('Vui lòng nhập tên kỳ thi', 'warning');
        return;
      }
      
      document.getElementById('examSelectModal').style.display = 'none';
      await openExamInput(cls, examName);
    });
  }

  const btnSaveExam = document.getElementById('btnSaveExam');
  if (btnSaveExam) {
    btnSaveExam.addEventListener('click', async () => {
      await saveExamScores();
    });
  }

  const btnSendExamZalo = document.getElementById('btnSendExamZalo');
  if (btnSendExamZalo) {
    btnSendExamZalo.addEventListener('click', async () => {
      await sendExamZalo();
    });
  }

  const exportExamBtn = document.getElementById('exportExamBtn');
  if (exportExamBtn) {
    exportExamBtn.addEventListener('click', async () => {
      const cls = document.getElementById('filterClass').value;
      if (!cls) {
        toast('Vui lòng chọn một lớp để xuất điểm.', 'warning');
        return;
      }
      
      const classStudents = state.students.filter(s => s.className === cls);
      if (classStudents.length === 0) {
        toast('Lớp này chưa có học sinh.', 'warning');
        return;
      }
      
      toast('Đang xuất bảng điểm...', 'info');
      try {
        const exams = await fetchExams(cls);
        
                if (typeof XLSX === 'undefined') {
          toast('Đang tải thư viện Excel, vui lòng thử lại sau...', 'warning');
          return;
        }
        
        const uniqueExamsMap = {};
        exams.forEach(ex => uniqueExamsMap[ex.examName] = ex);
        const uniqueExams = Object.values(uniqueExamsMap);
        
        const data = [];
        // Header
        const headerRow = ["Họ và Tên", "Điện Thoại"];
        uniqueExams.forEach(ex => {
          headerRow.push("Điểm thi");
          headerRow.push("Nhận xét");
        });
        data.push(headerRow);
        
        // Data rows
        classStudents.forEach(student => {
          const row = [student.fullName || student.name || '', student.phone1 || student.phone2 || ''];
          uniqueExams.forEach(ex => {
            const scoreObj = ex.scores.find(s => s.studentId === student.id);
            if (scoreObj) {
              row.push(scoreObj.score || '');
              row.push(scoreObj.comment || '');
            } else {
              row.push('');
              row.push('');
            }
          });
          data.push(row);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // Column widths
        const wscols = [
          {wch: 25}, // Ho va Ten
          {wch: 15}, // Dien thoai
        ];
        uniqueExams.forEach(ex => {
          wscols.push({wch: 10}); // Diem thi
          wscols.push({wch: 35}); // Nhan xet
        });
        ws['!cols'] = wscols;
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Bang Diem");
        XLSX.writeFile(wb, `Bang_Diem_${cls}_${new Date().toISOString().split('T')[0]}.xlsx`);
        
      } catch (e) {
        console.error(e);
        toast('Lỗi khi xuất bảng điểm', 'error');
      }
    });
  }
});

async function fetchExams(className) {
  try {
    const res = await api(`/api/exams?className=${encodeURIComponent(className)}`);
    return res || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function openExamInput(className, examName) {
  currentExamClass = className;
  currentExamName = examName;
  
  document.getElementById('examInputTitle').textContent = `Nhập điểm: ${examName} - ${className}`;
  
  const classStudents = state.students.filter(s => s.className === className);
  
  if (classStudents.length === 0) {
    toast('Lớp này không có học sinh nào.', 'warning');
    return;
  }
  
  const exams = await fetchExams(className);
  const existingExam = exams.find(e => e.examName === examName);
  
  const examInputList = document.getElementById('examInputList');
  let html = '';
  
  const absencesData = await api(`/api/absences?className=${encodeURIComponent(className)}`);
  const classAbsences = absencesData.absences || [];
  
  classStudents.forEach(student => {
    let currentScore = '';
    let autoComment = '';
    
    if (existingExam && existingExam.scores) {
      const scoreObj = existingExam.scores.find(s => s.studentId === student.id);
      if (scoreObj) {
        currentScore = scoreObj.score !== undefined ? scoreObj.score : '';
        autoComment = scoreObj.comment || '';
      }
    }
    
    if (!autoComment) {
      const studentAbs = classAbsences.filter(a => a.studentId === student.id);
      if (studentAbs.length > 0) {
        let kbTot = 0, kbDat = 0, kbKem = 0;
        let bTot = 0, bDat = 0, bKem = 0;
        let vTot = 0, vDat = 0, vKem = 0;
        
        studentAbs.forEach(a => {
          if (a.khaoBai === 'Tốt') kbTot++;
          if (a.khaoBai === 'Đạt') kbDat++;
          if (a.khaoBai === 'Kém') kbKem++;
          
          if (a.bang === 'Tốt') bTot++;
          if (a.bang === 'Đạt') bDat++;
          if (a.bang === 'Kém') bKem++;
          
          if (a.vo === 'Tốt') vTot++;
          if (a.vo === 'Đạt') vDat++;
          if (a.vo === 'Kém') vKem++;
        });
        
        let parts = [];
        if (kbTot || kbDat || kbKem) parts.push(`Khảo bài: ${kbTot} Tốt, ${kbDat} Đạt, ${kbKem} Kém`);
        if (bTot || bDat || bKem) parts.push(`Bảng: ${bTot} Tốt, ${bDat} Đạt, ${bKem} Kém`);
        if (vTot || vDat || vKem) parts.push(`Vở: ${vTot} Tốt, ${vDat} Đạt, ${vKem} Kém`);
        
        if (parts.length > 0) {
          autoComment = parts.join(' | ');
        } else {
          autoComment = "Chưa có dữ liệu đánh giá trên lớp.";
        }
      } else {
        autoComment = "Chưa có dữ liệu đánh giá trên lớp.";
      }
    }
    
    html += `
      <div class="exam-student-row" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 10px; background: #fff;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
          <strong style="font-size: 15px; color: #0f172a;">${escapeHtml(student.fullName)}</strong>
          <input type="text" placeholder="Điểm" class="exam-score-input" data-studentid="${student.id}" value="${currentScore}" style="width: 120px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-weight: bold; text-align: center;">
        </div>
        <div>
          <label style="font-size: 12px; color: #64748b; margin-bottom: 4px; display: block;">Nhận xét (Tổng kết quá trình):</label>
          <textarea class="exam-comment-input" data-studentid="${student.id}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; color: #475569; min-height: 40px; box-sizing: border-box; resize: vertical;">${escapeHtml(autoComment)}</textarea>
        </div>
      </div>
    `;
  });
  
  examInputList.innerHTML = html;
  document.getElementById('examInputModal').style.display = 'flex';
}

async function saveExamScores() {
  const scores = [];
  document.querySelectorAll('.exam-score-input').forEach(input => {
    const studentId = input.getAttribute('data-studentid');
    const score = input.value;
    const commentInput = document.querySelector(`.exam-comment-input[data-studentid="${studentId}"]`);
    const comment = commentInput ? commentInput.value : '';
    
    if (score !== '') {
      scores.push({ studentId, score: score, comment });
    }
  });
  
  if (scores.length === 0) {
    toast('Chưa có điểm nào được nhập.', 'warning');
    return;
  }
  
  const exams = await fetchExams(currentExamClass);
  const existingExam = exams.find(e => e.examName === currentExamName);
  const examId = existingExam ? existingExam.id : null;
  
  try {
    await api('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: examId,
        className: currentExamClass,
        examName: currentExamName,
        date: state.today,
        scores
      })
    });
    
    toast('Lưu bảng điểm thành công!', 'success');
    document.getElementById('examInputModal').style.display = 'none';
  } catch (err) {
    toast('Lỗi khi lưu bảng điểm', 'error');
    console.error(err);
  }
}

async function sendExamZalo() {
  await saveExamScores();
  
  const scores = [];
  document.querySelectorAll('.exam-score-input').forEach(input => {
    const studentId = input.getAttribute('data-studentid');
    const score = input.value;
    const commentInput = document.querySelector(`.exam-comment-input[data-studentid="${studentId}"]`);
    const comment = commentInput ? commentInput.value : '';
    
    if (score !== '') {
      scores.push({ studentId, score, comment });
    }
  });
  
  if (scores.length === 0) {
    toast('Chưa có điểm nào để gửi.', 'warning');
    return;
  }
  
  let queueCount = 0;
  
  scores.forEach(s => {
    const student = state.students.find(st => st.id === s.studentId);
    if (!student) return;
    
    const phone = student.phone1 || student.phone2;
    if (!phone) return;
    
    let message = `Trung tâm trân trọng thông báo kết quả kỳ thi [${currentExamName}] của học sinh [${student.fullName || student.name}]:\n\n`;
    message += `- Điểm số kỳ thi: ${s.score}/10\n`;
    message += `- Quá trình học tập trên lớp vừa qua:\n  ${s.comment}\n\n`;
    message += `(Đánh giá tự động từ hệ thống: Kết quả này phản ánh thái độ học tập trên lớp. Chúc gia đình một ngày tốt lành!)`;
    
    const key = `exam_${student.id}_${Date.now()}`;
    const payload = {
      phone,
      message,
      type: 'Exam',
      studentName: student.fullName || student.name,
      studentId: student.id,
      timestamp: Date.now()
    };
    
    localStorage.setItem(key, JSON.stringify(payload));
    queueCount++;
  });
  
  if (queueCount > 0) {
    toast(`Đã đưa ${queueCount} tin nhắn báo điểm vào hàng xử lý Zalo.`, 'success');
    document.getElementById('examInputModal').style.display = 'none';
    if (typeof loadZaloQueue === 'function') loadZaloQueue();
  } else {
    toast('Không có học sinh nào có số điện thoại hợp lệ để gửi Zalo.', 'warning');
  }
}
