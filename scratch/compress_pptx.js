const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const archiver = require('archiver');
const sharp = require('sharp');

async function processFile() {
  const inputFile = '/Users/yipang/Documents/Codex/PPT生成/imagegen_body_region_test/antigravity_quota_monitor_analysis_test_v2_h873.pptx';
  const outputFile = '/Users/yipang/Documents/Codex/PPT生成/imagegen_body_region_test/antigravity_quota_monitor_analysis_test_v2_h873_compressed.pptx';
  const tempDir = path.join(__dirname, 'temp_unzip');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log('Unzipping PPTX...');
  await new Promise((resolve, reject) => {
    fs.createReadStream(inputFile)
      .pipe(unzipper.Extract({ path: tempDir }))
      .on('close', resolve)
      .on('error', reject);
  });

  console.log('Unzipped. Processing images in ppt/media...');
  const mediaDir = path.join(tempDir, 'ppt', 'media');
  if (fs.existsSync(mediaDir)) {
    const files = fs.readdirSync(mediaDir);
    for (const file of files) {
      if (file.toLowerCase().endsWith('.png') || file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')) {
        const filePath = path.join(mediaDir, file);
        const originalSize = fs.statSync(filePath).size;
        
        console.log(`Processing ${file} (Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB)...`);
        
        const tempFilePath = filePath + '.tmp';
        await sharp(filePath)
          .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
          .png({ palette: true, quality: 90 })
          .toFile(tempFilePath);
          
        fs.renameSync(tempFilePath, filePath);
        const newSize = fs.statSync(filePath).size;
        console.log(`  -> Compressed to: ${(newSize / 1024 / 1024).toFixed(2)} MB`);
      }
    }
  }

  console.log('Re-zipping into new PPTX...');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(tempDir, false);
    archive.finalize();
  });

  console.log('Done! Compressed file saved to:');
  console.log(outputFile);
  
  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
}

processFile().catch(console.error);
