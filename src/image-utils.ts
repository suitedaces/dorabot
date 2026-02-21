import sharp from 'sharp';

const MAX_DIMENSION = 7680;

// Downscale an image buffer so neither dimension exceeds MAX_DIMENSION.
// Falls back to the original buffer when metadata/decoding is unavailable.
export async function constrainImageSize(buffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const meta = await image.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w === 0 || h === 0 || (w <= MAX_DIMENSION && h <= MAX_DIMENSION)) {
      return buffer;
    }

    const scale = MAX_DIMENSION / Math.max(w, h);
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));

    return image
      .resize(newW, newH, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}
