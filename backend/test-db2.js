const mysql = require('mysql2/promise');
require('dotenv').config();
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'callcenter'
  });
  const [tickets] = await conn.query('SELECT * FROM tickets');
  console.log('Tickets count:', tickets.length);
  if (tickets.length > 0) {
    console.log('Sample ticket:', tickets[0]);
  }
  conn.end();
}
main().catch(console.error);
