const fs = require('fs');
let index = fs.readFileSync('public/index.html', 'utf8');

const codeGroup = `<div class="form-group" style="margin-bottom: 10px;">
        <label>Mã HS</label>
        <input type="text" id="editStudentCode" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>`;
const newCodeGroup = `<div class="form-group" style="margin-bottom: 10px; display: none;">
        <label>Mã HS</label>
        <input type="text" id="editStudentCode" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>`;
index = index.replace(codeGroup, newCodeGroup);

const classGroup = `<div class="form-group" style="margin-bottom: 10px;">
        <label>Lớp (Không sửa ở đây)</label>
        <input type="text" id="editStudentClass" readonly style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: #e2e8f0; color: #475569;">
      </div>`;
const newClassGroup = `<div class="form-group" style="margin-bottom: 10px; display: none;">
        <label>Lớp (Không sửa ở đây)</label>
        <input type="text" id="editStudentClass" readonly style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: #e2e8f0; color: #475569;">
      </div>`;
index = index.replace(classGroup, newClassGroup);

fs.writeFileSync('public/index.html', index, 'utf8');
console.log('Fixed edit modal visibility');
