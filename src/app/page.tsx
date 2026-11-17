import { Page } from '@/components/PageLayout';
import { AuthButton } from '../components/AuthButton';

export default function Home() {
  return (
    <Page>
      <Page.Main className="flex flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">Funded means funded.</h1>
          <p className="text-sm opacity-70">
            USDC sits in escrow from day one. When everyone confirms, money
            moves — nobody can ghost your payout.
          </p>
        </div>
        <AuthButton />
      </Page.Main>
    </Page>
  );
}
