import { exiftool } from 'exiftool-vendored';
import formidable from 'formidable';
import fs from 'fs/promises';
import path from 'path';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Use POST');
    return;
  }

  try {
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const width  = Number(fields.width);
    const height = Number(fields.height);
    const outName = (fields.outName?.toString() || 'out.jpg');

    if (!files.picture) {
      res.status(400).send('missing file field \"picture\"');
      return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      res.status(400).send('width/height must be numbers');
      return;
    }

    const file = Array.isArray(files.picture) ? files.picture[0] : files.picture;
    const inPath = file.filepath;
    const outPath = path.join(path.dirname(inPath), `exif_${Date.now()}_${outName}`);

    await exiftool.write(inPath, { ExifImageWidth: width, ExifImageHeight: height }, outPath);

    const buf = await fs.readFile(outPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=\"${outName}\"`);
    res.status(200).end(buf);

    try { await fs.unlink(outPath); } catch {}
  } catch (e) {
    res.status(500).send(String(e));
  }
}
