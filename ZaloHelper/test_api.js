const http = require('http');

const data = JSON.stringify({
  message: 'Test message',
  link: 'zalo://conversation?id=123'
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/local-zalo/open-paste',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', e => console.error('Error:', e));
req.write(data);
req.end();
