/**
 * The data behind the lesson page: the course and curriculum around a lesson,
 * a learner's progress through it, its discussion thread and its quiz.
 */
export {
  createCommentSchema,
  deleteCommentSchema,
  editCommentSchema,
  saveNoteSchema,
  lessonRef,
  INTENT_CAPABILITY,
  getCourseWithDetails,
  getLessonById,
  getModuleById,
  getUserById,
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
  getLastWatchPosition,
  calculateWatchProgress,
  getCommentById,
  getLessonThread,
} from "./lib/data";
export {
  getQuizById,
  getQuizByLessonId,
  getQuizWithQuestions,
  getBestAttempt,
  computeResult,
  renderThread,
} from "./lib/quiz";
