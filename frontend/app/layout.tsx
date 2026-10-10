import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JAL-SENTINEL — Autonomous Drainage Inundation & Evacuation Engine',
  description: 'Gauge-free optical flood tracking, dynamic evacuation routing, and municipal hazard remediation engine.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-sentinel-dark text-gray-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
