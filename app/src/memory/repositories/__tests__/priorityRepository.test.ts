/**
 * OWNER: DHREY — task D-V2
 *
 * Round-trips the priority_preference table through the repository, against the same
 * in-memory SQLite the other D1 repository tests use.
 */

import { getDatabase } from '../../database';
import { ensureSeeded } from '../../index';
import { priorityRepository } from '../priorityRepository';

const STUDY = 'profile_study';

describe('D-V2 priorityRepository', () => {
  beforeAll(async () => {
    await getDatabase();
    // priority_preference has a FK to context_profile, so a profile must exist.
    await ensureSeeded();
  });

  afterEach(async () => {
    await priorityRepository.clearProfile(STUDY);
  });

  it('round-trips a preference', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
      sourceCommand: 'let Mom call me while I study',
    });

    expect(created.subject).toBe('Mom');
    expect(created.channel).toBe('calls');
    expect(created.enabled).toBe(true);
    expect(created.sourceCommand).toBe('let Mom call me while I study');

    const listed = await priorityRepository.listForProfile(STUDY);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(created.id);
  });

  it('derives enforceable from the contract, not from the caller', async () => {
    const calls = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    const whatsapp = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });

    // CHANNEL_ENFORCEABLE is the single source of truth (ADR-111).
    expect(calls.enforceable).toBe(true);
    expect(whatsapp.enforceable).toBe(false);
  });

  it('is idempotent — re-adding the same subject updates one row', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });

    const listed = await priorityRepository.listForProfile(STUDY);
    expect(listed).toHaveLength(1);
  });

  it('re-adding a disabled subject switches it back on', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    await priorityRepository.setEnabled(created.id, false);

    const disabled = await priorityRepository.listForProfile(STUDY);
    expect(disabled[0]!.enabled).toBe(false);

    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });

    const reenabled = await priorityRepository.listForProfile(STUDY);
    expect(reenabled).toHaveLength(1);
    expect(reenabled[0]!.enabled).toBe(true);
  });

  it('toggling off keeps the row, so the list survives', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });

    await priorityRepository.setEnabled(created.id, false);

    const listed = await priorityRepository.listForProfile(STUDY);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.enabled).toBe(false);
  });

  it('the same subject on two channels are separate rows', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'sms',
      subject: 'Mom',
    });

    const listed = await priorityRepository.listForProfile(STUDY);
    expect(listed).toHaveLength(2);
  });

  it('is mode-scoped', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    await priorityRepository.addPreference({
      profileId: 'profile_sleep',
      channel: 'calls',
      subject: 'Dad',
    });

    const study = await priorityRepository.listForProfile(STUDY);
    expect(study.map((p) => p.subject)).toEqual(['Mom']);

    await priorityRepository.clearProfile('profile_sleep');
  });

  it('rejects a blank subject rather than storing a nameless row', async () => {
    await expect(
      priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: '   ' }),
    ).rejects.toThrow();

    const listed = await priorityRepository.listForProfile(STUDY);
    expect(listed).toHaveLength(0);
  });

  it('removes a preference', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });

    await priorityRepository.removePreference(created.id);

    expect(await priorityRepository.listForProfile(STUDY)).toHaveLength(0);
  });
});
