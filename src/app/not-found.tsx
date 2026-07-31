import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="spatial-wash flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <Card>
          <CardContent className="space-y-4 pt-5 text-center">
            <Compass
              className="mx-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h1 className="font-semibold">That page does not exist</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                The link may be out of date, or you may not have access to it.
              </p>
            </div>
            <Button asChild className="w-full">
              <Link href="/dashboard">Back to your dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
