import type { Metadata } from 'next';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import { BookingProvider } from './state/BookingContext';
import { OrganizationJsonLd } from './organization-json-ld';

export const metadata: Metadata = {
  title: 'Ora Air',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <OrganizationJsonLd />
        <BookingProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </BookingProvider>
      </body>
    </html>
  );
}
