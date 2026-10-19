import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('sweep stale data', { minutes: 1 }, internal.sweep.sweep, {});

export default crons;
