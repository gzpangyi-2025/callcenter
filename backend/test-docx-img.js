const { Document, Packer, Paragraph, ImageRun } = require('docx');
const fs = require('fs');
const sizeOf = require('image-size');

const imgPath = '/Users/yipang/Documents/code/callcenter/oss/1776935579975-212726359-70D563CC-91B1-40F1-8B4E-57C85ED66B0D.jpg';
if (fs.existsSync(imgPath)) {
  const buffer = fs.readFileSync(imgPath);
  const dims = sizeOf(buffer);
  console.log('Image dims:', dims);
} else {
  console.log('Image not found');
}
