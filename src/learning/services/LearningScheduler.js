'use strict';
/**
 * LearningScheduler - DISABLED
 * All automated learning cycles have been turned off to stop DB connection exhaustion.
 * No timers, no background jobs, no DB calls run automatically.
 */

const LearningScheduler = {
      start() {
              console.log('[LearningScheduler] DISABLED - no cycles will run');
      },
      stop() {
              console.log('[LearningScheduler] DISABLED - nothing to stop');
      },
      async runManual(cycleType = 'daily') {
              console.log('[LearningScheduler] DISABLED - manual cycle blocked');
              return { success: false, error: 'LearningScheduler is disabled' };
      },
      async getCycleHistory(limit = 20) {
              return [];
      },
      async evaluateKnownOutcomes() {
              return 0;
      },
      isStarted() { return false; }
};

module.exports = LearningScheduler;
