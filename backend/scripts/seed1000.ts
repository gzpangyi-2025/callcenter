import mysql from 'mysql2/promise';

async function generateTickets() {
  const connection = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'callcenter' });
  
  // Get all valid category combinations from ticket_categories table
  const [categoriesRaw] = await connection.execute('SELECT level1 as category1, level2 as category2, level3 as category3 FROM ticket_categories WHERE level3 IS NOT NULL;');
  const categories: any[] = categoriesRaw as any[];
  
  if (categories.length === 0) {
    console.log('No categories found to use.');
    process.exit(1);
  }

  // Users we have
  const userIds = [1, 2, 3];
  
  const insertPromises = [];
  
  console.log(`Starting to generate 1000 tickets...`);
  for (let i = 0; i < 1000; i++) {
    // Random category
    const cat = categories[Math.floor(Math.random() * categories.length)];
    
    // Random past dates (up to 3 years back ~ 1095 days)
    const daysAgo = Math.floor(Math.random() * 1095);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.random() * 24 * 3600 * 1000);
    // Closed a few days after creation
    const closedAt = new Date(createdAt.getTime() + (Math.random() * 3 + 0.1) * 24 * 60 * 60 * 1000);
    
    // Format to MySQL datetime string
    const format = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

    const creatorId = userIds[Math.floor(Math.random() * userIds.length)];
    const assigneeId = userIds[Math.floor(Math.random() * userIds.length)];
    
    const ticketNo = `RND-${Date.now()}-${i}`;
    
    insertPromises.push(
      connection.execute(`
        INSERT INTO tickets (ticketNo, title, description, status, type, creatorId, assigneeId, category1, category2, category3, createdAt, closedAt, updatedAt)
        VALUES (?, ?, ?, 'closed', 'other', ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        ticketNo, `Mock Ticket ${ticketNo} [${cat.category2}]`, `Automated test ticket for historical data simulation spanning 3 years. Focus on ${cat.category3}.`,
        creatorId, assigneeId, cat.category1, cat.category2, cat.category3, format(createdAt), format(closedAt), format(closedAt)
      ])
    );
    
    if (insertPromises.length === 100) {
       await Promise.all(insertPromises);
       insertPromises.length = 0;
       console.log(`Inserted ${i+1} tickets...`);
    }
  }
  
  if (insertPromises.length > 0) {
    await Promise.all(insertPromises);
  }
  
  console.log('Successfully inserted 1000 historical mock tickets.');
  process.exit(0);
}

generateTickets().catch(console.error);
