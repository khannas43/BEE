import type { Metadata } from "next";
import { inter, plusJakarta } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "BEE Standards & Labelling Portal",
  description:
    "Bureau of Energy Efficiency — Standards & Labelling Portal. Verify star-rated appliances, compare energy savings, and manage the model & label lifecycle.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} ${plusJakarta.className}`}>
      <body className="bg-surface font-body-md text-on-surface min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
