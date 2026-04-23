const http = require('http');

const optionsLogin = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};

const req = http.request(optionsLogin, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    let token;
    try {
      token = JSON.parse(data).data.accessToken;
    } catch(e) {
      console.log('Login raw response:', data);
      return;
    }
    console.log('Got token:', token ? 'YES' : 'NO');
    
    const req2 = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/tickets?pageSize=50',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res2) => {
      let data2 = '';
      res2.on('data', c => data2 += c);
      res2.on('end', () => console.log('Tickets:', data2.length > 200 ? data2.substring(0, 200) + '...' : data2));
    });
    req2.end();
  });
});
req.write(JSON.stringify({ username: 'admin', password: 'password' }));
req.end();
