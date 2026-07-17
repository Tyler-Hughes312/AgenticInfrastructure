import React, { Suspense } from "react";
import "./globals.css";
import { ChatSessionProvider } from "../components/chat/ChatSessionProvider";
import { AuthProvider } from "../components/auth/AuthProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="h-full bg-charcoal-bg text-charcoal-text antialiased">
        <Suspense
          fallback={
            <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
              Loading...
            </div>
          }
        >
          <AuthProvider>
            <ChatSessionProvider>{children}</ChatSessionProvider>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
