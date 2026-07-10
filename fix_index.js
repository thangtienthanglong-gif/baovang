const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// The modal is currently at the very end of the file.
const modalStart = html.indexOf('<!-- Modal Quản lý nhân sự -->');
if (modalStart !== -1) {
  const modalHtml = html.substring(modalStart);
  html = html.substring(0, modalStart);
  
  // Add <body> tag if it's missing (we accidentally removed it)
  if (!html.includes('<body')) {
    html = html.replace('  </head>', '  </head>\n<body>');
  }
  
  // Add </body></html> if missing
  if (!html.includes('</body>')) {
    html += '\n</body>\n</html>';
  }
  
  // Place modal before the closing body tag
  html = html.replace('</body>', modalHtml + '\n</body>');
  
  // Also, there is another issue: earlier I placed socket.io script inside modalHtml?
  // Let's make sure script tags are properly at the end
}

fs.writeFileSync('public/index.html', html);
