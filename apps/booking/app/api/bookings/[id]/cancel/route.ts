/** POST /api/bookings/:id/cancel — planner cancels (→ booking.cancel_booking). */
import { cancelBooking } from "@/lib/data/booking";
import { handleBookingMutation } from "../_mutate";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleBookingMutation(params, cancelBooking);
}
