import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load environment variables from .env file
dotenv.config();

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'callcenter',
  entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
  synchronize: false, // We manually trigger synchronize below
  charset: 'utf8mb4',
});

async function run() {
  try {
    console.log('Connecting to database...');
    await dataSource.initialize();
    console.log('Database connected successfully.');

    console.log('Synchronizing database schema...');
    await dataSource.synchronize();
    console.log('Database schema synchronized successfully!');

    process.exit(0);
  } catch (error) {
    console.error('Error synchronizing database schema:', error);
    process.exit(1);
  }
}

run();
