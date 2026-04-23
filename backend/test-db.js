const mysql = require('mysql2/promise');
require('dotenv').config();
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'callcenter'
  });
  const [roles] = await conn.query('SELECT * FROM roles');
  console.log('Roles:', roles);
  
  // Find admin role
  const adminRole = roles.find(r => r.name === 'admin');
  if (adminRole) {
    await conn.query('UPDATE users SET roleId = ? WHERE username = "admin"', [adminRole.id]);
    console.log(`Updated admin user to roleId ${adminRole.id}`);
  }
  
  const [users] = await conn.query('SELECT u.id, u.username, u.roleId, r.name as roleName FROM users u LEFT JOIN roles r ON u.roleId = r.id');
  console.log('Users:', users);
  
  conn.end();
}
main().catch(console.error);
