const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');

async function checkStranger() {
  try {
    const imgBuffer = await screenshot();
    
    // For pkg compatibility, explicitly specify paths
    const workerPath = require('path').join(__dirname, 'node_modules/tesseract.js/src/worker-script/node/index.js');
    const corePath = require('path').join(__dirname, 'node_modules/tesseract.js-core');
    
    const worker = await Tesseract.createWorker('vie', 1, {
      workerPath,
      corePath,
      langPath: process.cwd(),
      logger: m => console.log(m)
    });
    
    // Do not use fixed rectangle because different monitors have different resolutions
    const { data: { text } } = await worker.recognize(imgBuffer);
    await worker.terminate();
    
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
    require('fs').writeFileSync('ocr_error.log', String(err));
    // If there is an error, block sending to prevent sending to strangers
    return true; 
  }
}

module.exports = { checkStranger };
