import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WorkHub',
  description: 'Attendance, projects, clients and team chat in one workspace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
