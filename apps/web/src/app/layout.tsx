import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClerkProvider } from "@/components/ConvexClerkProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { buildBootInlineScript } from "@/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "alove — LaTeX workspace",
  description: "Premium LaTeX editor with Convex realtime and Clerk auth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-[100dvh] bg-background font-sans text-foreground antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: buildBootInlineScript() }} />
        <ThemeProvider>
          <ConvexClerkProvider>{children}</ConvexClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
