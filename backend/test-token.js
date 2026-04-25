const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 1, username: 'admin' }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' });
console.log(token);
