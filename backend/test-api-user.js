const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign({
  sub: 2,
  username: 'pangyi',
  role: 'user'
}, process.env.JWT_SECRET || 'callcenter_jwt_secret_key_2026', { expiresIn: '15m' });

const req2 = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/tickets?pageSize=50',
  method: 'GET',
  headers: { 'Authorization': `Bearer ${token}` }
}, (res2) => {
  let data2 = '';
  res2.on('data', c => data2 += c);
  res2.on('end', () => console.log('Tickets response user:', res2.statusCode, data2.length > 300 ? data2.substring(0, 300) + '...' : data2));
});
req2.end();
