import { createMotionPreferences, setDefaultMotionPreferences } from '@ledge/ui/motionPreferences';
export * from '@ledge/ui/motionPreferences';

// The island keeps the `ledge.reducedMotion` key and registers it as what the shared mascots read.
export const { loadReduced, saveReduced, useMotionPreferences } = createMotionPreferences('ledge');
setDefaultMotionPreferences(useMotionPreferences);
