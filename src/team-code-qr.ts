export async function teamCodeQrDataUrl(teamCode: string): Promise<string> {
  if (!/^#TA#[A-Za-z0-9+/_=-]+$/.test(teamCode)) throw new Error('没有可导出的有效阵容码');
  const QRCode = await import('qrcode');
  let errorCorrectionLevel: 'M' | 'L' = 'M';
  try { QRCode.create(teamCode, { errorCorrectionLevel }); }
  catch {
    errorCorrectionLevel = 'L';
    try { QRCode.create(teamCode, { errorCorrectionLevel }); }
    catch { throw new Error('阵容码过长，无法生成单张二维码'); }
  }
  return QRCode.toDataURL(teamCode, { type: 'image/png', margin: 4, scale: 8, errorCorrectionLevel, color: { dark: '#000000ff', light: '#ffffffff' } });
}
