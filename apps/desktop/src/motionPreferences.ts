import { createMotionPreferences, setDefaultMotionPreferences } from '@ledge/ui/motionPreferences';
export * from '@ledge/ui/motionPreferences';

// Desktop keeps the `desktop.reducedMotion` key and registers it as what the shared mascots read.
export const { loadReduced, saveReduced, useMotionPreferences } = createMotionPreferences('desktop');
setDefaultMotionPreferences(useMotionPreferences);
