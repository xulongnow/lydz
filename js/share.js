/**
 * 分享编解码 + 截图分享（横切能力）
 * 编解码使用 TextEncoder + base64url，彻底弃用 escape/unescape
 */

/** 编码分享链接 */
export function encodeShare(resultId, path) {
  const payload = JSON.stringify({ r: resultId, p: path });
  const bytes = new TextEncoder().encode(payload);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `#s=${base64}`;
}

/** 解码分享链接 */
export function decodeShare(hash) {
  const m = hash.match(/^#s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const base64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

/** 异步截图（html2canvas 本地 vendored，带加载失败兜底） */
export async function takeScreenshot(targetElement, filename) {
  const toast = document.getElementById('screenshotToast');
  if (!toast) return;

  toast.textContent = '正在生成截图...';
  toast.classList.add('show');

  try {
    const module = await import('./vendor/html2canvas.esm.js');
    const html2canvas = module.default;
    const canvas = await html2canvas(targetElement, {
      backgroundColor: '#faf6ef',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = filename || '旅游搭子测试结果.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.textContent = '截图已保存';
  } catch (err) {
    console.error(err);
    toast.textContent = '截图失败，请手动截屏';
  }

  setTimeout(() => toast.classList.remove('show'), 2000);
}
