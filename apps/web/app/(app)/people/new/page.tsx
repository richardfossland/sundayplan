import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddMemberForm } from "@/components/member-form";

export default function NewPersonPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/people" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← People
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Registry">Add a person</SectionTitle>
        </div>
        <p className="mt-2 text-sm text-ink-400">
          Phone is the highest-value field — SMS magic links are how volunteers respond.
        </p>
      </div>
      <Card className="px-5 py-5">
        <AddMemberForm />
      </Card>
    </div>
  );
}
