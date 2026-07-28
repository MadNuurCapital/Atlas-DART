"use client";

import { useState, useTransition } from "react";
import {
  Loader2,
  UserPlus,
  Search,
  Copy,
  Check,
  ShieldCheck,
  UserMinus,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  inviteUser,
  setUserRole,
  setUserActive,
} from "@/app/(app)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSgDate } from "@/lib/sg-date";
import type { Role } from "@/lib/constants";

export type ManagedUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  active: boolean;
  lastSubmission: string | null;
};

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("consultant");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [tempPassword, setTempPassword] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("fullName", fullName);
      fd.set("email", email);
      fd.set("role", role);

      const result = await inviteUser(fd);
      setErrors(result.fieldErrors ?? {});

      if (!result.ok) {
        if (result.message) toast.error(result.message);
        return;
      }

      if (result.temporaryPassword) {
        // Email is not configured. Keep the dialog open so the password can be
        // copied - closing it would lose the only copy that exists.
        setTempPassword(result.temporaryPassword);
        toast.warning(result.message ?? "Account created without an email.");
        return;
      }

      setFullName("");
      setEmail("");
      setRole("consultant");
      onOpenChange(false);
      if (result.message) toast.success(result.message);
    });
  }

  function reset() {
    setTempPassword(undefined);
    setCopied(false);
    setFullName("");
    setEmail("");
    setRole("consultant");
    setErrors({});
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : reset())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They receive an email to set their own password. Their profile is
            created automatically.
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-3">
            <div className="rounded-md border border-status-late/40 bg-status-late/5 px-3 py-2.5 text-sm">
              <p className="font-medium">
                The account exists, but the invitation email could not be sent.
              </p>
              <p className="mt-1 text-muted-foreground">
                Give <strong>{email}</strong> this password directly and ask
                them to change it after signing in. It is not stored anywhere
                and will not be shown again.
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                readOnly
                value={tempPassword}
                className="font-mono"
                aria-label="Temporary password"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(tempPassword);
                  setCopied(true);
                  toast.success("Copied.");
                }}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                Copy
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              To fix this properly, point Supabase&rsquo;s SMTP settings at your
              Resend account. See docs/netlify-deployment.md.
            </p>

            <div className="flex justify-end">
              <Button type="button" onClick={reset}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="As it should appear on the team board"
                autoComplete="off"
                disabled={pending}
                aria-invalid={errors.fullName ? true : undefined}
              />
              {errors.fullName && (
                <p className="text-sm text-destructive">{errors.fullName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                disabled={pending}
                aria-invalid={errors.email ? true : undefined}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                disabled={pending}
              >
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultant">Consultant</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Admins see the whole team and manage targets. They submit their
                own DART as well.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={reset}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                data-testid="send-invite"
                onClick={submit}
              >
                {pending && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Send invitation
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user }: { user: ManagedUser }) {
  const [pending, startTransition] = useTransition();

  function changeRole(role: Role) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      fd.set("role", role);
      const result = await setUserRole(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      fd.set("active", String(!user.active));
      const result = await setUserActive(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${
              user.active ? "" : "text-muted-foreground"
            }`}
          >
            {user.fullName}
          </span>
          {user.role === "admin" && (
            <Badge variant="secondary">
              <ShieldCheck className="size-3" aria-hidden="true" />
              Admin
            </Badge>
          )}
          {!user.active && <Badge variant="muted">Deactivated</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {user.email}
          {user.lastSubmission
            ? ` · last submitted ${formatSgDate(user.lastSubmission)}`
            : " · never submitted"}
        </p>
      </div>

      {user.active && (
        <Select
          value={user.role}
          onValueChange={(v) => changeRole(v as Role)}
          disabled={pending}
        >
          <SelectTrigger
            className="h-9 w-36"
            aria-label={`Role for ${user.fullName}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="consultant">Consultant</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Button
        type="button"
        size="sm"
        variant={user.active ? "ghost" : "secondary"}
        disabled={pending}
        onClick={toggleActive}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : user.active ? (
          <UserMinus aria-hidden="true" />
        ) : (
          <UserCheck aria-hidden="true" />
        )}
        {user.active ? "Deactivate" : "Reactivate"}
      </Button>
    </li>
  );
}

export function UserManager({ users }: { users: ManagedUser[] }) {
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      u.active !== showInactive &&
      (!q ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)),
  );

  const activeCount = users.filter((u) => u.active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
            aria-label="Search people"
          />
        </div>
        <Button
          type="button"
          onClick={() => setInviting(true)}
          data-testid="invite-user"
        >
          <UserPlus aria-hidden="true" />
          Invite
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={showInactive ? "ghost" : "secondary"}
          onClick={() => setShowInactive(false)}
        >
          Active ({activeCount})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={showInactive ? "secondary" : "ghost"}
          onClick={() => setShowInactive(true)}
        >
          Deactivated ({users.length - activeCount})
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {showInactive
                ? "Nobody is deactivated."
                : "Nobody matches that search."}
            </p>
          ) : (
            <ul>
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </div>
  );
}
