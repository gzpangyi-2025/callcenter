#!/bin/bash
set -e

INPUT_FILE="/Users/yipang/Documents/Codex/PPT生成/imagegen_body_region_test/antigravity_quota_monitor_analysis_test_v2_h873.pptx"
OUTPUT_FILE="/Users/yipang/Documents/Codex/PPT生成/imagegen_body_region_test/antigravity_quota_monitor_analysis_test_v2_h873_compressed_high_fidelity.pptx"
TEMP_DIR="/tmp/pptx_compress_$(date +%s)"

echo "1. Creating temp dir $TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "2. Unzipping PPTX..."
unzip -q "$INPUT_FILE" -d "$TEMP_DIR"

echo "3. Compressing images with sharp via Node..."
cat << 'EOF' > compress_images.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function processImages() {
  const mediaDir = path.join(process.argv[2], 'ppt', 'media');
  if (!fs.existsSync(mediaDir)) return;
  
  const files = fs.readdirSync(mediaDir);
  for (const file of files) {
    if (file.match(/\.(png|jpe?g)$/i)) {
      const filePath = path.join(mediaDir, file);
      const tempPath = filePath + '.tmp';
      console.log('Compressing', file);
      await sharp(filePath)
        .resize({ width: 3840, height: 2160, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, effort: 10 })
        .toFile(tempPath);
      fs.renameSync(tempPath, filePath);
    }
  }
}
processImages().catch(console.error);
EOF

node compress_images.js "$TEMP_DIR"

# Clean up the script before zipping
rm compress_images.js

echo "4. Zipping back to PPTX..."
rm -f "$OUTPUT_FILE"
cd "$TEMP_DIR"
zip -qr "$OUTPUT_FILE" .

echo "5. Cleaning up..."
cd - > /dev/null
rm -rf "$TEMP_DIR"

echo "Done! Saved to $OUTPUT_FILE"
