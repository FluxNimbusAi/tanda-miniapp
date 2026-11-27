"use client";

import { Page } from "@/components/PageLayout";
import { UserInfo } from "@/components/UserInfo";
import { NotificationConsent } from "@/components/NotificationConsent";
import { useSession } from "next-auth/react";

// t_ux2_audit defect 1: Profile tab now resolves to a real screen -
// wallet identity, World verification state, and the notification
// consent switch (the retention-hook surface) in one place.
export default function ProfilePage() {
  const session = useSession();
  return (
    <Page>
      <Page.Main className="grid gap-6 px-6 py-4">
        <h1 className="text-xl font-semibold">Profile</h1>
        {session.status === "authenticated" ? <UserInfo /> : null}
        <NotificationConsent />
      </Page.Main>
    </Page>
  );
}
