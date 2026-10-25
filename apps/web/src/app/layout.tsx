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
  description:
    "Paste your product's URL. Web agents explore it, record the flows worth showing, and edit them into a narrated demo video.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {/* Marks the page as scripted before first paint, so hero motion starts hidden only when it will run. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
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
