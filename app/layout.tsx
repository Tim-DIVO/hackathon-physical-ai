import type { Metadata } from "next";
import "./globals.css";
import "./polish.css";
import "./cell-atlas.css";
import "./voice.css";
import "./live/live.css";
export const metadata: Metadata = {
  title: "LabLens — A clearer record of discovery",
  description:
    "An evidence-linked workspace for laboratory video, experiment notes, and sample provenance.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
