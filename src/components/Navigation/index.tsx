"use client";

import { TabItem, Tabs } from "@worldcoin/mini-apps-ui-kit-react";
import { Bank, Home, Plus, User } from "iconoir-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Bottom navigation (mobile-first, World mini-app guidelines) — but the
 * tabs are ROUTES, not decoration (t_ux2_audit defect 1: the shipped TODO
 * "these currently don't link anywhere" is dead). Active tab derives from
 * the pathname so deep links (/bill/0x…) still highlight Home; tapping a
 * tab pushes its real route.
 */
const TAB_ROUTES: Record<string, string> = {
  home: "/home",
  new: "/home?intent=create",
  wallet: "/explorer",
  profile: "/profile",
};

export const Navigation = () => {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const isNew = sp.get("intent") === "create";
  const value =
    Object.entries(TAB_ROUTES).find(([, route]) =>
      route === "/home"
        ? (pathname === "/home" || pathname.startsWith("/bill")) && !isNew
        : route.startsWith("/home")
          ? pathname.startsWith("/home") && isNew
          : pathname.startsWith(route),
    )?.[0] ?? "home";

  return (
    <Tabs
      value={value}
      onValueChange={(v: string) => router.push(TAB_ROUTES[v] ?? "/home")}
    >
      <TabItem value="home" icon={<Home />} label="Home" />
      <TabItem value="new" icon={<Plus />} label="New" />
      <TabItem value="wallet" icon={<Bank />} label="Explorer" />
      <TabItem value="profile" icon={<User />} label="Profile" />
    </Tabs>
  );
};
