export interface TestCase {
  id: number;
  input: string;
  context?: { activeActivity?: 'study' | 'sleep' };
  expectedActivity: 'study' | 'sleep' | 'unknown';
  expectedOperation?: 'activate' | 'deactivate' | 'teach' | 'modify' | 'query';
}

export const EVAL_DATASET: TestCase[] = [
  // Golden 1: Teach Study profile
  {
    id: 1,
    input: 'When I study, keep silent and let my parents call me.',
    expectedActivity: 'study',
    expectedOperation: 'teach',
  },
  {
    id: 2,
    input: 'Whenever I am studying, turn on silent mode and allow calls from parents.',
    expectedActivity: 'study',
    expectedOperation: 'teach',
  },
  {
    id: 3,
    input: 'When I study, keep the phone silent and let my parents call me.',
    expectedActivity: 'study',
    expectedOperation: 'teach',
  },
  {
    id: 4,
    input: 'Set my study profile to silent and let parents call.',
    expectedActivity: 'study',
  },
  {
    id: 5,
    input: 'When I am studying block notifications and let parents call.',
    expectedActivity: 'study',
    expectedOperation: 'teach',
  },
  {
    id: 6,
    input: 'Remember for study sessions: keep silent and allow parents.',
    expectedActivity: 'study',
    expectedOperation: 'teach',
  },

  // Golden 2: Activate Study with duration
  {
    id: 7,
    input: "I'm going to study for two hours.",
    expectedActivity: 'study',
    expectedOperation: 'activate',
  },
  {
    id: 8,
    input: 'I am going to study for 2 hours.',
    expectedActivity: 'study',
    expectedOperation: 'activate',
  },
  {
    id: 9,
    input: 'Start studying for 120 minutes.',
    expectedActivity: 'study',
    expectedOperation: 'activate',
  },
  { id: 10, input: 'Study for 1 hour.', expectedActivity: 'study' },
  {
    id: 11,
    input: 'I am going to study for 3 hours.',
    expectedActivity: 'study',
    expectedOperation: 'activate',
  },
  {
    id: 12,
    input: 'Activate study mode for 30 minutes.',
    expectedActivity: 'study',
    expectedOperation: 'activate',
  },

  // Golden 3: Temporary override for project group
  {
    id: 13,
    input: 'Let my project group through for 20 minutes.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 14,
    input: 'Allow my project group to notify me for the next 20 mins.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 15,
    input: 'Let project group call me for 15 minutes.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 16,
    input: 'Allow project group messages for 30 minutes.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 17,
    input: 'Let project group notify me for 45 mins.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 18,
    input: 'Allow my project group for 10 minutes.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },

  // Golden 4: Deactivate Study
  {
    id: 19,
    input: "I'm done studying.",
    expectedActivity: 'study',
    expectedOperation: 'deactivate',
  },
  {
    id: 20,
    input: 'Finished studying.',
    expectedActivity: 'study',
    expectedOperation: 'deactivate',
  },
  { id: 21, input: 'Stop study mode.', expectedActivity: 'study', expectedOperation: 'deactivate' },
  { id: 22, input: 'Done studying.', expectedActivity: 'study', expectedOperation: 'deactivate' },
  {
    id: 23,
    input: 'Deactivate study mode.',
    expectedActivity: 'study',
    expectedOperation: 'deactivate',
  },
  {
    id: 24,
    input: 'End study session.',
    expectedActivity: 'study',
    expectedOperation: 'deactivate',
  },

  // Golden 5: Activate Sleep with alarm / schedule
  {
    id: 25,
    input: "I'm going to sleep. Wake me at 7 AM on weekdays.",
    expectedActivity: 'sleep',
    expectedOperation: 'activate',
  },
  { id: 26, input: 'Going to bed. Set alarm for 6:30 AM on weekdays.', expectedActivity: 'sleep' },
  { id: 27, input: "I'm off to bed. Wake me up at 8 AM on weekdays.", expectedActivity: 'sleep' },
  { id: 28, input: 'Going to sleep, alarm at 7:00 AM.', expectedActivity: 'sleep' },
  { id: 29, input: 'Sleep mode, wake me at 7 AM.', expectedActivity: 'sleep' },
  { id: 30, input: "I'm going to bed.", expectedActivity: 'sleep', expectedOperation: 'activate' },

  // Golden 6: Modify brightness
  {
    id: 31,
    input: 'Change Study brightness to 50%.',
    expectedActivity: 'study',
    expectedOperation: 'modify',
  },
  {
    id: 32,
    input: 'Set brightness to 40%.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 33,
    input: 'Modify study brightness to 60%.',
    expectedActivity: 'study',
    expectedOperation: 'modify',
  },
  {
    id: 34,
    input: 'Change brightness to 30%.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 35,
    input: 'Set brightness to 70%.',
    context: { activeActivity: 'study' },
    expectedActivity: 'study',
  },
  {
    id: 36,
    input: 'Change study brightness to 80%.',
    expectedActivity: 'study',
    expectedOperation: 'modify',
  },

  // Golden 7: Clarification / Unknown commands
  { id: 37, input: 'Turn on my washing machine.', expectedActivity: 'unknown' },
  { id: 38, input: 'Play some music.', expectedActivity: 'unknown' },
  { id: 39, input: 'Order a pizza.', expectedActivity: 'unknown' },
  { id: 40, input: 'What is the weather today?', expectedActivity: 'unknown' },
];
