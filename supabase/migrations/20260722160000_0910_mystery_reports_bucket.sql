-- 0037_mystery_reports_bucket — bucket privado para os PDFs do Cliente Oculto
-- (laudo + transcrição). Acesso SOMENTE via service-role (upload no worker e
-- URL assinada na action getMysteryReportUrl) — service_role ignora RLS, então
-- não são necessárias policies em storage.objects. Idempotente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mystery-reports', 'mystery-reports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
