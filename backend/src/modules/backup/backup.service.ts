import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchService } from '../search/search.service';
import { FilesService } from '../files/files.service';
import { join, extname } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, copyFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import * as archiver from 'archiver';
import { createWriteStream, createReadStream } from 'fs';
import * as unzipper from 'unzipper';

const ossDir = join(process.cwd(), 'oss');
const backupsDir = join(process.cwd(), 'backups');

// Image extensions for classification
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);

// Regex to extract OSS filenames from content (matches /api/files/static/xxx.ext)
const OSS_REF_REGEX = /\/api\/files\/static\/([a-f0-9-]+\.[a-z0-9]+)/gi;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly searchService: SearchService,
    private readonly filesService: FilesService,
  ) {
    // Ensure backups directory exists
    if (!existsSync(backupsDir)) {
      mkdirSync(backupsDir, { recursive: true });
    }
  }

  /**
   * Collect all OSS filenames referenced anywhere in the database
   */
  private async collectReferencedFiles(): Promise<Set<string>> {
    const referenced = new Set<string>();

    const extractFromContent = (content: string) => {
      if (!content) return;
      let match: RegExpExecArray | null;
      const regex = new RegExp(OSS_REF_REGEX.source, 'gi');
      while ((match = regex.exec(content)) !== null) {
        referenced.add(match[1]);
      }
    };

    // 1. messages.fileUrl (chat images & files)
    try {
      const messages = await this.dataSource.query(
        `SELECT fileUrl FROM messages WHERE fileUrl IS NOT NULL AND fileUrl != ''`
      );
      for (const msg of messages) {
        if (msg.fileUrl) {
          const filename = msg.fileUrl.split('/').pop();
          if (filename) referenced.add(filename);
        }
      }
    } catch (err) {
      this.logger.warn('Failed to scan messages for file references', err);
    }

    // 2. posts.content (BBS post body with embedded images)
    try {
      const posts = await this.dataSource.query(
        `SELECT content FROM posts WHERE content IS NOT NULL`
      );
      for (const post of posts) {
        extractFromContent(post.content);
      }
    } catch (err) {
      this.logger.warn('Failed to scan posts for file references', err);
    }

    // 3. post_comments.content
    try {
      const comments = await this.dataSource.query(
        `SELECT content FROM post_comments WHERE content IS NOT NULL`
      );
      for (const comment of comments) {
        extractFromContent(comment.content);
      }
    } catch (err) {
      this.logger.warn('Failed to scan post_comments for file references', err);
    }

    // 4. knowledge_docs.content + analysisImgUrl + flowImgUrl
    try {
      const docs = await this.dataSource.query(
        `SELECT content, analysisImgUrl, flowImgUrl FROM knowledge_docs`
      );
      for (const doc of docs) {
        extractFromContent(doc.content);
        if (doc.analysisImgUrl) {
          const fn = doc.analysisImgUrl.split('/').pop();
          if (fn) referenced.add(fn);
        }
        if (doc.flowImgUrl) {
          const fn = doc.flowImgUrl.split('/').pop();
          if (fn) referenced.add(fn);
        }
      }
    } catch (err) {
      this.logger.warn('Failed to scan knowledge_docs for file references', err);
    }

    // 5. users.avatar
    try {
      const users = await this.dataSource.query(
        `SELECT avatar FROM users WHERE avatar IS NOT NULL AND avatar != ''`
      );
      for (const user of users) {
        if (user.avatar) {
          const fn = user.avatar.split('/').pop();
          if (fn) referenced.add(fn);
        }
      }
    } catch (err) {
      this.logger.warn('Failed to scan users for avatar references', err);
    }

    return referenced;
  }

  /**
   * Get list of orphan files (files in oss/ not referenced by any DB record)
   */
  async getOrphanFiles(): Promise<{ files: string[]; count: number; totalSize: number }> {
    if (!existsSync(ossDir)) {
      return { files: [], count: 0, totalSize: 0 };
    }

    const allFiles = readdirSync(ossDir).filter(f => {
      try { return statSync(join(ossDir, f)).isFile(); } catch { return false; }
    });

    const referenced = await this.collectReferencedFiles();

    const orphans: string[] = [];
    let totalSize = 0;

    for (const f of allFiles) {
      if (!referenced.has(f)) {
        orphans.push(f);
        try {
          totalSize += statSync(join(ossDir, f)).size;
        } catch { /* skip */ }
      }
    }

    return { files: orphans, count: orphans.length, totalSize };
  }

  /**
   * Delete all orphan files from oss/ directory
   */
  async cleanOrphanFiles(): Promise<{ deletedCount: number; freedSize: number }> {
    const { files, totalSize } = await this.getOrphanFiles();
    let deletedCount = 0;

    for (const f of files) {
      try {
        unlinkSync(join(ossDir, f));
        deletedCount++;
      } catch (err) {
        this.logger.warn(`Failed to delete orphan file: ${f}`, err);
      }
    }

    this.logger.log(`Cleaned ${deletedCount} orphan files, freed ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    return { deletedCount, freedSize: totalSize };
  }

  /**
   * 检测 COS 存储中的孤儿文件（在 COS 中存在但数据库中没有引用的对象）
   */
  async getCosOrphanFiles(): Promise<{ files: string[]; count: number }> {
    try {
      const [cosKeys, referenced] = await Promise.all([
        this.filesService.listAllCosKeys(),
        this.collectReferencedFiles(),
      ]);

      const orphans = cosKeys.filter(key => !referenced.has(key));
      return { files: orphans, count: orphans.length };
    } catch (err) {
      this.logger.warn('Failed to compute COS orphan stats', err);
      return { files: [], count: 0 };
    }
  }

  /**
   * 删除 COS 存储中的所有孤儿文件
   */
  async cleanCosOrphanFiles(): Promise<{ deletedCount: number; failedCount: number }> {
    const { files } = await this.getCosOrphanFiles();
    this.logger.log(`Deleting ${files.length} COS orphan files...`);
    const result = await this.filesService.deleteCosObjects(files);
    this.logger.log(`COS orphan cleanup: deleted=${result.deleted}, failed=${result.failed}`);
    return { deletedCount: result.deleted, failedCount: result.failed };
  }

  /**
   * Helper: extract OSS filenames from HTML/Markdown content string
   */
  static extractOssFilenames(content: string): string[] {
    if (!content) return [];
    const filenames: string[] = [];
    const regex = new RegExp(OSS_REF_REGEX.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      filenames.push(match[1]);
    }
    return filenames;
  }

  /**
   * Helper: delete a list of OSS files (fire-and-forget safe)
   */
  static deleteOssFiles(filenames: string[], logger?: Logger): void {
    for (const f of filenames) {
      try {
        const fPath = join(ossDir, f);
        if (existsSync(fPath)) {
          unlinkSync(fPath);
          logger?.debug(`Deleted OSS file: ${f}`);
        }
      } catch (err) {
        logger?.warn(`Failed to delete OSS file: ${f}`, err);
      }
    }
  }

  /**
   * Get current system data statistics for the UI
   */
  async getStats() {
    const tableNames = await this.getAllTableNames();
    const recordCounts: Record<string, number> = {};
    let totalRecords = 0;

    for (const table of tableNames) {
      const result = await this.dataSource.query(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      const count = parseInt(result[0].cnt, 10);
      recordCounts[table] = count;
      totalRecords += count;
    }

    // OSS file stats from FilesService
    let imageCount = 0;
    let fileCount = 0;
    let imageSize = 0;
    let fileSize = 0;
    let provider = 'local';
    
    try {
      const stats = await this.filesService.getStorageStats();
      imageCount = stats.imageCount;
      imageSize = stats.imageSize;
      fileCount = stats.fileCount;
      fileSize = stats.fileSize;
      provider = stats.provider;
    } catch (err) {
      this.logger.warn('Failed to fetch storage stats', err);
    }

    // Orphan file stats
    let orphanCount = 0;
    let orphanSize = 0;
    
    // 只有在使用本地存储时才计算孤儿文件（COS因为费用/限制原因不全量拉取计算孤儿）
    if (provider === 'local') {
      try {
        const orphanInfo = await this.getOrphanFiles();
        orphanCount = orphanInfo.count;
        orphanSize = orphanInfo.totalSize;
      } catch (err) {
        this.logger.warn('Failed to compute orphan file stats', err);
      }
    }

    return {
      code: 0,
      data: {
        tables: tableNames,
        tableCount: tableNames.length,
        recordCounts,
        totalRecords,
        imageCount,
        imageSize,
        fileCount,
        fileSize,
        orphanCount,
        orphanSize,
        provider,
      },
    };
  }

  /**
   * Create a backup ZIP file
   */
  async createBackup(options: {
    includeImages?: boolean;
    includeFiles?: boolean;
    includeAuditLogs?: boolean;
  }): Promise<{ code: number; data: { filename: string; size: number } }> {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `backup_callcenter_${timestamp}.zip`;
    const zipPath = join(backupsDir, filename);

    this.logger.log(`Starting backup: ${filename}, options: ${JSON.stringify(options)}`);

    return new Promise(async (resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver.default('zip', { zlib: { level: 6 } });

      output.on('close', () => {
        const size = archive.pointer();
        this.logger.log(`Backup completed: ${filename}, size: ${(size / 1024 / 1024).toFixed(2)} MB`);
        resolve({ code: 0, data: { filename, size } });
      });

      archive.on('error', (err) => {
        this.logger.error('Backup archive error', err);
        reject(err);
      });

      archive.pipe(output);

      // 1. Export all database tables
      const tableNames = await this.getAllTableNames();
      const excludeTables: string[] = [];
      if (!options.includeAuditLogs) {
        excludeTables.push('audit_logs');
      }

      const targetTables = tableNames.filter(t => !excludeTables.includes(t));
      const tableRecordCounts: Record<string, number> = {};
      let totalRecords = 0;

      for (const table of targetTables) {
        try {
          const rows = await this.dataSource.query(`SELECT * FROM \`${table}\``);
          const json = JSON.stringify(rows, null, 2);
          archive.append(json, { name: `database/${table}.json` });
          tableRecordCounts[table] = rows.length;
          totalRecords += rows.length;
          this.logger.debug(`Exported table: ${table} (${rows.length} rows)`);
        } catch (err) {
          this.logger.warn(`Failed to export table ${table}`, err);
        }
      }

      // 2. Collect OSS files
      let imageCount = 0;
      let fileCount = 0;
      // 迁移到腾讯云 COS 后，不再在系统备份中打包附件，以极大地提升备份效率


      // 3. Generate manifest
      const manifest = {
        version: '1.0',
        appName: 'CallCenter',
        createdAt: new Date().toISOString(),
        options: {
          includeImages: !!options.includeImages,
          includeFiles: !!options.includeFiles,
          includeAuditLogs: !!options.includeAuditLogs,
        },
        statistics: {
          tables: targetTables,
          tableRecordCounts,
          totalRecords,
          imageCount,
          fileCount,
        },
      };

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      await archive.finalize();
    });
  }

  /**
   * Restore system from a backup ZIP file
   */
  async restoreBackup(zipPath: string): Promise<{ code: number; message: string; details: any }> {
    const extractDir = join(backupsDir, `_restore_${Date.now()}`);

    try {
      this.logger.log(`Starting restore from: ${zipPath}`);

      // 1. Extract ZIP
      mkdirSync(extractDir, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: extractDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // 2. Validate manifest
      const manifestPath = join(extractDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        throw new Error('备份文件无效：缺少 manifest.json');
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.appName !== 'CallCenter') {
        throw new Error('备份文件无效：不是 CallCenter 系统的备份');
      }

      this.logger.log(`Restoring backup from ${manifest.createdAt}, tables: ${manifest.statistics?.tables?.length || 'unknown'}`);

      // 3. Disable foreign key checks
      await this.dataSource.query('SET FOREIGN_KEY_CHECKS = 0');

      try {
        // 4. Truncate all existing tables
        const currentTables = await this.getAllTableNames();
        for (const table of currentTables) {
          try {
            await this.dataSource.query(`TRUNCATE TABLE \`${table}\``);
            this.logger.debug(`Truncated table: ${table}`);
          } catch (err) {
            this.logger.warn(`Failed to truncate ${table}`, err);
          }
        }

        // 5. Import database JSON files
        const dbDir = join(extractDir, 'database');
        let importedTables = 0;
        let importedRecords = 0;

        if (existsSync(dbDir)) {
          const jsonFiles = readdirSync(dbDir).filter(f => f.endsWith('.json'));

          for (const file of jsonFiles) {
            const tableName = file.replace('.json', '');
            try {
              const rows = JSON.parse(readFileSync(join(dbDir, file), 'utf-8'));

              if (!Array.isArray(rows) || rows.length === 0) {
                this.logger.debug(`Skipping empty table: ${tableName}`);
                continue;
              }

              // Check if table exists in current database
              const tableExists = currentTables.includes(tableName);
              if (!tableExists) {
                this.logger.warn(`Table ${tableName} exists in backup but not in current database, skipping`);
                continue;
              }

              // Batch insert (500 rows per batch)
              const batchSize = 500;
              for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const columns = Object.keys(batch[0]);
                const escapedColumns = columns.map(c => `\`${c}\``).join(', ');
                const valuePlaceholders = batch.map(
                  () => `(${columns.map(() => '?').join(', ')})`
                ).join(', ');
                const values = batch.flatMap(row => columns.map(c => row[c]));

                await this.dataSource.query(
                  `INSERT INTO \`${tableName}\` (${escapedColumns}) VALUES ${valuePlaceholders}`,
                  values,
                );
              }

              importedTables++;
              importedRecords += rows.length;
              this.logger.debug(`Imported table: ${tableName} (${rows.length} rows)`);
            } catch (err) {
              this.logger.error(`Failed to import table ${tableName}`, err);
            }
          }
        }

        // 6. Restore OSS files
        let restoredImages = 0;
        let restoredFiles = 0;
        // 迁移到腾讯云 COS 后，不再恢复本地附件


        // 7. Re-enable foreign key checks
        await this.dataSource.query('SET FOREIGN_KEY_CHECKS = 1');

        // 8. Rebuild Elasticsearch indices
        try {
          this.logger.log('Rebuilding Elasticsearch indices...');
          await this.searchService.syncAll();
          this.logger.log('Elasticsearch rebuild completed');
        } catch (err) {
          this.logger.warn('Elasticsearch rebuild failed (non-critical)', err);
        }

        const details = {
          importedTables,
          importedRecords,
          restoredImages,
          restoredFiles,
          backupDate: manifest.createdAt,
        };

        this.logger.log(`Restore completed: ${JSON.stringify(details)}`);

        return {
          code: 0,
          message: '系统恢复成功！请重新登录。',
          details,
        };
      } catch (err) {
        // Make sure FK checks are re-enabled even on failure
        await this.dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
        throw err;
      }
    } catch (err) {
      this.logger.error('Restore failed', err);
      return {
        code: 1,
        message: `恢复失败：${err.message || '未知错误'}`,
        details: null,
      };
    } finally {
      // Clean up temp extract directory
      try {
        rmSync(extractDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  /**
   * List all backup files
   */
  async listBackups() {
    if (!existsSync(backupsDir)) {
      return { code: 0, data: [] };
    }

    const files = readdirSync(backupsDir)
      .filter(f => f.endsWith('.zip') && f.startsWith('backup_'))
      .sort()
      .reverse();

    const list = [];
    for (const f of files) {
      const fPath = join(backupsDir, f);
      try {
        const stat = statSync(fPath);

        // Try to read manifest from zip for metadata
        let manifest: any = null;
        try {
          const directory = await unzipper.Open.file(fPath);
          const manifestEntry = directory.files.find(e => e.path === 'manifest.json');
          if (manifestEntry) {
            const buf = await manifestEntry.buffer();
            manifest = JSON.parse(buf.toString('utf-8'));
          }
        } catch { /* skip */ }

        list.push({
          filename: f,
          size: stat.size,
          createdAt: manifest?.createdAt || stat.mtime.toISOString(),
          options: manifest?.options || {},
          statistics: manifest?.statistics || {},
        });
      } catch { /* skip broken files */ }
    }

    return { code: 0, data: list };
  }

  /**
   * Delete a specific backup file
   */
  async deleteBackup(filename: string) {
    const safeName = filename.replace(/[/\\]/g, '');
    const fPath = join(backupsDir, safeName);
    if (!existsSync(fPath)) {
      return { code: 1, message: '备份文件不存在' };
    }
    unlinkSync(fPath);
    this.logger.log(`Deleted backup: ${safeName}`);
    return { code: 0, message: '备份已删除' };
  }

  /**
   * Get full path of a backup file for download
   */
  getBackupPath(filename: string): string | null {
    const safeName = filename.replace(/[/\\]/g, '');
    const fPath = join(backupsDir, safeName);
    return existsSync(fPath) ? fPath : null;
  }

  // ---- Private Helpers ----

  private async getAllTableNames(): Promise<string[]> {
    const result = await this.dataSource.query('SHOW TABLES');
    return result.map((row: any) => Object.values(row)[0] as string);
  }
}
