import { requireAuth, isMfaEnrolled } from "@/lib/auth/server";
import { Card } from "@/components/ui/card";
import { SecurityClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  await requireAuth();
  const enrolled = await isMfaEnrolled();

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Segurança</h1>
        <p className="text-sm text-text-muted">MFA, recovery codes e sessões.</p>
      </header>

      <Card className="space-y-2 p-6">
        <h2 className="text-sm font-bold tracking-tight">MFA (TOTP)</h2>
        <p className="text-sm">
          {enrolled ? (
            <span className="font-semibold text-success-fg">Ativado.</span>
          ) : (
            <span className="font-semibold text-warning-fg">Não ativado.</span>
          )}
        </p>
        {!enrolled && (
          <p className="text-xs text-text-muted">
            Faça login novamente para iniciar o enrolamento.
          </p>
        )}
      </Card>

      <SecurityClient mfaEnrolled={enrolled} />
    </div>
  );
}
