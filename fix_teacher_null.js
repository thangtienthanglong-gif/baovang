const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

code = code.replace(
  "const teacherName = document.getElementById('transferTeacherName').value.trim();",
  "const teacherInput = document.getElementById('transferTeacherName');\n  const teacherName = teacherInput ? teacherInput.value.trim() : '';"
);

fs.writeFileSync('public/app.js', code, 'utf8');
console.log("Updated app.js safe teacher name extraction.");
