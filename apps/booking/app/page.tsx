/**
 * Home → the calendar is the app's centerpiece, so route there. Auth/session is
 * enforced by middleware; the calendar page resolves church membership.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect("/calendar");
}
