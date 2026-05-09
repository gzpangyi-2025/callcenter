const { DataSource } = require('typeorm');
require('dotenv').config({path: '.env'});

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
});

ds.initialize().then(async () => {
  const [roles] = await ds.query('SELECT * FROM roles;');
  const [users] = await ds.query('SELECT id, username, roleId FROM users WHERE username="admin";');
  console.log("Roles:", roles);
  console.log("Admin user:", users);
  process.exit(0);
}).catch(console.error);
