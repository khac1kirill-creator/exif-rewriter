import formidable from 'formidable';
import fs from 'fs/promises';
import sharp from 'sharp';
import piexif from 'piexifjs';

export const config = { api: { bodyParser: false } };

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
  if (req.method !== 'POST') return res.status(405).send('Use POST');

  try {
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const width  = Number(fields.width);
    const height = Number(fields.height);
    let outName  = (fields.outName?.toString() || 'out.jpg');

    if (!files?.picture) return res.status(400).send('missing file "picture"');
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return res.status(400).send('width/height must be numbers');
    }

    const file = Array.isArray(files.picture) ? files.picture[0] : files.picture;
    const inBuf = await fs.readFile(file.filepath);

    if (!/\.jpe?g$/i.test(outName)) outName = outName.replace(/\.\w+$/i, '') + '.jpg';

    let jpegBuffer;
    const meta = await sharp(inBuf).metadata();
    jpegBuffer = meta.format !== 'jpeg'
      ? await sharp(inBuf).jpeg({ quality: 95 }).toBuffer()
      : inBuf;

    const bin = bufferToBinaryString(jpegBuffer);
    let exifObj;
    try {
      exifObj = piexif.load(bin);
    } catch {
      exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": null };
    }
    exifObj.Exif[piexif.ExifIFD.PixelXDimension] = width;   // ExifImageWidth
    exifObj.Exif[piexif.ExifIFD.PixelYDimension] = height;  // ExifImageHeight

    const exifBytes = piexif.dump(exifObj);
    const withExif = piexif.insert(exifBytes, bin);
    const outBuffer = binaryStringToBuffer(withExif);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.status(200).end(outBuffer);
  } catch (e) {
    res.status(500).send(String(e));
  }
}
