import formidable from 'formidable';
import fs from 'fs/promises';
import sharp from 'sharp';
import piexif from 'piexifjs';

export const config = { api: { bodyParser: false } };

// piexifjs работает со строками (binary string) — конвертеры:
function bufferToBinaryString(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return binary;
}
function binaryStringToBuffer(bin) {
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return Buffer.from(bytes.buffer);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Use POST');
    return;
  }

  try {
    // Если нужен простой ключ: раскомментируй строки ниже и добавь переменную окружения API_KEY в Vercel
    // if (process.env.API_KEY && req.headers['x-api-key'] !== process.env.API_KEY) {
    //   res.status(401).send('unauthorized');
    //   return;
    // }

    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const width  = Number(fields.width);
    const height = Number(fields.height);
    let outName  = (fields.outName?.toString() || 'out.jpg');

    if (!files?.picture) {
      res.status(400).send('missing file "picture"');
      return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      res.status(400).send('width/height must be numbers');
      return;
    }

    const file = Array.isArray(files.picture) ? files.picture[0] : files.picture;
    const inBuf = await fs.readFile(file.filepath);

    // piexifjs пишет EXIF только в JPEG → гарантируем JPEG-выход
    if (!/\.jpe?g$/i.test(outName)) outName = outName.replace(/\.\w+$/i, '') + '.jpg';

    // Если вход не JPEG — сконвертируем
    let jpegBuffer;
    const meta = await sharp(inBuf).metadata();
    if (meta.format !== 'jpeg') {
      jpegBuffer = await sharp(inBuf).jpeg({ quality: 95 }).toBuffer();
    } else {
      jpegBuffer = inBuf;
    }

    // Прописываем EXIF (PixelXDimension/PixelYDimension == ExifImageWidth/Height)
    const bin = bufferToBinaryString(jpegBuffer);

    let exifObj;
    try {
      exifObj = piexif.load(bin);
    } catch {
      exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": null };
    }
    exifObj.Exif[piexif.ExifIFD.PixelXDimension] = width;   // 0xA002
    exifObj.Exif[piexif.ExifIFD.PixelYDimension] = height;  // 0xA003

    const exifBytes = piexif.dump(exifObj);
    const withExif = piexif.insert(exifBytes, bin);
    const outBuffer = binaryStringToBuffer(withExif);

    // ВАЖНО: корректный тип и имя файла
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.status(200).end(outBuffer);
  } catch (e) {
    res.status(500).send(String(e));
  }
}
