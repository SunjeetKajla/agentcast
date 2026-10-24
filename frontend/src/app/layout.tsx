import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BackgroundVideo from "@/components/BackgroundVideo";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentCast — link in. video out.",
  description: "Turn any web SaaS into a high-impact demo video in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body
        className={`${inter.className} min-h-screen bg-[#050505] text-[#FAFAFA] flex flex-col antialiased selection:bg-white/20 selection:text-white relative overflow-x-hidden`}
      >
        <BackgroundVideo />
        <Navbar />
        <main className="flex-1 flex flex-col items-center relative z-10">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
