import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// One face for the whole product, from the redesign: Schibsted Grotesk, heavy for display, regular for text.
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-schibsted",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgentCast — link in. video out.",
  description:
    "Paste your product's link. Web agents explore it, film the flows worth showing at 60 fps and cut a narrated demo video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable} suppressHydrationWarning>
      <head>
        {/* Marks the page as scripted before first paint, so entrances start hidden only when they will run. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
