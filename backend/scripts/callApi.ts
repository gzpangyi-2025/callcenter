import * as http from 'http';

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    console.log(raw);
    const parsed = JSON.parse(raw);
    const token = parsed.data && parsed.data.access_token ? parsed.data.access_token : parsed.access_token;
    
    if(!token) {
        console.log("NO TOKEN!");
        return;
    }
    
    const req2 = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/report/summary',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res2) => {
      let raw2 = '';
      res2.on('data', c => raw2 += c);
      res2.on('end', () => console.log('Summary Result:', raw2));
    });
    req2.end();
  });
});
req.write(JSON.stringify({ username: "admin", password: "password" }));
req.end();
