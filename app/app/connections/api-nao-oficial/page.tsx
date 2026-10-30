import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { declaracaoDoRiscoWhatsapp } from "@/lib/onboarding/risco-whatsapp";

export default async function ApiNaoOficialPage() {
  const user = await requireAuth();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {traduzir("Conexão por dispositivo vinculado", user.idioma)}
        </h1>
        <p className="text-muted-foreground">
          {traduzir(
            "O que esta conexão faz, quais riscos existem e como agir quando ela desconectar.",
            user.idioma,
          )}{" "}
        </p>
      </header>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">{traduzir("Resumo", user.idioma)}</h2>
        <p className="leading-relaxed">{declaracaoDoRiscoWhatsapp}</p>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">
          {traduzir("O que você precisa saber", user.idioma)}
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            {traduzir(
              "A integração não é fornecida, certificada ou suportada pela Meta.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir(
              "A sessão depende de um dispositivo vinculado e pode exigir novo QR Code.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir(
              "Uma desconexão interrompe as respostas até a sessão voltar a funcionar.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir("Durante o beta, prefira um número empresarial dedicado.", user.idioma)}
          </li>
          <li>
            {traduzir(
              "Não use o produto para campanhas, listas, grupos ou mensagens não solicitadas.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir("Você pode pausar a IA e assumir qualquer conversa pelo Inbox.", user.idioma)}
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">
          {traduzir("Se o número desconectar", user.idioma)}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            {traduzir(
              "Abra Conexões e confira o estado apresentado no cartão do número.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir(
              "Use a ação de reconectar e leia um novo QR Code quando solicitado.",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir(
              "Confirme que o estado voltou para conectado antes de esperar novas respostas.",
              user.idioma,
            )}
          </li>
        </ol>
      </section>
    </div>
  );
}
