/** POST /api/bookings/:id/decline — planner declines (→ booking.decline_booking). */
import { declineBooking } from "@/lib/data/booking";
import { handleBookingMutation } from "../_mutate";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleBookingMutation(params, declineBooking);
}
