</script>
</head>
<body>

<div class="panel-overlay" id="panelOverlay" onclick="closeHistoryPanel()"></div>
<div class="history-panel" id="historyPanel">
    <div class="panel-header">
        <h3 style="margin:0;" id="panelTitle">Thông tin Học sinh</h3>
        <button onclick="closeHistoryPanel()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#64748b;">&times;</button>
    </div>
    <div class="panel-content" id="panelContent">
        Đang tải dữ liệu...
    </div>
</div>

<div class="app-container">
    <div class="header-top">
        <a href="/" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Trở về</a>
        <div class="ca-banner" id="caBannerInfo" style="display:none;"></div>
    </div>

    <div id="screen-1">
        <h2 style="text-align: center;">Thông tin ca dạy</h2>
        
        <div class="flex-row">
            <div class="form-group">
                <label>Bạn đang dạy Ca mấy?</label>
                <select id="shiftName">
                    <option value="Ca 1">Ca 1</option>
                    <option value="Ca 2">Ca 2</option>
                    <option value="Ca 3">Ca 3</option>
                </select>
            </div>
            <div class="form-group">
                <label>Phần dạy</label>
                <select id="partName">
                    <option value="H1">H1</option>
                    <option value="H2">H2</option>
                    <option value="H3">H3</option>
                    <option value="H4">H4</option>
                    <option value="Đ1">Đ1</option>
                    <option value="Đ2">Đ2</option>
                    <option value="Đ3">Đ3</option>
                    <option value="Đ4">Đ4</option>
                    <option value="TH">TH</option>
                </select>
            </div>
        </div>

        <div class="form-group">
            <label>Tên Giáo viên</label>
            <input type="text" id="teacherName" placeholder="VD: Cô Trang">
        </div>

        <div class="form-group">
            <label>Lớp học</label>
            <select id="className">
                <option value="">-- Đang tải danh sách lớp --</option>
            </select>
        </div>
        

        <button class="btn-primary" id="startBtn" onclick="startShift()">Bắt đầu vào lớp</button>
    </div>

    <div id="screen-2">
        <div style="border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 10px;">
            <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 15px;">
                <h2 id="header-title" style="margin:0; font-size:24px; color:#1e293b;">Đang tải...</h2>
                <button class="btn-success" id="submitAttendanceBtn" style="width:auto; padding: 8px 15px; font-size:14px;" onclick="submitAttendance()">Chốt Điểm Danh</button>
            </div>

            <div class="info-banner">
                <div class="inline-edit-group">
                    <label>Bài dạy:</label>
                    <input type="text" id="editLessonName" onchange="updateLessonInfo()" />
                </div>
                <div class="inline-edit-group">
                    <label>Bài tập:</label>
                    <input type="text" id="editExercises" onchange="updateLessonInfo()" />
                </div>
            </div>
        </div>

        <div id="studentListContainer">
            <div style="text-align:center; padding: 20px; color:#64748b;">Đang tải danh sách học sinh...</div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-top: 20px; gap: 15px;">
            <button class="btn-secondary" onclick="cancelCurrentSession()">Hủy ca dạy này</button>
            <button class="btn-danger" style="margin-top: 0;" onclick="endShift()">Kết thúc ca dạy</button>
        </div>
    </div>
</div>

<script>