"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, X, Pencil, EyeOff, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  renameInsurer,
  setInsurerActive,
} from "@/app/(app)/admin/targets/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Insurer } from "@/types/database";

function InsurerRow({
  insurer,
  caseCount,
}: {
  insurer: Insurer;
  caseCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(insurer.name);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", insurer.id);
      fd.set("name", name);
      const result = await renameInsurer(fd);
      if (result.ok) {
        setEditing(false);
        toast.success(result.message ?? "Renamed.");
      } else {
        toast.error(
          result.fieldErrors?.name ?? result.message ?? "Could not rename.",
        );
      }
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", insurer.id);
      fd.set("active", String(!insurer.active));
      const result = await setInsurerActive(fd);
      if (result.ok) toast.success(result.message ?? "Updated.");
      else toast.error(result.message ?? "Could not update.");
    });
  }

  return (
    <li className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-0">
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            aria-label="Insurer name"
            className="h-10"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            onClick={save}
            aria-label="Save name"
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setName(insurer.name);
              setEditing(false);
            }}
            aria-label="Cancel"
          >
            <X aria-hidden="true" />
          </Button>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-sm ${insurer.active ? "" : "text-muted-foreground line-through"}`}
            >
              {insurer.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {caseCount === 0
                ? "No cases"
                : `${caseCount} case${caseCount === 1 ? "" : "s"}`}
              {insurer.created_by && " · added by an advisor"}
            </p>
          </div>

          {!insurer.active && <Badge variant="muted">Retired</Badge>}

          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(true)}
            aria-label={`Rename ${insurer.name}`}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            onClick={toggleActive}
            aria-label={
              insurer.active ? `Retire ${insurer.name}` : `Reinstate ${insurer.name}`
            }
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : insurer.active ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </Button>
        </>
      )}
    </li>
  );
}

export function InsurerManager({
  insurers,
  caseCounts,
}: {
  insurers: Insurer[];
  caseCounts: Record<string, number>;
}) {
  const [query, setQuery] = useState("");

  const filtered = insurers.filter((i) =>
    i.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search insurers"
        aria-label="Search insurers"
      />

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No insurers match that search.
            </p>
          ) : (
            <ul>
              {filtered.map((i) => (
                <InsurerRow
                  key={i.id}
                  insurer={i}
                  caseCount={caseCounts[i.id] ?? 0}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
