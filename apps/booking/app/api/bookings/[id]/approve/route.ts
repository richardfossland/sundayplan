/** POST /api/bookings/:id/approve — planner approves (→ booking.approve_booking). */
import { approveBooking } from "@/lib/data/booking";
import { handleBookingMutation } from "../_mutate";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleBookingMutation(params, approveBooking);
}
