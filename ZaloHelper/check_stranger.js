const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');

async function checkStranger() {
  try {
    const imgBuffer = await screenshot();
    
    // We run OCR on the full screenshot. It takes ~1-2s.
    const { data: { text } } = await Tesseract.recognize(imgBuffer, 'vie');
    const upperText = text.toUpperCase();
    
    // If we find any of these keywords, it's a stranger
    if (upperText.includes('NGƯỜI LẠ') || 
        upperText.includes('GỬI YÊU CẦU') || 
        upperText.includes('KẾT BẠN') || 
        upperText.includes('NHÓM CHUNG')) {
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
