import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: 'Copycat — 필터 실험실',
  description: '사진을 불러와 나만의 색감을 만드는 로컬 필터 실험실',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" data-theme="dark" data-astryx-theme="neutral">
      <body>{children}</body>
    </html>
  );
}
