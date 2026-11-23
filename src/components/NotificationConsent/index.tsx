'use client';

// W10 slice 1 (P1.1 prereq) — notifications consent banner.
// Gate for the server-side send-notification lane: World's API can only reach
// users who granted the permission via MiniKit. One-time prompt, honors the
// platform error codes (already_requested => user declined; don't nag again —
// guidelines compliance protects the capability; docs.world.org
// /mini-apps/guidelines/features-and-guidelines.md).
import { Button, ListItem } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { Permission } from '@worldcoin/minikit-js/commands';
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider';
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'tanda_notif_prompt_dismissed';

type State = 'checking' | 'granted' | 'prompt' | 'hidden';

export const NotificationConsent = () => {
  const [state, setState] = useState<State>('checking');
  const { isInstalled } = useMiniKit();

  useEffect(() => {
    if (!isInstalled) {
      setState('hidden');
      return;
    }
    const check = async () => {
      try {
        const result = await MiniKit.getPermissions();
        if (
          result.data.status === 'success' &&
          // biome-ignore lint/suspicious/noExplicitAny: permissions payload is loosely typed in 2.x
          (result.data.permissions as Record<string, unknown> | undefined)?.notifications === true
        ) {
          setState('granted');
          return;
        }
      } catch {
        // fall through to prompt path
      }
      setState(
        typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY)
          ? 'hidden'
          : 'prompt',
      );
    };
    check();
  }, [isInstalled]);

  const onClickEnable = async () => {
    try {
      const result = await MiniKit.requestPermission({ permission: Permission.Notifications });
      const status = (result as { data?: { status?: string } }).data?.status;
      if (status === 'success') {
        setState('granted');
        return;
      }
    } catch (err) {
      // MiniKit throws structured errors — user_rejected / already_requested mean
      // "stop prompting this install", already_granted means we're actually fine.
      const code = (err as { error?: string })?.error ?? '';
      if (code === 'already_granted') {
        setState('granted');
        return;
      }
      if (code === 'user_rejected' || code === 'already_requested') {
        window.localStorage.setItem(DISMISS_KEY, '1');
        setState('hidden');
        return;
      }
      console.error('requestPermission failed:', err);
    }
    setState('hidden');
  };

  if (state === 'hidden' || state === 'checking') return null;

  if (state === 'granted') {
    return (
      <ListItem
        description="Bill reminders and settlement updates enabled"
        label="Reminders on"
      />
    );
  }

  return (
    <div className="grid w-full gap-2 rounded-xl border p-4">
      <p className="text-sm font-semibold">Never chase a friend for money again</p>
      <p className="text-xs opacity-70">
        Get a nudge when a bill needs your confirm or is about to settle. Only
        for bills you&apos;re in — zero marketing.
      </p>
      <Button onClick={onClickEnable} size="lg" className="w-full">
        Enable reminders
      </Button>
    </div>
  );
};
