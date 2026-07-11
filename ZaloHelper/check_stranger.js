const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');

async function checkStranger() {
  try {
    const imgBuffer = await screenshot();
    
    // Run OCR on the top area (height: 500)
    // Tesseract natively supports rectangle cropping without Jimp
    const { data: { text } } = await Tesseract.recognize(imgBuffer, 'vie', {
      rectangle: { top: 0, left: 0, width: 1920, height: 600 }
    });
    const upperText = text.toUpperCase();
    
    // Strict multi-word matching to prevent false positives from chat history
    const hasStrangerBadge = upperText.includes('NGƯỜI LẠ');
    const hasAddFriendBtn = upperText.includes('GỬI YÊU CẦU') && upperText.includes('KẾT BẠN');
    const hasNoMutualGroup = upperText.includes('KHÔNG CÓ') && upperText.includes('NHÓM CHUNG');
    
    if (hasStrangerBadge || hasAddFriendBtn || hasNoMutualGroup) {
      console.log('check_stranger: STRANGER DETECTED');
      return true;
    } else {
      console.log('check_stranger: FRIEND DETECTED');
      return false;
    }
  } catch (err) {
    console.error('OCR Error:', err);
    return false; // On error, assume friend to prevent blocking
  }
}

module.exports = { checkStranger };
