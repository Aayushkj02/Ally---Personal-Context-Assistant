/**
 * OWNER: AAYUSH — task T3
 *
 * Adds the AUTOMATIC_ZEN_RULE_SETTINGS intent filter to MainActivity.
 *
 * WHY A PLUGIN AND NOT app.json:
 * Expo's `android.intentFilters` PREPENDS `android.intent.action.` to whatever action you
 * give it. This action lives in the `android.app.action` namespace, so app.json produced
 * `android.intent.action.android.app.action.AUTOMATIC_ZEN_RULE_SETTINGS` — a nonsense
 * action that registered fine and matched nothing. Expo's config cannot express actions
 * outside the android.intent.action namespace; a config plugin can.
 *
 * WHY IT IS NEEDED AT ALL:
 * Android rejects addAutomaticZenRule() with "Lacking enabled CPS or config activity"
 * unless the rule's configurationActivity resolves. See ADR-105.
 */

const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const ACTION = 'android.app.action.AUTOMATIC_ZEN_RULE_SETTINGS';
const CATEGORY = 'android.intent.category.DEFAULT';

module.exports = function withZenRuleIntentFilter(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const activity = (app.activity ?? []).find((a) => a.$?.['android:name'] === '.MainActivity');

    if (!activity) {
      throw new Error('withZenRuleIntentFilter: .MainActivity not found in AndroidManifest');
    }

    activity['intent-filter'] = activity['intent-filter'] ?? [];

    const already = activity['intent-filter'].some((f) =>
      (f.action ?? []).some((a) => a.$?.['android:name'] === ACTION),
    );

    if (!already) {
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': ACTION } }],
        category: [{ $: { 'android:name': CATEGORY } }],
      });
    }

    return cfg;
  });
};
