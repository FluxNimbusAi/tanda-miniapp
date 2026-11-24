import { auth } from "@/auth";
import { Navigation } from "@/components/Navigation";
import { Page } from "@/components/PageLayout";

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // If the user is not authenticated, redirect to the login page
  if (!session) {
    console.log("Not authenticated");
    // redirect('/');
  }

  return (
    <Page>
      {children}
      {/* DEF-4 [t_1d9b5038]: tab bar is <nav>, not a footer element —
          World mini-app rule bans <footer> on shipped surfaces. */}
      <nav className="fixed bottom-0 w-full bg-background">
        <Navigation />
      </nav>
    </Page>
  );
}
