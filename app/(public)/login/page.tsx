import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Entrar — LUA CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted-foreground">LUA CRM</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
