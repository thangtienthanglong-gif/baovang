const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

const oldApi = `async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Branch-Id': getActiveBranch(), 'Authorization': 'Bearer ' + getToken() },
    ...options
  });`;

const newApi = `async function api(path, options = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json', 'X-Branch-Id': getActiveBranch(), 'Authorization': 'Bearer ' + getToken() };
  const mergedHeaders = { ...defaultHeaders, ...(options.headers || {}) };
  const response = await fetch(path, {
    ...options,
    headers: mergedHeaders
  });`;

app = app.replace(oldApi, newApi);
fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed api function in app.js');
