import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgentCast — link in. video out.",
  description: "Turn any article, blog, or doc into a short-form video in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-accent/30 selection:text-white`}>
        <Navbar />
        <main className="flex-1 flex flex-col items-center">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
