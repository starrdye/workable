import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DevErrorFilter } from "@/components/DevErrorFilter";
import { AIEngineProvider } from "@/contexts/AIEngineContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Workable — Personal Workflow Mapper",
  description: "Map your personal workflow, spot bottlenecks, and optimise how you work.",
  // Tab favicon is served automatically from src/app/icon.svg by Next.js App Router
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        {/* Suppress chrome-extension errors in dev only — never ships to production */}
        {process.env.NODE_ENV === "development" && <DevErrorFilter />}
        <LanguageProvider>
          <AIEngineProvider>
            {children}
          </AIEngineProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
