"use client";
import Link from "next/link";
import { formatRelative } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  contacts: Contact[];
}

function displayName(c: Contact): string {
  return c.display_name?.trim() || c.name?.trim() || "—";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first || first === "—") return "—";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

export function ContactsTable({ contacts }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Última atividade</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c.id} className="cursor-pointer">
            <TableCell>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                  aria-hidden
                >
                  {initials(displayName(c))}
                </span>
                <Link
                  href={`/app/contacts/${c.id}`}
                  className="font-semibold text-text hover:text-accent hover:underline"
                >
                  {displayName(c)}
                </Link>
              </div>
            </TableCell>
            <TableCell className="text-text-subtle">
              {c.email ?? "—"}
            </TableCell>
            <TableCell className="text-text-subtle tabular-nums">
              {c.phone_number ?? "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.length === 0
                  ? <span className="text-text-subtle text-xs">—</span>
                  : c.tags.map((t) => (
                      <Badge key={t} variant="neutral">{t}</Badge>
                    ))}
              </div>
            </TableCell>
            <TableCell className="text-text-subtle text-sm">
              {c.last_activity_at
                ? formatRelative(new Date(c.last_activity_at), new Date(), { locale: ptBR })
                : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
                {c.is_blocked && <Badge variant="warning">Bloqueado</Badge>}
                {!c.is_anonymized && !c.is_blocked && (
                  <Badge variant="success">Ativo</Badge>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
