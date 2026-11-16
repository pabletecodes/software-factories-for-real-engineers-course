import { db } from "~/db";
import { getLandingPage, type Db } from "./lib/landing";

export type { FeaturedCourse, LandingPage, LandingStats } from "./lib/landing";

const FEATURED_COURSE_COUNT = 3;

/**
 * What the landing page (`/`) shows, bound to a database. The app uses
 * `landing`, which reads the app database; tests build their own against a
 * test database.
 */
export function createLanding(database: Db) {
  return {
    /**
     * The newest published courses, each with its lesson count, and the
     * catalogue totals. Only published courses count anywhere.
     */
    get() {
      return getLandingPage(database, FEATURED_COURSE_COUNT);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const landing = /* @__PURE__ */ createLanding(db);
