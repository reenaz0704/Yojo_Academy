/**
 * Trainer data rule (spec §6.7): before any student object reaches a trainer it is reduced to these fields.
 * Guardian, phone, email and fees never leave the server for a trainer. Later milestones call this from the
 * response serialiser of every trainer endpoint.
 */
export const TRAINER_VISIBLE_STUDENT_FIELDS = [
  'id',
  'name',
  'batch',
  'path',
  'rank',
  'labs',
  'quiz',
  'xp',
  'lastLabDays',
  'missed',
  'lastActive',
  'resume',
  'mocks',
  'portfolio',
  'internship',
] as const;

export type TrainerStudentView = Partial<Record<(typeof TRAINER_VISIBLE_STUDENT_FIELDS)[number], unknown>>;

export function projectStudentForTrainer(student: Record<string, unknown>): TrainerStudentView {
  const out: TrainerStudentView = {};
  for (const k of TRAINER_VISIBLE_STUDENT_FIELDS) if (k in student) out[k] = student[k];
  return out;
}
