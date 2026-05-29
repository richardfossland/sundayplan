import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { NewTemplateForm } from "@/components/template-form";

export default function NewTemplatePage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/services/templates" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Templates
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Plan">New template</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <NewTemplateForm />
      </Card>
      <p className="text-center text-xs text-ink-600">
        You&apos;ll add the order of service and role requirements after creating it.
      </p>
    </div>
  );
}
