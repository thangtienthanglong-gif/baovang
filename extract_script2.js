const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

const regex = /<script>([\s\S]*?)<\/script>/g;
let match;
let count = 1;
while ((match = regex.exec(html)) !== null) {
  fs.writeFileSync(`public/ketbu_eval_script_${count}.js`, match[1], 'utf8');
  console.log(`Extracted script ${count}`);
  count++;
}
