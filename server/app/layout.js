export const metadata = {
  title: 'LiveArch',
  description: 'Hosted, shareable architecture diagrams.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
