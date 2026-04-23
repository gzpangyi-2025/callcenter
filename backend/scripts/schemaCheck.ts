import mysql from 'mysql2/promise';

async function seed() {
  const connection = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'callcenter' });
  const [cats] = await connection.execute('SELECT * FROM ticket_categories;');
  console.log('Categories:', cats);
  process.exit(0);
}

seed().catch(console.error);
