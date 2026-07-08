import React from "react";
import "./globals.css";
import { OrchestratorProvider } from "../components/orchestrator/OrchestratorProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="h-full bg-charcoal-bg text-charcoal-text antialiased">
        <OrchestratorProvider>{children}</OrchestratorProvider>
      </body>
    </html>
  );
}
