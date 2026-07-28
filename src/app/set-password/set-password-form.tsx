"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { setPassword } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetPasswordForm() {
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{
    password?: string;
    confirm?: string;
  }>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("password", password);
      fd.set("confirm", confirm);

      // On success this redirects, so nothing after it runs.
      const result = await setPassword(fd);
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message);
    });
  }

  const longEnough = password.length >= 10;
  const matches = confirm.length > 0 && password === confirm;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPasswordValue(e.target.value)}
          disabled={pending}
          aria-invalid={errors.password ? true : undefined}
        />
        <p
          className={`text-xs ${longEnough ? "text-status-present" : "text-muted-foreground"}`}
        >
          {longEnough && <Check className="mr-1 inline size-3" aria-hidden="true" />}
          At least 10 characters
        </p>
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Type it again</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
          aria-invalid={errors.confirm ? true : undefined}
        />
        {matches && (
          <p className="text-xs text-status-present">
            <Check className="mr-1 inline size-3" aria-hidden="true" />
            They match
          </p>
        )}
        {errors.confirm && (
          <p className="text-sm text-destructive">{errors.confirm}</p>
        )}
      </div>

      {message && (
        <div
          role="alert"
          data-testid="set-password-error"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          {message}
        </div>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={pending || !longEnough || !matches}
        data-testid="save-password"
        onClick={submit}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Save and continue
      </Button>
    </div>
  );
}
