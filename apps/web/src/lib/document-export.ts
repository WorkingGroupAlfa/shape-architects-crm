export const WEB_TEMPLATE_LOGO_URL =
  '/shape-logo.webp';

export function prepareHtmlForWebExport(html: string) {
  return html
    .replace('/*__LOCAL_NOW_FONTS__*/', '')
    .replace(/__LOCAL_TEMPLATE_LOGO__/g, WEB_TEMPLATE_LOGO_URL);
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Failed to fetch asset: ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function prepareHtmlForPdfExport(html: string) {
  let logoSrc = WEB_TEMPLATE_LOGO_URL;
  try {
    logoSrc = await urlToDataUrl(WEB_TEMPLATE_LOGO_URL);
  } catch {
    // Fallback to URL if CORS blocks logo download. The rest of template still renders.
  }

  return html
    .replace('/*__LOCAL_NOW_FONTS__*/', '')
    .replace(/__LOCAL_TEMPLATE_LOGO__/g, logoSrc);
}

export async function generatePdfBase64FromHtml(html: string, fileName: string) {
  const preparedHtml = await prepareHtmlForPdfExport(html);
  const { default: html2pdf } = await import('html2pdf.js');
  const worker = html2pdf().set({
    filename: fileName,
    margin: 0,
    image: { type: 'jpeg', quality: 1 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
      width: 794,
      scrollX: 0,
      scrollY: 0
    },
    jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
  }).from(preparedHtml, 'string');

  const pdf = await worker.toPdf().get('pdf');
  return pdf.output('datauristring') as string;
}

export function pdfBase64ToBlob(pdfBase64: string) {
  const normalized = pdfBase64.trim();
  const cleanBase64 = normalized.startsWith('data:')
    ? normalized.slice(normalized.indexOf(',') + 1)
    : normalized;
  const binary = atob(cleanBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/pdf' });
}
