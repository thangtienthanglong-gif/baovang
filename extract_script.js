const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.indexOf('</script>');
const scriptBody = html.substring(scriptStart + 8, scriptEnd);
fs.writeFileSync('public/ketbu_eval_script.js', scriptBody, 'utf8');
console.log('Extracted script to ketbu_eval_script.js');
