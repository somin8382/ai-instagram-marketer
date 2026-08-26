"use client";

import { useRouter } from "next/navigation";
import { HomeLanding } from "@/lib/ui/home-landing";

/**
 * The signed-out front door, reachable while signed in. `/` redirects customers
 * to their dashboard, so this is how an owner checks what visitors actually see.
 */
export default function HomePreviewPage() {
  const router = useRouter();
  return (
    <HomeLanding isPreview onApply={() => router.push("/?screen=apply")} />
  );
}
