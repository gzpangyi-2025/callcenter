import { DataSource } from 'typeorm';
import { Ticket } from '../src/entities/ticket.entity';

const AppDataSource = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  username: 'callcenter',
  password: 'callcenter_123',
  database: 'callcenter',
  entities: [Ticket],
});

async function run() {
  await AppDataSource.initialize();
  const qb = AppDataSource.getRepository(Ticket).createQueryBuilder('t')
      .select('t.category3', 'category3')
      .addSelect('COUNT(*)', 'total')
      .where('t.category2 = :category2', { category2: 'X86服务器' })
      .groupBy('t.category3')
      .orderBy('total', 'DESC');
  console.log("Cat3 Result:", await qb.getRawMany());
  process.exit(0);
}
run();
