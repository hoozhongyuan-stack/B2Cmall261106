import { View } from '@tarojs/components';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

import './QrCode.css';

/**
 * 纯 JS 渲染二维码矩阵，避免 canvas / 外网图片依赖。
 * 核销码为 8 位数字，矩阵很小（21×21），逐格 View 渲染足够。
 */
export default function QrCode({ value, size = 320 }: { value: string; size?: number }) {
  const modules = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    return Array.from({ length: count }, (_, row) =>
      Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
    );
  }, [value]);

  return (
    <View className="qrcode" style={{ width: `${size}rpx`, height: `${size}rpx` }}>
      {modules.map((row, rowIndex) => (
        <View key={rowIndex} className="qrcode-row">
          {row.map((dark, colIndex) => (
            <View
              key={colIndex}
              className={`qrcode-cell${dark ? ' qrcode-cell--dark' : ''}`}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
