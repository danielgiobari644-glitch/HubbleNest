import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgBuffer = fs.readFileSync('icon.svg');

async function generate() {
  // 192x192
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile('pwa-192x192.png');

  // 512x512
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile('pwa-512x512.png');

  // 180x180 for iOS apple-touch-icon
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile('apple-touch-icon.png');

  // 32x32 favicon
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile('favicon.png');

  // Maskable 512x512 with 15% padding safe-zone
  const innerSize = Math.round(512 * 0.76);
  const innerIcon = await sharp(svgBuffer)
    .resize(innerSize, innerSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 11, g: 15, b: 25, alpha: 1 } // Deep dark background
    }
  })
    .composite([{ input: innerIcon, gravity: 'center' }])
    .png()
    .toFile('pwa-maskable-512x512.png');

  console.log('All PWA icons generated successfully.');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
