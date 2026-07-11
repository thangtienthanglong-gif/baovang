const screenshot = require('screenshot-desktop');
const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');

async function checkStranger() {
  try {
    const imgBuffer = await screenshot();
    
    // Read with Jimp and crop the top 500 pixels to avoid scanning chat history
    const image = await Jimp.read(imgBuffer);
    image.crop({ x: 0, y: 0, w: image.bitmap.width, h: Math.min(500, image.bitmap.height) });
    const croppedBuffer = await image.getBuffer('image/png');
    
    // Run OCR on the cropped top area
    const { data: { text } } = await Tesseract.recognize(croppedBuffer, 'vie');
    const upperText = text.toUpperCase();
    
    // Strict multi-word matching to prevent false positives from chat history
    const hasStrangerBadge = upperText.includes('NGƯỜI LẠ');
    const hasAddFriendBtn = upperText.includes('GỬI YÊU CẦU') && upperText.includes('KẾT BẠN');
    const hasNoMutualGroup = upperText.includes('KHÔNG CÓ') && upperText.includes('NHÓM CHUNG');
    
    if (hasStrangerBadge || hasAddFriendBtn || hasNoMutualGroup) {
      console.log('STRANGER');
      process.exit(1);
    } else {
      console.log('FRIEND');
      process.exit(0);
    }
  } catch (err) {
    console.error(err);
    process.exit(2);
  }
}
checkStranger();
