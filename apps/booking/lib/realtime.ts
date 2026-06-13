"use client";

/**
 * Realtime hints for SundayBooking. This is a HINT layer only — the DB
 * exclusion constraint (migration 0022) is the real double-booking guard, so
 * every subscription failure is swallowed and the UI degrades to manual
 * refresh. Two mechanisms:
 *
 *  1. postgres_changes on schema "booking" tables `booking` + `events` →
 *     debounced refetch so the calendar/queue update across clients.
 *  2. A per-resource(+day) Presence channel → when a user opens the create-form
 *     for a slot they broadcast presence; other viewers see a "someone is
 *     requesting this now" badge.
 *
 * Cross-device behaviour can't be verified headless — RIG-TEST with two
 * devices.
 */
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to booking changes + a tab-visibility regain, calling `onChange`
 * (debounced) whenever a refetch is warranted. Returns nothing; cleans up on
 * unmount. `onChange` should be stable (wrap in useCallback) or the effect
 * re-subscribes.
 */
export function useBookingRealtime(onChange: () => void): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 250);
    };

    let channel: RealtimeChannel | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel("booking-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "booking", table: "booking" },
          fire,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "booking", table: "events" },
          fire,
        )
        .subscribe();
    } catch {
      // Realtime unavailable → rely on manual refresh / visibility regain.
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      if (channel) {
        try {
          createClient().removeChannel(channel);
        } catch {
          /* swallow */
        }
      }
    };
  }, []);
}

export interface SlotPresence {
  userId: string;
  resourceId: string;
  at: number;
}

/**
 * Broadcast that the current user is requesting a slot on `resourceId` for the
 * local `dayKey` (YYYY-MM-DD), and report back whether ANYONE ELSE is also
 * present on that channel. Pass `resourceId=null` to leave/standby (form
 * closed). The callback receives the count of OTHER peers present.
 */
export function useSlotPresence(
  resourceId: string | null,
  dayKey: string | null,
  userId: string,
  onPeers: (otherCount: number) => void,
): void {
  const peersRef = useRef(onPeers);
  peersRef.current = onPeers;

  useEffect(() => {
    if (!resourceId || !dayKey) {
      peersRef.current(0);
      return;
    }
    let channel: RealtimeChannel | null = null;
    try {
      const supabase = createClient();
      const topic = `slot:${resourceId}:${dayKey}`;
      channel = supabase.channel(topic, {
        config: { presence: { key: userId } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          if (!channel) return;
          const state = channel.presenceState();
          // Count distinct presence keys that aren't us.
          const others = Object.keys(state).filter((k) => k !== userId).length;
          peersRef.current(others);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && channel) {
            channel
              .track({ userId, resourceId, at: Date.now() } satisfies SlotPresence)
              .catch(() => {});
          }
        });
    } catch {
      peersRef.current(0);
    }

    return () => {
      if (channel) {
        try {
          channel.untrack().catch(() => {});
          createClient().removeChannel(channel);
        } catch {
          /* swallow */
        }
      }
    };
  }, [resourceId, dayKey, userId]);
}
