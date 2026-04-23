import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchService } from '../search/search.service';
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

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly searchService: SearchService,
  ) {
    // Ensure backups directory exists
    if (!existsSync(backupsDir)) {
      mkdirSync(backupsDir, { recursive: true });
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

    // OSS file stats
    let imageCount = 0;
    let fileCount = 0;
    let imageSize = 0;
    let fileSize = 0;

    if (existsSync(ossDir)) {
      const files = readdirSync(ossDir);
      for (const f of files) {
        const ext = extname(f).toLowerCase();
        const fPath = join(ossDir, f);
        try {
          const size = statSync(fPath).size;
          if (IMAGE_EXTS.has(ext)) {
            imageCount++;
            imageSize += size;
          } else {
            fileCount++;
            fileSize += size;
          }
        } catch { /* skip broken files */ }
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

      if (existsSync(ossDir)) {
        const ossFiles = readdirSync(ossDir);
        for (const f of ossFiles) {
          const ext = extname(f).toLowerCase();
          const fPath = join(ossDir, f);
          try {
            if (!statSync(fPath).isFile()) continue;
          } catch { continue; }

          if (IMAGE_EXTS.has(ext)) {
            if (options.includeImages) {
              archive.file(fPath, { name: `oss_images/${f}` });
              imageCount++;
            }
          } else {
            if (options.includeFiles) {
              archive.file(fPath, { name: `oss_files/${f}` });
              fileCount++;
            }
          }
        }
      }

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

        if (!existsSync(ossDir)) {
          mkdirSync(ossDir, { recursive: true });
        }

        // Restore images
        const imgDir = join(extractDir, 'oss_images');
        if (existsSync(imgDir)) {
          const imgFiles = readdirSync(imgDir);
          for (const f of imgFiles) {
            try {
              copyFileSync(join(imgDir, f), join(ossDir, f));
              restoredImages++;
            } catch (err) {
              this.logger.warn(`Failed to restore image ${f}`, err);
            }
          }
        }

        // Restore files
        const fileDir = join(extractDir, 'oss_files');
        if (existsSync(fileDir)) {
          const dataFiles = readdirSync(fileDir);
          for (const f of dataFiles) {
            try {
              copyFileSync(join(fileDir, f), join(ossDir, f));
              restoredFiles++;
            } catch (err) {
              this.logger.warn(`Failed to restore file ${f}`, err);
            }
          }
        }

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
