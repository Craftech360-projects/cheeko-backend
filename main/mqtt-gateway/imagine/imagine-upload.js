// imagine/imagine-upload.js
const axios = require('axios');
const FormData = require('form-data');

async function uploadImagineJpeg(jpegBuffer, { managerApiUrl, serviceKey }) {
  const form = new FormData();
  form.append('file', jpegBuffer, { filename: 'imagine.jpg', contentType: 'image/jpeg' });
  const res = await axios.post(`${managerApiUrl}/imagine/upload`, form, {
    headers: { ...form.getHeaders(), 'X-Service-Key': serviceKey },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 15000,
  });
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.url) {
    return res.data.data.url;
  }
  throw new Error(`imagine upload failed: ${JSON.stringify(res.data)}`);
}
module.exports = { uploadImagineJpeg };
