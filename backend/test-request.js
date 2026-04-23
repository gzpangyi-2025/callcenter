const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const token = JSON.parse(data).data.accessToken;
    
    const req2 = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/tickets?pageSize=50',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res2) => {
      let data2 = '';
      res2.on('data', chunk => data2 += chunk);
      res2.on('end', () => console.log('Tickets response:', res2.statusCode, data2.substring(0, 300)));
    });
    req2.end();
  });
});
req.write(JSON.stringify({ username: 'admin', password: 'password' }));
req.end();
