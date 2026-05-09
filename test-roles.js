const mysql = require('mysql2/promise');
require('dotenv').config({path: './backend/.env'});

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });
  const [roles] = await conn.execute('SELECT * FROM roles;');
  const [users] = await conn.execute('SELECT id, username, roleId FROM users WHERE username="admin";');
  console.log("Roles:", roles);
  console.log("Admin user:", users);
  conn.end();
}
run();
