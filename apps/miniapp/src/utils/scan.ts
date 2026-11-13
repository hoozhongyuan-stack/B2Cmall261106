import Taro from '@tarojs/taro';
import jsQR from 'jsqr';

/**
 * H5 预览扫码：选择或拍摄一张包含二维码的图片并解码。
 * 小程序端直接使用 Taro.scanCode，不走这里。
 */
export async function scanQrFromImage(): Promise<string | null> {
  const result = await Taro.chooseImage({
    count: 1,
    sizeType: ['original'],
    sourceType: ['album', 'camera'],
  });
  const path = result.tempFilePaths?.[0];
  if (!path) return null;

  return new Promise<string | null>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height);
        const found = jsQR(pixels.data, pixels.width, pixels.height);
        resolve(found?.data ?? null);
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = path;
  });
}
