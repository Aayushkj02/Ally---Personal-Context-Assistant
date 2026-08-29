/**
 * OWNER: DHREY
 *
 * Turns a mode's stored priority preferences into the shape the device layer accepts.
 *
 * THE HONEST GAP THIS LAYER MAKES EXPLICIT (ADR-111, ADR-301):
 * The user thinks per contact — "let Mom call me". Android thinks per SCOPE — starred
 * contacts, all contacts, or anyone. There is no per-individual-contact DND exception for
 * apps. So the resolver reduces "one or more enabled contacts on this channel" to "enable
 * this channel, scoped to starred contacts", and reports the named subjects alongside so
 * the UI can tell the user exactly who they must star.
 *
 * Pure: no I/O, no device calls. Unit-testable in Node.
 */

import type { Channel, ChannelEnforcement, PriorityPreference } from '../../types';
import { CHANNEL_ENFORCEABLE } from '../../types';

export interface ResolvedPriority {
  profileId: string;
  /** What the device layer is asked to switch on. */
  channels: Record<Channel, boolean>;
  /** The people the user named, per channel — for display, not for Android. */
  subjects: Record<Channel, string[]>;
  /**
   * Subjects on ENFORCEABLE channels that Android can only honour if they are starred
   * contacts. The UI shows this so "why didn't Mom ring?" has an answer on screen.
   */
  requiresStarring: string[];
  /** Channels stored but which Android cannot act on. Always includes whatsapp when used. */
  preferenceOnly: Channel[];
}

const EMPTY: Record<Channel, boolean> = { calls: false, sms: false, whatsapp: false };

export function resolvePriority(
  profileId: string,
  preferences: PriorityPreference[],
): ResolvedPriority {
  const mine = preferences.filter((p) => p.profileId === profileId && p.enabled);

  const channels: Record<Channel, boolean> = { ...EMPTY };
  const subjects: Record<Channel, string[]> = { calls: [], sms: [], whatsapp: [] };

  for (const p of mine) {
    channels[p.channel] = true;
    if (!subjects[p.channel].includes(p.subject)) subjects[p.channel].push(p.subject);
  }

  const requiresStarring = Array.from(
    new Set((['calls', 'sms'] as Channel[]).filter((c) => channels[c]).flatMap((c) => subjects[c])),
  );

  const preferenceOnly = (Object.keys(channels) as Channel[]).filter(
    (c) => channels[c] && !CHANNEL_ENFORCEABLE[c],
  );

  return { profileId, channels, subjects, requiresStarring, preferenceOnly };
}

/**
 * Merges what the user asked for with what the device reported back, so a screen renders
 * one list rather than reconciling two. A channel the user never enabled is `unsupported`
 * — nothing was requested, so nothing was applied.
 */
export function describeEnforcement(
  resolved: ResolvedPriority,
  deviceResult: ChannelEnforcement[] | null,
): ChannelEnforcement[] {
  const byChannel = new Map(deviceResult?.map((c) => [c.channel, c]) ?? []);

  return (Object.keys(resolved.channels) as Channel[]).map((channel) => {
    const reported = byChannel.get(channel);
    if (reported) return reported;

    // WhatsApp is preference-only whether or not anything is configured — that is a property
    // of the platform, not of the user's list. Reporting it as `unsupported` when empty read
    // as "your phone cannot do this", which is a different and wrong claim.
    if (!CHANNEL_ENFORCEABLE[channel]) {
      return {
        channel,
        status: 'preference_only' as const,
        message: 'Ally remembers this. Android cannot let Ally control it.',
      };
    }

    if (!resolved.channels[channel]) {
      return {
        channel,
        status: 'unsupported' as const,
        message: 'Nothing configured for this channel.',
      };
    }
    // Requested but the device layer said nothing — never assume it worked.
    return CHANNEL_ENFORCEABLE[channel]
      ? { channel, status: 'failed' as const, message: 'Ally could not confirm this with Android.' }
      : {
          channel,
          status: 'preference_only' as const,
          message: 'Ally remembers this. Android cannot let Ally control it.',
        };
  });
}
