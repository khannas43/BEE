import { notFound } from "next/navigation";
import { RegistrationReviews } from "@/components/app/registrations/RegistrationReviews";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. Programme and the Director reach it from the menu; other roles do not. */
export default function RegistrationReviewsPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <RegistrationReviews module={model} screen={{ ...dashboard, id: "registration-reviews", name: "Registration reviews" }} />;
}
