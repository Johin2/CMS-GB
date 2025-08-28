import './globals.css'; // keep your Tailwind/global styles
import NavBar from './components/NavBar';
export const metadata = {
  title: 'Glassbox Outreach',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white">
        <NavBar />
        <div className="mx-auto ">{children}</div>
      </body>
    </html>
  );
}
